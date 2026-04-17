"""包装 LLMProvider：在每次完整流式调用成功后记录用量并累计次数。"""

from __future__ import annotations

from collections.abc import Iterator
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.llm.base import LLMProvider
from app.llm.token_counter import count_tokens
from app.models import LLMUsageEvent, User

log = logging.getLogger(__name__)


def _record_usage(
    db: Session,
    *,
    user_id: int,
    provider: str,
    action: str,
    input_text: str,
    output_text: str,
) -> None:
    u = db.get(User, user_id)
    if u is None:
        return
    u.llm_call_count = int(u.llm_call_count or 0) + 1
    in_tokens = count_tokens(input_text, provider)
    out_tokens = count_tokens(output_text, provider)
    evt = LLMUsageEvent(
        user_id=user_id,
        provider=provider,
        action=action,
        input_tokens=in_tokens,
        output_tokens=out_tokens,
        total_tokens=in_tokens + out_tokens,
    )
    db.add(evt)
    # 某些接口（如 AI 起名/评估）没有后续业务写入与 commit，这里直接提交确保统计落库。
    db.commit()


class MeteredLLM(LLMProvider):
    def __init__(self, inner: LLMProvider, db: Session, user_id: int, *, provider: str, action: str) -> None:
        self._inner = inner
        self._db = db
        self._user_id = user_id
        self._provider = provider
        self._action = action

    def stream_complete(self, system: str, user: str) -> Iterator[str]:
        def gen() -> Iterator[str]:
            out_parts: list[str] = []
            for chunk in self._inner.stream_complete(system, user):
                out_parts.append(chunk)
                yield chunk
            try:
                _record_usage(
                    self._db,
                    user_id=self._user_id,
                    provider=self._provider,
                    action=self._action,
                    input_text=f"{system}\n{user}",
                    output_text="".join(out_parts),
                )
            except Exception:
                # 统计失败不影响主业务返回
                self._db.rollback()
                log.exception("record llm usage failed user_id=%s action=%s", self._user_id, self._action)

        return gen()
