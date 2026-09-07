import anthropic
import openai
from sqlalchemy.orm import Session

from app.llm.anthropic_llm import AnthropicLLM
from app.llm.providers import resolve_agent_llm_for_user, resolve_llm_for_user
from app.models import User, UserCustomLLM
from app.schemas.connection import ConnectionStatus


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
