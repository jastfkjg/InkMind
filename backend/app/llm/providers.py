from app.config import settings
from app.llm.base import LLMProvider
from app.llm.anthropic_llm import AnthropicLLM
from app.llm.openai_llm import DeepSeekLLM, OpenAILLM, QwenLLM


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
    raise ValueError(f"不支持的模型提供方: {name}")
