import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from app.agent.claude_orchestrator import ClaudeOrchestrator, OrchestratorSession


class AgentWaitTests(unittest.IsolatedAsyncioTestCase):
    async def test_internal_messages_cannot_keep_a_silent_model_running_forever(self) -> None:
        client = SimpleNamespace(connect=AsyncMock(), query=AsyncMock(), disconnect=AsyncMock())
        async def internal_messages():
            while True:
                await asyncio.sleep(0.001)
                yield {"internal_status": "retrying"}
        client.receive_response = internal_messages
        orchestrator = ClaudeOrchestrator.__new__(ClaudeOrchestrator)
        orchestrator._user = SimpleNamespace(id=1)
        orchestrator._queue = SimpleNamespace(
            subscribe_submissions=AsyncMock(return_value=asyncio.Queue()),
            unsubscribe_submissions=AsyncMock(),
        )
        orchestrator._record_orchestrator_usage = Mock()
        session = OrchestratorSession(session_id="test", novel_id=1, user_id=1)
        with patch("app.agent.claude_orchestrator._SDK_IDLE_TIMEOUT_SECONDS", 0.02), \
             patch("app.agent.claude_orchestrator._ensure_cleanup_running"), \
             patch("app.agent.claude_orchestrator.init_tool_context"), \
             patch("app.agent.claude_orchestrator._build_agent_options"), \
             patch("app.agent.claude_orchestrator.ClaudeSDKClient", return_value=client):
            async def collect():
                return [event async for event in orchestrator.chat(session, "hi")]
            events = await asyncio.wait_for(collect(), timeout=1)
        errors = [event for event in events if event.event_type == "error"]
        self.assertEqual(len(errors), 1)
        self.assertIn("超时", str(errors[0].data))
        self.assertEqual(events[-1].event_type, "done")
        client.disconnect.assert_awaited_once()
        self.assertIsNone(session.sdk_client)
        completed = [event.data for event in events if event.event_type == "agent_step"
                     and event.data.get("step_type") == "tool_result"]
        self.assertEqual([event["tool_name"] for event in completed], ["agent_connect", "agent_query"])
