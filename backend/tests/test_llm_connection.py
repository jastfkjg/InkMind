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
    def test_probe_duration_includes_success_and_failure(self) -> None:
        from app.services.llm_connection import probe_provider
        for mode in ("models", "model"):
            for failure in (False, True):
                with self.subTest(mode=mode, failure=failure):
                    provider = Mock()
                    provider.list_models.return_value = ["example-model"]
                    if failure:
                        getattr(provider, "list_models" if mode == "models" else "test_model").side_effect = TimeoutError()
                    with patch("app.services.llm_connection.perf_counter", side_effect=[10.0, 11.25]):
                        result = probe_provider(provider, mode)
                    self.assertEqual(result.elapsed_ms, 1250.0)
                    self.assertEqual(result.status, "timeout" if failure else "ok")

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
        from app.routers.custom_llms import router as custom_router
        app = FastAPI(); app.include_router(router); app.include_router(custom_router)
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

    def test_draft_probe_list_failure_does_not_prevent_model_test(self) -> None:
        payload = {"provider": "qwen", "protocol": "openai", "base_url": "https://fixture.invalid/v1",
                   "api_key": "fixture-secret", "default_model": "not-in-presets"}
        error = openai.APIStatusError("secret", response=httpx.Response(401, request=httpx.Request("GET", "https://fixture.invalid/models")), body={})
        inner = Mock(); inner.list_models.side_effect = error; inner.test_model.return_value = (7, 2)
        with patch("app.routers.custom_llms.get_llm_from_user_config", return_value=inner):
            listed = self.client.post("/custom-llms/probe", json={**payload, "mode": "models"})
            self.assertEqual(listed.json()["status"], "authentication")
            self.assertEqual(listed.json()["http_status"], 401)
            self.assertEqual(self.db.query(LLMUsageEvent).count(), 0)
            tested = self.client.post("/custom-llms/probe", json={**payload, "mode": "model"})
            self.assertEqual(tested.json()["status"], "ok")
        event = self.db.query(LLMUsageEvent).one()
        self.assertEqual((event.input_tokens, event.output_tokens, event.source), (7, 2, "custom"))
        self.db.refresh(self.user)
        self.assertEqual(self.user.llm_call_count, 3)
        self.assertEqual(self.user.token_quota_used, 17)
        self.assertNotIn("fixture-secret", listed.text + tested.text)

    def test_saved_key_is_owned_and_cannot_be_reused_for_changed_destination(self) -> None:
        payload = {"provider": "anthropic", "protocol": "anthropic", "base_url": self.custom.base_url,
                   "custom_llm_id": self.custom.id, "default_model": "test-model", "mode": "model"}
        with patch("app.routers.custom_llms.get_llm_from_user_config") as factory:
            self.assertEqual(self.client.post("/custom-llms/probe", json={**payload, "custom_llm_id": self.foreign.id}).status_code, 404)
            self.assertEqual(self.client.post("/custom-llms/probe", json={**payload, "base_url": "https://other.invalid"}).json()["status"], "key_required")
            factory.assert_not_called()
            factory.return_value.test_model.return_value = (4, 1)
            self.assertEqual(self.client.post("/custom-llms/probe", json=payload).json()["status"], "ok")
            self.assertEqual(factory.call_args.args[1], "fixture-secret")

    def test_model_error_codes_are_classified_without_exposing_messages(self) -> None:
        from app.services.llm_connection import probe_provider
        for code, body, expected in [(404, {"code":"model_not_found"}, "model_unavailable"),
                                     (404, {}, "endpoint"), (400, {}, "request"), (403, {}, "permission")]:
            inner = Mock()
            inner.test_model.side_effect = openai.APIStatusError("fixture-secret", response=httpx.Response(code, request=httpx.Request("POST", "https://fixture.invalid")), body=body)
            result = probe_provider(inner, "model")
            self.assertEqual(result.status, expected)
            self.assertNotIn("fixture-secret", result.model_dump_json())

    def test_default_model_is_saved_and_used_without_overriding_explicit_selection(self) -> None:
        from app.llm.providers import resolve_agent_llm_for_user
        response = self.client.post("/custom-llms", json={"provider":"qwen", "protocol":"anthropic", "api_key":"synthetic", "base_url":"https://fixture.invalid", "default_model":"  custom-model  "})
        self.assertEqual(response.status_code, 201)
        item = response.json()
        self.assertEqual(item["default_model"], "custom-model")
        self.user.agent_use_custom = True; self.user.agent_custom_llm_id = item["id"]
        self.assertEqual(resolve_agent_llm_for_user(self.user, self.db)["model"], "custom-model")
        self.user.agent_model = "override"
        self.assertEqual(resolve_agent_llm_for_user(self.user, self.db)["model"], "override")


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

    def test_real_model_probe_uses_selected_model_bounded_output_and_no_retries(self) -> None:
        for factory, constructor, protocol in [(OpenAICompatibleLLM, "app.llm.openai_llm.OpenAI", "openai"), (AnthropicLLM, "app.llm.anthropic_llm.anthropic.Anthropic", "anthropic")]:
            with patch(constructor) as sdk:
                provider = factory(api_key="synthetic", base_url="https://fixture.invalid", model="custom-model")
                client = sdk.return_value.with_options.return_value
                call = client.chat.completions.create if protocol == "openai" else client.messages.create
                call.return_value.usage.prompt_tokens = call.return_value.usage.input_tokens = 4
                call.return_value.usage.completion_tokens = call.return_value.usage.output_tokens = 1
                self.assertEqual(provider.test_model(), (4, 1))
                sdk.return_value.with_options.assert_called_once_with(timeout=30.0, max_retries=0)
                self.assertEqual(call.call_args.kwargs["model"], "custom-model")
                self.assertEqual(call.call_args.kwargs["max_tokens"], 32)
                client.models.list.assert_not_called()


if __name__ == "__main__":
    unittest.main()
