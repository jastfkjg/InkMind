from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import OptionalUser
from app.llm.providers import get_builtin_provider_info, _PROVIDER_DEFAULTS, _PROVIDER_LABELS
from app.models import UserCustomLLM

router = APIRouter(prefix="/meta", tags=["meta"])


def _mask_key(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) <= 8:
        return "***"
    return key[:4] + "***" + key[-4:]


@router.get("/llm-providers")
def llm_providers(user: OptionalUser, db: Session = Depends(get_db)) -> dict:
    builtin = get_builtin_provider_info()

    agent_builtin = None
    if not settings.desktop_mode and settings.anthropic_api_key:
        agent_builtin = {
            "model": settings.anthropic_model,
            "base_url": settings.anthropic_base_url,
        }

    custom_llms = []
    if user is not None:
        items = db.query(UserCustomLLM).filter(UserCustomLLM.user_id == user.id).order_by(UserCustomLLM.created_at).all()
        for item in items:
            provider = item.provider.lower().strip()
            defaults = _PROVIDER_DEFAULTS.get(provider, {})
            custom_llms.append({
                "id": item.id,
                "provider": provider,
                "provider_label": _PROVIDER_LABELS.get(provider, provider),
                "api_key": _mask_key(item.api_key),
                "base_url": item.base_url,
                "default_base_url": defaults.get("base_url"),
                "models": settings.LLM_PROVIDER_MODELS.get(provider, []),
            })

    return {
        "builtin": builtin,
        "default": "" if settings.desktop_mode else settings.default_llm_provider,
        "agent_builtin": agent_builtin,
        "custom_llms": custom_llms,
        "generation_custom_llm_id": getattr(user, "generation_custom_llm_id", None) if user else None,
        "agent_custom_llm_id": getattr(user, "agent_custom_llm_id", None) if user else None,
    }
