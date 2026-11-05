/**
 * P2 PDF Host route smoke test (no DSH boot): node test/pdf-http.mjs
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from '../index.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const PDF_SOURCE =
  process.env.PPT_WORKBENCH_TEST_PDF ||
  join(ROOT, 'mortgage-calc/docs/zj-502-visit-card-20261020.pdf');
const workspace = await mkdtemp(join(tmpdir(), 'ppt-wb-pdf-http-'));
const pdf = join(workspace, 'report.pdf');
await copyFile(PDF_SOURCE, pdf);
const sessionId = 'pdf-session';
const routes = new Map();
apply({
  sessions: { get: (id) => (id === sessionId ? { id } : undefined) },
  workingDirectory: { get: () => workspace },
  connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
  webServer: { register() { return () => {}; }, getOrigin() { return 'http://127.0.0.1:0'; } },
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
  const opened = await call('GET', '/deck', undefined, { sessionId, path: pdf });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.deck.format, 'pdf');
  assert.equal(opened.body.deck.editable, false);
  assert.equal(opened.body.slides[0].shapes.length, 0);
  assert.ok(opened.body.deck.pages.length >= 1);
  console.log('[ok] GET /deck PDF:', opened.body.deck.slideCount, 'page(s)');

  const created = await call('POST', '/annotations', {
    sessionId,
    path: pdf,
    op: 'create',
    slideIndex: 0,
    pointNorm: { x: 0.4, y: 0.5 },
    body: 'PDF HTTP 批注',
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.annotations.length, 1);
  assert.equal(created.body.annotations[0].format, 'pdf');
  assert.equal(created.body.annotations[0].anchor.kind, 'pdf-page');
  console.log('[ok] PDF annotation create');

  const slide = await fetchLikeSlide(1);
  assert.equal(slide.status, 200);
  assert.equal(slide.type, 'image/png');
  console.log('[ok] PDF page render route');

  const edit = await call('POST', '/edit', {
    sessionId,
    path: pdf,
    baseSha: opened.body.deck.sha256,
    ops: [{ op: 'setNotes', slideIndex: 0, text: 'no' }],
  });
  assert.equal(edit.status, 422);
  assert.equal(edit.body.code, 'not-editable');
  console.log('[ok] PDF /edit rejected as read-only');

  console.log('ALL PDF HTTP TESTS PASSED');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function fetchLikeSlide(page) {
  const route = routes.get('/api/dsh-ppt-workbench/slide');
  const url = new URL('http://127.0.0.1/api/dsh-ppt-workbench/slide');
  url.searchParams.set('sha', (await call('GET', '/deck', undefined, { sessionId, path: pdf })).body.deck.sha256);
  url.searchParams.set('page', String(page));
  const response = await route.fetch(new Request(url));
  return { status: response.status, type: response.headers.get('content-type') };
}
