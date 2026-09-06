import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ entryPoints: ['src/utils/previewReview.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { reviewSegments, reviewedContent } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('accepting or rejecting all changes preserves the exact proposal or original', () => {
  for (const [old, proposed] of [
    ['', '　　第一段。\n\n第二段。'], ['删除的章\n', ''],
    ['　　雨。\n\n　　海。\n', '　　雪。\n\n　　海。\n'],
    ['同一句\n同一句\n', '同一句\n新句子\n同一句\n'],
    ['\n\n原文\r\n\r\n末尾', '\n 新文\n\n'], ['😀\n\t', '🌊\n\t'],
    [Array(600).fill('旧段\n').join(''), Array(600).fill('新段\n').join('')],
  ]) {
    const segments = reviewSegments(old, proposed);
    assert.equal(reviewedContent(segments, new Set()), proposed);
    assert.equal(reviewedContent(segments, new Set(segments.map((_, i) => i))), old);
  }
});

test('partial acceptance leaves unrelated and rejected paragraphs intact', () => {
  const segments = reviewSegments('开头。\n\n旧一。\n\n中间。\n\n旧二。', '开头。\n\n新一。\n\n中间。\n\n新二。');
  const second = segments.findIndex((s) => s.before === '旧二。');
  assert.equal(reviewedContent(segments, new Set([second])), '开头。\n\n新一。\n\n中间。\n\n旧二。');
});

test('an inserted paragraph can be rejected without deleting its neighbours', () => {
  const segments = reviewSegments('一。\n二。\n', '一。\n新增。\n二。\n');
  const insertion = segments.findIndex((s) => !s.before && s.after);
  assert.ok(insertion >= 0);
  assert.equal(reviewedContent(segments, new Set([insertion])), '一。\n二。\n');
});
