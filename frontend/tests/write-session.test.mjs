import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/utils/writeSession.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { sameSnapshot, sessionKey, draftKey, readPosition, readDraft, singleFlight } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const storage = (value) => ({ getItem: () => value });

test('writing state is isolated by user, novel and chapter', () => {
  assert.notEqual(sessionKey(1, 1), sessionKey(2, 1));
  assert.notEqual(sessionKey(1, 1), sessionKey(1, 2));
  assert.notEqual(draftKey(1, 1, 1), draftKey(1, 1, 2));
});

test('malformed or unavailable browser storage is harmless', () => {
  for (const value of ['{', 'null', '{}', '{"chapterId":1,"start":-1,"end":0,"scrollTop":0}']) {
    assert.equal(readPosition(storage(value), 'key'), null);
    assert.equal(readDraft(storage(value), 'key'), null);
  }
  const unavailable = { getItem() { throw new Error('Storage disabled'); } };
  assert.equal(readPosition(unavailable, 'key'), null);
  assert.equal(readDraft(unavailable, 'key'), null);
});

test('drafts and positions round-trip without losing Chinese text or selection', () => {
  const draft = { chapterId: 2, title: '归途', summary: '重逢', content: '　　正文\n　　第二段', savedAt: 123 };
  assert.deepEqual(readDraft(storage(JSON.stringify(draft)), 'key'), draft);
  const position = { chapterId: 2, start: 3, end: 8, scrollTop: 142.5 };
  assert.deepEqual(readPosition(storage(JSON.stringify(position)), 'key'), position);
  assert.equal(sameSnapshot(draft, { ...draft, content: '新正文' }), false);
  assert.equal(sameSnapshot(draft, { ...draft, savedAt: 456 }), true);
});

test('concurrent callers join a single save and await the latest edit', async () => {
  let editor = 'first';
  let server = '';
  const writes = [];
  let release;
  const save = singleFlight(async () => {
    while (editor !== server) {
      const snapshot = editor;
      writes.push(snapshot);
      if (writes.length === 1) await new Promise((resolve) => { release = resolve; });
      server = snapshot;
    }
  });
  const first = save();
  editor = 'latest';
  const leaving = save();
  assert.equal(first, leaving);
  release();
  await leaving;
  assert.equal(server, 'latest');
  assert.deepEqual(writes, ['first', 'latest']);
});

test('failed saves can be retried rather than retaining a rejected promise', async () => {
  let attempts = 0;
  const save = singleFlight(async () => { if (++attempts === 1) throw new Error('Offline'); });
  await assert.rejects(save(), /Offline/);
  await save();
  assert.equal(attempts, 2);
});
