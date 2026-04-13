from fastapi import APIRouter

from app.config import settings
from app.llm.providers import list_available_providers

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/llm-providers")
def llm_providers() -> dict:
    return {
        "available": list_available_providers(),
        "default": settings.default_llm_provider,
    }
