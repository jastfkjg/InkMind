"""基于 tiktoken 的真实 token 计数，按模型厂商选用对应编码器。"""

from __future__ import annotations

import threading
from typing import Literal

import tiktoken

# tiktoken 缓存，避免重复初始化
_cache: dict[str, tiktoken.Encoding] = {}
_lock = threading.Lock()


def _get_encoding(name: str) -> tiktoken.Encoding:
    """线程安全地获取或创建 encoding 实例（带缓存）。"""
    with _lock:
        if name not in _cache:
            _cache[name] = tiktoken.get_encoding(name)
        return _cache[name]


def encoding_for_provider(provider: str) -> tiktoken.Encoding:
    """根据 provider 返回对应的 tiktoken encoding。

    - openai / deepseek / minimax / kimi：OpenAI 兼容，均用 cl100k_base
    - qwen：通义千问 OpenAI 兼容模式，用 cl100k_base（近似，官方推荐用 qwen tokenizer）
    - anthropic：Claude 系列，用 cl100k_base 作为近似估算
    """
    if provider in ("openai", "deepseek", "minimax", "kimi", "qwen", "anthropic"):
        return _get_encoding("cl100k_base")
    # 默认 fallback
    return _get_encoding("cl100k_base")


def count_tokens(text: str, provider: str) -> int:
    """返回 text 在指定 provider 模型下的真实 token 数。"""
    if not text:
        return 0
    enc = encoding_for_provider(provider)
    return len(enc.encode(text))


# 别名，保持向后兼容
estimate_tokens = count_tokens
