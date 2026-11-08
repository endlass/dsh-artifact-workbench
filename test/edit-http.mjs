/**
 * P1 Host 路由 smoke test（不启动 DSH）：直接调用 index.js 注册的 fetch handler。
 *   node test/edit-http.mjs
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from '../index.js';
import { statFile } from '../lib/util.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const DECK_V1 =
  process.env.PPT_WORKBENCH_TEST_DECK ||
  join(ROOT, 'research/ppt-workbench/engine/deck/deck-v1.pptx');

const workspace = await mkdtemp(join(tmpdir(), 'ppt-wb-http-'));
const deckPath = join(workspace, 'deck.pptx');
await copyFile(DECK_V1, deckPath);
const sessionId = 'test-session';

const routes = new Map();
const fakeCtx = {
  sessions: { get: (id) => (id === sessionId ? { id } : undefined) },
  workingDirectory: { get: () => workspace },
  connection: {
    fetch: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
  },
  webServer: { register() { return () => {}; }, getOrigin() { return 'http://127.0.0.1:0'; } },
  tools: { register() { return () => {}; } },
  effect(fn) {
    const dispose = fn();
    return dispose;
  },
};

function endpoint(path) {
  const route = routes.get(`/api/dsh-ppt-workbench${path}`);
  assert.ok(route, `route not registered: ${path}`);
  return route;
}

async function call(method, path, body, query) {
  const url = new URL(`http://127.0.0.1/api/dsh-ppt-workbench${path}`);
  if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const request = new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  const response = await endpoint(path).fetch(request);
  return { status: response.status, body: await response.json() };
}

try {
  apply(fakeCtx);
  assert.ok(routes.size >= 8, `expected routes, got ${routes.size}`);

  const opened = await call('GET', '/deck', undefined, { sessionId, path: deckPath });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.deck.slideCount, 12);
  assert.equal(opened.body.deck.history.canUndo, false);
  const textShape = opened.body.slides[9].shapes.find((shape) => shape.name === 'EDIT-TEXT');
  assert.match(textShape.text, /EDIT-TEXT/, 'inventory includes full text');

  process.env.PPT_WORKBENCH_OPEN_DRY_RUN = '1';
  const native = await call('POST', '/open-native', { sessionId, path: deckPath });
  assert.equal(native.status, 200);
  assert.equal(native.body.dryRun, true);
  assert.equal(native.body.app, 'LibreOffice');
  const nativeAgain = await call('POST', '/open-native', { sessionId, path: deckPath });
  assert.equal(nativeAgain.status, 429, 'open-native is rate limited');
  delete process.env.PPT_WORKBENCH_OPEN_DRY_RUN;
  console.log('[ok] POST /open-native dry-run + rate limit');

  const edited = await call('POST', '/edit', {
    sessionId,
    path: deckPath,
    baseSha: opened.body.deck.sha256,
    ops: [
      { op: 'setText', slideIndex: 9, shapeId: 3, text: 'HTTP 编辑测试' },
      { op: 'setNotes', slideIndex: 6, text: 'HTTP 备注' },
    ],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.edit.opsApplied, 2);
  assert.notEqual(edited.body.deck.sha256, opened.body.deck.sha256);
  assert.equal(edited.body.deck.history.canUndo, true);
  const editedText = edited.body.slides[9].shapes.find((shape) => shape.name === 'EDIT-TEXT');
  assert.match(editedText.text, /HTTP 编辑测试/);
  console.log('[ok] POST /edit:', edited.body.edit.opsApplied, 'ops');

  // 并发 deck 读取：修复写不能互相踩（2026-11-04 真机 ENOENT 回归）
  const parallelReads = await Promise.all(
    Array.from({ length: 8 }, () => call('GET', '/deck', undefined, { sessionId, path: deckPath })),
  );
  assert.ok(parallelReads.every((entry) => entry.status === 200), 'concurrent deck reads must all succeed');
  console.log('[ok] concurrent GET /deck x8');

  const history = await call('GET', '/history', undefined, { sessionId, path: deckPath });
  assert.equal(history.status, 200);
  assert.equal(history.body.canUndo, true);
  assert.ok(history.body.items.length >= 2);
  console.log('[ok] GET /history:', history.body.items.length, 'versions');

  const undone = await call('POST', '/undo', { sessionId, path: deckPath });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.edit.action, 'undo');
  assert.equal(undone.body.deck.sha256, opened.body.deck.sha256);
  assert.match(undone.body.slides[9].shapes.find((shape) => shape.name === 'EDIT-TEXT').text, /EDIT-TEXT/);
  const afterUndoHistory = await call('GET', '/history', undefined, { sessionId, path: deckPath });
  assert.equal(afterUndoHistory.body.canRedo, true);
  console.log('[ok] POST /undo restores old deck');

  const redone = await call('POST', '/redo', { sessionId, path: deckPath });
  assert.equal(redone.status, 200);
  assert.equal(redone.body.edit.action, 'redo');
  assert.match(redone.body.slides[9].shapes.find((shape) => shape.name === 'EDIT-TEXT').text, /HTTP 编辑测试/);
  console.log('[ok] POST /redo restores new deck');

  // 外部改写 → 编辑必须 409 stale，不覆盖
  await copyFile(DECK_V1, deckPath);
  const stale = await call('POST', '/edit', {
    sessionId,
    path: deckPath,
    baseSha: redone.body.deck.sha256,
    ops: [{ op: 'setText', slideIndex: 9, shapeId: 3, text: '冲突写入' }],
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale');
  assert.match(stale.body.currentSha, /^[0-9a-f]{64}$/);
  assert.ok(stale.body.conflictCopy, 'stale response carries a conflict copy path');
  assert.ok(await statFile(stale.body.conflictCopy), 'conflict copy file exists');
  console.log('[ok] conflict copy:', stale.body.conflictCopy.split('/').pop());
  const conflictText = await call('GET', '/deck', undefined, { sessionId, path: deckPath });
  assert.match(conflictText.body.slides[9].shapes.find((shape) => shape.name === 'EDIT-TEXT').text, /EDIT-TEXT/);
  console.log('[ok] stale edit rejected without overwrite');

  // 非法 op → 422 且带 opIndex
  const bad = await call('POST', '/edit', {
    sessionId,
    path: deckPath,
    baseSha: conflictText.body.deck.sha256,
    ops: [{ op: 'nope' }],
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.code, 'bad-op');
  console.log('[ok] invalid op rejected:', bad.body.message.slice(0, 60));

  console.log('ALL EDIT HTTP TESTS PASSED');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
