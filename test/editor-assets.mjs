/**
 * P4 drawio editor asset route smoke test: node test/editor-assets.mjs
 * Serves the vendored editor through the same handler registered on webServer.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { EDITOR_ROUTE, serveEditorFile } from '../lib/editor-server.mjs';

const server = createServer((req, res) => { void serveEditorFile(req, res); });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const index = await fetch(`${origin}${EDITOR_ROUTE}/index.html`);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.ok(html.includes('draw.io'));
  assert.match(index.headers.get('content-type') || '', /text\/html/);

  const main = await fetch(`${origin}${EDITOR_ROUTE}/js/main.js`);
  assert.equal(main.status, 200);
  assert.match(main.headers.get('content-type') || '', /javascript/);
  assert.ok((await main.text()).length > 100);

  const app = await fetch(`${origin}${EDITOR_ROUTE}/js/app.min.js`);
  assert.equal(app.status, 200);
  assert.ok((await app.text()).length > 1000);

  const missing = await fetch(`${origin}${EDITOR_ROUTE}/nope.js`);
  assert.equal(missing.status, 404);
  const traversal = await fetch(`${origin}${EDITOR_ROUTE}/../../etc/passwd`);
  assert.ok([400, 404].includes(traversal.status));
  console.log('[ok] editor static route:', origin + EDITOR_ROUTE);
  console.log('ALL EDITOR ASSET TESTS PASSED');
} finally {
  server.close();
}
