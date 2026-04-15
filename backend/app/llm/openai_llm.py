from collections.abc import Iterator

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

    def _chat_temperature(self) -> float | None:
        """子类可覆盖。返回 None 表示不传 temperature 字段。"""
        if not self._send_temperature:
            return None
        return 0.85

    def stream_complete(self, system: str, user: str) -> Iterator[str]:
        payload: dict = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": True,
        }
        t = self._chat_temperature()
        if t is not None:
            payload["temperature"] = t
        try:
            stream = self._client.chat.completions.create(**payload)
        except (APIError, APIConnectionError, APITimeoutError, RateLimitError) as e:
            raise wrap_openai_error(e) from e
        except Exception as e:
            raise LLMRequestError(str(e) or "OpenAI 兼容接口请求失败") from e

        for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if not choice:
                continue
            delta = choice.delta.content
            if delta:
                yield delta


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


class MiniMaxLLM(OpenAICompatibleLLM):
    """MiniMax OpenAI 兼容 Chat Completions。"""

    def __init__(self) -> None:
        super().__init__(
            api_key=settings.minimax_api_key or "",
            base_url=settings.minimax_base_url,
            model=settings.minimax_model,
            send_temperature=settings.minimax_send_temperature,
            timeout=settings.minimax_timeout,
        )


class KimiLLM(OpenAICompatibleLLM):
    """Kimi（月之暗面 Moonshot OpenAI 兼容 API）。"""

    def __init__(self) -> None:
        super().__init__(
            api_key=settings.moonshot_api_key or "",
            base_url=settings.moonshot_base_url,
            model=settings.moonshot_model,
            send_temperature=settings.moonshot_send_temperature,
            timeout=settings.moonshot_timeout,
        )

    def _chat_temperature(self) -> float | None:
        if not self._send_temperature:
            return None
        # Moonshot：kimi-k2 / kimi-k2.5 等仅允许 temperature=1（否则 400 invalid temperature）
        if self._model.lower().startswith("kimi-k2"):
            return 1.0
        return 0.85
