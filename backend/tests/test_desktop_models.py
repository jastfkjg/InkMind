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
from app.agent.claude_orchestrator import _build_claude_cli_env
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

    def test_reselect_connection_inherits_default_for_display_and_generation(self) -> None:
        for desktop in (True, False):
            with self.subTest(desktop=desktop), patch.object(settings, "desktop_mode", desktop):
                response = self.client.post("/custom-llms", json={
                    "provider": "qwen", "protocol": "anthropic", "api_key": "synthetic-key",
                    "base_url": "https://fixture.invalid", "default_model": "deepseek-v4-pro",
                })
                self.assertEqual(response.status_code, 201)
                custom_id = response.json()["id"]
                self.user.preferred_llm_model = self.user.agent_model = "qwen3-max"
                self.db.commit()
                response = self.client.patch("/auth/me", json={
                    "generation_use_custom": True, "generation_custom_llm_id": custom_id,
                    "preferred_llm_model": None, "agent_use_custom": True,
                    "agent_custom_llm_id": custom_id, "agent_model": None,
                })
                self.assertEqual(response.status_code, 200)
                self.db.expire_all()
                self.assertIsNone(self.client.get("/auth/me").json()["preferred_llm_model"])
                info = self.client.get("/meta/llm-providers").json()
                self.assertEqual(next(c for c in info["custom_llms"] if c["id"] == custom_id)["default_model"], "deepseek-v4-pro")
                with patch("app.llm.providers.get_llm_from_user_config") as factory:
                    resolve_llm_for_user(self.user, None, db=self.db)
                    self.assertEqual(factory.call_args.args[3], "deepseek-v4-pro")
                self.assertEqual(resolve_agent_llm_for_user(self.user, self.db)["model"], "deepseek-v4-pro")
                self.client.patch(f"/custom-llms/{custom_id}", json={"default_model": "updated-default"})
                self.assertEqual(resolve_agent_llm_for_user(self.user, self.db)["model"], "updated-default")

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
            "model": "user-agent-model", "claude_auth_mode": "auto", "source": "custom",
        })
        with patch("app.llm.providers.get_llm_from_user_config") as factory:
            resolve_llm_for_user(self.user, "qwen", db=self.db)
            factory.assert_called_once_with("anthropic", "user-test-key", "https://user.invalid", "user-model", protocol="anthropic", claude_auth_mode="auto")
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

    def test_web_builtin_agent_falls_back_to_deepseek_anthropic(self) -> None:
        with patch.multiple(
            settings, desktop_mode=False, anthropic_api_key=None,
            anthropic_base_url=None, deepseek_api_key="deepseek-key",
        ):
            self.assertEqual(resolve_agent_llm_for_user(self.user, self.db), {
                "api_key": "deepseek-key",
                "base_url": "https://api.deepseek.com/anthropic",
                "model": "deepseek-v4-flash",
                "claude_auth_mode": "auth_token",
                "source": "builtin",
            })

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

    def test_protocol_is_independent_of_brand_and_model_presets(self) -> None:
        response = self.client.post("/custom-llms", json={
            "provider": "qwen", "protocol": "anthropic", "api_key": "synthetic-key",
            "base_url": "https://user.invalid/anthropic",
        })
        self.assertEqual(response.status_code, 201)
        custom_id = response.json()["id"]
        self.assertEqual(response.json()["protocol"], "anthropic")
        self.assertEqual(self.client.get("/meta/llm-providers").json()["custom_llms"][0]["protocol"], "anthropic")
        response = self.client.patch("/auth/me", json={
            "agent_use_custom": True, "agent_custom_llm_id": custom_id,
            "agent_model": "unlisted-model", "generation_use_custom": True,
            "generation_custom_llm_id": custom_id, "preferred_llm_model": "unlisted-model",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(resolve_agent_llm_for_user(self.user, self.db)["model"], "unlisted-model")
        with patch("app.llm.providers.AnthropicLLM") as factory:
            resolve_llm_for_user(self.user, None, db=self.db)
            self.assertEqual(factory.call_args.kwargs["model"], "unlisted-model")
            self.assertEqual(factory.call_args.kwargs["base_url"], "https://user.invalid/anthropic")
        response = self.client.patch(f"/custom-llms/{custom_id}", json={
            "protocol": "openai", "base_url": "https://user.invalid/v1",
        })
        self.assertEqual(response.status_code, 200)
        with patch("app.llm.providers.OpenAICompatibleLLM") as factory:
            resolve_llm_for_user(self.user, None, db=self.db)
            self.assertEqual(factory.call_args.kwargs["model"], "unlisted-model")
        for desktop in (True, False):
            with patch.object(settings, "desktop_mode", desktop):
                self.assertIsNone(resolve_agent_llm_for_user(self.user, self.db)["api_key"])
        self.assertEqual(self.client.patch("/auth/me", json={"agent_custom_llm_id": custom_id}).status_code, 400)

    def test_claude_auth_mode_is_saved_and_returned(self) -> None:
        response = self.client.post("/custom-llms", json={
            "provider": "deepseek", "protocol": "anthropic",
            "claude_auth_mode": "auth_token", "api_key": "synthetic-key",
            "base_url": "https://api.deepseek.com/anthropic",
            "default_model": "deepseek-v4-pro",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["claude_auth_mode"], "auth_token")
        custom_id = response.json()["id"]
        response = self.client.patch(
            f"/custom-llms/{custom_id}", json={"claude_auth_mode": "api_key"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["claude_auth_mode"], "api_key")

    def test_claude_cli_env_supports_provider_specific_authentication(self) -> None:
        fixtures = (
            ("https://api.anthropic.com", "api_key", "ANTHROPIC_API_KEY"),
            ("https://api.kimi.com/coding/", "auto", "ANTHROPIC_API_KEY"),
            ("https://api.deepseek.com/anthropic", "auto", "ANTHROPIC_AUTH_TOKEN"),
            ("https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic", "auto", "ANTHROPIC_AUTH_TOKEN"),
            ("https://gateway.example.invalid/anthropic", "api_key", "ANTHROPIC_API_KEY"),
        )
        for base_url, mode, expected_key in fixtures:
            with self.subTest(base_url=base_url, mode=mode):
                env = _build_claude_cli_env({
                    "api_key": "fixture-secret", "base_url": base_url,
                    "model": "fixture-model", "claude_auth_mode": mode,
                })
                other_key = "ANTHROPIC_AUTH_TOKEN" if expected_key == "ANTHROPIC_API_KEY" else "ANTHROPIC_API_KEY"
                self.assertEqual(env[expected_key], "fixture-secret")
                self.assertEqual(env[other_key], "")
                for name in (
                    "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL",
                    "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
                    "ANTHROPIC_DEFAULT_OPUS_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL",
                ):
                    self.assertEqual(env[name], "fixture-model")

    def test_protocol_validation_and_legacy_defaults(self) -> None:
        for brand, protocol in (("qwen", "openai"), ("anthropic", "anthropic")):
            response = self.client.post("/custom-llms", json={"provider": brand, "api_key": "synthetic-key"})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["protocol"], protocol)
        for payload, status in (({"protocol": "invalid"}, 422), ({"protocol": "anthropic"}, 400)):
            self.assertEqual(self.client.post("/custom-llms", json={
                "provider": "qwen", "api_key": "synthetic-key", **payload,
            }).status_code, status)

    def test_legacy_protocol_migration_is_repeatable(self) -> None:
        from sqlalchemy import text
        from app import main
        with self.engine.begin() as conn:
            conn.execute(text("DROP TABLE user_custom_llms"))
            conn.execute(text("CREATE TABLE user_custom_llms (id INTEGER PRIMARY KEY, user_id INTEGER, provider VARCHAR(64), api_key VARCHAR(512), base_url VARCHAR(512), created_at DATETIME)"))
            conn.execute(text("INSERT INTO user_custom_llms (id, provider, api_key) VALUES (1, 'qwen', 'synthetic-qwen'), (2, 'anthropic', 'synthetic-anthropic')"))
        with patch.object(main, "engine", self.engine):
            main._migrate_sqlite()
            main._migrate_sqlite()
        with self.engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT protocol, claude_auth_mode, api_key FROM user_custom_llms ORDER BY id")).all(),
                             [("openai", "auto", "synthetic-qwen"), ("anthropic", "auto", "synthetic-anthropic")])


if __name__ == "__main__":
    unittest.main()
