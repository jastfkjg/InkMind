import anthropic
import openai
from sqlalchemy.orm import Session

from app.llm.anthropic_llm import AnthropicLLM
from app.llm.providers import resolve_agent_llm_for_user, resolve_llm_for_user
from app.models import User, UserCustomLLM
from app.schemas.connection import ConnectionStatus, LLMProbeResponse, ProbeMode
from app.llm.base import LLMProvider


def _error_status(error: Exception) -> ConnectionStatus:
    if isinstance(error, (openai.APITimeoutError, anthropic.APITimeoutError, TimeoutError)):
        return "timeout"
    if isinstance(error, NotImplementedError):
        return "not_supported"
    code = getattr(error, "status_code", None)
    if code == 401:
        return "authentication"
    if code == 403:
        return "permission"
    if code in (404, 405, 501):
        return "not_supported"
    if code == 429:
        return "rate_limit"
    return "unavailable"


def check_saved_llm_connection(user: User, db: Session, target: str) -> ConnectionStatus:
    # Never fall back to another account or a server key when the saved custom
    # selection is missing. This check also covers a deleted custom provider.
    if getattr(user, f"{target}_use_custom", False):
        custom_id = getattr(user, f"{target}_custom_llm_id", None)
        custom = db.get(UserCustomLLM, custom_id) if custom_id else None
        if custom is None or custom.user_id != user.id or not custom.api_key.strip():
            return "unconfigured"
    try:
        if target == "generation":
            provider = resolve_llm_for_user(user, None, db=db, action="连接检查")
        else:
            configuration = resolve_agent_llm_for_user(user, db)
            if not (configuration.get("api_key") or "").strip():
                return "unconfigured"
            provider = AnthropicLLM(
                api_key=configuration["api_key"], base_url=configuration["base_url"],
                model=configuration["model"],
            )
    except ValueError:
        return "unconfigured"
    except Exception:
        return "unavailable"
    try:
        provider.check_connection()
    except Exception as error:
        # SDK messages may contain credentials, URLs and proxy responses. The
        # UI receives only a stable status and explains it in the user's language.
        return _error_status(error)
    return "ok"


def probe_provider(provider: LLMProvider, mode: ProbeMode) -> "LLMProbeResponse":
    from app.schemas.connection import LLMProbeResponse
    from app.llm.metered_llm import TokenQuotaExceededError
    try:
        if mode == "models":
            return LLMProbeResponse(mode=mode, status="ok", models=provider.list_models())
        provider.test_model()
        return LLMProbeResponse(mode=mode, status="ok")
    except Exception as error:
        code = getattr(error, "status_code", None)
        status = _error_status(error)
        if isinstance(error, TokenQuotaExceededError):
            status = "quota"
        elif mode == "model":
            # Inspect only structured error codes; never return SDK text, URLs or credentials.
            body = getattr(error, "body", None)
            detail = body.get("error", body) if isinstance(body, dict) else {}
            error_code = str(detail.get("code", detail.get("type", ""))).lower() if isinstance(detail, dict) else ""
            if error_code in {"model_not_found", "model_not_supported", "invalid_model", "modelnotfound"}:
                status = "model_unavailable"
            elif code in (404, 405, 501):
                status = "endpoint"
            elif code in (400, 422):
                status = "request"
        return LLMProbeResponse(mode=mode, status=status, http_status=code)


def probe_saved_connection(user: User, db: Session, target: str, mode: ProbeMode) -> "LLMProbeResponse":
    from app.schemas.connection import LLMProbeResponse
    from app.llm.metered_llm import MeteredLLM
    try:
        if getattr(user, f"{target}_use_custom", False):
            custom_id = getattr(user, f"{target}_custom_llm_id", None)
            custom = db.get(UserCustomLLM, custom_id) if custom_id else None
            if not custom or custom.user_id != user.id or not custom.api_key.strip():
                raise ValueError
        if target == "generation":
            provider = resolve_llm_for_user(user, None, db=db, action="模型测试")
        else:
            config = resolve_agent_llm_for_user(user, db)
            if not config["api_key"] or (mode == "model" and not config["model"]):
                raise ValueError
            provider = MeteredLLM(AnthropicLLM(api_key=config["api_key"], base_url=config["base_url"], model=config["model"]),
                                  db, user.id, provider=custom.provider if user.agent_use_custom else "anthropic", source=config["source"], action="模型测试")
    except ValueError:
        return LLMProbeResponse(mode=mode, status="unconfigured")
    except Exception:
        return LLMProbeResponse(mode=mode, status="unavailable")
    return probe_provider(provider, mode)
