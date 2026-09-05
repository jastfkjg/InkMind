"""Offline regressions: in-memory database, fake LLM, real chapter HTTP routes."""

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.agent.memory import NovelMemory
from app.agent.tools import GenerateChapterTool, GetCharacterProfilesTool, GetPreviousChaptersTool
from app.database import Base, get_db
from app.deps import get_current_user
from app.llm.base import LLMProvider
from app.models import Chapter, ChapterVersion, Character, Novel, User
from app.routers.chapters import router
from app.schemas.chapter import ChapterOut
from app.services.chapter_gen import (
    build_generation_prompt,
    plan_batch_chapters,
    run_direct_chapter_generation,
    run_flexible_chapter_generation,
    run_react_chapter_generation,
)
from app.workflow.base import WorkflowPhaseType, WorkflowState, WorkflowStatus
from app.workflow.orchestrator import NovelOrchestrator
from app.workflow.phases import ChapterContentSubagent, ChapterSummarySubagent


class RecordingLLM(LLMProvider):
    def __init__(self, response: str = '{"title":"新标题","body":"新的正文"}') -> None:
        self.prompts: list[str] = []
        self.response = response

    def stream_complete(self, system: str, user: str, *, max_tokens: int | None = None):
        self.prompts.append(user)
        yield self.response


class DatabaseCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.user = User(email="writer@example.invalid", hashed_password="unused")
        self.db.add(self.user)
        self.db.flush()
        self.novel = Novel(user_id=self.user.id, title="测试作品")
        self.other = Novel(user_id=self.user.id, title="另一作品")
        self.db.add_all([self.novel, self.other])
        self.db.flush()
        self.chapters = [
            Chapter(novel_id=self.novel.id, title=f"章节{i}", summary=f"情节标记{i}",
                    content=f"正文{i}", sort_order=i * 10)
            for i in range(1, 8)
        ]
        self.db.add_all(self.chapters)
        self.db.add(Chapter(novel_id=self.other.id, summary="其他作品情节", sort_order=999))
        self.db.commit()

    def assert_middle_context(self, text: str) -> None:
        for i in (2, 3, 4):
            self.assertIn(f"情节标记{i}", text)
        for i in (1, 5, 6, 7):
            self.assertNotIn(f"情节标记{i}", text)
        self.assertNotIn("其他作品情节", text)


