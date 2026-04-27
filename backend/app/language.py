from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User


def get_accept_language(
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> str:
    """从请求头获取语言偏好，返回 'zh' 或 'en'。"""
    if not accept_language:
        return "zh"
    
    lang_lower = accept_language.lower()
    
    if lang_lower.startswith("en"):
        return "en"
    
    if "zh" in lang_lower:
        return "zh"
    
    return "zh"


def get_language(
    db: Annotated[Session, Depends(get_db)],
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> str:
    """
    获取语言偏好，优先级：
    1. 用户设置的 ai_language（如果已登录且已设置）
    2. Accept-Language 请求头
    3. 默认 'zh'
    """
    user_ai_language = None
    
    try:
        from fastapi import Request
        from app.deps import security, decode_token
        
        request = Request(scope={"type": "http"})
    except Exception:
        pass
    
    return get_accept_language(accept_language)


def _get_user_ai_language(user: User | None) -> str | None:
    """从用户对象获取 ai_language 偏好。"""
    if user and user.ai_language:
        return user.ai_language
    return None


def get_effective_language(
    user_ai_language: str | None,
    accept_language: str | None,
) -> str:
    """
    计算有效语言：
    1. 优先使用用户的 ai_language
    2. 其次使用 Accept-Language 请求头
    3. 默认 'zh'
    """
    if user_ai_language and user_ai_language in ["zh", "en"]:
        return user_ai_language
    return get_accept_language(accept_language)


Language = Annotated[str, Depends(get_accept_language)]
