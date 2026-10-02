"""Retry ownership, saved parameters, migration and partial batch recovery with fake models."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.deps import get_current_user
from app.models import BackgroundTask, Chapter, Novel, User
from app.routers.background_tasks import router
from app.services import task_manager as workers


class TaskRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose); self.addCleanup(self.db.close)
        self.user = User(email="writer@example.invalid", hashed_password="unused")
        self.other = User(email="other@example.invalid", hashed_password="unused")
        self.db.add_all([self.user, self.other]); self.db.flush()
        self.novel = Novel(user_id=self.user.id, title="山海")
        self.db.add(self.novel); self.db.flush()
        self.chapter = Chapter(novel_id=self.novel.id, title="原章", content="原稿", sort_order=0)
        self.db.add(self.chapter); self.db.commit()
        app = FastAPI(); app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app); self.addCleanup(self.client.close)
        self.submit = self.enterContext(patch.object(workers.task_manager, "submit_task"))
        self.enterContext(patch.object(workers.task_manager, "is_running", return_value=False))

    def create_single(self) -> BackgroundTask:
        response = self.client.post("/background-tasks/single", json={"novel_id": self.novel.id, "chapter_id": self.chapter.id, "title": "任务标题", "summary": "雨夜", "fixed_title": "固定标题", "word_count": 1234})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertNotIn("request_json", response.json())
        task = self.db.get(BackgroundTask, response.json()["id"])
        task.status = "failed"; self.db.commit(); self.submit.reset_mock()
        return task

    def test_retry_replays_once_and_keeps_original_until_worker_runs(self) -> None:
        task = self.create_single(); task.error_message = "旧错误"; self.db.commit()
        response = self.client.post(f"/background-tasks/{task.id}/retry")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "pending")
        self.assertEqual(response.json()["novel_title"], "山海")
        self.assertIsNone(response.json()["error_message"])
        self.assertEqual(self.submit.call_args.args[5:10], (self.chapter.id, "任务标题", "雨夜", "固定标题", 1234))
        self.assertEqual(self.client.post(f"/background-tasks/{task.id}/retry").status_code, 409)
        self.submit.assert_called_once()
        self.assertEqual(self.db.get(Chapter, self.chapter.id).content, "原稿")

    def test_ownership_and_deleted_target(self) -> None:
        task = self.create_single(); task.user_id = self.other.id; self.db.commit()
        self.assertEqual(self.client.post(f"/background-tasks/{task.id}/retry").status_code, 404)
        task.user_id = self.user.id; self.db.delete(self.chapter); self.db.commit()
        self.assertEqual(self.client.post(f"/background-tasks/{task.id}/retry").status_code, 409)
        self.submit.assert_not_called()

    def test_legacy_task_does_not_guess_missing_target(self) -> None:
        task = self.create_single(); task.request_json = None; self.db.commit()
        self.assertFalse(self.client.get(f"/background-tasks/{task.id}").json()["retryable"])
        self.assertEqual(self.client.post(f"/background-tasks/{task.id}/retry").status_code, 409)
        self.submit.assert_not_called()

    def test_queue_failure_can_be_retried_without_leaking_error(self) -> None:
        task = self.create_single(); self.submit.side_effect = RuntimeError("private internal detail")
        response = self.client.post(f"/background-tasks/{task.id}/retry")
        self.assertEqual(response.status_code, 503); self.assertNotIn("private", response.text)
        self.assertEqual(self.db.get(BackgroundTask, task.id).status, "failed")

    def test_batch_retry_skips_completed_and_reuses_plan(self) -> None:
        response = self.client.post("/background-tasks/batch", json={"novel_id": self.novel.id, "total_summary": "两章", "chapter_count": 2})
        task = self.db.get(BackgroundTask, response.json()["id"])
        task.status = "failed"; task.completed_count = 1; task.total_tokens = 11
        task.batch_plan_json = json.dumps([{"title": "第一章", "summary": "已完成"}, {"title": "第二章", "summary": "只生成这个"}])
        task.task_items[0].status = "completed"; task.task_items[0].chapter_id = self.chapter.id
        task.task_items[1].status = "failed"; self.db.commit()
        task_id, user_id, novel_id = task.id, self.user.id, self.novel.id
        response = self.client.post(f"/background-tasks/{task_id}/retry")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["task_items"][0]["status"], "completed")
        def generate(**kwargs):
            self.assertEqual(kwargs["chapter_summary"], "只生成这个")
            chapter = Chapter(novel_id=novel_id, title="新章", content="正文", sort_order=1)
            kwargs["db"].add(chapter); kwargs["db"].commit()
            yield chapter
        with patch.object(workers, "SessionLocal", lambda: Session(self.engine)), patch.object(workers, "resolve_llm_for_user", return_value=object()), patch.object(workers, "normalize_provider_name", return_value="fixture"), patch.object(workers, "LLMUsageAccumulator", return_value=SimpleNamespace(total_tokens=7, flush=lambda: None)), patch.object(workers, "plan_batch_chapters") as plan, patch.object(workers, "run_direct_chapter_generation", side_effect=generate) as gen:
            workers._run_batch_chapters_task(task_id, user_id, novel_id, None, "两章", 2, None, "direct", 10)
        plan.assert_not_called(); gen.assert_called_once()
        self.db.expire_all(); task = self.db.get(BackgroundTask, task_id)
        self.assertEqual((task.status, task.completed_count, task.total_tokens), ("completed", 2, 18))
        self.assertEqual(self.db.query(Chapter).filter_by(novel_id=novel_id).count(), 2)
        self.assertEqual(self.db.get(Chapter, self.chapter.id).content, "原稿")

    def test_migration_is_repeatable_and_preserves_old_task(self) -> None:
        from app import main
        task = self.create_single()
        with self.engine.begin() as conn:
            conn.execute(text("ALTER TABLE background_tasks DROP COLUMN request_json"))
        with patch.object(main, "engine", self.engine), patch.object(main.settings, "database_url", "sqlite://"):
            main._migrate_sqlite(); main._migrate_sqlite()
        self.assertIn("request_json", {c["name"] for c in inspect(self.engine).get_columns("background_tasks")})
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(text("SELECT title FROM background_tasks")), "任务标题")
            self.assertIsNone(conn.scalar(text("SELECT request_json FROM background_tasks")))

    def test_retry_inserts_missing_middle_chapter_before_completed_sibling(self) -> None:
        response = self.client.post("/background-tasks/batch", json={"novel_id": self.novel.id, "total_summary": "三章", "chapter_count": 3})
        task = self.db.get(BackgroundTask, response.json()["id"])
        later = Chapter(novel_id=self.novel.id, title="第三章", content="保持第三章", sort_order=1)
        self.db.add(later); self.db.flush()
        task.task_items[0].status = "completed"; task.task_items[0].chapter_id = self.chapter.id
        task.task_items[2].status = "completed"; task.task_items[2].chapter_id = later.id
        self.db.commit()
        order = workers._reserve_batch_chapter_order(self.db, task, 1, None)
        self.db.add(Chapter(novel_id=self.novel.id, title="第二章", content="重试内容", sort_order=order))
        self.db.commit()
        ordered = self.db.query(Chapter).filter_by(novel_id=self.novel.id).order_by(Chapter.sort_order).all()
        self.assertEqual([c.title for c in ordered], ["原章", "第二章", "第三章"])
        self.assertEqual(later.content, "保持第三章")


if __name__ == "__main__":
    unittest.main()