class ContextTests(DatabaseCase):
    def test_middle_chapter_only_uses_preceding_three(self) -> None:
        memory = NovelMemory(self.db, self.novel, before_chapter=self.chapters[4])
        text = memory.build_context("新的概要")
        self.assert_middle_context(text)
        self.assertLess(text.index("情节标记2"), text.index("情节标记4"))

    def test_first_chapter_has_no_previous_context(self) -> None:
        memory = NovelMemory(self.db, self.novel, before_chapter=self.chapters[0])
        self.assertEqual(memory.get_relevant_chapters(), [])

    def test_append_keeps_latest_chapters(self) -> None:
        memory = NovelMemory(self.db, self.novel)
        self.assertEqual([c.id for c in memory.get_relevant_chapters()],
                         [c.id for c in reversed(self.chapters[-3:])])
        self.assertEqual(memory.get_relevant_chapters(0), [])

    def test_equal_sort_orders_follow_id_order(self) -> None:
        for chapter in self.chapters:
            chapter.sort_order = 0
        self.db.commit()
        self.assert_middle_context(
            NovelMemory(self.db, self.novel, before_chapter=self.chapters[4]).build_context("新概要")
        )

    def test_insert_position_and_inclusive_anchor(self) -> None:
        before = NovelMemory(self.db, self.novel, before_sort_order=50)
        through = NovelMemory(self.db, self.novel, through_chapter=self.chapters[3])
        self.assert_middle_context(before.build_context("新概要"))
        self.assert_middle_context(through.build_context("新概要"))

    def test_empty_summaries_are_skipped_without_leaking_future(self) -> None:
        self.chapters[3].summary = ""
        self.db.commit()
        actual = NovelMemory(self.db, self.novel, before_chapter=self.chapters[4]).get_relevant_chapters()
        self.assertEqual([c.id for c in actual], [c.id for c in reversed(self.chapters[:3])])

    def test_foreign_anchor_is_rejected(self) -> None:
        foreign = self.db.query(Chapter).filter_by(novel_id=self.other.id).one()
        with self.assertRaises(ValueError):
            NovelMemory(self.db, self.novel, before_chapter=foreign)

    def test_character_names_in_unsegmented_chinese_and_english(self) -> None:
        self.db.add_all([
            Character(novel_id=self.novel.id, name="林照", profile="送信人"),
            Character(novel_id=self.novel.id, name="雨", profile=""),
            Character(novel_id=self.novel.id, name="Alice", profile=""),
            Character(novel_id=self.novel.id, name="Ann", profile=""),
            Character(novel_id=self.novel.id, name="医生", profile="doctor"),
            Character(novel_id=self.other.id, name="林照", profile="外部人物"),
        ])
        self.db.commit()
        summary = "林照收到一封信后遇见雨。ALICE meets Joanne and a doctor."
        memory = NovelMemory(self.db, self.novel)
        names = [c.name for c in memory.get_relevant_characters(summary)]
        self.assertEqual(set(names), {"林照", "雨", "Alice", "医生"})
        self.assertEqual(names[-1], "医生")  # Explicit names rank ahead of profile matches.
        tool_text = GetCharacterProfilesTool(self.db, self.novel).run(summary)
        self.assertIn("【林照】", tool_text)
        self.assertNotIn("外部人物", tool_text)
        self.assertNotIn("【Ann】", tool_text)
        self.assertEqual(memory.get_relevant_characters(""), [])

    def test_direct_generation_and_preview_preserve_boundary(self) -> None:
        llm = RecordingLLM()
        before = self.chapters[4].content
        list(run_direct_chapter_generation(
            self.db, self.novel, "新概要", self.chapters[4], llm,
            fixed_title="固定标题", save_to_db=False,
        ))
        self.assert_middle_context(llm.prompts[0])
        self.assertEqual(self.chapters[4].content, before)
        _, prompt = build_generation_prompt(self.db, self.novel, "新概要", None, new_sort_order=50)
        self.assert_middle_context(prompt)

    def test_agent_tool_sync_and_stream_preserve_boundary(self) -> None:
        llm = RecordingLLM()
        tool = GenerateChapterTool(self.db, self.novel, llm, before_chapter=self.chapters[4])
        tool.run("新概要")
        list(tool.run_stream("新概要"))
        for prompt in llm.prompts:
            self.assert_middle_context(prompt)
        previous = GetPreviousChaptersTool(self.db, self.novel, before_chapter=self.chapters[4])
        self.assert_middle_context(previous.run())

    def test_both_agent_modes_wire_boundary_to_tools(self) -> None:
        captured: list[str] = []

        class InspectingAgent:
            def __init__(self, llm, tools, **kwargs):
                self.tools = {tool.name: tool for tool in tools}

            def run(self, task, **kwargs):
                captured.append(self.tools["get_previous_chapters"].run())
                yield self.tools["generate_chapter"].run("新概要")

        for name, generate in (("ReActAgent", run_react_chapter_generation),
                               ("FlexibleNovelAgent", run_flexible_chapter_generation)):
            with self.subTest(mode=name), patch(f"app.services.chapter_gen.{name}", InspectingAgent):
                llm = RecordingLLM()
                list(generate(self.db, self.novel, "新概要", self.chapters[4], llm, fixed_title="固定标题"))
                self.assert_middle_context(captured[-1])
                self.assert_middle_context(llm.prompts[0])

    def test_batch_planning_includes_anchor_but_not_later_plot(self) -> None:
        llm = RecordingLLM('{"chapters":[{"title":"新标题","summary":"新概要"}]}')
        plan_batch_chapters(self.db, self.novel, llm, total_summary="新概要",
                            chapter_count=1, after_chapter=self.chapters[3])
        self.assert_middle_context(llm.prompts[0])

    def test_workflow_uses_chapter_number_not_id_or_sort_order(self) -> None:
        llm = RecordingLLM()
        context = {"target_chapter": 5, "chapter_summary": "新概要"}
        for cls in (ChapterSummarySubagent, ChapterContentSubagent):
            agent = cls(self.db, self.novel, self.user, llm, "zh")
            agent.execute(context)
            self.assert_middle_context(llm.prompts[-1])
        list(ChapterContentSubagent(self.db, self.novel, self.user, llm, "zh").execute_stream(context))
        self.assert_middle_context(llm.prompts[-1])

    def test_workflow_passes_target_to_content_phase(self) -> None:
        state = WorkflowState(
            workflow_id="test", novel_id=self.novel.id, user_id=self.user.id,
            current_phase=WorkflowPhaseType.CHAPTER_CONTENT,
            status=WorkflowStatus.RUNNING, target_chapter=5,
        )
        orchestrator = NovelOrchestrator(self.db, self.novel, self.user, RecordingLLM())
        context = orchestrator.build_context_for_phase(WorkflowPhaseType.CHAPTER_CONTENT, state)
        self.assertEqual(context["target_chapter"], 5)


class ChapterApiTests(DatabaseCase):
    def setUp(self) -> None:
        super().setUp()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.chapter = self.chapters[0]
        self.versions = [ChapterVersion(chapter_id=self.chapter.id, version_number=i,
                                       title="标题", summary="概要", content=f"版本正文{i}", change_type="manual")
                         for i in (1, 2)]
        self.db.add_all(self.versions)
        self.db.commit()
        self.url = f"/novels/{self.novel.id}/chapters/{self.chapter.id}"

    def test_compare_endpoint_reaches_static_route(self) -> None:
        response = self.client.get(f"{self.url}/versions/compare", params={
            "version_id_1": self.versions[0].id, "version_id_2": self.versions[1].id,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["old_version"]["id"], self.versions[0].id)
        self.assertEqual(response.json()["new_version"]["id"], self.versions[1].id)

    def test_detail_and_compare_current_still_work(self) -> None:
        detail = self.client.get(f"{self.url}/versions/{self.versions[0].id}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["id"], self.versions[0].id)
        current = self.client.get(f"{self.url}/versions/{self.versions[0].id}/compare-current")
        self.assertEqual(current.status_code, 200, current.text)

    def test_compare_rejects_version_from_another_chapter(self) -> None:
        self.versions[1].chapter_id = self.chapters[1].id
        self.db.commit()
        response = self.client.get(f"{self.url}/versions/compare", params={
            "version_id_1": self.versions[0].id, "version_id_2": self.versions[1].id,
        })
        self.assertEqual(response.status_code, 404)

    def test_chapter_http_dates_have_timezone(self) -> None:
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        for field in ("created_at", "updated_at"):
            self.assertEqual(datetime.fromisoformat(response.json()[field]).utcoffset(), timedelta(0))

    def test_schema_preserves_explicit_timezone(self) -> None:
        aware = datetime(2026, 9, 5, 12, tzinfo=timezone(timedelta(hours=8)))
        chapter = ChapterOut.model_validate(self.chapter).model_copy(update={"updated_at": aware})
        self.assertEqual(chapter.model_dump(mode="json")["updated_at"], aware.isoformat())


if __name__ == "__main__":
    unittest.main()
