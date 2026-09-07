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
                factory.assert_called_once_with(
                    "qwen", "fixture-only", "https://fixture.invalid/v1",
                    "deepseek-v4-pro", protocol="openai", claude_auth_mode="auto",
                )

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

    def test_generation_preview_transports_keep_draft_and_progress_separate(self) -> None:
        import json
        self.user.preview_before_save = True
        self.user.enable_auto_audit = True
        self.db.commit()
        target = self.chapters[0]
        original = target.content
        chunks = ['[并行调用工具]\n', '  - get_novel_context\n', '[并行调用完成]\n',
                  '{"body":"雨落下。\\n\\n他推开门。"}', '[完成] 所有必要步骤已完毕\n']
        for mode in ('direct', 'react', 'flexible'):
            self.user.agent_mode = mode
            self.db.commit()
            for route in ('generate', 'generate-sse'):
                with self.subTest(mode=mode, route=route), \
                        patch('app.services.chapter_gen.FlexibleNovelAgent.run', return_value=iter(chunks)), \
                        patch('app.services.chapter_gen.ReActAgent.run', return_value=iter(['{"body":"雨落下。\\n\\n他推开门。"}'])), \
                        patch('app.routers.chapters.resolve_llm_for_user', return_value=RecordingLLM('{"body":"雨落下。\\n\\n他推开门。"}')), \
                        patch('app.routers.chapters.stream_evaluate_tokens', return_value=iter(['{"de_ai_score": 80}'])):
                    response = self.client.post(f'/novels/{self.novel.id}/chapters/{route}',
                                                json={'chapter_id': target.id, 'summary': '雨夜'})
                self.assertEqual(response.status_code, 200)
                lines = response.text.splitlines()
                events = [json.loads(line[6:] if line.startswith('data: ') else line)
                          for line in lines if line.startswith(('data: ', '{'))]
                self.assertFalse(any('error' in event for event in events), response.text)
                result = next(event['preview'] for event in events if 'preview' in event)
                self.assertEqual(result['content'], '雨落下。\n\n他推开门。')
                self.assertNotIn('所有必要步骤', response.text)
                self.db.refresh(target)
                self.assertEqual(target.content, original)

    def test_revision_preview_requires_explicit_adoption(self) -> None:
        import json
        target = self.chapters[0]
        original = target.content
        for mode in ('rewrite', 'append'):
            with self.subTest(mode=mode), patch('app.routers.chapters.resolve_llm_for_user', return_value=RecordingLLM('新增片段。')):
                response = self.client.post(f'/novels/{self.novel.id}/chapters/{target.id}/revise',
                                            json={'mode': mode, 'instruction': '补充动作', 'preview': True})
            events = [json.loads(line) for line in response.text.splitlines()]
            preview = next(event['preview'] for event in events if 'preview' in event)
            self.assertEqual(preview['content'], original + '\n\n新增片段。' if mode == 'append' else '新增片段。')
            self.db.refresh(target)
            self.assertEqual(target.content, original)
            self.assertTrue(any('t' in event for event in events))
            self.assertFalse(any('chapter' in event for event in events))

    def test_evaluation_stream_exposes_readable_issues_not_json(self) -> None:
        import json
        raw = '{"issues":[{"aspect":"动机","detail":"缺少铺垫"}],"de_ai_score":72}'
        with patch('app.routers.chapters.resolve_llm_for_user', return_value=RecordingLLM()), \
                patch('app.routers.chapters.stream_evaluate_tokens', return_value=iter(raw)):
            response = self.client.post(f'/novels/{self.novel.id}/chapters/{self.chapters[0].id}/ai-evaluate', json={})
        events = [json.loads(line) for line in response.text.splitlines()]
        text = ''.join(event.get('t','') for event in events)
        self.assertEqual(text, '动机\n缺少铺垫\n\n')
        self.assertEqual(events[-1]['evaluate']['de_ai_score'], 72)
