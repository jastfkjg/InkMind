import json
import unittest

from app.llm.json_stream import JsonStringStream
from app.llm.ndjson_stream import filter_think_chunks
from app.services.chapter_eval import partial_evaluation_issues


class JsonStreamTests(unittest.TestCase):
    def test_every_boundary_decodes_only_root_body(self) -> None:
        body = '雨声。\n\n他说："灯\\影"。😊'
        raw = '```json\n' + json.dumps({'title': 'body', 'metadata': {'body': '不展示'}, 'body': body, 'notes': '不展示'}, ensure_ascii=True) + '\n```'
        for boundary in range(1, len(raw)):
            with self.subTest(boundary=boundary):
                stream = JsonStringStream()
                output = stream.feed(raw[:boundary]) + stream.feed(raw[boundary:])
                self.assertEqual(output, body)
        stream = JsonStringStream()
        self.assertEqual(''.join(stream.feed(char) for char in raw), body)

    def test_body_arrives_before_json_is_complete(self) -> None:
        stream = JsonStringStream()
        self.assertEqual(stream.feed('{"title":"测试","body":"第一段'), '第一段')
        self.assertEqual(stream.feed('\\n'), '\n')
        self.assertEqual(stream.feed('第二段"}'), '第二段')

    def test_thinking_tags_across_every_boundary(self) -> None:
        raw = '<think>不展示推理</think>{"body":"正文"}'
        for boundary in range(1, len(raw)):
            self.assertEqual(''.join(filter_think_chunks(iter([raw[:boundary], raw[boundary:]]))), '{"body":"正文"}')
        self.assertEqual(''.join(filter_think_chunks(iter(raw))), '{"body":"正文"}')

    def test_evaluation_only_emits_complete_issues(self) -> None:
        issue = {'aspect': '人物动机', 'detail': '转折需要铺垫'}
        raw = '{"de_ai_score":80,"issues":[' + json.dumps(issue, ensure_ascii=False)
        self.assertEqual(partial_evaluation_issues(raw[:-1]), [])
        self.assertEqual(partial_evaluation_issues(raw + ',{"aspect":"未完'), [issue])
        self.assertEqual(partial_evaluation_issues('{"notes":"\\"issues\\":[{}]","issues":['), [])
