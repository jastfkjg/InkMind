from sqlalchemy.orm import Session

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.anthropic_llm import AnthropicLLM
from app.llm.metered_llm import LLMUsageAccumulator, MeteredLLM
from app.llm.openai_llm import DeepSeekLLM, KimiLLM, MiniMaxLLM, OpenAILLM, OpenAICompatibleLLM, QwenLLM


_PROVIDER_DEFAULTS: dict[str, dict] = {
    "openai": {
        "base_url": None,
        "model": "gpt-4o-mini",
        "send_temperature": True,
        "timeout": 120.0,
    },
    "qwen": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen3-max",
        "send_temperature": True,
        "timeout": 120.0,
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-v4-flash",
        "send_temperature": True,
        "timeout": 120.0,
    },
    "minimax": {
        "base_url": "https://api.minimax.io/v1",
        "model": "MiniMax-M2.7",
        "send_temperature": True,
        "timeout": 120.0,
    },
    "kimi": {
        "base_url": "https://api.moonshot.ai/v1",
        "model": "kimi-k2.5",
        "send_temperature": True,
        "timeout": 120.0,
    },
    "glm": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-5.1",
        "send_temperature": True,
        "timeout": 120.0,
    },
    "anthropic": {
        "base_url": None,
        "model": "claude-sonnet-4-20250514",
    },
}

_PROVIDER_LABELS: dict[str, str] = {
    "openai": "OpenAI",
    "qwen": "Qwen / 通义千问",
    "deepseek": "DeepSeek",
    "minimax": "MiniMax",
    "kimi": "Kimi / 月之暗面",
    "glm": "GLM / 智谱",
    "anthropic": "Anthropic",
}


def list_available_providers() -> list[str]:
    if settings.desktop_mode:
        return []
    out: list[str] = []
    if settings.openai_api_key:
        out.append("openai")
    if settings.anthropic_api_key:
        out.append("anthropic")
    if settings.qwen_api_key:
        out.append("qwen")
    if settings.deepseek_api_key:
        out.append("deepseek")
    if settings.minimax_api_key:
        out.append("minimax")
    if settings.moonshot_api_key:
        out.append("kimi")
    if settings.glm_api_key:
        out.append("glm")
    return out


def has_generation_configuration(user: object, db: Session, explicit_provider: str | None = None) -> bool:
    """Check the selected connection, without making a model request."""
    if getattr(user, "generation_use_custom", False):
        from app.models import UserCustomLLM
        custom_id = getattr(user, "generation_custom_llm_id", None)
        custom = db.get(UserCustomLLM, custom_id) if custom_id else None
        return bool(custom and custom.user_id == getattr(user, "id", None)
                    and (custom.api_key or "").strip())
    return _normalize_provider_name(explicit_provider, user) in list_available_providers()


def get_builtin_provider_info() -> list[dict]:
    available = list_available_providers()
    result = []
    for provider_id in available:
        models = settings.LLM_PROVIDER_MODELS.get(provider_id, [])
        defaults = _PROVIDER_DEFAULTS.get(provider_id, {})
        result.append({
            "id": provider_id,
            "label": _PROVIDER_LABELS.get(provider_id, provider_id),
            "models": models,
            "default_model": defaults.get("model", models[0] if models else ""),
        })
    return result


def get_llm(provider: str | None, model: str | None = None) -> LLMProvider:
    if settings.desktop_mode:
        raise ValueError("请在 AI 设置中添加自定义 LLM，并为正文生成选择供应商和模型")
    name = (provider or settings.default_llm_provider).lower().strip()
    if name == "openai":
        if not settings.openai_api_key:
            raise ValueError("未配置 OPENAI_API_KEY")
        return OpenAILLM(model=model)
    if name == "anthropic":
        if not settings.anthropic_api_key:
            raise ValueError("未配置 ANTHROPIC_API_KEY")
        return AnthropicLLM(model=model)
    if name == "qwen":
        if not settings.qwen_api_key:
            raise ValueError("未配置 QWEN_API_KEY（通义千问 / DashScope）")
        return QwenLLM(model=model)
    if name == "deepseek":
        if not settings.deepseek_api_key:
            raise ValueError("未配置 DEEPSEEK_API_KEY")
        return DeepSeekLLM(model=model)
    if name == "minimax":
        if not settings.minimax_api_key:
            raise ValueError("未配置 MINIMAX_API_KEY")
        return MiniMaxLLM(model=model)
    if name in ("kimi", "moonshot"):
        if not settings.moonshot_api_key:
            raise ValueError("未配置 MOONSHOT_API_KEY 或 KIMI_API_KEY（月之暗面 / Kimi）")
        return KimiLLM(model=model)
    if name == "glm":
        if not settings.glm_api_key:
            raise ValueError("未配置 GLM_API_KEY（智谱）")
        return OpenAICompatibleLLM(
            api_key=settings.glm_api_key,
            base_url=settings.glm_base_url,
            model=model or settings.glm_model,
            send_temperature=settings.glm_send_temperature,
            timeout=settings.glm_timeout,
        )
    raise ValueError(f"不支持的模型提供方: {name}")


