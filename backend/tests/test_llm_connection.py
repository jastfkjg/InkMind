"""Connection checks use synthetic accounts and mocked SDK calls, never live APIs."""
import unittest
from unittest.mock import Mock, patch

import anthropic
import httpx
import openai
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, get_db
from app.deps import get_current_user
from app.llm.anthropic_llm import AnthropicLLM
from app.llm.metered_llm import MeteredLLM
from app.llm.openai_llm import OpenAICompatibleLLM
from app.models import LLMUsageEvent, User, UserCustomLLM
from app.routers.meta import router


class ConnectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.user = User(email="connection@example.invalid", hashed_password="unused", token_quota_used=17, llm_call_count=2)
        self.other = User(email="other@example.invalid", hashed_password="unused")
        self.db.add_all([self.user, self.other]); self.db.flush()
        self.custom = UserCustomLLM(user_id=self.user.id, provider="anthropic", api_key="fixture-secret", base_url="https://fixture.invalid")
        self.foreign = UserCustomLLM(user_id=self.other.id, provider="anthropic", api_key="other-secret")
        self.db.add_all([self.custom, self.foreign]); self.db.commit()
        app = FastAPI(); app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def check(self, target: str = "generation") -> dict:
        response = self.client.post("/meta/llm-connection-test", json={"target": target})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_success_uses_metadata_without_generating_or_metering(self) -> None:
        inner = Mock()
        metered = MeteredLLM(inner, self.db, self.user.id, provider="fixture", action="连接检查")
        with patch("app.services.llm_connection.resolve_llm_for_user", return_value=metered) as resolver:
            self.assertEqual(self.check(), {"status": "ok"})
        resolver.assert_called_once_with(self.user, None, db=self.db, action="连接检查")
        inner.check_connection.assert_called_once_with()
        inner.stream_complete.assert_not_called()
        self.db.refresh(self.user)
        self.assertEqual((self.user.llm_call_count, self.user.token_quota_used), (2, 17))
        self.assertEqual(self.db.query(LLMUsageEvent).count(), 0)

    def test_missing_foreign_or_empty_custom_keys_never_fall_back(self) -> None:
        for target in ("generation", "agent"):
            setattr(self.user, f"{target}_use_custom", True)
            for custom_id in (None, 9999, self.foreign.id):
                setattr(self.user, f"{target}_custom_llm_id", custom_id)
                with patch("app.services.llm_connection.resolve_llm_for_user") as generation, patch("app.services.llm_connection.resolve_agent_llm_for_user") as agent:
                    self.assertEqual(self.check(target), {"status": "unconfigured"})
                    generation.assert_not_called(); agent.assert_not_called()
            self.custom.api_key = "  "
            setattr(self.user, f"{target}_custom_llm_id", self.custom.id)
            self.assertEqual(self.check(target), {"status": "unconfigured"})

    def test_agent_uses_saved_anthropic_connection(self) -> None:
        self.user.agent_use_custom = True
        self.user.agent_custom_llm_id = self.custom.id
        self.user.agent_model = "saved-agent-model"
        with patch("app.services.llm_connection.AnthropicLLM") as factory:
            self.assertEqual(self.check("agent"), {"status": "ok"})
            factory.assert_called_once_with(api_key="fixture-secret", base_url="https://fixture.invalid", model="saved-agent-model")
            factory.return_value.check_connection.assert_called_once_with()

    def test_generation_uses_saved_custom_selection(self) -> None:
        self.user.generation_use_custom = True
        self.user.generation_custom_llm_id = self.custom.id
        self.user.preferred_llm_model = "saved-writing-model"
        with patch("app.llm.providers.get_llm_from_user_config") as factory:
            self.assertEqual(self.check(), {"status": "ok"})
            factory.assert_called_once_with("anthropic", "fixture-secret", "https://fixture.invalid", "saved-writing-model", protocol="anthropic")
            factory.return_value.check_connection.assert_called_once_with()

    def test_desktop_without_custom_selection_is_unconfigured(self) -> None:
        with patch.object(settings, "desktop_mode", True):
            self.assertEqual(self.check(), {"status": "unconfigured"})
            self.assertEqual(self.check("agent"), {"status": "unconfigured"})

    def test_errors_are_classified_without_leaking_provider_messages(self) -> None:
        request = httpx.Request("GET", "https://fixture.invalid/v1/models")
        for sdk in (openai, anthropic):
            for code, expected in ((401, "authentication"), (403, "permission"), (404, "not_supported"), (405, "not_supported"), (501, "not_supported"), (429, "rate_limit"), (503, "unavailable")):
                error = sdk.APIStatusError("fixture-secret https://private.invalid", response=httpx.Response(code, request=request), body={"secret": "fixture-secret"})
                provider = Mock(); provider.check_connection.side_effect = error
                with patch("app.services.llm_connection.resolve_llm_for_user", return_value=provider):
                    self.assertEqual(self.check(), {"status": expected})
            for error, expected in ((sdk.APITimeoutError(request=request), "timeout"), (NotImplementedError(), "not_supported"), (RuntimeError("fixture-secret"), "unavailable")):
                provider = Mock(); provider.check_connection.side_effect = error
                with patch("app.services.llm_connection.resolve_llm_for_user", return_value=provider):
                    self.assertEqual(self.check(), {"status": expected})

    def test_request_does_not_accept_credentials_or_arbitrary_destinations(self) -> None:
        for body in ({"target": "unknown"}, {"target": "generation", "api_key": "untrusted"}, {"target": "agent", "base_url": "https://untrusted.invalid"}):
            response = self.client.post("/meta/llm-connection-test", json=body)
            self.assertEqual(response.status_code, 422)


class SDKConnectionTests(unittest.TestCase):
    def test_sdk_checks_use_only_model_list_with_bounded_timeout_and_no_retry(self) -> None:
        for factory, sdk_constructor in ((OpenAICompatibleLLM, "app.llm.openai_llm.OpenAI"), (AnthropicLLM, "app.llm.anthropic_llm.anthropic.Anthropic")):
            with patch(sdk_constructor) as sdk:
                provider = factory(api_key="fixture-secret", base_url="https://fixture.invalid", model="fixture-model")
                provider.check_connection()
                sdk.return_value.with_options.assert_called_once_with(timeout=15.0, max_retries=0)
                sdk.return_value.with_options.return_value.models.list.assert_called_once_with()
                sdk.return_value.chat.completions.create.assert_not_called()
                sdk.return_value.messages.stream.assert_not_called()


if __name__ == "__main__":
    unittest.main()
