"""Account-owned payment APIs and verified Alipay callbacks."""
from datetime import datetime, timezone
from hashlib import sha256
from html import escape
import logging
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import CurrentAdmin, CurrentUser
from app.models import AdminLog, CreditLedger, PaymentNotification, PaymentOrder, TokenReservation
from app.schemas.billing import PaymentOrderCreate, PaymentOrderResponse, ReservationReconcile
from app.services import billing
from app.services.alipay_payment import PaymentGatewayError, get_gateway

router = APIRouter(prefix="/billing", tags=["billing"])
DB = Annotated[Session, Depends(get_db)]
log = logging.getLogger(__name__)


def owned_order(db: Session, order_id: int, user_id: int) -> PaymentOrder:
    order = db.scalar(select(PaymentOrder).where(PaymentOrder.id == order_id, PaymentOrder.user_id == user_id))
    if order is None:
        raise HTTPException(404, "订单不存在。")
    billing.check_environment(order)
    return order


def gateway_failure(error: PaymentGatewayError) -> HTTPException:
    return HTTPException(503, str(error))


@router.get("/catalog")
def catalog(user: CurrentUser) -> dict:
    active = billing.purchase_enabled(user.id)
    return {"enabled": active, "sandbox": settings.alipay_sandbox,
            "metering_enabled": billing.enabled(),
            "custom_recharge": billing.custom_recharge() if active else None,
            "packages": [p.model_dump() for p in billing.packages()] if active else [],
            "models": [m.model_dump(include={"provider", "model", "input_rate", "output_rate"}) for m in billing.models()] if active else [],
            "terms_url": settings.billing_terms_url if active else "",
            "support_email": settings.billing_support_email if active else "",
            "can_purchase": active and user.token_quota is not None}


@router.get("/ledger")
def ledger(user: CurrentUser, db: DB, limit: int = Query(100, ge=1, le=500)) -> list[dict]:
    entries = db.scalars(select(CreditLedger).where(CreditLedger.user_id == user.id)
                        .order_by(CreditLedger.created_at.desc(), CreditLedger.id.desc()).limit(limit))
    return [{"id": entry.id, "kind": entry.kind, "amount": entry.amount, "order_id": entry.order_id,
             "event_key": entry.event_key, "created_at": entry.created_at} for entry in entries]


@router.get("/admin/reservations")
def reservations(admin: CurrentAdmin, db: DB) -> list[dict]:
    entries = db.scalars(select(TokenReservation).where(TokenReservation.status == "interrupted")
                        .order_by(TokenReservation.created_at).limit(500))
    return [{"id": entry.id, "user_id": entry.user_id, "amount": entry.amount, "provider": entry.provider,
             "model": entry.model, "action": entry.action, "created_at": entry.created_at} for entry in entries]


@router.post("/admin/reservations/{reservation_id}/reconcile")
def reconcile(reservation_id: str, body: ReservationReconcile, admin: CurrentAdmin, db: DB) -> dict:
    reservation = db.get(TokenReservation, reservation_id)
    if reservation is None:
        raise HTTPException(404, "额度预占不存在。")
    if reservation.status != "interrupted":
        raise HTTPException(409, "只能核对已中断的请求。")
    try:
        billing.settle(db, reservation.id, body.input_tokens, body.output_tokens)
        db.add(AdminLog(admin_id=admin.id, target_user_id=reservation.user_id, action="billing_reconcile",
                        details=f"reservation={reservation.id}; input={body.input_tokens}; output={body.output_tokens}; reason={body.reason}"))
        db.commit()
        return {"status":"settled"}
    except ValueError as error:
        db.rollback()
        raise HTTPException(409, str(error)) from None


@router.post("/orders", response_model=PaymentOrderResponse)
def create_order(body: PaymentOrderCreate, user: CurrentUser, db: DB) -> PaymentOrder:
    billing.require_purchase_enabled(user.id)
    try:
        return billing.create_order(db, user.id, body.package_id, body.request_key, body.amount_cents)
    except PaymentGatewayError as error:
        db.rollback()
        raise gateway_failure(error) from None


@router.get("/orders", response_model=list[PaymentOrderResponse])
def orders(user: CurrentUser, db: DB, limit: int = Query(50, ge=1, le=100)) -> list[PaymentOrder]:
    if settings.desktop_mode:
        raise HTTPException(404, "Not found")
    return list(db.scalars(select(PaymentOrder).where(PaymentOrder.user_id == user.id)
                          .order_by(PaymentOrder.created_at.desc(), PaymentOrder.id.desc()).limit(limit)))


