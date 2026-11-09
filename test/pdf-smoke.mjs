/**
 * P2 PDF adapter smoke test:
 *   node test/pdf-smoke.mjs
 * Covers: PDF render/inventory, format/editable, point+area annotations,
 * schema v2 file, v1 -> v2 migration, page render bytes.
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adapterForPath } from '../lib/artifacts/index.mjs';
import { annotationFile, loadAnnotationFile } from '../lib/annotations.mjs';
import { sha256File, statFile, writeJsonFile } from '../lib/util.mjs';

const PDF_SOURCE =
  process.env.PPT_WORKBENCH_TEST_PDF ||
  fileURLToPath(new URL('./fixtures/sample-report.pdf', import.meta.url));
const work = await mkdtemp(join(tmpdir(), 'ppt-wb-pdf-'));
const pdf = join(work, 'report.pdf');

try {
  await copyFile(PDF_SOURCE, pdf);
  const info = await statFile(pdf);
  const { sha } = await sha256File(pdf);
  const adapter = adapterForPath(pdf);
  assert.equal(adapter.id, 'pdf');
  assert.equal(adapter.editable, false);

  const deck = await adapter.load({ path: pdf, sha, info });
  assert.equal(deck.deck.format, 'pdf');
  assert.equal(deck.deck.editable, false);
  assert.ok(deck.deck.slideCount >= 1);
  assert.equal(deck.deck.renderedPages, deck.deck.pages.length);
  assert.ok(deck.deck.slideWidthEmu > 0 && deck.deck.slideHeightEmu > 0);
  assert.equal(deck.slides[0].shapes.length, 0);
  const png = await adapter.readSlide(sha, 1);
  assert.ok(png && png.bytes.length > 1000);
  console.log('[ok] PDF deck:', deck.deck.slideCount, 'page(s),', deck.deck.renderedPages, 'rendered');

  const inventory = {
    format: 'pdf',
    slides: deck.slides,
    slideWidthEmu: deck.deck.slideWidthEmu,
    slideHeightEmu: deck.deck.slideHeightEmu,
  };
  await adapter.mutateAnnotations({
    path: pdf,
    sha,
    inventory,
    payload: { op: 'create', slideIndex: 0, pointNorm: { x: 0.5, y: 0.4 }, body: 'PDF 点批注' },
    author: { name: 'test' },
  });
  await adapter.mutateAnnotations({
    path: pdf,
    sha,
    inventory,
    payload: { op: 'create', slideIndex: 0, bboxNorm: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, body: 'PDF 区域批注' },
    author: { name: 'test' },
  });
  const read = await adapter.readAnnotations({ path: pdf, sha, inventory });
  assert.equal(read.annotations.length, 2);
  assert.ok(read.annotations.every((entry) => entry.format === 'pdf' && entry.anchor.kind === 'pdf-page'));
  assert.equal(read.repair.orphaned, 0);
  const file = await loadAnnotationFile(pdf, sha, 'pdf');
  assert.equal(file.schema, 'dsh-artifact-annotation@2');
  assert.equal(file.format, 'pdf');
  console.log('[ok] PDF point/area annotations + schema v2');

  // v1 sidecar migration
  const legacy = {
    schema: 'dsh-ppt-annotation@1',
    deck: { path: pdf, sha256: sha },
    annotations: [{
      id: 'legacy-1', slideId: 1, slideIndex: 0, slideTextSha1: '',
      anchor: {
        shapeId: null, shapeName: null, textSha1: '', pointNorm: { x: 0.25, y: 0.25 },
        bboxEmu: { left: 100, top: 100, width: 1000, height: 1000 }, rotation: 0, groupPath: [],
      },
      body: '旧版批注', author: { id: 'local', name: '我' }, status: 'open', replies: [], history: [],
    }],
  };
  await writeJsonFile(annotationFile(pdf), legacy);
  const migrated = await adapter.readAnnotations({ path: pdf, sha, inventory });
  assert.equal(migrated.annotations.length, 1);
  assert.equal(migrated.annotations[0].format, 'pptx'); // legacy annotations were PPT-authored
  assert.equal(migrated.annotations[0].anchor.kind, 'pptx-shape');
  const migratedFile = await loadAnnotationFile(pdf, sha, 'pdf');
  assert.equal(migratedFile.schema, 'dsh-artifact-annotation@2');
  console.log('[ok] legacy v1 sidecar migrated');

  console.log('ALL PDF SMOKE TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
