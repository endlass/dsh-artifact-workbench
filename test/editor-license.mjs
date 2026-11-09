/**
 * License guard for the vendored draw.io editor bundle.
 *
 * draw.io 31.4.5 appends libavoid (LGPL-2.1) to editor/js/extensions.min.js.
 * We remove that append during vendoring so the public package carries no
 * LGPL component; this test fails if a future rebuild reintroduces it.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = `${root}editor/js/extensions.min.js`;
const bundle = readFileSync(bundlePath, 'utf8');

for (const symbol of ['initAvoidModule', 'ShapeConnectionPin', 'AvoidRouting', 'computeRoutes']) {
  assert.equal(bundle.includes(symbol), false, `libavoid implementation symbol still present: ${symbol}`);
}
assert.equal(existsSync(`${root}editor/js/libavoid-js`), false, 'editor/js/libavoid-js must not exist');
assert.equal(existsSync(`${root}licenses/lgpl-2.1.txt`), false, 'LGPL text should be removed once libavoid is removed');
assert.ok(bundle.includes('libavoid (LGPL-2.1) removed'), 'bundle must carry the libavoid-removal note');
console.log('[ok] editor bundle carries no libavoid implementation');
