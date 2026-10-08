"""Bound and meter every platform SDK-assistant request before contacting its provider."""
from dataclasses import dataclass
import json
import secrets
from urllib.parse import urlparse
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.config import settings
from app.database import SessionLocal
from app.services import billing

router = APIRouter(prefix="/billing/agent-proxy", include_in_schema=False)


@dataclass(repr=False)
class ProxySession:
    session_id: str
    user_id: int
    provider: str
    model: str
    api_key: str
    base_url: str
    auth_mode: str


_sessions: dict[str, ProxySession] = {}


def unregister(session_id: str) -> None:
    for token, entry in list(_sessions.items()):
        if entry.session_id == session_id:
            _sessions.pop(token, None)


def register(session_id: str, user_id: int, config: dict[str, Any]) -> dict[str, Any]:
    provider = "deepseek" if config.get("base_url", "") and "deepseek.com" in config["base_url"] else "anthropic"
    model = config.get("model") or settings.anthropic_model
    billing.model_rate(provider, model)  # Fail before connecting an unpriced platform model.
    parsed = urlparse(settings.billing_agent_proxy_base_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("助手计费转发地址必须为本机 HTTP 服务。")
    if not config.get("api_key"):
        raise ValueError("平台助手模型尚未配置。")
    unregister(session_id)
    token = secrets.token_urlsafe(32)
    _sessions[token] = ProxySession(session_id, user_id, provider, model, config["api_key"],
                                    config.get("base_url") or "https://api.anthropic.com", config.get("claude_auth_mode", "auto"))
    return {**config, "api_key": token, "base_url": settings.billing_agent_proxy_base_url, "claude_auth_mode": "api_key"}


def session_for(request: Request) -> ProxySession:
    token = request.headers.get("x-api-key") or request.headers.get("authorization", "").removeprefix("Bearer ")
    entry = _sessions.get(token)
    if not billing.enabled() or entry is None:
        raise HTTPException(401, "助手计费会话无效，请重新打开助手。")
    return entry


def usage_values(usage: dict[str, Any]) -> tuple[int, int]:
    values = [usage.get(name, 0) for name in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")]
    if any(type(value) is not int or value < 0 for value in values) or "input_tokens" not in usage or "output_tokens" not in usage:
        raise ValueError("供应商用量不完整。")
    return sum(values[:3]), values[3]


def settle(reservation_id: str, usage: tuple[int, int] | None) -> None:
    with SessionLocal() as db:
        if usage is None:
            billing.interrupt_reservation(db, reservation_id)
        else:
            try:
                billing.settle(db, reservation_id, *usage)
            except Exception:
                db.rollback(); billing.interrupt_reservation(db, reservation_id)
                raise


def upstream_headers(entry: ProxySession, request: Request) -> dict[str, str]:
    from app.llm.anthropic_auth import resolve_claude_auth_mode
    headers = {"anthropic-version": request.headers.get("anthropic-version", "2023-06-01"), "Content-Type": "application/json"}
    if request.headers.get("anthropic-beta"):
        headers["anthropic-beta"] = request.headers["anthropic-beta"]
    if resolve_claude_auth_mode(entry.base_url, entry.auth_mode) == "auth_token":
        headers["Authorization"] = f"Bearer {entry.api_key}"
    else:
        headers["x-api-key"] = entry.api_key
    return headers


@router.post("/v1/messages")
async def messages(request: Request):
    entry = session_for(request)
    body = await request.body()
    if len(body) > 2_000_000:
        raise HTTPException(413, "助手上下文过大，请开始新的对话。")
    try:
        payload = json.loads(body)
    except ValueError:
        raise HTTPException(400, "助手请求格式无效。") from None
    output_limit = payload.get("max_tokens")
    if payload.get("model") != entry.model or type(output_limit) is not int or not 1 <= output_limit <= 32768:
        raise HTTPException(400, "助手模型或生成上限与收费配置不一致。")
    rate = billing.model_rate(entry.provider, entry.model)
    amount = billing.cost(len(body) + 1024, output_limit, rate.input_rate, rate.output_rate)
    with SessionLocal() as db:
        try:
            reservation = billing.reserve(db, entry.user_id, entry.provider, entry.model, "AI助手", amount)
        except Exception:
            db.rollback()
            return JSONResponse(status_code=402, content={"error": {"type": "quota_exceeded", "message": "AI 额度不足以完成此请求，请购买额度或缩短上下文。"}})
        reservation_id = reservation.id
    client = httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15))
    try:
        response = await client.send(client.build_request("POST", entry.base_url.rstrip("/") + "/v1/messages",
                                                          headers=upstream_headers(entry, request), json=payload), stream=True)
    except Exception:
        await client.aclose(); settle(reservation_id, None)
        return JSONResponse(status_code=503, content={"error":{"type":"api_error","message":"供应商结果未知，额度暂被预占，请联系管理员核对。"}})
    if response.status_code >= 400:
        await response.aclose(); await client.aclose(); settle(reservation_id, (0, 0))
        return JSONResponse(status_code=response.status_code, content={"error":{"type":"api_error","message":"供应商拒绝此请求，请检查助手模型配置。"}})
    if not payload.get("stream"):
        try:
            content = await response.aread()
            data = json.loads(content)
            settle(reservation_id, usage_values(data["usage"]))
            return Response(content, media_type="application/json")
        except Exception:
            settle(reservation_id, None)
            return JSONResponse(status_code=503, content={"error":{"type":"api_error","message":"未取得可信用量，额度暂被预占，请联系管理员核对。"}})
        finally:
            await response.aclose(); await client.aclose()

    async def stream():
        buffer = ""
        usage: dict[str, Any] = {}
        saw_input = False
        saw_output = False
        finished = False
        settled = False
        try:
            async for chunk in response.aiter_text():
                buffer += chunk.replace("\r\n", "\n")
                while "\n\n" in buffer:
                    event, buffer = buffer.split("\n\n", 1)
                    lines = [line[5:].strip() for line in event.splitlines() if line.startswith("data:")]
                    if not lines: continue
                    data = json.loads("\n".join(lines))
                    if data.get("type") == "message_start":
                        usage.update(data.get("message", {}).get("usage", {}))
                        saw_input = "input_tokens" in usage
                    elif data.get("type") == "message_delta":
                        latest = data.get("usage", {})
                        usage.update(latest); saw_output = saw_output or "output_tokens" in latest
                    elif data.get("type") == "message_stop":
                        finished = True
                    elif data.get("type") == "error":
                        raise ValueError("provider stream error")
                if finished and saw_input and saw_output and not settled:
                    settle(reservation_id, usage_values(usage)); settled = True
                yield chunk
            if not settled:
                raise ValueError("missing terminal usage")
        finally:
            await response.aclose(); await client.aclose()
            if not settled: settle(reservation_id, None)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control":"no-store", "X-Accel-Buffering":"no"})


@router.get("/v1/models")
async def models(request: Request):
    entry = session_for(request)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(entry.base_url.rstrip("/") + "/v1/models", headers=upstream_headers(entry, request))
        if response.status_code >= 400:
            return JSONResponse(status_code=response.status_code, content={"error":{"message":"无法读取助手模型列表。"}})
        return Response(response.content, media_type="application/json")


@router.post("/v1/messages/count_tokens")
async def count_tokens(request: Request):
    entry = session_for(request)
    body = await request.body()
    if len(body) > 2_000_000:
        raise HTTPException(413, "助手上下文过大。")
    payload = json.loads(body)
    if payload.get("model") != entry.model:
        raise HTTPException(400, "助手模型与配置不一致。")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(entry.base_url.rstrip("/") + "/v1/messages/count_tokens",
                                     headers=upstream_headers(entry, request), json=payload)
        if response.status_code >= 400:
            return JSONResponse(status_code=response.status_code, content={"error":{"message":"无法读取助手上下文长度。"}})
        return Response(response.content, media_type="application/json")
