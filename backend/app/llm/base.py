from abc import ABC, abstractmethod
from collections.abc import Iterator

_DEFAULT_MAX_TOKENS = 8192


def calc_max_tokens_from_word_count(word_count: int | None, *, language: str = "zh") -> int:
    if not word_count or word_count <= 0:
        return _DEFAULT_MAX_TOKENS
    if language == "zh":
        tokens = int(word_count * 1.8)
    else:
        tokens = int(word_count * 1.5)
    tokens = max(tokens, 2048)
    tokens = min(tokens, 32768)
    return tokens


class LLMProvider(ABC):
    def check_connection(self) -> None:
        """Read provider metadata without generating text or recording token usage."""
        raise NotImplementedError

    def list_models(self) -> list[str]:
        raise NotImplementedError

    def test_model(self) -> tuple[int, int]:
        """Make one bounded request; return input/output usage without exposing output."""
        raise NotImplementedError

    @abstractmethod
    def stream_complete(
        self, system: str, user: str, *, max_tokens: int | None = None
    ) -> Iterator[str]:
        pass

    def complete(
        self, system: str, user: str, *, max_tokens: int | None = None
    ) -> str:
        return "".join(self.stream_complete(system, user, max_tokens=max_tokens)).strip()
