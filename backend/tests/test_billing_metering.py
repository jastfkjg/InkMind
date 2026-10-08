from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import json
from threading import Barrier
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base
from app.llm.base import LLMProvider
from app.llm.metered_llm import LLMUsageAccumulator, MeteredLLM, TokenQuotaExceededError, get_effective_token_quota_used
from app.llm import agent_billing_proxy as proxy
from app.models import CreditLedger, LLMUsageEvent, PaymentOrder, TokenReservation, User
from app.services import billing


class Vendor(LLMProvider):
    supports_authoritative_usage = True
    _model = "meter-test"
    def __init__(self, usage=(5, 7), fail=False): self.usage=usage; self.fail=fail; self.calls=0
    def stream_complete(self, system, user, *, max_tokens=None):
        self.calls += 1
        yield "partial"
        if self.fail: raise RuntimeError("provider interrupted")
        self.last_usage=self.usage
        yield " complete"
    def test_model(self): self.last_usage=self.usage; return self.usage or (1, 1)


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    engine=create_engine(f"sqlite:///{tmp_path / 'meter.db'}", connect_args={"check_same_thread":False, "timeout":10})
    Base.metadata.create_all(engine); sessions=sessionmaker(bind=engine); db=sessions()
    user=User(email="meter@example.com",hashed_password="unused",token_quota=10000)
    db.add(user); db.commit()
    monkeypatch.setattr(settings,"billing_enabled",True);monkeypatch.setattr(settings,"desktop_mode",False)
    monkeypatch.setattr(settings,"billing_models",[{"provider":"anthropic","model":"meter-test","input_rate":"2","output_rate":"3"}])
    monkeypatch.setattr(proxy,"SessionLocal",sessions)
    monkeypatch.setattr("app.llm.metered_llm.count_tokens", lambda text, provider: len(text))
    yield db,user,sessions
    proxy._sessions.clear();db.close();engine.dispose()


def metered(db,user,vendor=None,source="builtin",accumulator=None):
    return MeteredLLM(vendor or Vendor(),db,user.id,provider="anthropic",action="后台章节生成",source=source,accumulator=accumulator)


def test_generation_and_background_accumulator_settle_actual_usage_once(fixture):
    db,user,_=fixture;acc=LLMUsageAccumulator(db,user.id,"anthropic","后台章节生成")
    llm=metered(db,user,accumulator=acc)
    assert llm.complete("system","prompt",max_tokens=10)=="partial complete"
    acc.flush();db.refresh(user)
    assert user.token_quota_reserved==0 and user.token_quota_used==31
    event=db.scalar(select(LLMUsageEvent));assert event.total_tokens==12 and event.billing_credits==31
    assert db.scalar(select(func.count(LLMUsageEvent.id)))==1
    assert db.scalar(select(CreditLedger)).amount==-31
    assert get_effective_token_quota_used(db,user)==31
    billing.settle(db,db.scalar(select(TokenReservation)).id,5,7)
    assert db.scalar(select(func.count(CreditLedger.id)))==1


def test_insufficient_balance_prevents_upstream_call(fixture):
    db,user,_=fixture;user.token_quota=100;db.commit();vendor=Vendor()
    with pytest.raises(TokenQuotaExceededError): metered(db,user,vendor).complete("s","u",max_tokens=10)
    assert vendor.calls==0
    assert db.scalar(select(func.count(TokenReservation.id)))==0


def test_concurrent_reservations_cannot_spend_same_balance(fixture):
    db,user,sessions=fixture;user.token_quota=100;db.commit();barrier=Barrier(2)
    def reserve():
        with sessions() as connection:
            barrier.wait()
            try: return billing.reserve(connection,user.id,"anthropic","meter-test","parallel",70).id
            except TokenQuotaExceededError: return None
    with ThreadPoolExecutor(2) as pool: results=list(pool.map(lambda _:reserve(),range(2)))
    assert sum(result is not None for result in results)==1
    db.expire_all();assert db.get(User,user.id).token_quota_reserved==70


@pytest.mark.parametrize("vendor",[Vendor(usage=None),Vendor(fail=True)])
def test_missing_usage_or_failure_retains_reconcilable_hold(fixture,vendor):
    db,user,_=fixture
    with pytest.raises((ValueError,RuntimeError)): metered(db,user,vendor).complete("s","u",max_tokens=10)
    reservation=db.scalar(select(TokenReservation));assert reservation.status=="interrupted"
    db.refresh(user);assert user.token_quota_reserved==reservation.amount
    assert db.scalar(select(func.count(LLMUsageEvent.id)))==0
    billing.settle(db,reservation.id,0,0);db.refresh(user);assert user.token_quota_reserved==0


def test_stream_cancellation_and_restart_keep_unknown_usage_hold(fixture):
    db,user,_=fixture;stream=metered(db,user).stream_complete("s","u",max_tokens=10)
    assert next(stream)=="partial";stream.close()
    reservation=db.scalar(select(TokenReservation));assert reservation.status=="interrupted"
    second=billing.reserve(db,user.id,"anthropic","meter-test","restart",100)
    billing.recover_reservations(db);db.refresh(second);assert second.status=="interrupted"
    db.refresh(user);assert user.token_quota_reserved==reservation.amount+100


