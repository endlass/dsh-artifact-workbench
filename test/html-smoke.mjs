/**
 * P2.2 H5 report snapshot smoke test:
 *   node test/html-smoke.mjs
 * Requires local Chrome/Chromium; renders the report HTML to a PDF snapshot,
 * reuses the PDF page/annotation pipeline.
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { adapterForPath } from '../lib/artifacts/index.mjs';
import { loadAnnotationFile } from '../lib/annotations.mjs';
import { sha256File, statFile } from '../lib/util.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const HTML_SOURCE =
  process.env.PPT_WORKBENCH_TEST_HTML ||
  join(ROOT, 'mortgage-calc/docs/zj-502-visit-card-20261020.html');
const work = await mkdtemp(join(tmpdir(), 'ppt-wb-html-'));
const file = join(work, 'report.html');

try {
  await copyFile(HTML_SOURCE, file);
  const info = await statFile(file);
  const { sha } = await sha256File(file);
  const adapter = adapterForPath(file);
  assert.equal(adapter.id, 'html');
  assert.equal(adapter.editable, false);

  const deck = await adapter.load({ path: file, sha, info });
  assert.equal(deck.deck.format, 'pdf');
  assert.equal(deck.deck.sourceFormat, 'html');
  assert.equal(deck.deck.editable, false);
  assert.ok(deck.deck.slideCount >= 1);
  assert.equal(deck.deck.renderedPages, deck.deck.pages.length);
  assert.equal(deck.slides[0].shapes.length, 0);
  const png = await adapter.readSlide(sha, 1);
  assert.ok(png && png.bytes.length > 1000);
  console.log('[ok] H5 snapshot:', deck.deck.slideCount, 'page(s),', deck.deck.renderedPages, 'rendered');

  const inventory = {
    format: 'pdf',
    slides: deck.slides,
    slideWidthEmu: deck.deck.slideWidthEmu,
    slideHeightEmu: deck.deck.slideHeightEmu,
  };
  const created = await adapter.mutateAnnotations({
    path: file,
    sha,
    inventory,
    payload: { op: 'create', selector: 'h1', textQuote: 'H5 报告', xNorm: 0.4, yNorm: 0.3, scrollY: 0, tag: 'h1', body: 'H5 报告批注' },
    author: { name: 'test' },
  });
  assert.equal(created.annotations.length, 1);
  assert.equal(created.annotations[0].format, 'html');
  assert.equal(created.annotations[0].anchor.kind, 'html-dom');
  const sidecar = await loadAnnotationFile(file, sha, 'html');
  assert.equal(sidecar.schema, 'dsh-artifact-annotation@2');
  assert.equal(sidecar.format, 'html');
  console.log('[ok] H5 DOM annotation (html-dom)');
  console.log('ALL HTML SMOKE TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