def get_llm_from_user_config(
    provider: str,
    api_key: str,
    base_url: str | None = None,
    model: str | None = None,
    protocol: str | None = None,
) -> LLMProvider:
    if not api_key.strip():
        raise ValueError("请在 AI 设置中为自定义 LLM 配置 API Key")
    name = provider.lower().strip()
    if name == "moonshot":
        name = "kimi"
    if (protocol or ("anthropic" if name == "anthropic" else "openai")) == "anthropic":
        if settings.desktop_mode:
            base_url = base_url or "https://api.anthropic.com"
            model = model or _PROVIDER_DEFAULTS["anthropic"]["model"]
        return AnthropicLLM(api_key=api_key, base_url=base_url, model=model)
    defaults = _PROVIDER_DEFAULTS.get(name, _PROVIDER_DEFAULTS["openai"])
    effective_base_url = base_url or defaults.get("base_url")
    if settings.desktop_mode and not effective_base_url:
        effective_base_url = "https://api.openai.com/v1"
    effective_model = model or defaults.get("model", "gpt-4o-mini")
    send_temperature = defaults.get("send_temperature", True)
    timeout = defaults.get("timeout", 120.0)
    return OpenAICompatibleLLM(
        api_key=api_key,
        base_url=effective_base_url,
        model=effective_model,
        send_temperature=send_temperature,
        timeout=timeout,
    )


def normalize_provider_name(provider: str | None, user: object | None) -> str:
    name = (provider or "").strip().lower()
    if not name and user is not None:
        pref = getattr(user, "preferred_llm_provider", None)
        name = (pref or "").strip().lower()
    if not name:
        name = settings.default_llm_provider.strip().lower()
    if name == "moonshot":
        return "kimi"
    return name


def _normalize_provider_name(provider: str | None, user: object | None) -> str:
    return normalize_provider_name(provider, user)


def resolve_llm_for_user(
    user: object | None,
    explicit_provider: str | None,
    *,
    db: Session | None = None,
    action: str = "LLM调用",
    accumulator: LLMUsageAccumulator | None = None,
) -> LLMProvider:
    provider_name = _normalize_provider_name(explicit_provider, user)

    if user is not None and db is not None:
        use_custom = getattr(user, "generation_use_custom", False)
        custom_llm_id = getattr(user, "generation_custom_llm_id", None)
        if use_custom and custom_llm_id:
            from app.models import UserCustomLLM
            custom_llm = db.get(UserCustomLLM, custom_llm_id)
            if custom_llm and custom_llm.user_id == getattr(user, "id", None):
                llm = get_llm_from_user_config(
                    custom_llm.provider,
                    custom_llm.api_key,
                    custom_llm.base_url,
                    getattr(user, "preferred_llm_model", None) or custom_llm.default_model,
                    protocol=custom_llm.effective_protocol,
                )
                uid = getattr(user, "id", None)
                if uid is not None:
                    return MeteredLLM(
                        llm, db, int(uid),
                        provider=custom_llm.provider.lower().strip(),
                        action=action,
                        source="custom",
                        accumulator=accumulator,
                    )
                return llm

    user_model = None
    if user is not None:
        user_model = getattr(user, "preferred_llm_model", None)

    llm = get_llm(provider_name, model=user_model)
    if db is not None and user is not None:
        uid = getattr(user, "id", None)
        if uid is not None:
            return MeteredLLM(
                llm, db, int(uid),
                provider=provider_name,
                action=action,
                source="builtin",
                accumulator=accumulator,
            )
    return llm


def resolve_agent_llm_for_user(user: object | None, db: Session | None = None) -> dict[str, str | None]:
    if user is not None and db is not None:
        use_custom = getattr(user, "agent_use_custom", False)
        custom_llm_id = getattr(user, "agent_custom_llm_id", None)
        if use_custom and custom_llm_id:
            from app.models import UserCustomLLM
            custom_llm = db.get(UserCustomLLM, custom_llm_id)
            if (custom_llm and custom_llm.user_id == getattr(user, "id", None)
                    and custom_llm.api_key.strip()
                    and custom_llm.effective_protocol == "anthropic"):
                return {
                    "api_key": custom_llm.api_key,
                    "base_url": custom_llm.base_url or ("https://api.anthropic.com" if settings.desktop_mode else None),
                    "model": getattr(user, "agent_model", None) or custom_llm.default_model,
                    "source": "custom",
                }
    if settings.desktop_mode or getattr(user, "agent_use_custom", False):
        return {"api_key": None, "base_url": None, "model": None, "source": "custom"}
    return {
        "api_key": settings.anthropic_api_key,
        "base_url": settings.anthropic_base_url,
        "model": getattr(user, "agent_model", None) or settings.anthropic_model or None,
        "source": "builtin",
    }
