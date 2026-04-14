"""NDJSON helpers for streaming LLM output to HTTP clients (one JSON object per line)."""

from __future__ import annotations

import json


def ndjson_line(obj: dict) -> bytes:
    return (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
