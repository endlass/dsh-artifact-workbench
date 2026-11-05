/**
 * Annotation schema v1 -> v2 migration on a PPTX sidecar:
 *   node test/annotation-schema.mjs
 * Existing user sidecars must remain readable and repair anchors unchanged.
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { annotationFile, loadAnnotationFile, readAnnotations } from '../lib/annotations.mjs';
import { ensureDeck } from '../lib/render.mjs';
import { sha256File, statFile, writeJsonFile } from '../lib/util.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const DECK_V1 = process.env.PPT_WORKBENCH_TEST_DECK || join(ROOT, 'research/ppt-workbench/engine/deck/deck-v1.pptx');
const work = await mkdtemp(join(tmpdir(), 'ppt-wb-schema-'));
const deck = join(work, 'deck.pptx');
try {
  await copyFile(DECK_V1, deck);
  const info = await statFile(deck);
  const { sha } = await sha256File(deck);
  const rendered = await ensureDeck(deck, sha, info);
  const inventory = {
    format: 'pptx',
    slides: rendered.slides,
    slideWidthEmu: rendered.deck.slideWidthEmu,
    slideHeightEmu: rendered.deck.slideHeightEmu,
  };
  const slide = rendered.slides[9];
  const shape = slide.shapes.find((entry) => entry.name === 'EDIT-TEXT');
  const legacy = {
    schema: 'dsh-ppt-annotation@1',
    deck: { path: deck, sha256: sha },
    annotations: [{
      id: 'legacy-ppt-1',
      slideId: slide.slideId,
      slideIndex: 9,
      slideTextSha1: slide.textSha1,
      anchor: {
        shapeId: shape.shapeId,
        shapeName: shape.name,
        textSha1: shape.textSha1,
        bboxEmu: { left: shape.left, top: shape.top, width: shape.width, height: shape.height },
        rotation: 0,
        pointNorm: { x: 0.4, y: 0.4 },
        groupPath: [],
      },
      body: '旧版 PPT 批注', author: { id: 'local', name: '我' }, status: 'open', replies: [], history: [],
    }],
  };
  await writeJsonFile(annotationFile(deck), legacy);
  const result = await readAnnotations(deck, sha, inventory);
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].format, 'pptx');
  assert.equal(result.annotations[0].anchor.kind, 'pptx-shape');
  assert.equal(result.annotations[0].id, 'legacy-ppt-1');
  assert.equal(result.repair.orphaned, 0);
  const file = await loadAnnotationFile(deck, sha, 'pptx');
  assert.equal(file.schema, 'dsh-artifact-annotation@2');
  assert.equal(file.format, 'pptx');
  console.log('[ok] PPTX v1 sidecar migrated without loss');
  console.log('ALL ANNOTATION SCHEMA TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
