"""各阶段 Subagent 实现。

每个 Subagent 专注于一个特定的创作阶段：
- NovelSetupSubagent: 作品设定完善
- OutlinePlanningSubagent: 大纲规划
- CharacterDesignSubagent: 人物设计
- ChapterSummarySubagent: 章节摘要生成
- ChapterContentSubagent: 章节正文生成
- PolishSubagent: 润色修改
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.agent.memory import NovelMemory
from app.agent.tools import (
    GetCharacterProfilesTool,
    GetNovelContextTool,
    GetPreviousChaptersTool,
)
from app.llm.base import LLMProvider
from app.language import Language
from app.models import Character, Chapter, Novel, User
from app.prompts import get_prompt
from app.workflow.base import (
    PhaseResult,
    Subagent,
    WorkflowPhaseType,
    WorkflowStatus,
)

log = logging.getLogger(__name__)


class NovelSetupSubagent(Subagent):
    """作品设定完善 Subagent。

    根据用户提供的基本信息（标题、类型），完善作品的详细设定，包括：
    - 世界观背景
    - 核心设定
    - 写作风格建议
    """

    phase_type = WorkflowPhaseType.NOVEL_SETUP

    def execute(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> PhaseResult:
        result = PhaseResult(
            phase_type=self.phase_type,
            status=WorkflowStatus.RUNNING,
            started_at=datetime.now(),
        )

        try:
            novel_tool = GetNovelContextTool(self._db, self._novel)
            existing_setup = novel_tool.run()

            setup_prompt = self._build_setup_prompt(existing_setup, user_modifications)

            system_prompt = get_prompt("workflow_setup_system", self._language)
            user_prompt = get_prompt(
                "workflow_setup_user",
                self._language,
                existing_setup=existing_setup,
                user_modifications=json.dumps(user_modifications, ensure_ascii=False, indent=2)
                if user_modifications
                else "（无用户修改）",
            )

            llm_response = self._llm.complete(system_prompt, user_prompt)

            setup_result = self._parse_setup_response(llm_response)

            result.generated_content = setup_result
            result.success = True
            result.status = WorkflowStatus.WAITING_USER_CONFIRM
            result.suggestions = self._generate_setup_suggestions(setup_result)
            result.raw_output = llm_response

        except Exception as e:
            log.exception("NovelSetupSubagent 执行失败")
            result.success = False
            result.status = WorkflowStatus.FAILED
            result.error_message = str(e)

        result.completed_at = datetime.now()
        return result

    def _build_setup_prompt(self, existing_setup: str, user_modifications: dict[str, Any] | None) -> str:
        parts = [f"现有作品设定：\n{existing_setup}"]

        if user_modifications:
            parts.append(f"\n用户希望调整的方向：\n{json.dumps(user_modifications, ensure_ascii=False, indent=2)}")

        return "\n".join(parts)

    def _parse_setup_response(self, response: str) -> dict[str, Any]:
        result: dict[str, Any] = {}

        try:
            json_match = response.find("{")
            if json_match >= 0:
                json_str = response[json_match:]
                parsed = json.loads(json_str)
                if isinstance(parsed, dict):
                    return parsed
        except json.JSONDecodeError:
            pass

        result["raw_response"] = response
        result["background"] = response
        return result

    def _generate_setup_suggestions(self, setup_result: dict[str, Any]) -> list[str]:
        suggestions = []

        if "background" in setup_result and len(setup_result["background"]) < 200:
            suggestions.append("建议进一步丰富世界观背景设定")

        if "core_settings" not in setup_result:
            suggestions.append("建议补充核心设定（如力量体系、社会规则等）")

        if "writing_style" not in setup_result:
            suggestions.append("可以考虑明确写作风格（如快节奏、细腻描写等）")

        return suggestions


class OutlinePlanningSubagent(Subagent):
    """大纲规划 Subagent。

    根据作品设定，规划全书的整体结构和章节安排。
    """

    phase_type = WorkflowPhaseType.OUTLINE_PLANNING

    def execute(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> PhaseResult:
        result = PhaseResult(
            phase_type=self.phase_type,
            status=WorkflowStatus.RUNNING,
            started_at=datetime.now(),
        )

        try:
            novel_context = context.get("novel_setup", {})
            if not novel_context:
                novel_tool = GetNovelContextTool(self._db, self._novel)
                novel_context = {"raw": novel_tool.run()}

            system_prompt = get_prompt("workflow_outline_system", self._language)
            user_prompt = get_prompt(
                "workflow_outline_user",
                self._language,
                novel_context=json.dumps(novel_context, ensure_ascii=False, indent=2),
                user_modifications=json.dumps(user_modifications, ensure_ascii=False, indent=2)
                if user_modifications
                else "（无用户修改）",
            )

            llm_response = self._llm.complete(system_prompt, user_prompt)

            outline_result = self._parse_outline_response(llm_response)

            result.generated_content = outline_result
            result.success = True
            result.status = WorkflowStatus.WAITING_USER_CONFIRM
            result.suggestions = self._generate_outline_suggestions(outline_result)
            result.raw_output = llm_response

        except Exception as e:
            log.exception("OutlinePlanningSubagent 执行失败")
            result.success = False
            result.status = WorkflowStatus.FAILED
            result.error_message = str(e)

        result.completed_at = datetime.now()
        return result

    def _parse_outline_response(self, response: str) -> dict[str, Any]:
        result: dict[str, Any] = {"raw_response": response}

        try:
            json_match = response.find("{")
            if json_match >= 0:
                json_str = response[json_match:]
                parsed = json.loads(json_str)
                if isinstance(parsed, dict):
                    return parsed
        except json.JSONDecodeError:
            pass

        result["outline_text"] = response
        return result

    def _generate_outline_suggestions(self, outline_result: dict[str, Any]) -> list[str]:
        suggestions = []

        chapters = outline_result.get("chapters", [])
        if not chapters:
            suggestions.append("建议进一步细化章节安排")
        elif len(chapters) < 5:
            suggestions.append("当前章节数较少，可以考虑增加更多章节")

        if "major_plotlines" not in outline_result:
            suggestions.append("建议明确主要情节线")

        return suggestions


class CharacterDesignSubagent(Subagent):
    """人物设计 Subagent。

    根据作品设定和大纲，设计主要角色。
    """

    phase_type = WorkflowPhaseType.CHARACTER_DESIGN

    def execute(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> PhaseResult:
        result = PhaseResult(
            phase_type=self.phase_type,
            status=WorkflowStatus.RUNNING,
            started_at=datetime.now(),
        )

        try:
            existing_chars = self._db.query(Character).filter(Character.novel_id == self._novel.id).all()
            existing_chars_data = [
                {"name": c.name, "profile": c.profile, "notes": c.notes} for c in existing_chars
            ]

            novel_tool = GetNovelContextTool(self._db, self._novel)
            novel_context = novel_tool.run()

            outline_context = context.get("outline", {})

            system_prompt = get_prompt("workflow_character_system", self._language)
            user_prompt = get_prompt(
                "workflow_character_user",
                self._language,
                novel_context=novel_context,
                existing_characters=json.dumps(existing_chars_data, ensure_ascii=False, indent=2),
                outline_context=json.dumps(outline_context, ensure_ascii=False, indent=2),
                user_modifications=json.dumps(user_modifications, ensure_ascii=False, indent=2)
                if user_modifications
                else "（无用户修改）",
            )

            llm_response = self._llm.complete(system_prompt, user_prompt)

            char_result = self._parse_character_response(llm_response)

            result.generated_content = char_result
            result.success = True
            result.status = WorkflowStatus.WAITING_USER_CONFIRM
            result.suggestions = self._generate_character_suggestions(char_result)
            result.raw_output = llm_response

        except Exception as e:
            log.exception("CharacterDesignSubagent 执行失败")
            result.success = False
            result.status = WorkflowStatus.FAILED
            result.error_message = str(e)

        result.completed_at = datetime.now()
        return result

    def _parse_character_response(self, response: str) -> dict[str, Any]:
        result: dict[str, Any] = {"raw_response": response}

        try:
            json_match = response.find("{")
            if json_match >= 0:
                json_str = response[json_match:]
                parsed = json.loads(json_str)
                if isinstance(parsed, dict):
                    return parsed
        except json.JSONDecodeError:
            pass

        result["characters_text"] = response
        return result

    def _generate_character_suggestions(self, char_result: dict[str, Any]) -> list[str]:
        suggestions = []

        characters = char_result.get("characters", [])
        if not characters:
            suggestions.append("建议设计至少 2-3 个主要角色")

        for i, char in enumerate(characters):
            if not char.get("relationships"):
                suggestions.append(f"建议补充角色 '{char.get('name', f'第{i+1}个角色')}' 的人物关系")

        return suggestions


class ChapterSummarySubagent(Subagent):
    """章节摘要生成 Subagent。

    根据大纲和人物设定，生成单章摘要。
    """

    phase_type = WorkflowPhaseType.CHAPTER_SUMMARY

    def execute(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> PhaseResult:
        result = PhaseResult(
            phase_type=self.phase_type,
            status=WorkflowStatus.RUNNING,
            started_at=datetime.now(),
        )

        try:
            target_chapter = context.get("target_chapter")
            chapter_count = context.get("chapter_count", 1)

            novel_tool = GetNovelContextTool(self._db, self._novel)
            novel_context = novel_tool.run()

            prev_chapters_tool = GetPreviousChaptersTool(self._db, self._novel)
            prev_chapters = prev_chapters_tool.run(limit=3)

            character_profiles = ""
            if user_modifications and "chapter_summary" in user_modifications:
                char_tool = GetCharacterProfilesTool(self._db, self._novel)
                character_profiles = char_tool.run(user_modifications["chapter_summary"])

            system_prompt = get_prompt("workflow_summary_system", self._language)
            user_prompt = get_prompt(
                "workflow_summary_user",
                self._language,
                novel_context=novel_context,
                prev_chapters=prev_chapters,
                character_profiles=character_profiles,
                target_chapter=target_chapter or "下一章",
                chapter_count=chapter_count,
                user_modifications=json.dumps(user_modifications, ensure_ascii=False, indent=2)
                if user_modifications
                else "（无用户修改）",
            )

            llm_response = self._llm.complete(system_prompt, user_prompt)

            summary_result = self._parse_summary_response(llm_response)

            result.generated_content = summary_result
            result.success = True
            result.status = WorkflowStatus.WAITING_USER_CONFIRM
            result.suggestions = self._generate_summary_suggestions(summary_result)
            result.raw_output = llm_response

        except Exception as e:
            log.exception("ChapterSummarySubagent 执行失败")
            result.success = False
            result.status = WorkflowStatus.FAILED
            result.error_message = str(e)

        result.completed_at = datetime.now()
        return result

    def _parse_summary_response(self, response: str) -> dict[str, Any]:
        result: dict[str, Any] = {"raw_response": response}

        try:
            json_match = response.find("{")
            if json_match >= 0:
                json_str = response[json_match:]
                parsed = json.loads(json_str)
                if isinstance(parsed, dict):
                    return parsed
        except json.JSONDecodeError:
            pass

        result["chapter_summary"] = response
        return result

    def _generate_summary_suggestions(self, summary_result: dict[str, Any]) -> list[str]:
        suggestions = []

        summary = summary_result.get("chapter_summary", "")
        if len(summary) < 100:
            suggestions.append("章节摘要较简短，建议补充更多情节细节")

        if "key_events" not in summary_result:
            suggestions.append("建议明确本章的关键事件")

        if "character_arcs" not in summary_result:
            suggestions.append("可以考虑本章中人物的成长或变化")

        return suggestions


class ChapterContentSubagent(Subagent):
    """章节正文生成 Subagent。

    根据已确认的章节摘要，生成章节正文。
    支持流式输出。
    """

    phase_type = WorkflowPhaseType.CHAPTER_CONTENT

    def execute(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> PhaseResult:
        result = PhaseResult(
            phase_type=self.phase_type,
            status=WorkflowStatus.RUNNING,
            started_at=datetime.now(),
        )

        try:
            chapter_summary = context.get("chapter_summary", "")
            if not chapter_summary and user_modifications:
                chapter_summary = user_modifications.get("chapter_summary", "")

            fixed_title = context.get("fixed_title")
            if not fixed_title and user_modifications:
                fixed_title = user_modifications.get("fixed_title")

            word_count = context.get("word_count")

            memory = NovelMemory(self._db, self._novel)
            context_built = memory.build_context(chapter_summary)

            word_count_req = ""
            if word_count and 500 <= word_count <= 4000:
                word_count_req = get_prompt("gen_word_count_req", self._language, count=word_count)

            if fixed_title:
                system = get_prompt("gen_system_fixed_title", self._language, word_count_req=word_count_req)
                title_line = get_prompt("gen_title_line_fixed", self._language, title=fixed_title.strip())
            else:
                system = get_prompt("gen_system_dynamic_title", self._language, word_count_req=word_count_req)
                title_line = ""

            user = (
                context_built
                + "\n\n"
                + get_prompt("gen_user_task", self._language, summary=chapter_summary)
                + title_line
                + "\n\n"
                + get_prompt("gen_user_warning", self._language)
            )

            llm_response = self._llm.complete(system, user)

            content_result = self._parse_content_response(llm_response, fixed_title is not None)

            result.generated_content = content_result
            result.success = True
            result.status = WorkflowStatus.WAITING_USER_CONFIRM
            result.suggestions = self._generate_content_suggestions(content_result)
            result.raw_output = llm_response

        except Exception as e:
            log.exception("ChapterContentSubagent 执行失败")
            result.success = False
            result.status = WorkflowStatus.FAILED
            result.error_message = str(e)

        result.completed_at = datetime.now()
        return result

    def execute_stream(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> Iterator[str]:
        chapter_summary = context.get("chapter_summary", "")
        if not chapter_summary and user_modifications:
            chapter_summary = user_modifications.get("chapter_summary", "")

        fixed_title = context.get("fixed_title")
        if not fixed_title and user_modifications:
            fixed_title = user_modifications.get("fixed_title")

        word_count = context.get("word_count")

        yield "[开始生成章节正文]\n"

        try:
            memory = NovelMemory(self._db, self._novel)
            context_built = memory.build_context(chapter_summary)

            word_count_req = ""
            if word_count and 500 <= word_count <= 4000:
                word_count_req = get_prompt("gen_word_count_req", self._language, count=word_count)

            if fixed_title:
                system = get_prompt("gen_system_fixed_title", self._language, word_count_req=word_count_req)
            else:
                system = get_prompt("gen_system_dynamic_title", self._language, word_count_req=word_count_req)

            user = (
                context_built
                + "\n\n"
                + get_prompt("gen_user_task", self._language, summary=chapter_summary)
                + "\n\n"
                + get_prompt("gen_user_warning", self._language)
            )

            full_response = ""
            for chunk in self._llm.stream_complete(system, user):
                full_response += chunk
                yield chunk

            yield "\n[正文生成完成]"

        except Exception as e:
            log.exception("ChapterContentSubagent 流式执行失败")
            yield f"\n[错误] 生成失败: {e}"

    def _parse_content_response(
        self, response: str, has_fixed_title: bool
    ) -> dict[str, Any]:
        result: dict[str, Any] = {"raw_response": response}

        try:
            json_match = response.find("{")
            if json_match >= 0:
                json_str = response[json_match:]
                parsed = json.loads(json_str)
                if isinstance(parsed, dict):
                    return parsed
        except json.JSONDecodeError:
            pass

        if has_fixed_title:
            result["body"] = response
        else:
            lines = response.strip().split("\n")
            if lines:
                result["title"] = lines[0].strip()
                result["body"] = "\n".join(lines[1:]).strip()
            else:
                result["body"] = response

        return result

    def _generate_content_suggestions(self, content_result: dict[str, Any]) -> list[str]:
        suggestions = []

        body = content_result.get("body", "")
        word_count = len(body)

        if word_count < 500:
            suggestions.append("正文字数较少，建议考虑扩写")

        if word_count > 4000:
            suggestions.append("正文较长，可以考虑拆分章节")

        if "needs_polish" not in content_result:
            suggestions.append("可以考虑对正文进行润色")

        return suggestions


class PolishSubagent(Subagent):
    """润色修改 Subagent。

    对已生成的正文进行润色、修改、追加等操作。
    """

    phase_type = WorkflowPhaseType.POLISH

    def execute(
        self,
        context: dict[str, Any],
        user_modifications: dict[str, Any] | None = None,
    ) -> PhaseResult:
        result = PhaseResult(
            phase_type=self.phase_type,
            status=WorkflowStatus.RUNNING,
            started_at=datetime.now(),
        )

        try:
            original_content = context.get("original_content", "")
            polish_mode = context.get("polish_mode", "polish")
            instructions = context.get("instructions", "")

            if user_modifications:
                original_content = user_modifications.get("original_content", original_content)
                polish_mode = user_modifications.get("polish_mode", polish_mode)
                instructions = user_modifications.get("instructions", instructions)

            system_prompt = self._get_polish_system_prompt(polish_mode)
            user_prompt = self._get_polish_user_prompt(
                polish_mode, original_content, instructions
            )

            llm_response = self._llm.complete(system_prompt, user_prompt)

            polish_result = {
                "original_content": original_content,
                "polished_content": llm_response,
                "polish_mode": polish_mode,
                "instructions": instructions,
                "raw_response": llm_response,
            }

            result.generated_content = polish_result
            result.success = True
            result.status = WorkflowStatus.WAITING_USER_CONFIRM
            result.suggestions = ["建议对比润色前后的差异，确认是否符合预期"]
            result.raw_output = llm_response

        except Exception as e:
            log.exception("PolishSubagent 执行失败")
            result.success = False
            result.status = WorkflowStatus.FAILED
            result.error_message = str(e)

        result.completed_at = datetime.now()
        return result

    def _get_polish_system_prompt(self, mode: str) -> str:
        prompts = {
            "polish": """你是一位专业的小说编辑和润色师。请对给定的小说正文进行润色，
