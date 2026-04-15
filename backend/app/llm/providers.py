from sqlalchemy.orm import Session

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.anthropic_llm import AnthropicLLM
from app.llm.metered_llm import MeteredLLM
from app.llm.openai_llm import DeepSeekLLM, KimiLLM, MiniMaxLLM, OpenAILLM, QwenLLM


def list_available_providers() -> list[str]:
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
    return out


def get_llm(provider: str | None) -> LLMProvider:
    name = (provider or settings.default_llm_provider).lower().strip()
    if name == "openai":
        if not settings.openai_api_key:
            raise ValueError("未配置 OPENAI_API_KEY")
        return OpenAILLM()
    if name == "anthropic":
        if not settings.anthropic_api_key:
            raise ValueError("未配置 ANTHROPIC_API_KEY")
        return AnthropicLLM()
    if name == "qwen":
        if not settings.qwen_api_key:
            raise ValueError("未配置 QWEN_API_KEY（通义千问 / DashScope）")
        return QwenLLM()
    if name == "deepseek":
        if not settings.deepseek_api_key:
            raise ValueError("未配置 DEEPSEEK_API_KEY")
        return DeepSeekLLM()
    if name == "minimax":
        if not settings.minimax_api_key:
            raise ValueError("未配置 MINIMAX_API_KEY")
        return MiniMaxLLM()
    if name in ("kimi", "moonshot"):
        if not settings.moonshot_api_key:
            raise ValueError("未配置 MOONSHOT_API_KEY 或 KIMI_API_KEY（月之暗面 / Kimi）")
        return KimiLLM()
    raise ValueError(f"不支持的模型提供方: {name}")


def _normalize_provider_name(provider: str | None, user: object | None) -> str:
    name = (provider or "").strip().lower()
    if not name and user is not None:
        pref = getattr(user, "preferred_llm_provider", None)
        name = (pref or "").strip().lower()
    if not name:
        name = settings.default_llm_provider.strip().lower()
    if name == "moonshot":
        return "kimi"
    return name


def resolve_llm_for_user(
    user: object | None,
    explicit_provider: str | None,
    *,
    db: Session | None = None,
    action: str = "LLM调用",
) -> LLMProvider:
    """请求体中的 llm_provider 优先，否则使用用户偏好，再否则 settings.default_llm_provider。
    传入 db 且 user 有 id 时，返回带调用次数统计的包装器（按完整流式请求计 1 次）。"""
    provider_name = _normalize_provider_name(explicit_provider, user)
    llm = get_llm(provider_name)
    if db is not None and user is not None:
        uid = getattr(user, "id", None)
        if uid is not None:
            return MeteredLLM(
                llm,
                db,
                int(uid),
                provider=provider_name,
                action=action,
            )
    return llm
