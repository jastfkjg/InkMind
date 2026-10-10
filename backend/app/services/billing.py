"""Opt-in billing, atomic credits and durable reservations (single-worker deployment)."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING
import logging
from uuid import uuid4
from urllib.parse import urlparse

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import CreditLedger, LLMUsageEvent, PaymentOrder, TokenReservation, User
from app.schemas.billing import BillingModel, CreditPackage
from app.services.alipay_payment import get_gateway, load_payment_config, return_url, PaymentGatewayError

log = logging.getLogger(__name__)
_payment_test_ready = True


def enabled() -> bool:
    return settings.billing_enabled and not settings.desktop_mode


def purchase_enabled(user_id: int) -> bool:
    return not settings.desktop_mode and (enabled() or (
        _payment_test_ready and user_id in settings.billing_payment_test_user_ids))


def custom_recharge() -> dict[str, int] | None:
    rate = settings.billing_custom_credits_per_cent
    return {"min_cents": 100, "max_cents": 100000000, "credits_per_cent": rate} if rate else None


def packages() -> list[CreditPackage]:
    return [CreditPackage.model_validate(p) for p in settings.billing_packages]


def models() -> list[BillingModel]:
    return [BillingModel.model_validate(m) for m in settings.billing_models]


def validate_configuration() -> None:
    global _payment_test_ready
    _payment_test_ready = True
    try:
        _validate_configuration()
    except (PaymentGatewayError, RuntimeError, ValueError):
        if enabled():
            raise
        # An optional payment test must never prevent existing writing features
        # from starting. Hide purchases until the configuration is corrected.
        _payment_test_ready = False
        log.error("Payment test disabled because its configuration is unavailable")


def _validate_configuration() -> None:
    if not enabled() and (settings.desktop_mode or not settings.billing_payment_test_user_ids):
        return
    if enabled() and not models():
        raise RuntimeError("启用收费前必须配置 BILLING_MODELS 及计费倍率。")
    if any(model.provider not in {"openai", "anthropic", "qwen", "deepseek", "minimax", "kimi", "glm"} for model in models()):
        raise RuntimeError("付费模型厂商必须使用受支持的用量适配器。")
    for items, keys in ((packages(), lambda p: p.id), (models(), lambda m: (m.provider, m.model))):
        identifiers = [keys(item) for item in items]
        if len(set(identifiers)) != len(identifiers):
            raise RuntimeError("收费配置中存在重复套餐或模型。")
    if any(p.id == "custom" for p in packages()):
        raise RuntimeError("套餐 ID custom 保留给自定义充值。")
    if not packages() and not custom_recharge():  # Allow metering rollout before opening the shop.
        return
    required = (settings.billing_terms_url,) if settings.alipay_sandbox else (settings.billing_terms_url, settings.billing_support_email)
    if not all(required):
        raise RuntimeError("收款配置不完整，请按 docs/PAYMENTS.md 配置后启用。")
    return_url()
    if not settings.alipay_sandbox and not settings.alipay_notify_url:
        raise RuntimeError("生产收款必须配置公网 HTTPS 通知地址。")
    for url in filter(None, (settings.alipay_notify_url, settings.billing_terms_url)):
        parsed = urlparse(url)
        sandbox_terms = (settings.alipay_sandbox and url == settings.billing_terms_url
                         and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"})
        if not parsed.hostname or parsed.username or parsed.fragment or (parsed.scheme != "https" and not sandbox_terms):
            raise RuntimeError("收款通知、返回页和服务条款必须使用有效 HTTPS 地址。")
    get_gateway()  # Validate key configuration without contacting Alipay.


def require_enabled() -> None:
    if not enabled():
        raise HTTPException(404, "收款功能未启用。")


def require_purchase_enabled(user_id: int) -> None:
    if not purchase_enabled(user_id):
        raise HTTPException(404, "收款功能未启用。")


def model_rate(provider: str, model: str) -> BillingModel:
    name = "kimi" if provider == "moonshot" else provider
    for item in models():
        if item.provider == name and item.model == model:
            return item
    raise ValueError("该平台模型尚未开放付费使用，请选择已支持的模型或自带 API Key。")


def cost(input_tokens: int, output_tokens: int, input_rate: Decimal, output_rate: Decimal) -> int:
    if input_tokens < 0 or output_tokens < 0:
        raise ValueError("无效用量。")
    return int((input_tokens * input_rate + output_tokens * output_rate).to_integral_value(rounding=ROUND_CEILING))


def lock_user(db: Session, user_id: int) -> User:
    # UPDATE obtains the SQLite write lock; refresh defeats an ORM identity-map race.
    db.execute(update(User).where(User.id == user_id).values(token_quota_reserved=User.token_quota_reserved))
    db.expire_all()
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "用户不存在。")
    return user


def effective_used(db: Session, user: User) -> int:
    from app.llm.metered_llm import get_effective_token_quota_used
    return get_effective_token_quota_used(db, user)


def create_order(db: Session, user_id: int, package_id: str | None, request_key: str,
                 amount_cents: int | None = None) -> PaymentOrder:
    require_purchase_enabled(user_id)
    custom = amount_cents is not None
    if custom:
        if package_id is not None or type(amount_cents) is not int or not 100 <= amount_cents <= 100000000:
            raise HTTPException(400, "自定义充值最低 1 元，金额必须精确到分。")
        package_id = "custom"
    elif not package_id or package_id == "custom":
        raise HTTPException(400, "请选择套餐或自定义充值金额。")
    user = lock_user(db, user_id)
    if user.token_quota is None:
        raise HTTPException(409, "当前账号额度无限制，无需购买。")
    key = f"{user_id}:{request_key}"
    existing = db.scalar(select(PaymentOrder).where(PaymentOrder.request_key == key))
    if existing:
        if existing.package_id != package_id or (custom and existing.amount_cents != amount_cents):
            raise HTTPException(409, "购买请求与原订单不一致。")
        db.commit()
        return existing
    if custom:
        configuration = custom_recharge()
        if configuration is None:
            raise HTTPException(400, "自定义充值尚未开放。")
        assert amount_cents is not None
        credits = amount_cents * configuration["credits_per_cent"]
        subject = "InkMind 自定义 AI 额度充值"
    else:
        package = next((p for p in packages() if p.id == package_id), None)
        if package is None:
            raise HTTPException(400, "额度包不存在或已下架。")
        amount_cents, credits = package.amount_cents, package.credits
        subject = f"InkMind {package.name}"
    now = datetime.now(timezone.utc)
    config = load_payment_config()
    order = PaymentOrder(user_id=user_id, request_key=key, package_id=package_id,
                         out_trade_no=f"IM{uuid4().hex}", subject=subject,
                         amount_cents=amount_cents, credits=credits,
                         app_id=config.app_id, seller_id=config.seller_id,
                         sandbox=config.sandbox, expires_at=now + timedelta(minutes=15))
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def check_environment(order: PaymentOrder) -> None:
    config = load_payment_config()
    if (order.app_id != config.app_id or order.seller_id != config.seller_id
            or order.sandbox != config.sandbox):
        raise HTTPException(409, "订单与当前收款环境不一致，请联系管理员。")


def amount_matches(value: object, cents: int) -> bool:
    try:
        return Decimal(str(value)).is_finite() and Decimal(str(value)) == Decimal(cents) / 100
    except Exception:
        return False


def confirm_payment(db: Session, order: PaymentOrder, params: dict, *, notification: bool = False, commit: bool = True) -> PaymentOrder:
    check_environment(order)
    if (params.get("out_trade_no") != order.out_trade_no
            or not amount_matches(params.get("total_amount"), order.amount_cents)
            or not params.get("trade_no")):
        raise HTTPException(400, "支付订单校验失败。")
    if notification and (params.get("app_id") != order.app_id or params.get("seller_id") != order.seller_id):
        raise HTTPException(400, "收款身份校验失败。")
    if (params.get("trade_status") not in {"TRADE_SUCCESS", "TRADE_FINISHED"}
            or any(params.get(k) for k in ("out_biz_no", "gmt_refund", "refund_fee"))):
        return order
    user = lock_user(db, order.user_id)
    order = db.get(PaymentOrder, order.id)
    assert order is not None
    if order.trade_no and order.trade_no != params["trade_no"]:
        raise HTTPException(400, "交易号不一致。")
    if order.status in {"pending", "closed"}:
        # A late, verified success outranks a local expiry or close indication.
        if user.token_quota is None:
            raise HTTPException(409, "账号额度状态发生变化，请联系管理员处理订单。")
        user.token_quota += order.credits
        order.remaining_credits = order.credits
        order.trade_no = params["trade_no"]
        order.status = "paid"
        order.paid_at = datetime.now(timezone.utc)
        db.add(CreditLedger(user_id=user.id, event_key=f"pay:{order.id}", kind="purchase",
                            amount=order.credits, order_id=order.id))
    if commit:
        db.commit()
        db.refresh(order)
    return order


def sync_order(db: Session, order: PaymentOrder) -> PaymentOrder:
    check_environment(order)
    if order.status == "refunding":
        return sync_refund(db, order)
    if order.status != "pending":
        return order
    response = get_gateway().query(order)
    if response.get("trade_status") in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
        return confirm_payment(db, order, response)
    if response.get("trade_status") == "TRADE_CLOSED":
        lock_user(db, order.user_id)
        order = db.get(PaymentOrder, order.id)
        if order and order.status == "pending":
            order.status = "closed"
        db.commit()
    return order


def prepare_refund(db: Session, order: PaymentOrder, admin_id: int) -> PaymentOrder:
    user = lock_user(db, order.user_id)
    order = db.get(PaymentOrder, order.id)
    assert order is not None
    check_environment(order)
    if order.status in {"refunding", "refunded"}:
        db.commit()
        return order
    if (order.status != "paid" or order.remaining_credits != order.credits
            or user.token_quota is None or user.token_quota_reserved
            or user.token_quota - effective_used(db, user) < order.credits):
        raise HTTPException(409, "仅支持全额退还未使用额度包；请先结束 AI 任务。")
    order.refund_no = f"IR{uuid4().hex}"
    order.refund_requested_at = datetime.now(timezone.utc)
    order.status = "refunding"
    order.remaining_credits = 0
    user.token_quota -= order.credits
    db.add(CreditLedger(user_id=user.id, event_key=f"refund:{order.id}", kind="refund_hold",
                        amount=-order.credits, order_id=order.id))
    from app.models import AdminLog
    db.add(AdminLog(admin_id=admin_id, action="payment_refund", target_user_id=user.id,
                    details=f"退款订单 {order.out_trade_no}"))
    db.commit()
    db.refresh(order)
    return order


def finish_refund(db: Session, order: PaymentOrder, result: dict) -> PaymentOrder:
    amount = result.get("refund_amount", result.get("refund_fee"))
    if (not amount_matches(amount, order.amount_cents) or result.get("out_trade_no") != order.out_trade_no
            or result.get("trade_no") != order.trade_no
            or (result.get("out_request_no") and result["out_request_no"] != order.refund_no)
            or result.get("refund_status") != "REFUND_SUCCESS"):
        raise PaymentGatewayError("退款结果待确认，额度已冻结，请稍后查询原退款单。")
    lock_user(db, order.user_id)
    order = db.get(PaymentOrder, order.id)
    assert order is not None
    if order.status == "refunding":
        order.status = "refunded"
        order.refunded_at = datetime.now(timezone.utc)
        db.add(CreditLedger(user_id=order.user_id, event_key=f"refunded:{order.id}",
                            kind="refund_completed", amount=0, order_id=order.id))
    db.commit()
    return order


def sync_refund(db: Session, order: PaymentOrder) -> PaymentOrder:
    if order.refund_requested_at and datetime.now(timezone.utc) < order.refund_requested_at.replace(tzinfo=timezone.utc) + timedelta(seconds=10):
        return order
    result = get_gateway().refund_query(order)
    if result.get("refund_status") != "REFUND_SUCCESS":
        return order
    return finish_refund(db, order, result)


def consume_paid_credits(db: Session, user: User, tokens: int) -> None:
    """Keep refundable package balances aligned with the existing Token quota."""
    if not enabled() or user.token_quota is None or tokens <= 0:
        return
    user = lock_user(db, user.id)
    orders = list(db.scalars(select(PaymentOrder).where(
        PaymentOrder.user_id == user.id, PaymentOrder.status == "paid", PaymentOrder.remaining_credits > 0
    ).order_by(PaymentOrder.paid_at, PaymentOrder.id)))
    paid_remaining = sum(order.remaining_credits for order in orders)
    free_remaining = max(0, user.token_quota - effective_used(db, user) - paid_remaining)
    charge = max(0, tokens - free_remaining)
    consumption_id = uuid4().hex
    for order in orders:
        deduction = min(charge, order.remaining_credits)
        order.remaining_credits -= deduction
        charge -= deduction
        if deduction:
            db.add(CreditLedger(user_id=user.id, event_key=f"consume:{consumption_id}:{order.id}",
                               kind="consumption", amount=-deduction, order_id=order.id))


def reserve(db: Session, user_id: int, provider: str, model: str, action: str, amount: int) -> TokenReservation:
    rate = model_rate(provider, model)
    user = lock_user(db, user_id)
    used = effective_used(db, user)
    user.token_quota_used = used
    available = None if user.token_quota is None else user.token_quota - used - user.token_quota_reserved
    if amount <= 0 or (available is not None and available < amount):
        db.rollback()
        from app.llm.metered_llm import TokenQuotaExceededError
        raise TokenQuotaExceededError("AI 额度不足以完成此任务，请购买额度或缩短生成长度。",
                                      quota=user.token_quota, used=used, required=amount)
    user.token_quota_reserved += amount
    reservation = TokenReservation(id=uuid4().hex, user_id=user_id, amount=amount,
                                   provider=provider, model=model, action=action,
                                   input_rate=str(rate.input_rate), output_rate=str(rate.output_rate))
    db.add(reservation)
    db.commit()
    return reservation


def settle(db: Session, reservation_id: str, input_tokens: int, output_tokens: int) -> None:
    if any(type(value) is not int or value < 0 for value in (input_tokens, output_tokens)):
        raise ValueError("供应商用量无效，额度仍被预占，请联系管理员核对。")
    reservation = db.get(TokenReservation, reservation_id)
    if reservation is None:
        raise ValueError("额度预占不存在。")
    user = lock_user(db, reservation.user_id)
    reservation = db.get(TokenReservation, reservation_id)
    assert reservation is not None
    if reservation.status not in {"active", "interrupted"}:
        db.commit()
        return
    charge = cost(input_tokens, output_tokens, Decimal(reservation.input_rate), Decimal(reservation.output_rate))
    if charge > reservation.amount:
        raise ValueError("供应商用量超过预占上限，额度仍被预占，请联系管理员核对。")
    used = effective_used(db, user)
    paid_orders = list(db.scalars(select(PaymentOrder).where(
        PaymentOrder.user_id == user.id, PaymentOrder.status == "paid", PaymentOrder.remaining_credits > 0
    ).order_by(PaymentOrder.paid_at, PaymentOrder.id)))
    paid_remaining = sum(o.remaining_credits for o in paid_orders)
    free_remaining = max(0, (user.token_quota or 0) - used - paid_remaining)
    paid_charge = max(0, charge - free_remaining)
    attributed_charge = 0
    for order in paid_orders:
        deduction = min(paid_charge, order.remaining_credits)
        order.remaining_credits -= deduction
        paid_charge -= deduction
        if deduction:
            attributed_charge += deduction
            db.add(CreditLedger(user_id=user.id, event_key=f"use:{reservation.id}:order:{order.id}",
                                kind="consumption", amount=-deduction, order_id=order.id))
    user.token_quota_used = used + charge
    user.token_quota_reserved = max(0, user.token_quota_reserved - reservation.amount)
    user.llm_call_count += 1
    reservation.status = "settled"
    if charge != attributed_charge or charge == 0:
        db.add(CreditLedger(user_id=user.id, event_key=f"use:{reservation.id}", kind="consumption", amount=-(charge-attributed_charge)))
    db.add(LLMUsageEvent(user_id=user.id, provider=reservation.provider, source="builtin", model=reservation.model,
                         action=reservation.action, input_tokens=input_tokens, output_tokens=output_tokens,
                         total_tokens=input_tokens + output_tokens, billing_credits=charge))
    db.commit()


def interrupt_reservation(db: Session, reservation_id: str) -> None:
    reservation = db.get(TokenReservation, reservation_id)
    if reservation is not None:
        lock_user(db, reservation.user_id)
        reservation = db.get(TokenReservation, reservation_id)
    if reservation and reservation.status == "active":
        reservation.status = "interrupted"
        db.commit()


def recover_reservations(db: Session) -> None:
    # A restart cannot prove that the upstream request cost zero. Keep holds for reconciliation.
    db.execute(update(TokenReservation).where(TokenReservation.status == "active").values(status="interrupted"))
    db.commit()
