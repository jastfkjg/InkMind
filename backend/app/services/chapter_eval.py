"""当前章节正文的 AI 评估：弱点清单 + 去 AI 化分数。"""

from __future__ import annotations

import json
import re
from typing import Any

from app.llm.base import LLMProvider
from app.models import Novel
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
) -> tuple[str, str]:
    body = (content or "").strip()
    clipped = body[:_EVAL_BODY_MAX] if len(body) > _EVAL_BODY_MAX else body
    system = (
        "你是严谨的文学编辑与中文网文审稿人。"
        "用户会提供一部小说的某一章：标题、本章概要（若有）与正文。"
        "请只指出写得不够好或容易显得「像 AI 生成」的地方，每条说明为何不理想。"
        "不要泛泛夸奖，不要编造正文中不存在的情节；若没有值得指出的问题，issues 可为空列表。"
        "同时给出一个 0～100 的整数 de_ai_score，表示「去 AI 化」程度："
        "分数越高，表示读起来越像自然的人类创作，越少模板句、堆砌副词、空洞比喻、机械转折与万能套话。"
        "若正文极短或几乎为空，可将 de_ai_score 设为 0，issues 说明原因。"
        "仅输出合法 JSON 对象，不要 markdown 代码围栏以外的任何文字。键名固定为 issues 与 de_ai_score。"
        'issues 为数组，元素为对象，字段 aspect（问题点简述）与 detail（理由），均为字符串。'
    )
    user_msg = (
        f"【作品类型】{novel.genre or '未指定'}\n"
        f"【书名】{novel.title or '（无）'}\n\n"
        f"【本章标题】{title or '（无）'}\n"
        f"【本章概要】\n{(summary or '').strip() or '（未填）'}\n\n"
        f"【正文】\n{clipped or '（空）'}"
    )
    return system, user_msg


def evaluate_chapter(llm: LLMProvider, novel: Novel, *, title: str, summary: str, content: str) -> ChapterEvaluateOut:
    system, user_msg = build_evaluate_messages(novel, title=title, summary=summary, content=content)
    raw = llm.complete(system, user_msg)
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