def test_custom_key_and_disabled_billing_keep_legacy_flow(fixture,monkeypatch):
    db,user,_=fixture;acc=LLMUsageAccumulator(db,user.id,"anthropic","legacy")
    metered(db,user,source="custom",accumulator=acc).complete("s","u",max_tokens=10);acc.flush()
    db.refresh(user);assert user.token_quota_used==0 and user.token_quota_reserved==0
    assert db.scalar(select(LLMUsageEvent)).source=="custom"
    monkeypatch.setattr(settings,"billing_enabled",False)
    metered(db,user).complete("s","u",max_tokens=10)
    assert db.scalar(select(func.count(TokenReservation.id)))==0


def test_unpriced_model_is_rejected_before_upstream(fixture):
    db,user,_=fixture;vendor=Vendor();vendor._model="unpriced"
    with pytest.raises(ValueError,match="尚未开放"): metered(db,user,vendor).complete("s","u",max_tokens=10)
    assert vendor.calls==0


def test_paid_package_consumption_can_be_traced_without_double_counting(fixture):
    db,user,_=fixture
    now=datetime.now(timezone.utc)
    for index,credits in enumerate((20,9980)):
        db.add(PaymentOrder(user_id=user.id,request_key=f"trace-{index}",out_trade_no=f"trace-order-{index}",
                            package_id="trace",subject="Trace",amount_cents=1,credits=credits,remaining_credits=credits,
                            status="paid",sandbox=True,app_id="test-app",seller_id="test-seller",paid_at=now,
                            expires_at=now+timedelta(minutes=15)))
    db.commit()
    metered(db,user).complete("s","u",max_tokens=10)
    entries=list(db.scalars(select(CreditLedger)))
    assert sum(entry.amount for entry in entries)==-31
    assert len(entries)==2 and all(entry.order_id for entry in entries)
    orders=list(db.scalars(select(PaymentOrder).order_by(PaymentOrder.id)))
    assert [order.remaining_credits for order in orders]==[0,9969]


def test_paid_background_and_missing_custom_selection_cannot_bypass_accounting(fixture):
    from app.llm.providers import resolve_llm_for_user
    from app.agent.sub_agent import SubAgentExecutor
    db,user,_=fixture
    with pytest.raises(ValueError,match="关联有效用户"):
        resolve_llm_for_user(None,"anthropic",db=db)
    with pytest.raises(ValueError,match="后台任务必须关联"):
        SubAgentExecutor(db,None)._resolve_llm("anthropic","后台任务")
    user.generation_use_custom=True
    with pytest.raises(ValueError,match="自带 API Key 配置不可用"):
        resolve_llm_for_user(user,"anthropic",db=db)


def proxy_client(fixture,monkeypatch,content,stream=True,status=200):
    db,user,_=fixture
    configuration=proxy.register("sdk-session",user.id,{"api_key":"test-provider-key","base_url":"https://api.vendor.test","model":"meter-test","claude_auth_mode":"api_key"})
    original=httpx.AsyncClient
    def upstream(request):
        assert request.headers.get("x-api-key")=="test-provider-key"
        db.expire_all();assert db.get(User,user.id).token_quota_reserved>0
        return httpx.Response(status,headers={"content-type":"text/event-stream" if stream else "application/json"},content=content)
    monkeypatch.setattr(proxy.httpx,"AsyncClient",lambda **kwargs:original(transport=httpx.MockTransport(upstream),**kwargs))
    app=FastAPI();app.include_router(proxy.router)
    client=TestClient(app)
    response=client.post("/billing/agent-proxy/v1/messages",headers={"x-api-key":configuration["api_key"]},
                         json={"model":"meter-test","max_tokens":10,"stream":stream,"messages":[{"role":"user","content":"test"}]})
    return response


def test_sdk_assistant_proxy_charges_trusted_cache_and_output_usage(fixture,monkeypatch):
    frames=[{"type":"message_start","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":4,"output_tokens":0}}},
            {"type":"message_delta","usage":{"output_tokens":5}},{"type":"message_stop"}]
    content="".join("data: "+json.dumps(frame)+"\n\n" for frame in frames)
    response=proxy_client(fixture,monkeypatch,content);assert response.status_code==200
    db,user,_=fixture;db.expire_all();assert db.get(User,user.id).token_quota_used==33
    assert db.get(User,user.id).token_quota_reserved==0
    event=db.scalar(select(LLMUsageEvent));assert event.action=="AI助手" and event.input_tokens==9 and event.output_tokens==5


def test_sdk_nonstream_and_missing_usage(fixture,monkeypatch):
    response=proxy_client(fixture,monkeypatch,json.dumps({"content":[]}),stream=False)
    assert response.status_code==503
    db,user,_=fixture;db.expire_all();assert db.get(User,user.id).token_quota_reserved>0
    assert db.scalar(select(TokenReservation)).status=="interrupted"