@router.post("/orders/{order_id}/query", response_model=PaymentOrderResponse)
def query_order(order_id: int, user: CurrentUser, db: DB) -> PaymentOrder:
    try:
        return billing.sync_order(db, owned_order(db, order_id, user.id))
    except PaymentGatewayError as error:
        db.rollback()
        raise gateway_failure(error) from None


@router.post("/orders/{order_id}/checkout")
def checkout(order_id: int, user: CurrentUser, db: DB) -> dict[str, str]:
    billing.require_purchase_enabled(user.id)
    try:
        # Reopen the same merchant order; Alipay rejects already-paid/closed trades.
        # Generating the signed cashier form needs no remote query and stays usable
        # during a transient query failure. Fulfillment still requires verified results.
        order = owned_order(db, order_id, user.id)
        if order.status != "pending":
            raise HTTPException(409, "订单已结束，请查询订单结果。")
        if order.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
            raise HTTPException(409, "订单已过期，请关闭原订单后重新购买。")
        return {"payment_html": get_gateway().checkout(order)}
    except PaymentGatewayError as error:
        db.rollback()
        raise gateway_failure(error) from None


@router.post("/orders/{order_id}/close", response_model=PaymentOrderResponse)
def close_order(order_id: int, user: CurrentUser, db: DB) -> PaymentOrder:
    try:
        order = billing.sync_order(db, owned_order(db, order_id, user.id))
        if order.status != "pending":
            return order
        result = get_gateway().close(order)
        if result.get("trade_status") != "NOT_FOUND" and result.get("out_trade_no") != order.out_trade_no:
            raise PaymentGatewayError("关闭结果待确认，请查询原订单。")
        billing.lock_user(db, user.id)
        order = db.get(PaymentOrder, order.id)
        assert order is not None
        if order.status == "pending":
            order.status = "closed"
        db.commit()
        return order
    except PaymentGatewayError as error:
        db.rollback()
        raise gateway_failure(error) from None


@router.post("/admin/orders/{order_id}/refund", response_model=PaymentOrderResponse)
def refund(order_id: int, admin: CurrentAdmin, db: DB) -> PaymentOrder:
    try:
        order = db.get(PaymentOrder, order_id)
        if order is None:
            raise HTTPException(404, "订单不存在。")
        billing.check_environment(order)
        order = billing.prepare_refund(db, order, admin.id)
        if order.status == "refunded":
            return order
        result = get_gateway().refund(order)
        if result.get("fund_change") == "Y":
            return billing.finish_refund(db, order, {**result, "refund_status": "REFUND_SUCCESS"})
        return order  # Query the same refund number later; never issue a second refund.
    except PaymentGatewayError as error:
        db.rollback()
        raise gateway_failure(error) from None


@router.post("/admin/orders/{order_id}/refund-query", response_model=PaymentOrderResponse)
def refund_query(order_id: int, admin: CurrentAdmin, db: DB) -> PaymentOrder:
    try:
        order = db.get(PaymentOrder, order_id)
        if order is None or not order.refund_no:
            raise HTTPException(404, "退款单不存在。")
        billing.check_environment(order)
        return billing.sync_refund(db, order)
    except PaymentGatewayError as error:
        db.rollback()
        raise gateway_failure(error) from None


@router.post("/notify", response_class=PlainTextResponse)
async def notify(request: Request, db: DB) -> PlainTextResponse:
    try:
        if settings.desktop_mode:
            return PlainTextResponse("fail")
        form = await request.form()
        pairs = list(form.multi_items())
        params = {key: value for key, value in pairs if isinstance(value, str)}
        # Reject ambiguity rather than silently discarding duplicate signed fields.
        if len(params) != len(pairs):
            return PlainTextResponse("fail")
        gateway = get_gateway()
        if params.get("app_id") != gateway.config.app_id or not gateway.verify(params):
            return PlainTextResponse("fail")
        order = db.scalar(select(PaymentOrder).where(PaymentOrder.out_trade_no == params.get("out_trade_no")))
        if order is None:
            return PlainTextResponse("fail")
        billing.check_environment(order)
        if (params.get("seller_id") != gateway.config.seller_id
                or not billing.amount_matches(params.get("total_amount"), order.amount_cents)
                or not params.get("notify_id") or not params.get("trade_no") or not params.get("trade_status")):
            return PlainTextResponse("fail")
        billing.lock_user(db, order.user_id)
        order = db.get(PaymentOrder, order.id)
        assert order is not None
        if order.trade_no and order.trade_no != params["trade_no"]:
            return PlainTextResponse("fail")
        other_event = any(params.get(k) for k in ("out_biz_no", "gmt_refund", "refund_fee"))
        event_type = "other" if other_event else "payment"
        event_id = sha256("|".join((params["notify_id"], order.out_trade_no, params["trade_no"],
                                  params["trade_status"], event_type)).encode()).hexdigest()
        if db.get(PaymentNotification, event_id) is not None:
            db.commit()
            return PlainTextResponse("success")
        db.add(PaymentNotification(id=event_id, order_id=order.id, notify_id=params["notify_id"],
                                   trade_no=params["trade_no"], trade_status=params["trade_status"], event_type=event_type))
        if not other_event and params["trade_status"] in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
            billing.confirm_payment(db, order, params, notification=True, commit=False)
        db.commit()
        return PlainTextResponse("success")
    except Exception:
        db.rollback()
        log.warning("Alipay notification rejected or could not be committed")
        return PlainTextResponse("fail")


