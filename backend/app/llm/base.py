from abc import ABC, abstractmethod
from collections.abc import Iterator


class LLMProvider(ABC):
    @abstractmethod
    def stream_complete(self, system: str, user: str) -> Iterator[str]:
        pass

    def complete(self, system: str, user: str) -> str:
        return "".join(self.stream_complete(system, user)).strip()
