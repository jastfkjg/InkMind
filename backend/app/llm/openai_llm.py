from openai import APIConnectionError, APIError, APITimeoutError, OpenAI, RateLimitError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.llm_errors import LLMRequestError, wrap_openai_error


class OpenAICompatibleLLM(LLMProvider):
    """任意 OpenAI 兼容 Chat Completions API（官方 OpenAI、Azure、DeepSeek、DashScope 等）。"""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str | None,
        model: str,
        send_temperature: bool = True,
        timeout: float = 120.0,
    ) -> None:
        kwargs: dict = {"api_key": api_key, "timeout": timeout}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = OpenAI(**kwargs)
        self._model = model
        self._send_temperature = send_temperature

    def complete(self, system: str, user: str) -> str:
        payload: dict = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if self._send_temperature:
            payload["temperature"] = 0.85
        try:
            r = self._client.chat.completions.create(**payload)
        except (APIError, APIConnectionError, APITimeoutError, RateLimitError) as e:
            raise wrap_openai_error(e) from e
        except Exception as e:
            raise LLMRequestError(str(e) or "OpenAI 兼容接口请求失败") from e

        choice = r.choices[0]
        content = choice.message.content
        if not content:
            return ""
        return content.strip()


class OpenAILLM(OpenAICompatibleLLM):
    def __init__(self) -> None:
        super().__init__(
            api_key=settings.openai_api_key or "",
            base_url=settings.openai_base_url,
            model=settings.openai_model,
            send_temperature=settings.openai_send_temperature,
            timeout=settings.openai_timeout,
        )


class QwenLLM(OpenAICompatibleLLM):
    """通义千问（阿里云 DashScope OpenAI 兼容模式）。"""

    def __init__(self) -> None:
        super().__init__(
            api_key=settings.qwen_api_key or "",
            base_url=settings.qwen_base_url,
            model=settings.qwen_model,
            send_temperature=settings.qwen_send_temperature,
            timeout=settings.qwen_timeout,
        )


class DeepSeekLLM(OpenAICompatibleLLM):
    """DeepSeek 官方 OpenAI 兼容 API。"""

    def __init__(self) -> None:
        super().__init__(
            api_key=settings.deepseek_api_key or "",
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
            send_temperature=settings.deepseek_send_temperature,
            timeout=settings.deepseek_timeout,
        )
