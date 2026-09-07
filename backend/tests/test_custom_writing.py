"""Real writing routes with saved custom connections and no server API keys."""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.llm.providers import has_generation_configuration
from app.models import UserCustomLLM
from app.routers.novels import router as novels_router
from app.routers.chapters import router as chapters_router
from test_context_and_chapters import DatabaseCase, RecordingLLM


class CustomWritingTests(DatabaseCase):
    def setUp(self) -> None:
        super().setUp()
        self.custom = UserCustomLLM(user_id=self.user.id, provider="qwen", protocol="openai",
                                    api_key="fixture-only", default_model="deepseek-v4-pro",
                                    base_url="https://fixture.invalid/v1")
        self.db.add(self.custom)
        self.db.flush()
        self.user.generation_use_custom = True
        self.user.generation_custom_llm_id = self.custom.id
        self.db.commit()
        app = FastAPI()
        app.include_router(novels_router)
        app.include_router(chapters_router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_inspiration_reaches_saved_model_without_builtin_keys(self) -> None:
        for desktop in (False, True):
            with self.subTest(desktop=desktop), patch.object(settings, "desktop_mode", desktop), \
                    patch("app.llm.providers.list_available_providers", return_value=[]), \
                    patch("app.llm.metered_llm.count_tokens", return_value=3), \
                    patch("app.llm.providers.get_llm_from_user_config", return_value=RecordingLLM("新的概要")) as factory:
                response = self.client.post(f"/novels/{self.novel.id}/ai-chapter-summary-inspire", json={})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertIn('"summary":', response.text)
                self.assertNotIn('"error":', response.text)
                factory.assert_called_once_with("qwen", "fixture-only", "https://fixture.invalid/v1",
                                                "deepseek-v4-pro", protocol="openai")

    def test_chapter_routes_pass_custom_preflight(self) -> None:
        routes = [("generate", {"chapter_id": 99999, "summary": "概要"}), ("generate-sse", {"chapter_id": 99999, "summary": "概要"}),
                  ("99999/suggest-title", {}), ("99999/ai-evaluate", {"llm_provider": "stale-builtin"}),
                  ("99999/revise", {"llm_provider": "stale-builtin", "instruction": "改写"})]
        with patch("app.llm.providers.list_available_providers", return_value=[]):
            for path, payload in routes:
                with self.subTest(path=path):
                    response = self.client.post(f"/novels/{self.novel.id}/chapters/{path}", json=payload)
                    self.assertEqual(response.status_code, 404, response.text)
                    self.assertEqual(response.json()["detail"], "章节不存在")

    def test_invalid_custom_connections_do_not_use_server_keys(self) -> None:
        with patch("app.llm.providers.list_available_providers", return_value=["openai"]):
            for custom_id in (None, 99999):
                self.user.generation_custom_llm_id = custom_id
                self.assertFalse(has_generation_configuration(self.user, self.db))
            self.user.generation_custom_llm_id = self.custom.id
            self.custom.api_key = " "
            self.assertFalse(has_generation_configuration(self.user, self.db))
            response = self.client.post(f"/novels/{self.novel.id}/ai-chapter-summary-inspire", json={})
            self.assertEqual(response.status_code, 503)
            self.custom.api_key = "fixture"
            self.custom.user_id = self.user.id + 100
            self.assertFalse(has_generation_configuration(self.user, self.db))

    def test_builtin_requires_selected_key(self) -> None:
        self.user.generation_use_custom = False
        self.user.preferred_llm_provider = "qwen"
        with patch("app.llm.providers.list_available_providers", return_value=["qwen"]):
            self.assertTrue(has_generation_configuration(self.user, self.db))
            self.assertFalse(has_generation_configuration(self.user, self.db, "openai"))
