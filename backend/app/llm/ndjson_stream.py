"""NDJSON helpers for streaming LLM output to HTTP clients (one JSON object per line)."""

from __future__ import annotations

import json
from collections.abc import Iterator


def ndjson_line(obj: dict) -> bytes:
    return (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")


def filter_think_chunks(chunks: Iterator[str]) -> Iterator[str]:
    """Remove reasoning blocks even when tags cross transport chunk boundaries."""
    starts = ("<think>", "<|im_start|>think")
    ends = ("</think>", "<|im_end|>")
    buffer = ""
    in_think = False

    def suffix_length(text: str, tags: tuple[str, ...]) -> int:
        lower = text.lower()
        return max((size for tag in tags for size in range(1, len(tag))
                    if lower.endswith(tag[:size])), default=0)

    for chunk in chunks:
        buffer += chunk
        while buffer:
            tags = ends if in_think else starts
            matches = [(buffer.lower().find(tag), tag) for tag in tags if tag in buffer.lower()]
            if matches:
                index, tag = min(matches)
                if not in_think and index:
                    yield buffer[:index]
                buffer = buffer[index + len(tag):]
                in_think = not in_think
                continue
            keep = suffix_length(buffer, tags)
            available = buffer[:-keep] if keep else buffer
            if not in_think and available:
                yield available
            buffer = buffer[-keep:] if keep else ""
            break
    if buffer and not in_think:
        yield buffer
