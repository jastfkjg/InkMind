"""Library summaries and optional first-chapter creation, against real HTTP routes."""
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Chapter, Character, Novel, NovelMemo, User
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
        self.assertFalse(response.json()["is_pinned"])
        self.assertFalse(response.json()["is_archived"])
        chapters = self.db.query(Chapter).filter_by(novel_id=novel_id).all()
        self.assertEqual(len(chapters), 1)
        self.assertEqual((chapters[0].title, chapters[0].content, chapters[0].summary), ("", "", ""))
        self.assertEqual(self.db.get(Novel, novel_id).user_id, self.user.id)

    def test_existing_create_clients_keep_empty_work_behavior(self) -> None:
        response = self.client.post("/novels", json={"title": "传统流程"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.db.query(Chapter).filter_by(novel_id=response.json()["id"]).count(), 0)

    def test_pin_is_persistent_and_prioritized_without_changing_last_edit(self) -> None:
        original = self.client.get(f"/novels/{self.empty.id}").json()
        response = self.client.patch(f"/novels/{self.empty.id}", json={"is_pinned": True})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["is_pinned"])
        self.assertEqual(response.json()["updated_at"], original["updated_at"])
        self.db.expire_all()
        items = self.client.get("/novels").json()
        self.assertEqual(items[0]["id"], self.empty.id)
        self.assertTrue(items[0]["is_pinned"])
        self.assertEqual(items[0]["last_edited_at"], original["updated_at"])
        self.client.patch(f"/novels/{self.empty.id}", json={"is_pinned": False})
        self.assertEqual(self.client.get("/novels").json()[0]["id"], self.novel.id)

    def test_archive_and_restore_keep_chapters_and_reference_material(self) -> None:
        character = Character(novel_id=self.novel.id, name="林照", profile="完整设定", notes="人物备注")
        memo = NovelMemo(novel_id=self.novel.id, title="伏笔", body="结局中的旧信")
        self.db.add_all([character, memo]); self.db.commit()
        original_contents = [(chapter.id, chapter.content) for chapter in self.novel.chapters]
        original = self.client.get(f"/novels/{self.novel.id}").json()
        for archived in (True, False):
            response = self.client.patch(f"/novels/{self.novel.id}", json={"is_archived": archived})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["is_archived"], archived)
            self.assertEqual(response.json()["updated_at"], original["updated_at"])
            self.db.expire_all()
            self.assertEqual(self.client.get(f"/novels/{self.novel.id}").json()["is_archived"], archived)
            items = self.client.get("/novels").json()
            item = next(item for item in items if item["id"] == self.novel.id)
            self.assertEqual(item["is_archived"], archived)
            self.assertEqual(item["chapter_count"], 2)
            self.assertEqual(item["total_words"], 6)
            self.assertEqual([(chapter.id, chapter.content) for chapter in self.novel.chapters], original_contents)
            self.assertEqual(self.db.get(Character, character.id).profile, "完整设定")
            self.assertEqual(self.db.get(NovelMemo, memo.id).body, "结局中的旧信")

    def test_partial_metadata_edit_retains_organization_flags(self) -> None:
        self.client.patch(f"/novels/{self.novel.id}", json={"is_pinned": True, "is_archived": True})
        response = self.client.patch(f"/novels/{self.novel.id}", json={"title": "新的书名"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["is_pinned"])
        self.assertTrue(response.json()["is_archived"])
        self.assertEqual(response.json()["title"], "新的书名")
        self.assertGreater(datetime.fromisoformat(response.json()["updated_at"]).replace(tzinfo=None), self.date)

    def test_organization_requires_ownership_and_valid_flags(self) -> None:
        response = self.client.patch(f"/novels/{self.private.id}", json={"is_archived": True})
        self.assertEqual(response.status_code, 404)
        self.assertFalse(self.db.get(Novel, self.private.id).is_archived)
        for flag in ("is_pinned", "is_archived"):
            response = self.client.patch(f"/novels/{self.novel.id}", json={flag: None})
            self.assertEqual(response.status_code, 422)
        self.assertFalse(self.db.get(Novel, self.novel.id).is_archived)


class LibraryMigrationTests(unittest.TestCase):
    def test_existing_sqlite_library_is_migrated_without_altering_manuscripts(self) -> None:
        from app import main

        engine = create_engine("sqlite://", poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            conn.execute(text("CREATE TABLE novels (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, outline TEXT, updated_at TEXT)"))
            conn.execute(text("CREATE TABLE chapters (id INTEGER PRIMARY KEY, novel_id INTEGER, content TEXT)"))
            conn.execute(text("INSERT INTO users (id) VALUES (1)"))
            conn.execute(text("INSERT INTO novels VALUES (1, 1, '旧作品', '原始设定', '2026-09-01 00:00:00')"))
            conn.execute(text("INSERT INTO chapters VALUES (1, 1, '完整正文保持原样')"))
        self.assertNotIn("is_pinned", {column["name"] for column in inspect(engine).get_columns("novels")})
        with patch.object(main, "engine", engine), patch.object(main.settings, "database_url", "sqlite://"):
            main._migrate_sqlite()
            main._migrate_sqlite()
            with engine.begin() as conn:
                row = conn.execute(text("SELECT title, background, updated_at, is_pinned, is_archived FROM novels WHERE id = 1")).one()
                self.assertEqual(tuple(row), ("旧作品", "原始设定", "2026-09-01 00:00:00", 0, 0))
                self.assertEqual(conn.scalar(text("SELECT content FROM chapters WHERE id = 1")), "完整正文保持原样")
                conn.execute(text("UPDATE novels SET is_pinned = 1, is_archived = 1 WHERE id = 1"))
            main._migrate_sqlite()
            with engine.connect() as conn:
                self.assertEqual(tuple(conn.execute(text("SELECT is_pinned, is_archived FROM novels WHERE id = 1")).one()), (1, 1))


if __name__ == "__main__":
    unittest.main()
