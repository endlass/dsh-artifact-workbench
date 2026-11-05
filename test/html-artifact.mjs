/**
 * P4.3 H5 artifact route + DOM annotation test: node test/html-artifact.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ARTIFACT_ROUTE, registerHtmlArtifact, serveHtmlArtifact } from '../lib/html-server.mjs';
import { mutateHtmlAnnotations, readHtmlAnnotations } from '../lib/annotations.mjs';

const work = await mkdtemp(join(tmpdir(), 'wb-html-artifact-'));
const html = '<!doctype html><html><head><link rel="stylesheet" href="report.css"></head><body><h1 id="title">报告</h1><script>window.__ran = true;</script></body></html>';
await writeFile(join(work, 'report.html'), html);
await writeFile(join(work, 'report.css'), 'h1{color:#333}');
const artifact = registerHtmlArtifact(join(work, 'report.html'));
const server = createServer((req, res) => { void serveHtmlArtifact(req, res); });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const page = await fetch(origin + artifact.url);
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.ok(body.includes('__dsh-bridge.js'));
  assert.ok(body.includes('id="title"'));
  const bridge = await fetch(`${origin}${ARTIFACT_ROUTE}/${artifact.token}/__dsh-bridge.js`);
  assert.equal(bridge.status, 200);
  assert.match(bridge.headers.get('content-type') || '', /javascript/);
  assert.ok((await bridge.text()).includes('dsh-html-pick'));
  const css = await fetch(`${origin}${ARTIFACT_ROUTE}/${artifact.token}/report.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /text\/css/);
  const traversal = await fetch(`${origin}${ARTIFACT_ROUTE}/${artifact.token}/../../etc/passwd`);
  assert.ok([400, 404].includes(traversal.status));

  const sha = 'b'.repeat(64);
  let result = await mutateHtmlAnnotations(join(work, 'report.html'), sha, {
    op: 'create', selector: '#title', textQuote: '报告', xNorm: 0.4, yNorm: 0.2, scrollY: 10, tag: 'h1', body: '标题需要改',
  }, { name: '测试' });
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].format, 'html');
  assert.equal(result.annotations[0].anchor.kind, 'html-dom');
  assert.equal(result.annotations[0].anchor.selector, '#title');
  const id = result.annotations[0].id;
  result = await mutateHtmlAnnotations(join(work, 'report.html'), sha, { op: 'resolve', id }, { name: '测试' });
  assert.equal(result.annotations[0].status, 'resolved');
  const read = await readHtmlAnnotations(join(work, 'report.html'), sha);
  assert.equal(read.annotations.length, 1);
  assert.equal(read.repair.repaired, 0);
  result = await mutateHtmlAnnotations(join(work, 'report.html'), sha, { op: 'delete', id }, { name: '测试' });
  assert.equal(result.annotations.length, 0);
  console.log('[ok] h5 artifact bridge + static assets + html-dom annotations');
  console.log('ALL HTML ARTIFACT TESTS PASSED');
} finally {
  server.close();
  await rm(work, { recursive: true, force: true });
}
