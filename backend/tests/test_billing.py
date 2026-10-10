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
from app.services.alipay_payment import PaymentGatewayError, _protected_file, _raw_key


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
    monkeypatch.setattr(billing, "_payment_test_ready", True)
    monkeypatch.setattr(settings, "billing_payment_test_user_ids", [])
    monkeypatch.setattr(settings, "billing_custom_credits_per_cent", 0)
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


@pytest.mark.parametrize("amount", [0, 1, 99, -100, 100000001, 100.5, "100", True, None])
def test_custom_recharge_rejects_invalid_money(fixture, monkeypatch, amount):
    client, db, user, _, _, _, _ = fixture
    monkeypatch.setattr(settings, "billing_custom_credits_per_cent", 10000)
    body = {"amount_cents":amount, "request_key":"custom-request-key", "accept_terms":True}
    assert client.post("/billing/orders", json=body).status_code == 422
    db.expire_all()
    assert db.get(User, user.id).token_quota == 100


def test_custom_recharge_is_server_priced_and_request_is_immutable(fixture, monkeypatch):
    client, db, user, _, _, _, _ = fixture
    body = {"amount_cents":123, "request_key":"custom-request-key", "accept_terms":True}
    assert client.post("/billing/orders", json=body).status_code == 400
    monkeypatch.setattr(settings, "billing_custom_credits_per_cent", 10000)
    result = client.post("/billing/orders", json=body).json()
    assert (result["package_id"], result["amount_cents"], result["credits"]) == ("custom", 123, 1230000)
    assert client.post("/billing/orders", json=body).json()["id"] == result["id"]
    assert client.post("/billing/orders", json={**body, "amount_cents":124}).status_code == 409
    assert client.post("/billing/orders", json={**body, "package_id":"starter"}).status_code == 422
    assert client.post("/billing/orders", json={**body, "credits":999999999}).status_code == 422
    assert client.post("/billing/orders", json={**body, "accept_terms":False}).status_code == 422
    assert client.post("/billing/orders", json={"package_id":"custom", "request_key":"another-request-key", "accept_terms":True}).status_code == 400
    # A price change never rewrites a previously accepted order.
    monkeypatch.setattr(settings, "billing_custom_credits_per_cent", 5000)
    assert client.post("/billing/orders", json=body).json()["credits"] == 1230000
    db.expire_all(); assert db.get(User, user.id).token_quota == 100


def test_custom_recharge_paid_once_and_wholly_unused_refund(fixture, monkeypatch):
    client, db, user, _, _, _, _ = fixture
    monkeypatch.setattr(settings, "billing_custom_credits_per_cent", 10000)
    result = client.post("/billing/orders", json={"amount_cents":100, "request_key":"custom-request-key", "accept_terms":True}).json()
    notification = params(out_trade_no=result["out_trade_no"], total_amount="1.00")
    for _ in range(2):
        assert client.post("/billing/notify", data=notification).text == "success"
    assert client.post(f'/billing/orders/{result["id"]}/query').json()["status"] == "paid"
    db.expire_all(); assert db.get(User, user.id).token_quota == 1000100
    assert db.scalar(select(func.count(CreditLedger.id)).where(CreditLedger.kind == "purchase")) == 1
    custom_order = db.get(PaymentOrder, result["id"])
    held = billing.prepare_refund(db, custom_order, user.id)
    billing.finish_refund(db, held, {"refund_amount":"1.00", "out_trade_no":held.out_trade_no,
                                  "trade_no":held.trade_no, "out_request_no":held.refund_no,
                                  "refund_status":"REFUND_SUCCESS"})
    db.expire_all(); assert db.get(User, user.id).token_quota == 100
    assert db.get(PaymentOrder, result["id"]).status == "refunded"


def test_payment_pilot_is_account_scoped_and_does_not_enable_ai_billing(fixture, monkeypatch):
    client, _, user, other, order, _, _ = fixture
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "billing_custom_credits_per_cent", 10000)
    monkeypatch.setattr(settings, "billing_payment_test_user_ids", [user.id])
    configuration = client.get("/billing/catalog").json()
    assert configuration["enabled"] and configuration["can_purchase"]
    assert configuration["custom_recharge"]["min_cents"] == 100
    assert not configuration["metering_enabled"] and not billing.enabled()
    assert not billing.purchase_enabled(other.id)
    assert client.post(f"/billing/orders/{order.id}/checkout").status_code == 200
    assert client.post("/billing/orders", json={"amount_cents":100, "request_key":"custom-request-key", "accept_terms":True}).status_code == 200
    monkeypatch.setattr(settings, "billing_payment_test_user_ids", [other.id])
    assert client.get("/billing/catalog").json()["custom_recharge"] is None
    assert client.post(f"/billing/orders/{order.id}/checkout").status_code == 404
    assert client.post("/billing/orders", json={"amount_cents":100, "request_key":"second-request-key", "accept_terms":True}).status_code == 404
    # Existing orders remain queryable after access is withdrawn.
    assert client.post(f"/billing/orders/{order.id}/query").status_code == 200
    monkeypatch.setattr(settings, "desktop_mode", True)
    assert not billing.purchase_enabled(other.id)


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


def test_payment_test_configuration_failure_preserves_service_and_can_recover(fixture, monkeypatch):
    client, _, user, _, _, _, gateway = fixture
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "billing_payment_test_user_ids", [user.id])
    monkeypatch.setattr(settings, "billing_models", [])
    monkeypatch.setattr(settings, "alipay_sandbox", False)
    monkeypatch.setattr(settings, "billing_terms_url", "https://example.com/terms")
    monkeypatch.setattr(settings, "billing_support_email", "support@example.com")
    monkeypatch.setattr(settings, "alipay_notify_url", "https://example.com/api/billing/notify")
    monkeypatch.setattr(settings, "alipay_return_url", "https://example.com/api/billing/return")

    def unavailable_gateway():
        raise PaymentGatewayError("支付宝收款配置不可用，请联系管理员。")

    monkeypatch.setattr(billing, "get_gateway", unavailable_gateway)
    billing.validate_configuration()  # A pilot config failure must not abort startup.
    assert not billing.enabled()
    assert client.get("/billing/catalog").json()["enabled"] is False
    assert client.post("/billing/orders", json={"package_id": "starter", "request_key": "pilot-request-key", "accept_terms": True}).status_code == 404

    monkeypatch.setattr(billing, "get_gateway", lambda: gateway)
    billing.validate_configuration()
    assert client.get("/billing/catalog").json()["enabled"] is True

    monkeypatch.setattr(billing, "get_gateway", unavailable_gateway)
    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_models", [{"provider": "deepseek", "model": "deepseek-flash", "input_rate": 3, "output_rate": 12}])
    with pytest.raises(PaymentGatewayError):
        billing.validate_configuration()  # Full billing still requires valid configuration.


def test_protected_key_file_accepts_editor_newline_but_rejects_body_formatting(tmp_path):
    path = tmp_path / "synthetic-key.txt"
    path.write_text("syntheticRawKey\n")
    path.chmod(0o600)
    assert _raw_key(_protected_file(path)) == "syntheticRawKey"
    for value in ("synthetic\nRawKey", "-----BEGIN RSA PRIVATE KEY-----\nsyntheticRawKey"):
        path.write_text(value)
        with pytest.raises(PaymentGatewayError):
            _raw_key(_protected_file(path))
