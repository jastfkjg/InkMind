"""包装 LLMProvider：在每次完整流式调用成功后记录用量并累计次数。

支持累积模式：一次业务操作中多次 LLM 调用的 token 用量会被累积，
最后只创建一条记录。

同时支持 token quota 检查：当用户配额不足时，拒绝 LLM 调用。
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


def get_effective_token_quota_used(db: Session, user: User) -> int:
    """Return the user's effective token usage for quota display/checks.

    Older accounts may have usage events recorded while ``token_quota_used`` was
    still 0, especially when they were previously unlimited. Treat the usage
    event total as the source of truth unless the stored counter is higher.
    After an admin reset, only usage events after the reset point count.
    """
    usage_query = db.query(func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0)).filter(
        LLMUsageEvent.user_id == user.id
    )
    if user.token_quota_reset_at is not None:
        usage_query = usage_query.filter(LLMUsageEvent.created_at >= user.token_quota_reset_at)

    event_used = int(usage_query.scalar() or 0)
    stored_used = int(user.token_quota_used or 0)
    return max(stored_used, event_used)


class TokenQuotaExceededError(Exception):
    """Token 配额超出错误。"""

    def __init__(
        self,
        message: str = "Token 配额已用完",
        quota: int | None = None,
        used: int | None = None,
        required: int | None = None,
    ) -> None:
        self.message = message
        self.quota = quota
        self.used = used
        self.required = required
        super().__init__(message)


def get_user_quota_status(db: Session, user_id: int) -> dict:
    """获取用户配额状态。
    
    返回：
    - is_unlimited: 是否无限制
    - quota: 总配额（tokens）
    - used: 已使用（tokens）
    - remaining: 剩余（tokens）
    - reset_at: 重置时间
    """
    user = db.get(User, user_id)
    if user is None:
        return {
            "is_unlimited": True,
            "quota": None,
            "used": 0,
            "remaining": None,
            "reset_at": None,
        }
    
    used = get_effective_token_quota_used(db, user)
    remaining = None
    if user.token_quota is not None:
        remaining = max(0, user.token_quota - used)
    
    return {
        "is_unlimited": user.token_quota is None,
        "quota": user.token_quota,
        "used": used,
        "remaining": remaining,
        "reset_at": user.token_quota_reset_at,
    }


def check_token_quota(
    db: Session,
    user_id: int,
    estimated_tokens: int = 1000,
) -> None:
    """检查用户 token 配额是否足够。
    
    Args:
        db: 数据库会话
        user_id: 用户 ID
        estimated_tokens: 预计需要的 token 数量
    
    Raises:
        TokenQuotaExceededError: 当配额不足时
    """
    user = db.get(User, user_id)
    if user is None:
        return
    
    if user.token_quota is None:
        return
    
    used = get_effective_token_quota_used(db, user)
    remaining = user.token_quota - used
    
    if remaining <= 0:
        raise TokenQuotaExceededError(
            message=f"Token 配额已用完。配额: {user.token_quota}, 已使用: {used}",
            quota=user.token_quota,
            used=used,
            required=estimated_tokens,
        )
    
    if remaining < estimated_tokens:
        log.warning(
            "User %s token quota low: remaining=%s, estimated=%s",
            user_id,
            remaining,
            estimated_tokens,
        )


def consume_token_quota(
    db: Session,
    user_id: int,
    tokens: int,
) -> None:
    """消耗用户 token 配额。
    
    这个函数应该在 LLM 调用完成后调用，用于实际扣除已使用的 token。
    """
    user = db.get(User, user_id)
    if user is None:
        return
    
    if user.token_quota is None:
        return
    
    user.token_quota_used = get_effective_token_quota_used(db, user) + tokens


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

    @property
    def total_tokens(self) -> int:
        return self._input_tokens + self._output_tokens

    @property
    def input_tokens(self) -> int:
        return self._input_tokens

    @property
    def output_tokens(self) -> int:
        return self._output_tokens

    @property
    def call_count(self) -> int:
        return self._call_count

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
        
        total = self._input_tokens + self._output_tokens
        if u.token_quota is not None:
            u.token_quota_used = get_effective_token_quota_used(self._db, u) + total
        
        evt = LLMUsageEvent(
            user_id=self._user_id,
            provider=self._provider,
            action=self._action,
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
            total_tokens=total,
        )
        self._db.add(evt)
        self._db.commit()
        
        log.debug(
            "flushed llm usage: user_id=%s action=%s calls=%s tokens=%s",
            self._user_id,
            self._action,
            self._call_count,
            total,
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
    
    total = in_tokens + out_tokens
    if u.token_quota is not None:
        u.token_quota_used = get_effective_token_quota_used(db, u) + total
    
    evt = LLMUsageEvent(
        user_id=user_id,
        provider=provider,
        action=action,
        input_tokens=in_tokens,
        output_tokens=out_tokens,
        total_tokens=total,
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