要求：
1. 保持原有的情节和人物设定不变
2. 优化语言表达，使文字更流畅、更有感染力
3. 保持原文的叙事节奏和风格
4. 只输出润色后的正文，不要解释或说明""",
            "rewrite": """你是一位专业的小说作者。请根据用户的要求，重写给定的小说正文。
要求：
1. 按照用户的具体要求进行修改
2. 保持故事的核心情节不变
3. 只输出重写后的正文，不要解释或说明""",
            "append": """你是一位专业的小说作者。请根据用户的要求，在给定的小说正文后追加内容。
要求：
1. 按照用户的要求续写
2. 保持与前文风格、人物设定的一致性
3. 只输出追加的内容，不要解释或说明""",
        }
        return prompts.get(mode, prompts["polish"])

    def _get_polish_user_prompt(
        self, mode: str, content: str, instructions: str
    ) -> str:
        parts = [f"原文：\n{content}"]

        if instructions:
            parts.append(f"\n用户要求：\n{instructions}")

        mode_desc = {
            "polish": "请对以上内容进行润色",
            "rewrite": "请根据以上要求重写内容",
            "append": "请根据以上要求追加内容",
        }

        parts.append(f"\n{mode_desc.get(mode, '请处理以上内容')}：")

        return "\n".join(parts)
