"""Desktop model isolation; all credentials and databases here are synthetic."""

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.config import Settings, settings
from app.database import Base, get_db
from app.deps import get_current_user, get_optional_user
from app.llm.providers import get_llm, get_llm_from_user_config, resolve_llm_for_user, resolve_agent_llm_for_user
from app.models import User, UserCustomLLM
from app.routers import auth, custom_llms, meta
from app.routers.agent import _get_backend, _create_orchestrator


class DesktopModelsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime = patch.multiple(
            settings, desktop_mode=True, anthropic_api_key="server-anthropic",
            qwen_api_key="server-qwen", deepseek_api_key="server-deepseek",
        )
        self.runtime.start()
        self.addCleanup(self.runtime.stop)
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.user = User(email="test@inkmind.desktop", hashed_password="unused")
        self.db.add(self.user)
        self.db.commit()
        app = FastAPI()
        for router in (auth.router, custom_llms.router, meta.router):
            app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[get_optional_user] = lambda: self.user
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_desktop_settings_discard_inherited_credentials(self) -> None:
        with patch.dict("os.environ", {"KIMI_API_KEY": "server-kimi"}):
            configured = Settings(
                _env_file=None, desktop_mode=True, anthropic_api_key="server-key",
                anthropic_base_url="https://server.invalid", qwen_api_key="server-key",
            )
        self.assertIsNone(configured.anthropic_api_key)
        self.assertIsNone(configured.moonshot_api_key)
        self.assertIsNone(configured.qwen_api_key)
        self.assertIsNone(configured.anthropic_base_url)

    def test_empty_desktop_has_no_builtin_metadata_or_fallback(self) -> None:
        info = self.client.get("/meta/llm-providers").json()
        self.assertEqual(info["builtin"], [])
        self.assertEqual(info["default"], "")
        self.assertIsNone(info["agent_builtin"])
        for provider in (None, "qwen", "anthropic", "deepseek"):
            with self.assertRaisesRegex(ValueError, "AI 设置"):
                get_llm(provider)
            with self.assertRaisesRegex(ValueError, "AI 设置"):
                resolve_llm_for_user(self.user, provider, db=self.db)
        self.assertIsNone(resolve_agent_llm_for_user(self.user, self.db)["api_key"])
        self.assertEqual(_get_backend(self.user, self.db), "none")
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as raised:
            _create_orchestrator(self.db, self.user, None, "zh")
        self.assertEqual(raised.exception.status_code, 503)

    def test_custom_selection_and_deletion_never_restore_builtins(self) -> None:
        response = self.client.post("/custom-llms", json={
            "provider": "anthropic", "api_key": "user-test-key",
            "base_url": "https://user.invalid",
        })
        self.assertEqual(response.status_code, 201)
        custom_id = response.json()["id"]
        response = self.client.patch("/auth/me", json={
            "agent_use_custom": True, "agent_custom_llm_id": custom_id,
            "agent_model": "user-agent-model", "generation_use_custom": True,
            "generation_custom_llm_id": custom_id, "preferred_llm_model": "user-model",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(resolve_agent_llm_for_user(self.user, self.db), {
            "api_key": "user-test-key", "base_url": "https://user.invalid",
            "model": "user-agent-model", "source": "custom",
        })
        with patch("app.llm.providers.get_llm_from_user_config") as factory:
            resolve_llm_for_user(self.user, "qwen", db=self.db)
            factory.assert_called_once_with("anthropic", "user-test-key", "https://user.invalid", "user-model")
        self.assertEqual(self.client.delete(f"/custom-llms/{custom_id}").status_code, 204)
        with self.assertRaises(ValueError):
            resolve_llm_for_user(self.user, None, db=self.db)
        self.assertIsNone(resolve_agent_llm_for_user(self.user, self.db)["api_key"])

    def test_missing_or_other_users_configuration_does_not_fall_back(self) -> None:
        other = User(email="other@inkmind.desktop", hashed_password="unused")
        self.db.add(other)
        self.db.flush()
        custom = UserCustomLLM(user_id=other.id, provider="anthropic", api_key="other-key")
        self.db.add(custom)
        self.db.commit()
        for custom_id in (custom.id, 9999):
            self.user.agent_use_custom = self.user.generation_use_custom = True
            self.user.agent_custom_llm_id = self.user.generation_custom_llm_id = custom_id
            with self.assertRaises(ValueError):
                resolve_llm_for_user(self.user, None, db=self.db)
            self.assertIsNone(resolve_agent_llm_for_user(self.user, self.db)["api_key"])

    def test_web_builtin_behavior_is_preserved(self) -> None:
        with patch.object(settings, "desktop_mode", False):
            info = self.client.get("/meta/llm-providers").json()
            self.assertIn("qwen", [item["id"] for item in info["builtin"]])
            self.assertIsNotNone(info["agent_builtin"])
            self.assertEqual(resolve_agent_llm_for_user(self.user, self.db)["api_key"], "server-anthropic")
            with patch("app.llm.providers.QwenLLM") as factory:
                get_llm("qwen")
                factory.assert_called_once()

    def test_custom_client_uses_user_key_and_explicit_endpoint(self) -> None:
        with patch.dict("os.environ", {"OPENAI_BASE_URL": "https://server.invalid"}):
            with patch("app.llm.providers.OpenAICompatibleLLM") as factory:
                get_llm_from_user_config("openai", "user-test-key", model="user-model")
                self.assertEqual(factory.call_args.kwargs["api_key"], "user-test-key")
                self.assertEqual(factory.call_args.kwargs["base_url"], "https://api.openai.com/v1")
                self.assertEqual(factory.call_args.kwargs["model"], "user-model")
        with self.assertRaisesRegex(ValueError, "API Key"):
            get_llm_from_user_config("openai", "   ")

    def test_agent_requires_anthropic_compatible_custom_configuration(self) -> None:
        custom = UserCustomLLM(user_id=self.user.id, provider="openai", api_key="user-test-key")
        self.db.add(custom)
        self.db.commit()
        self.user.agent_use_custom = True
        self.user.agent_custom_llm_id = custom.id
        self.assertEqual(_get_backend(self.user, self.db), "none")


if __name__ == "__main__":
    unittest.main()