def result_page(request: Request, state: str) -> HTMLResponse:
    zh = not request.headers.get("accept-language", "zh").lower().startswith("en")
    labels = {
        "neutral": ("支付结果", "请回到用量页查询你的订单。", "Payment result", "Return to Usage to check your order."),
        "paid": ("付款已确认", "额度已到账，你可以继续写作。", "Payment confirmed", "Your credits are available. You can continue writing."),
        "pending": ("正在确认支付结果", "暂未确认付款，请回到用量页查询原订单，避免重复付款。", "Confirming payment", "Payment is still unconfirmed. Check the original order in Usage before paying again."),
        "closed": ("订单已关闭", "请回到用量页查看订单或重新购买。", "Order closed", "Return to Usage to review your order or purchase again."),
        "invalid": ("无法确认这次回跳", "请登录后在用量页查询原订单。", "Unable to verify this return", "Sign in and check the original order in Usage."),
    }
    title, detail = labels.get(state, labels["pending"])[0:2] if zh else labels.get(state, labels["pending"])[2:4]
    target = settings.billing_frontend_url
    parsed = urlparse(target)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        target = "http://localhost:5173/usage" if settings.alipay_sandbox else "/usage"
    action = "返回用量页" if zh else "Back to Usage"
    return HTMLResponse(f'''<!doctype html><html lang="{"zh-CN" if zh else "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{escape(title)} · InkMind</title>
<style>:root{{--canvas:#faf9f5;--ink:#141413;--muted:#6c6a64;--primary:#a9583e;--line:#e6dfd8;color-scheme:light dark}}
@media(prefers-color-scheme:dark){{:root{{--canvas:#181715;--ink:#faf9f5;--muted:#a09d96;--primary:#cc785c;--line:#3d3d3a}}}}
*{{box-sizing:border-box}}body{{margin:0;padding:24px;background:var(--canvas);color:var(--ink);font:16px/1.65 system-ui,sans-serif}}
main{{max-width:560px;margin:15vh auto}}header{{color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:16px}}
h1{{font-size:28px;font-weight:500;line-height:1.3}}p{{color:var(--muted)}}a{{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;background:var(--primary);color:var(--canvas);border-radius:8px;text-decoration:none}}a:focus-visible{{outline:3px solid var(--primary);outline-offset:4px}}</style>
</head><body><main><header>InkMind</header><h1>{escape(title)}</h1><p role="status">{escape(detail)}</p><a href="{escape(target, quote=True)}">{action}</a></main></body></html>''', headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@router.get("/return", response_class=HTMLResponse, include_in_schema=False)
def payment_return(request: Request, db: DB) -> HTMLResponse:
    if not request.query_params:
        return result_page(request, "neutral")
    try:
        pairs = list(request.query_params.multi_items())
        params = dict(pairs)
        gateway = get_gateway()
        if (len(params) != len(pairs) or params.get("app_id") != gateway.config.app_id
                or not gateway.verify(params, notification=False)):
            return result_page(request, "invalid")
        order = db.scalar(select(PaymentOrder).where(PaymentOrder.out_trade_no == params.get("out_trade_no")))
        if order is None:
            return result_page(request, "invalid")
        # The signed return only locates the order. Authoritative query decides payment.
        order = billing.sync_order(db, order)
        return result_page(request, order.status)
    except Exception:
        db.rollback()
        return result_page(request, "pending")
