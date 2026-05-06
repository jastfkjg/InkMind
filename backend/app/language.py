from typing import Annotated

from fastapi import Depends, Header


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
