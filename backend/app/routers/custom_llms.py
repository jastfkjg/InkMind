from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.llm.providers import _PROVIDER_DEFAULTS, _PROVIDER_LABELS
from app.models import UserCustomLLM


from app.schemas.connection import LLMDraftProbeRequest, LLMProbeResponse
from app.services.llm_connection import probe_provider
from app.llm.providers import get_llm_from_user_config
from app.llm.metered_llm import MeteredLLM


router = APIRouter(prefix="/custom-llms", tags=["custom-llms"])


class CustomLLMCreate(BaseModel):
    provider: str
    protocol: Literal["openai", "anthropic"] | None = None
    api_key: str
    default_model: str | None = None
    base_url: str | None = None

    @field_validator("default_model")
    @classmethod
    def clean_model(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or len(value.strip()) > 256):
            raise ValueError("模型 ID 必须为 1–256 个字符")
        return value.strip() if value else None


class CustomLLMUpdate(BaseModel):
    provider: str | None = None
    protocol: Literal["openai", "anthropic"] | None = None
    api_key: str | None = None
    default_model: str | None = None
    base_url: str | None = None

    @field_validator("default_model")
    @classmethod
    def clean_model(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or len(value.strip()) > 256):
            raise ValueError("模型 ID 必须为 1–256 个字符")
        return value.strip() if value else None


class CustomLLMOut(BaseModel):
    id: int
    provider: str
    provider_label: str
    protocol: Literal["openai", "anthropic"]
    api_key: str | None
    base_url: str | None
    default_base_url: str | None
    default_model: str | None
    models: list[str]
    created_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_with_extras(cls, obj: UserCustomLLM) -> "CustomLLMOut":
        from app.config import settings
        provider = obj.provider.lower().strip()
        defaults = _PROVIDER_DEFAULTS.get(provider, {})
        return cls(
            id=obj.id,
            provider=provider,
            protocol=obj.effective_protocol,
            default_model=obj.default_model,
            provider_label=_PROVIDER_LABELS.get(provider, provider),
            api_key=_mask_key(obj.api_key),
            base_url=obj.base_url,
            default_base_url=defaults.get("base_url"),
            models=settings.LLM_PROVIDER_MODELS.get(provider, []),
            created_at=obj.created_at.isoformat() if obj.created_at else "",
        )


def _mask_key(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) <= 8:
        return "***"
    return key[:4] + "***" + key[-4:]


@router.get("", response_model=list[CustomLLMOut])
def list_custom_llms(user: CurrentUser, db: Session = Depends(get_db)):
    items = db.query(UserCustomLLM).filter(UserCustomLLM.user_id == user.id).order_by(UserCustomLLM.created_at).all()
    return [CustomLLMOut.from_orm_with_extras(i) for i in items]


@router.post("", response_model=CustomLLMOut, status_code=status.HTTP_201_CREATED)
def create_custom_llm(body: CustomLLMCreate, user: CurrentUser, db: Session = Depends(get_db)):
    provider = body.provider.lower().strip()
    if provider == "moonshot":
        provider = "kimi"
    defaults = _PROVIDER_DEFAULTS.get(provider)
    if not defaults:
        raise HTTPException(status_code=400, detail=f"不支持的供应商: {provider}")
    protocol = body.protocol or ("anthropic" if provider == "anthropic" else "openai")
    effective_base_url = (body.base_url or "").strip() or None
    if protocol != ("anthropic" if provider == "anthropic" else "openai") and not effective_base_url:
        raise HTTPException(status_code=400, detail="请填写与所选 API 协议匹配的 Base URL")
    effective_base_url = effective_base_url or defaults.get("base_url")
    item = UserCustomLLM(
        user_id=user.id,
        provider=provider,
        protocol=protocol,
        default_model=body.default_model,
        api_key=body.api_key.strip(),
        base_url=effective_base_url,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return CustomLLMOut.from_orm_with_extras(item)


@router.patch("/{item_id}", response_model=CustomLLMOut)
def update_custom_llm(item_id: int, body: CustomLLMUpdate, user: CurrentUser, db: Session = Depends(get_db)):
    item = db.query(UserCustomLLM).filter(UserCustomLLM.id == item_id, UserCustomLLM.user_id == user.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="未找到该自定义 LLM")
    if body.protocol is not None and body.protocol != item.effective_protocol:
        if not (body.base_url or "").strip():
            raise HTTPException(status_code=400, detail="切换 API 协议时请填写对应的 Base URL")
        item.protocol = body.protocol
    if body.provider is not None:
        provider = body.provider.lower().strip()
        if provider == "moonshot":
            provider = "kimi"
        if provider not in _PROVIDER_DEFAULTS:
            raise HTTPException(status_code=400, detail=f"不支持的供应商: {provider}")
        # Persist the previous protocol before changing the brand of legacy records.
        item.protocol = item.effective_protocol
        item.provider = provider
    if "default_model" in body.model_fields_set:
        item.default_model = body.default_model
    if body.api_key is not None:
        if "***" not in body.api_key:
            item.api_key = body.api_key.strip()
    if body.base_url is not None:
        item.base_url = body.base_url.strip() or None
    db.add(item)
    db.commit()
    db.refresh(item)
    return CustomLLMOut.from_orm_with_extras(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_custom_llm(item_id: int, user: CurrentUser, db: Session = Depends(get_db)):
    item = db.query(UserCustomLLM).filter(UserCustomLLM.id == item_id, UserCustomLLM.user_id == user.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="未找到该自定义 LLM")
    if user.generation_custom_llm_id == item_id:
        user.generation_use_custom = False
        user.generation_custom_llm_id = None
    if user.agent_custom_llm_id == item_id:
        user.agent_use_custom = False
        user.agent_custom_llm_id = None
    db.delete(item)
    db.commit()


@router.post("/probe", response_model=LLMProbeResponse)
def probe_custom_llm(body: LLMDraftProbeRequest, user: CurrentUser, db: Session = Depends(get_db)) -> LLMProbeResponse:
    key = (body.api_key or "").strip()
    if body.custom_llm_id is not None:
        item = db.get(UserCustomLLM, body.custom_llm_id)
        if not item or item.user_id != user.id:
            raise HTTPException(status_code=404, detail="未找到该自定义 LLM")
        # A saved credential is only reusable for its saved destination/protocol.
        if not key:
            if body.base_url.strip().rstrip("/") != (item.base_url or "").rstrip("/") or body.protocol != item.effective_protocol:
                return LLMProbeResponse(mode=body.mode, status="key_required")
            key = item.api_key
    if not key or "***" in key or not body.base_url.strip() or (body.mode == "model" and not body.default_model.strip()):
        return LLMProbeResponse(mode=body.mode, status="unconfigured")
    if body.provider not in _PROVIDER_DEFAULTS:
        raise HTTPException(status_code=400, detail="不支持的供应商")
    try:
        provider = get_llm_from_user_config(body.provider, key, body.base_url.strip(),
                                            body.default_model.strip() or None, protocol=body.protocol)
    except (ValueError, TypeError):
        return LLMProbeResponse(mode=body.mode, status="endpoint")
    metered = MeteredLLM(provider, db, user.id, provider=body.provider, source="custom", action="模型测试")
    return probe_provider(metered, body.mode)
