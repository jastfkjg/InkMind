"""NDJSON helpers for streaming LLM output to HTTP clients (one JSON object per line)."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator


def ndjson_line(obj: dict) -> bytes:
    return (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")


def filter_think_chunks(chunks: Iterator[str]) -> Iterator[str]:
    """过滤掉 LLM 输出中的思考标签内容。

    状态机方式处理，支持跨 chunk 的 think 标签。
    """
    buffer = ""
    in_think = False

    # 预编译正则（用于快速检测）
    think_start_re = re.compile(r'<think>|<THINK>|<\|im_start\|>think', re.IGNORECASE)
    think_end_re = re.compile(r'</think>|</THINK>|<\|im_end\|>', re.IGNORECASE)

    for chunk in chunks:
        buffer += chunk

        while True:
            if in_think:
                # 查找 think 块结束
                end_match = think_end_re.search(buffer)
                if end_match:
                    # 找到结束，删除 think 部分
                    buffer = buffer[end_match.end():]
                    in_think = False
                else:
                    # 没找到结束，继续等待
                    break
            else:
                # 查找 think 块开始
                start_match = think_start_re.search(buffer)
                if start_match:
                    # 输出 think 之前的内容
                    before = buffer[:start_match.start()]
                    if before:
                        yield before
                    # 移动到 think 开始之后
                    buffer = buffer[start_match.end():]
                    in_think = True
                else:
                    # 没有 think 标签，输出所有
                    if buffer:
                        yield buffer
                        buffer = ""
                    break

    # 处理剩余 buffer
    if buffer and not in_think:
        yield buffer
