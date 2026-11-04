/**
 * Multi-shape / area annotation smoke test（Host 半）：
 *   node test/annotation-multi.mjs
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mutateAnnotations, readAnnotations } from '../lib/annotations.mjs';
import { ensureDeck } from '../lib/render.mjs';
import { sha256File, statFile } from '../lib/util.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const DECK_V1 =
  process.env.PPT_WORKBENCH_TEST_DECK ||
  join(ROOT, 'research/ppt-workbench/engine/deck/deck-v1.pptx');

const work = await mkdtemp(join(tmpdir(), 'ppt-wb-multi-'));
const deck = join(work, 'deck.pptx');
try {
  await copyFile(DECK_V1, deck);
  const info = await statFile(deck);
  const { sha } = await sha256File(deck);
  const result = await ensureDeck(deck, sha, info);
  const inventory = {
    slides: result.slides,
    slideWidthEmu: result.deck.slideWidthEmu,
    slideHeightEmu: result.deck.slideHeightEmu,
  };

  const slide = result.slides[9];
  const shapeA = slide.shapes.find((shape) => shape.name === 'EDIT-TEXT') || slide.shapes[0];
  const shapeB =
    slide.shapes.find((shape) => shape.name === 'EDIT-MOVE' && shape.shapeId !== shapeA.shapeId) ||
    slide.shapes[1];

  const created = await mutateAnnotations(
    deck,
    sha,
    inventory,
    {
      op: 'create',
      slideIndex: 9,
      shapeIds: [shapeA.shapeId, shapeB.shapeId],
      pointNorm: { x: 0.5, y: 0.5 },
      body: '框选两个元素',
    },
    { id: 'smoke', name: 'Smoke' },
  );
  assert.equal(created.annotations.length, 1);
  const multi = created.annotations[0];
  assert.equal(multi.anchor.shapeIds.length, 2, 'multi shapeIds');
  assert.equal(multi.anchor.relatedShapes.length, 2, 'multi relatedShapes');
  assert.equal(multi.anchor.shapeName !== '', true, 'primary shape name');
  console.log('[ok] multi-shape create:', multi.anchor.relatedShapes.map((shape) => shape.name).join('、'));

  const area = await mutateAnnotations(
    deck,
    sha,
    inventory,
    {
      op: 'create',
      slideIndex: 2,
      bboxNorm: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
      pointNorm: { x: 0.35, y: 0.4 },
      body: '框选区域批注',
    },
    { id: 'smoke', name: 'Smoke' },
  );
  const areaAnnotation = area.annotations.find((entry) => entry.body === '框选区域批注');
  assert.ok(areaAnnotation, 'area annotation created');
  assert.equal(areaAnnotation.anchor.relatedShapes.length, 0, 'area has no related shapes');
  assert.ok(areaAnnotation.anchor.bboxEmu, 'area bboxEmu');
  assert.deepEqual(areaAnnotation.anchor.areaNorm, { x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  console.log('[ok] area create: bboxEmu', JSON.stringify(areaAnnotation.anchor.bboxEmu));

  const reread = await readAnnotations(deck, sha, inventory);
  assert.equal(reread.annotations.length, 2);
  assert.equal(reread.repair.orphaned, 0);
  console.log('ALL MULTI/AREA TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
