"""当前章节正文的 AI 评估：弱点清单 + 去 AI 化分数。"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from typing import Any

from app.language import Language
from app.llm.base import LLMProvider
from app.models import Novel
from app.prompts import get_prompt
from app.schemas.chapter import ChapterEvaluateIssue, ChapterEvaluateOut

_EVAL_BODY_MAX = 18000


def _strip_code_fence(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.MULTILINE)
        s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def build_evaluate_messages(
    novel: Novel,
    *,
    title: str,
    summary: str,
    content: str,
    language: Language = "zh",
) -> tuple[str, str]:
    body = (content or "").strip()
    clipped = body[:_EVAL_BODY_MAX] if len(body) > _EVAL_BODY_MAX else body
    
    system = get_prompt("evaluate_system", language)
    
    genre_display = novel.genre or get_prompt("common_unspecified", language)
    title_display = novel.title or get_prompt("common_none", language)
    chapter_title_display = title or get_prompt("common_none", language)
    summary_display = (summary or "").strip() or get_prompt("common_not_filled", language)
    content_display = clipped or get_prompt("common_none", language)
    
    user_msg = (
        get_prompt("evaluate_user_intro", language, genre=genre_display, title=title_display)
        + get_prompt("evaluate_user_chapter", language, chapter_title=chapter_title_display, chapter_summary=summary_display)
        + get_prompt("evaluate_user_content", language, content=content_display)
    )
    return system, user_msg


def stream_evaluate_tokens(
    llm: LLMProvider, novel: Novel, *, title: str, summary: str, content: str, language: Language = "zh"
) -> Iterator[str]:
    system, user_msg = build_evaluate_messages(novel, title=title, summary=summary, content=content, language=language)
    yield from llm.stream_complete(system, user_msg)


def evaluate_chapter(
    llm: LLMProvider, novel: Novel, *, title: str, summary: str, content: str, language: Language = "zh"
) -> ChapterEvaluateOut:
    raw = "".join(stream_evaluate_tokens(llm, novel, title=title, summary=summary, content=content, language=language))
    return parse_evaluation_json(raw)


def parse_evaluation_json(raw: str) -> ChapterEvaluateOut:
    text = _strip_code_fence(raw)
    data: Any
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError("模型返回内容无法解析为 JSON，请重试") from e

    if not isinstance(data, dict):
        raise ValueError("模型返回的评估格式不正确，请重试")

    raw_score = data.get("de_ai_score")
    if isinstance(raw_score, bool):
        score = 0
    elif isinstance(raw_score, (int, float)):
        score = int(round(float(raw_score)))
    else:
        try:
            score = int(float(str(raw_score).strip()))
        except (TypeError, ValueError):
            score = 0
    score = max(0, min(100, score))

    issues_out: list[ChapterEvaluateIssue] = []
    issues_raw = data.get("issues")
    if isinstance(issues_raw, list):
        for item in issues_raw:
            if not isinstance(item, dict):
                continue
            aspect = str(item.get("aspect") or item.get("point") or "").strip()
            detail = str(item.get("detail") or item.get("reason") or "").strip()
            if not aspect and not detail:
                continue
            if not aspect:
                aspect = "问题"
            if not detail:
                detail = "（未说明）"
            issues_out.append(ChapterEvaluateIssue(aspect=aspect[:800], detail=detail[:4000]))

    return ChapterEvaluateOut(issues=issues_out, de_ai_score=score)
