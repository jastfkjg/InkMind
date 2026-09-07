import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/utils/writingLayout.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { calculateWritingLayout, readWritingLayout, MIN_EDITOR_WIDTH, WRITING_GAP } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const preference = { chaptersOpen: true, chapterWidth: 228, toolsWidth: 380 };

test('940–1600px windows preserve writing space while a tool is open', () => {
  for (const viewport of [940, 1024, 1180, 1280, 1360, 1440, 1600]) {
    const width = viewport - 48;
    const layout = calculateWritingLayout(width, true, preference);
    const editorWidth = width - layout.toolsWidth - WRITING_GAP - (layout.autoCollapsed ? 0 : layout.chapterWidth + WRITING_GAP);
    assert.ok(editorWidth >= MIN_EDITOR_WIDTH, `${viewport}px leaves only ${editorWidth}px`);
  }
});

test('temporary collapse and window clamping leave preferences intact', () => {
  const before = structuredClone(preference);
  assert.equal(calculateWritingLayout(1100, true, preference).autoCollapsed, true);
  assert.equal(calculateWritingLayout(1100, false, preference).autoCollapsed, false);
  assert.equal(calculateWritingLayout(1500, true, preference).toolsWidth, 380);
  assert.deepEqual(preference, before);
  assert.equal(calculateWritingLayout(1500, false, { ...preference, chaptersOpen: false }).autoCollapsed, false);
});

test('oversized saved widths adapt to a narrow window and return on a wide one', () => {
  const wide = { ...preference, chapterWidth: 320, toolsWidth: 520 };
  const narrow = calculateWritingLayout(892, true, wide);
  assert.equal(narrow.toolsWidth, 280);
  assert.equal(narrow.autoCollapsed, true);
  assert.equal(calculateWritingLayout(1552, true, wide).toolsWidth, 520);
});

test('malformed or blocked storage uses bounded layout defaults', () => {
  for (const value of ['{', 'null', '[]', '{"chapterWidth":"300","toolsWidth":null}']) {
    assert.deepEqual(readWritingLayout({ getItem: () => value }), preference);
  }
  assert.deepEqual(readWritingLayout({ getItem() { throw new Error('Unavailable'); } }), preference);
  assert.deepEqual(readWritingLayout({ getItem: () => '{"chaptersOpen":false,"chapterWidth":999,"toolsWidth":-1}' }), { chaptersOpen: false, chapterWidth: 320, toolsWidth: 280 });
});
