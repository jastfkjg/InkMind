import anthropic

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.llm_errors import LLMRequestError, wrap_anthropic_error


class AnthropicLLM(LLMProvider):
    def __init__(self) -> None:
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self._model = settings.anthropic_model

    def complete(self, system: str, user: str) -> str:
        try:
            msg = self._client.messages.create(
                model=self._model,
                max_tokens=8192,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
        except anthropic.APIError as e:
            raise wrap_anthropic_error(e) from e
        except Exception as e:
            raise LLMRequestError(str(e) or "Anthropic 请求失败") from e

        parts: list[str] = []
        for block in msg.content:
            if hasattr(block, "text"):
                parts.append(block.text)
        return "".join(parts).strip()
