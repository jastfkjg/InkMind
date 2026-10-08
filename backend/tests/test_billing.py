"""Payment authorization, durable fulfillment, callbacks and refund uncertainty."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, get_db
from app.deps import get_current_user
from app.models import CreditLedger, PaymentNotification, PaymentOrder, User
from app.routers import billing as routes
from app.services import billing
from app.services.alipay_payment import PaymentGatewayError


@pytest.fixture
def fixture(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    db = sessions()
    user = User(email="test@example.com", hashed_password="unused", token_quota=100)
    other = User(email="other@example.com", hashed_password="unused", token_quota=100)
    db.add_all([user, other]); db.commit()
    config = SimpleNamespace(app_id="test-app", seller_id="test-seller", sandbox=True)
    response = {"code":"10000", "out_trade_no":"order-one", "total_amount":"0.01", "trade_no":"trade-one", "trade_status":"WAIT_BUYER_PAY"}
    gateway = SimpleNamespace(config=config, verify=lambda p, **kw: p.get("sign") == "valid",
                             query=lambda o: response, refund_query=lambda o: response,
                             close=lambda o: {"out_trade_no": o.out_trade_no}, checkout=lambda o: "<form></form>")
    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "desktop_mode", False)
    monkeypatch.setattr(settings, "billing_packages", [{"id":"starter", "name":"Starter", "amount_cents":1, "credits":1000}])
    monkeypatch.setattr(billing, "load_payment_config", lambda: config)
    monkeypatch.setattr(billing, "get_gateway", lambda: gateway)
    monkeypatch.setattr(routes, "get_gateway", lambda: gateway)
    order = billing.create_order(db, user.id, "starter", "first-request-key")
    order.out_trade_no = "order-one"; db.commit()
    app = FastAPI(); app.include_router(routes.router)
    def database():
        with sessions() as session: yield session
    def account():
        with sessions() as session: return session.get(User, user.id)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = account
    yield TestClient(app), db, user, other, order, response, gateway
    db.close(); engine.dispose()


def params(**changes):
    return {"app_id":"test-app", "seller_id":"test-seller", "out_trade_no":"order-one", "total_amount":"0.01",
            "trade_no":"trade-one", "trade_status":"TRADE_SUCCESS", "notify_id":"notification-one", "sign_type":"RSA2", "sign":"valid", **changes}


def test_order_creation_is_idempotent_and_owned(fixture):
    client, db, user, other, order, _, _ = fixture
    body = {"package_id":"starter", "request_key":"first-request-key", "accept_terms":True}
    response = client.post("/billing/orders", json=body).json()
    assert response["id"] == order.id
    expiry = datetime.fromisoformat(response["expires_at"])
    assert expiry.tzinfo is not None and expiry > datetime.now(timezone.utc)
    body["package_id"] = "another"
    assert client.post("/billing/orders", json=body).status_code == 409
    assert client.post("/billing/orders", json={**body, "accept_terms":False}).status_code == 422
    order.user_id = other.id; db.commit()
    assert client.post(f"/billing/orders/{order.id}/query").status_code == 404


@pytest.mark.parametrize("changes", [{"sign":"invalid"}, {"app_id":"other"}, {"seller_id":"other"}, {"total_amount":"0.02"}, {"out_trade_no":"other"}, {"notify_id":""}])
def test_notification_rejects_invalid_identity_signature_and_amount(fixture, changes):
    client, db, user, _, order, _, _ = fixture
    assert client.post("/billing/notify", data=params(**changes)).text == "fail"
    db.expire_all(); assert db.get(User, user.id).token_quota == 100
    assert db.get(PaymentOrder, order.id).status == "pending"


def test_notification_fulfills_once_even_with_new_notify_id(fixture):
    client, db, user, _, order, _, _ = fixture
    for notification in ("notification-one", "notification-one", "notification-two"):
        assert client.post("/billing/notify", data=params(notify_id=notification)).text == "success"
    db.expire_all()
    assert db.get(User, user.id).token_quota == 1100
    assert db.get(PaymentOrder, order.id).remaining_credits == 1000
    assert db.scalar(select(func.count(CreditLedger.id))) == 1
    assert db.scalar(select(func.count(PaymentNotification.id))) == 2


@pytest.mark.parametrize("changes", [{"refund_fee":"0.01"}, {"gmt_refund":"today"}, {"out_biz_no":"refund"}, {"trade_status":"TRADE_CLOSED"}, {"trade_status":"WAIT_BUYER_PAY"}])
def test_nonpayment_event_does_not_add_credits(fixture, changes):
    client, db, user, _, order, _, _ = fixture
    assert client.post("/billing/notify", data=params(**changes)).text == "success"
    db.expire_all(); assert db.get(User, user.id).token_quota == 100


def test_query_pending_unknown_closed_paid_and_duplicate_query(fixture):
    client, db, user, _, order, result, _ = fixture
    for state in ("WAIT_BUYER_PAY", "UNKNOWN", "NOT_FOUND"):
        result["trade_status"] = state
        assert client.post(f"/billing/orders/{order.id}/query").json()["status"] == "pending"
    result["trade_status"] = "TRADE_SUCCESS"
    assert client.post(f"/billing/orders/{order.id}/query").json()["status"] == "paid"
    assert client.post(f"/billing/orders/{order.id}/query").json()["status"] == "paid"
    db.expire_all(); assert db.get(User, user.id).token_quota == 1100


def test_return_shell_and_tampered_return_never_fulfill(fixture):
    client, db, user, _, _, _, _ = fixture
    shell = client.get("/billing/return")
    assert shell.status_code == 200 and "支付结果" in shell.text
    assert "Payment result" in client.get("/billing/return", headers={"Accept-Language":"en"}).text
    assert "无法确认" in client.get("/billing/return", params=params(sign="invalid")).text
    db.expire_all(); assert db.get(User, user.id).token_quota == 100


def test_cashier_remains_available_when_query_is_unavailable(fixture):
    client, db, user, _, order, _, gateway = fixture
    def unavailable(_):
        raise PaymentGatewayError("稍后查询原订单")
    gateway.query = unavailable
    assert client.post(f"/billing/orders/{order.id}/checkout").status_code == 200
    db.expire_all()
    assert db.get(User, user.id).token_quota == 100
    assert db.get(PaymentOrder, order.id).status == "pending"


def test_refund_unknown_freezes_once_and_query_requires_explicit_success(fixture):
    _, db, user, _, order, result, _ = fixture
    order = billing.confirm_payment(db, order, params())
    admin = User(email="admin@example.com", hashed_password="unused", is_admin=True); db.add(admin); db.commit()
    order = billing.prepare_refund(db, order, admin.id)
    refund_no = order.refund_no
    assert billing.prepare_refund(db, order, admin.id).refund_no == refund_no
    result.update(refund_amount="0.01", out_request_no=refund_no)
    for state in ("UNKNOWN", "REFUND_PROCESSING", ""):
        result["refund_status"] = state
        assert billing.sync_refund(db, order).status == "refunding"
    order.refund_requested_at = datetime.now(timezone.utc) - timedelta(seconds=11)
    result["refund_status"] = "REFUND_SUCCESS"
    assert billing.sync_refund(db, order).status == "refunded"
    assert db.get(User, user.id).token_quota == 100


def test_custom_and_disabled_billing_do_not_touch_packages(fixture, monkeypatch):
    _, db, user, _, order, _, _ = fixture
    billing.confirm_payment(db, order, params())
    monkeypatch.setattr(settings, "billing_enabled", False)
    billing.consume_paid_credits(db, user, 200)
    assert order.remaining_credits == 1000
    monkeypatch.setattr(settings, "billing_enabled", True)
    billing.consume_paid_credits(db, user, 150)
    assert order.remaining_credits == 950


def test_desktop_and_disabled_catalog_preserve_existing_behavior(fixture, monkeypatch):
    client, _, _, _, _, _, _ = fixture
    monkeypatch.setattr(settings, "billing_enabled", False)
    assert client.get("/billing/catalog").json()["packages"] == []
    assert client.post("/billing/orders", json={"package_id":"starter", "request_key":"valid-request-key", "accept_terms":True}).status_code == 404
    monkeypatch.setattr(settings, "desktop_mode", True)
    assert client.get("/billing/orders").status_code == 404
    assert client.post("/billing/notify", data=params()).text == "fail"


def test_billing_requires_explicit_priced_models(monkeypatch):
    monkeypatch.setattr(settings, "desktop_mode", False)
    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_models", [])
    with pytest.raises(RuntimeError, match="BILLING_MODELS"):
        billing.validate_configuration()
