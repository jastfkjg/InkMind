"""Generation metadata must never become saved prose."""
import json
from unittest.mock import patch

from app.services.chapter_gen import (
    _filter_flexible_agent_output, _parse_status_chunk,
    parse_chapter_generation_json, run_flexible_chapter_generation,
    run_react_chapter_generation,
)
from test_context_and_chapters import DatabaseCase, RecordingLLM


class GenerationOutputTests(DatabaseCase):
    def test_parallel_metadata_and_json_are_separate_from_prose(self) -> None:
        raw = json.dumps({"body": "雨声落下。\n\n他推开门。"}, ensure_ascii=False)
        chunks = ["[并行调用工具]\n", "  - get_novel_context\n",
                  '  - get_previous_chapters: {"limit": 3}\n',
                  "[并行调用完成]\n", "[开始生成正文]\n", raw[:12], raw[12:],
                  "[完成] 所有必要步骤已完毕\n"]
        bodies, statuses = _filter_flexible_agent_output(chunks)
        self.assertEqual(''.join(bodies), raw)
        self.assertEqual(len(statuses), 6)
        for save in (False, True):
            target = self.chapters[0]
            original = target.content
            with patch('app.services.chapter_gen.FlexibleNovelAgent.run', return_value=iter(chunks)):
                events = list(run_flexible_chapter_generation(
                    self.db, self.novel, '雨夜', target, RecordingLLM(), save_to_db=save))
            result = events[-1]
            self.assertEqual(result.content, '雨声落下。\n\n他推开门。')
            texts = [event for event in events if isinstance(event, str) and not event.startswith('__PROGRESS__:')]
            self.assertEqual(texts, [result.content])
            self.db.refresh(target)
            self.assertEqual(target.content, result.content if save else original)

    def test_finish_is_only_draft_stage(self) -> None:
        progress = _parse_status_chunk('[完成] 所有必要步骤已完毕', 'zh')
        self.assertNotIn('所有必要步骤', progress)
        self.assertNotIn('"finished"', progress)
        self.assertIn('正在整理', progress)

    def test_invalid_structured_output_is_not_prose(self) -> None:
        for raw in ('{"body":"未完成', '{"title":"缺少正文"}', '[]'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_chapter_generation_json(raw, need_title=True)
        self.assertEqual(parse_chapter_generation_json('正常正文。', need_title=False), ('', '正常正文。'))
        self.assertEqual(parse_chapter_generation_json('```json\n{"body":"正文"}\n```', need_title=False), ('', '正文'))

    def test_react_preview_does_not_save(self) -> None:
        target = self.chapters[0]
        original = target.content
        with patch('app.services.chapter_gen.ReActAgent.run', return_value=iter(['{"body":"新的正文"}'])):
            result = list(run_react_chapter_generation(
                self.db, self.novel, '概要', target, RecordingLLM(), save_to_db=False))[-1]
        self.assertEqual(result.content, '新的正文')
        self.db.refresh(target)
        self.assertEqual(target.content, original)
