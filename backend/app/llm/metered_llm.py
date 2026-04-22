"""包装 LLMProvider：在每次完整流式调用成功后记录用量并累计次数。

支持累积模式：一次业务操作中多次 LLM 调用的 token 用量会被累积，
最后只创建一条记录。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.llm.base import LLMProvider
from app.llm.token_counter import count_tokens
from app.models import LLMUsageEvent, User

log = logging.getLogger(__name__)


class LLMUsageAccumulator:
    """LLM 调用用量累积器。
    
    用于在一次业务操作中累积多次 LLM 调用的 token 用量，
    最后只创建一条记录。
    """

    def __init__(self, db: Session, user_id: int, provider: str, action: str) -> None:
        self._db = db
        self._user_id = user_id
        self._provider = provider
        self._action = action
        self._input_tokens = 0
        self._output_tokens = 0
        self._call_count = 0

    def accumulate(self, input_tokens: int, output_tokens: int) -> None:
        """累积一次 LLM 调用的 token 用量。"""
        self._input_tokens += input_tokens
        self._output_tokens += output_tokens
        self._call_count += 1

    def flush(self) -> None:
        """将累积的用量写入数据库，创建一条记录。"""
        if self._call_count == 0:
            return
        
        u = self._db.get(User, self._user_id)
        if u is None:
            return
        
        u.llm_call_count = int(u.llm_call_count or 0) + 1
        
        evt = LLMUsageEvent(
            user_id=self._user_id,
            provider=self._provider,
            action=self._action,
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
            total_tokens=self._input_tokens + self._output_tokens,
        )
        self._db.add(evt)
        self._db.commit()
        
        log.debug(
            "flushed llm usage: user_id=%s action=%s calls=%s tokens=%s",
            self._user_id,
            self._action,
            self._call_count,
            self._input_tokens + self._output_tokens,
        )


def _record_usage(
    db: Session,
    *,
    user_id: int,
    provider: str,
    action: str,
    input_text: str,
    output_text: str,
    accumulator: LLMUsageAccumulator | None = None,
) -> None:
    """记录 LLM 调用用量。
    
    如果提供了 accumulator，则累积到 accumulator 而不是立即写入数据库。
    """
    in_tokens = count_tokens(input_text, provider)
    out_tokens = count_tokens(output_text, provider)
    
    if accumulator is not None:
        accumulator.accumulate(in_tokens, out_tokens)
        return
    
    u = db.get(User, user_id)
    if u is None:
        return
    u.llm_call_count = int(u.llm_call_count or 0) + 1
    evt = LLMUsageEvent(
        user_id=user_id,
        provider=provider,
        action=action,
        input_tokens=in_tokens,
        output_tokens=out_tokens,
        total_tokens=in_tokens + out_tokens,
    )
    db.add(evt)
    db.commit()


@contextmanager
def llm_usage_session(
    db: Session,
    user_id: int,
    provider: str,
    action: str,
) -> Iterator[LLMUsageAccumulator]:
    """创建一个 LLM 用量统计会话上下文管理器。
    
    在上下文管理器内部，所有使用相同 accumulator 的 LLM 调用的 token 用量
    都会被累积，上下文管理器退出时只创建一条记录。
    
    使用示例：
        with llm_usage_session(db, user.id, "openai", "AI生成") as accumulator:
            llm = resolve_llm_for_user(user, None, db=db, action="AI生成", accumulator=accumulator)
            # 多次 LLM 调用...
            # 最后只创建一条记录
    """
    accumulator = LLMUsageAccumulator(db, user_id, provider, action)
    try:
        yield accumulator
    finally:
        try:
            accumulator.flush()
        except Exception:
            db.rollback()
            log.exception("flush llm usage failed user_id=%s action=%s", user_id, action)


class MeteredLLM(LLMProvider):
    def __init__(
        self,
        inner: LLMProvider,
        db: Session,
        user_id: int,
        *,
        provider: str,
        action: str,
        accumulator: "LLMUsageAccumulator | None" = None,
    ) -> None:
        self._inner = inner
        self._db = db
        self._user_id = user_id
        self._provider = provider
        self._action = action
        self._accumulator = accumulator

    def complete(self, system: str, user: str) -> str:
        output_text = "".join(self._inner.stream_complete(system, user)).strip()
        try:
            _record_usage(
                self._db,
                user_id=self._user_id,
                provider=self._provider,
                action=self._action,
                input_text=f"{system}\n{user}",
                output_text=output_text,
                accumulator=self._accumulator,
            )
        except Exception:
            self._db.rollback()
            log.exception("record llm usage failed user_id=%s action=%s", self._user_id, self._action)
        return output_text

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
                    accumulator=self._accumulator,
                )
            except Exception:
                self._db.rollback()
                log.exception("record llm usage failed user_id=%s action=%s", self._user_id, self._action)

        return gen()
