import anthropic
from collections.abc import Iterator

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.llm_errors import LLMRequestError, wrap_anthropic_error


class AnthropicLLM(LLMProvider):
    def __init__(self) -> None:
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self._model = settings.anthropic_model

    def stream_complete(self, system: str, user: str) -> Iterator[str]:
        try:
            with self._client.messages.stream(
                model=self._model,
                max_tokens=8192,
                system=system,
                messages=[{"role": "user", "content": user}],
            ) as stream:
                for text in stream.text_stream:
                    if text:
                        yield text
        except anthropic.APIError as e:
            raise wrap_anthropic_error(e) from e
        except Exception as e:
            raise LLMRequestError(str(e) or "Anthropic 请求失败") from e
