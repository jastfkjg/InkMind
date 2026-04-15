"""轻量 token 估算（跨厂商统一的近似值，用于用量统计展示）。"""

from __future__ import annotations

import re

_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_ALNUM_RE = re.compile(r"[A-Za-z0-9_]+")
_PUNCT_RE = re.compile(r"[^\sA-Za-z0-9_\u3400-\u9fff]")


def estimate_tokens(text: str) -> int:
    """按文本粗略估算 token 数：CJK 字符 + 英文词 + 标点。"""
    if not text:
        return 0
    cjk = len(_CJK_RE.findall(text))
    words = len(_ALNUM_RE.findall(text))
    punct = len(_PUNCT_RE.findall(text))
    return cjk + words + punct
