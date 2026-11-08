/**
 * P3 Mermaid source route smoke test:
 *   node test/source-http.mjs
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from '../index.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const FIXTURE = join(ROOT, 'dsh-ppt-workbench/test/fixtures/simple.mmd');
const workspace = await mkdtemp(join(tmpdir(), 'ppt-wb-source-'));
const mmd = join(workspace, 'flow.mmd');
await copyFile(FIXTURE, mmd);
const drawioPath = join(workspace, 'diagram.drawio');
await copyFile(join(ROOT, 'dsh-ppt-workbench/test/fixtures/simple.drawio'), drawioPath);
const sessionId = 'source-session';
const routes = new Map();
apply({
  sessions: { get: (id) => (id === sessionId ? { id } : undefined) },
  workingDirectory: { get: () => workspace },
  connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
  webServer: { register() { return () => {}; }, getOrigin() { return 'http://127.0.0.1:0'; } },
  tools: { register() { return () => {}; } },
  effect(fn) { return fn(); },
});

async function call(method, path, body, query) {
  const url = new URL(`http://127.0.0.1/api/dsh-ppt-workbench${path}`);
  if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const request = new Request(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  const response = await routes.get(`/api/dsh-ppt-workbench${path}`).fetch(request);
  return { status: response.status, body: await response.json() };
}

try {
  const found = await call('GET', '/source', undefined, { sessionId, path: mmd });
  assert.equal(found.status, 200);
  assert.equal(found.body.text.includes('需求确认'), true);
  const original = found.body.text;
  const newText = original.replace('需求确认', '需求确认（已修改）');
  const saved = await call('POST', '/source', {
    sessionId,
    path: mmd,
    baseSha: found.body.sha256,
    text: newText,
  });
  assert.equal(saved.status, 200);
  assert.notEqual(saved.body.deck.sha256, found.body.sha256);
  assert.equal(saved.body.deck.sourceFormat, 'mermaid');
  assert.ok(saved.body.source && saved.body.source.bytes > 0);
  console.log('[ok] source save + rerender');

  const again = await call('GET', '/source', undefined, { sessionId, path: mmd });
  assert.equal(again.body.text, newText);
  console.log('[ok] source readback');

  const stale = await call('POST', '/source', {
    sessionId,
    path: mmd,
    baseSha: found.body.sha256,
    text: original,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale');
  console.log('[ok] stale source write rejected');

  const nonEditable = await call('GET', '/source', undefined, {
    sessionId,
    path: join(ROOT, 'dsh-ppt-workbench/test/fixtures/simple.mmd.workbench/nope'),
  });
  assert.ok([403, 404, 415, 422].includes(nonEditable.status));
  const drawio = await call('GET', '/source', undefined, {
    sessionId,
    path: drawioPath,
  });
  assert.equal(drawio.status, 200);
  assert.ok(drawio.body.text.includes('<mxfile'));
  const drawioSave = await call('POST', '/source', {
    sessionId,
    path: drawioPath,
    baseSha: drawio.body.sha256,
    text: drawio.body.text,
    render: false,
  });
  assert.equal(drawioSave.status, 200);
  assert.ok(drawioSave.body.sha256);
  console.log('[ok] drawio source read/write render:false');
  console.log('ALL SOURCE HTTP TESTS PASSED');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
