#!/usr/bin/env node
/**
 * Build editor/js/extensions.min.js from the upstream draw.io 31.4.5 bundle
 * with the libavoid append removed.
 *
 * Why: draw.io 31.4.5 appends libavoid (LGPL-2.1, no public build sources) to
 * extensions.min.js. Artifact Workbench vendors that bundle, so shipping it
 * unmodified would require LGPL source/replaceability compliance we cannot
 * satisfy. The upstream build appends the three libavoid files last; removing
 * that tail leaves only Apache-2.0 draw.io code and its permissive vendor
 * bundles. The `Arrange > Layout > Orthogonal Routing` action (the only consumer
 * of libavoid in the editor) therefore becomes unavailable; ordinary orthogonal
 * edge styles are part of draw.io core and are unaffected.
 *
 * Usage:
 *   node scripts/build-drawio-extensions.mjs /path/to/drawio-31.4.5
 *   DRAWIO_SRC=/path/to/drawio-31.4.5 node scripts/build-drawio-extensions.mjs
 *
 * The path may be the draw.io repository root or the upstream
 * src/main/webapp/js/extensions.min.js file itself.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'editor', 'js', 'extensions.min.js');
const EXPECTED_UPSTREAM_SHA256 =
  '06dd7eeae1e7b97f4106005f31fd38a8f81d92d0a532b3e12474555fa38d2846';
const MARKER = 'var initAvoidModule=';
const LIB_TAIL_TOKENS = ['libavoid-routing.js', 'LibavoidRouting', 'initAvoidModule'];
const FORBIDDEN_IN_PREFIX = ['initAvoidModule', 'ShapeConnectionPin', 'AvoidRouting', 'computeRoutes'];

const arg = process.argv[2] ?? process.env.DRAWIO_SRC;
if (!arg) {
  console.error('usage: node scripts/build-drawio-extensions.mjs <drawio-31.4.5-source>');
  process.exit(2);
}

const candidate = resolve(arg);
const source = candidate.endsWith('extensions.min.js')
  ? candidate
  : join(candidate, 'src', 'main', 'webapp', 'js', 'extensions.min.js');
if (!existsSync(source)) {
  console.error(`draw.io extensions bundle not found: ${source}`);
  process.exit(2);
}

const original = readFileSync(source, 'utf8');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const upstreamSha = sha256(original);
if (upstreamSha !== EXPECTED_UPSTREAM_SHA256) {
  console.error(
    `unexpected upstream extensions.min.js\n  expected ${EXPECTED_UPSTREAM_SHA256}\n  got      ${upstreamSha}\n` +
      'Update EXPECTED_UPSTREAM_SHA256 after deliberately bumping the draw.io version.',
  );
  process.exit(1);
}

const index = original.indexOf(MARKER);
if (index < 0 || original.indexOf(MARKER, index + 1) !== -1) {
  console.error(`expected exactly one ${MARKER} marker in ${source}`);
  process.exit(1);
}
const prefix = original.slice(0, index);
const tail = original.slice(index);
for (const token of LIB_TAIL_TOKENS) {
  if (!tail.includes(token)) {
    console.error(`libavoid tail sanity check failed: missing "${token}"`);
    process.exit(1);
  }
}
for (const token of FORBIDDEN_IN_PREFIX) {
  if (prefix.includes(token)) {
    console.error(`refusing to write: libavoid implementation symbol "${token}" remains in the prefix`);
    process.exit(1);
  }
}

const banner = `/*!
 * draw.io extensions bundle (Apache-2.0) — jgraph/drawio v31.4.5,
 * modified for Artifact Workbench: the libavoid append
 * (libavoid.min.js + libavoid-routing.js + LibavoidRouting.js) was removed.
 * Source: https://github.com/jgraph/drawio/tree/v31.4.5/src/main/webapp/js
 * See editor/PROVENANCE.md and editor/MODIFICATIONS.md.
 */
`;
const note =
  '\n/* libavoid (LGPL-2.1) removed; Arrange > Layout > Orthogonal Routing is unavailable. */\n';
const output = `${banner}${prefix}${note}`;
writeFileSync(OUT, output, 'utf8');
console.log(`wrote ${OUT}`);
console.log(`  removed ${tail.length} bytes of libavoid append (prefix ${prefix.length} bytes kept)`);
console.log(`  output ${Buffer.byteLength(output)} bytes, sha256 ${sha256(output)}`);
