import anthropic
from collections.abc import Iterator

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.llm_errors import LLMRequestError, wrap_anthropic_error


class AnthropicLLM(LLMProvider):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        client_kwargs: dict = {"api_key": api_key or settings.anthropic_api_key}
        if base_url or settings.anthropic_base_url:
            client_kwargs["base_url"] = base_url or settings.anthropic_base_url
        self._client = anthropic.Anthropic(**client_kwargs)
        self._model = model or settings.anthropic_model

    def check_connection(self) -> None:
        self._client.with_options(timeout=15.0, max_retries=0).models.list()

    def stream_complete(self, system: str, user: str, *, max_tokens: int | None = None) -> Iterator[str]:
        effective_max = max_tokens or 8192
        try:
            with self._client.messages.stream(
                model=self._model,
                max_tokens=effective_max,
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
