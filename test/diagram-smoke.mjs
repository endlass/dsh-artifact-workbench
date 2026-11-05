/**
 * P2.3 diagram adapter smoke test:
 *   node test/diagram-smoke.mjs
 * Requires draw.io Desktop (local). Renders .drawio and .mmd to single-page images,
 * validates page annotations and local CLI presence.
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { adapterForPath } from '../lib/artifacts/index.mjs';
import { loadAnnotationFile } from '../lib/annotations.mjs';
import { sha256File, statFile } from '../lib/util.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'dsh-ppt-workbench/test/fixtures');
const cases = [
  { file: 'simple.drawio', sourceFormat: 'drawio', pages: 1 },
  { file: 'multi.drawio', sourceFormat: 'drawio', pages: 2 },
  { file: 'simple.mmd', sourceFormat: 'mermaid', pages: 1 },
];
const work = await mkdtemp(join(tmpdir(), 'ppt-wb-diagram-'));

try {
  for (const entry of cases) {
    const target = join(work, entry.file);
    await copyFile(join(FIXTURES, entry.file), target);
    const info = await statFile(target);
    const { sha } = await sha256File(target);
    const adapter = adapterForPath(target);
    assert.equal(adapter.id, 'diagram');
    assert.equal(adapter.editable, false);
    const deck = await adapter.load({ path: target, sha, info });
    assert.equal(deck.deck.format, 'pdf');
    assert.equal(deck.deck.sourceFormat, entry.sourceFormat);
    assert.equal(deck.deck.editable, false);
    assert.equal(deck.deck.slideCount, entry.pages);
    assert.equal(deck.deck.renderedPages, entry.pages);
    assert.equal(deck.deck.truncated, false);
    assert.equal(deck.slides.length, entry.pages);
    assert.equal(deck.slides[0].shapes.length, 0);
    for (let page = 1; page <= entry.pages; page += 1) {
      const png = await adapter.readSlide(sha, page);
      assert.ok(png && png.bytes.length > 1000);
    }
    const inventory = {
      format: 'pdf',
      slides: deck.slides,
      slideWidthEmu: deck.deck.slideWidthEmu,
      slideHeightEmu: deck.deck.slideHeightEmu,
    };
    const payload = entry.sourceFormat === 'drawio'
      ? { op: 'create', cellId: 'cell-1', cellLabel: '节点 1', body: 'drawio 批注' }
      : { op: 'create', slideIndex: 0, pointNorm: { x: 0.5, y: 0.5 }, body: `${entry.sourceFormat} 批注` };
    const created = await adapter.mutateAnnotations({
      path: target,
      sha,
      inventory,
      payload,
      author: { name: 'test' },
    });
    assert.equal(created.annotations.length, 1);
    if (entry.sourceFormat === 'drawio') {
      assert.equal(created.annotations[0].format, 'drawio');
      assert.equal(created.annotations[0].anchor.kind, 'drawio-cell');
    } else {
      assert.equal(created.annotations[0].format, 'pdf');
      assert.equal(created.annotations[0].anchor.kind, 'pdf-page');
    }
    const sidecar = await loadAnnotationFile(target, sha, entry.sourceFormat === 'drawio' ? 'drawio' : 'pdf');
    assert.equal(sidecar.schema, 'dsh-artifact-annotation@2');
    console.log(`[ok] ${entry.sourceFormat}: ${entry.pages} page render + annotation`);
  }
  console.log('ALL DIAGRAM SMOKE TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
