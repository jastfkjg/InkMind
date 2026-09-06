"""Library summaries and optional first-chapter creation, against real HTTP routes."""
import unittest
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Chapter, Novel, User
from app.routers.novels import router


class LibraryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.user = User(email="writer@example.invalid", hashed_password="unused")
        self.other = User(email="other@example.invalid", hashed_password="unused")
        self.db.add_all([self.user, self.other]); self.db.flush()
        self.date = datetime(2026, 9, 1)
        self.novel = Novel(user_id=self.user.id, title="山海", updated_at=self.date)
        self.empty = Novel(user_id=self.user.id, title="空白", updated_at=self.date)
        self.private = Novel(user_id=self.other.id, title="不可见", updated_at=self.date)
        self.db.add_all([self.novel, self.empty, self.private]); self.db.flush()
        self.chapters = [
            Chapter(novel_id=self.novel.id, title="最近编辑", content="　　山 海\n\t月\u00a0✨", sort_order=0, updated_at=self.date + timedelta(days=2)),
            Chapter(novel_id=self.novel.id, title="最后一章", content="星\r\n河", sort_order=1, updated_at=self.date + timedelta(days=1)),
            Chapter(novel_id=self.private.id, title="私有章", content="秘密" * 30, sort_order=0),
        ]
        self.db.add_all(self.chapters); self.db.commit()
        app = FastAPI(); app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_counts_latest_edit_and_user_isolation(self) -> None:
        response = self.client.get("/novels")
        self.assertEqual(response.status_code, 200, response.text)
        novels = response.json()
        self.assertEqual([n["id"] for n in novels], [self.novel.id, self.empty.id])
        item = novels[0]
        self.assertEqual(item["chapter_count"], 2)
        self.assertEqual(item["total_words"], 6)
        self.assertEqual(item["last_chapter_id"], self.chapters[0].id)
        self.assertEqual(item["last_chapter_title"], "最近编辑")
        self.assertEqual(item["last_edited_at"], "2026-09-03T00:00:00+00:00")
        self.assertNotIn("content", item)
        self.assertEqual(novels[1]["total_words"], 0)
        self.assertEqual(novels[1]["chapter_count"], 0)
        self.assertIsNone(novels[1]["last_chapter_id"])

    def test_edits_and_deletes_update_summary_without_stored_counters(self) -> None:
        self.chapters[1].content = "新内容"
        self.chapters[1].updated_at = self.date + timedelta(days=4)
        self.db.delete(self.chapters[0]); self.db.commit()
        item = self.client.get("/novels").json()[0]
        self.assertEqual(item["chapter_count"], 1)
        self.assertEqual(item["total_words"], 3)
        self.assertEqual(item["last_chapter_title"], "最后一章")

    def test_new_work_can_start_with_one_empty_chapter(self) -> None:
        response = self.client.post("/novels", json={"title": "新故事", "create_first_chapter": True})
        self.assertEqual(response.status_code, 201, response.text)
        novel_id = response.json()["id"]
        chapters = self.db.query(Chapter).filter_by(novel_id=novel_id).all()
        self.assertEqual(len(chapters), 1)
        self.assertEqual((chapters[0].title, chapters[0].content, chapters[0].summary), ("", "", ""))
        self.assertEqual(self.db.get(Novel, novel_id).user_id, self.user.id)

    def test_existing_create_clients_keep_empty_work_behavior(self) -> None:
        response = self.client.post("/novels", json={"title": "传统流程"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.db.query(Chapter).filter_by(novel_id=response.json()["id"]).count(), 0)


if __name__ == "__main__":
    unittest.main()
