/**
 * Host 半 smoke test（不依赖 DSH、不依赖插件安装）：
 *   node test/host-smoke.mjs
 *
 * 覆盖：
 * - ensureDeck：inventory + LibreOffice Kit 渲染 + 缓存
 * - readSlidePng：PNG 字节确实可读
 * - 批注 create / resolve / reply
 * - deck 变化后的锚点修复（LibreOffice round-trip：shape id 全变，按 name 修复）
 *
 * 使用仓库自带合成样张（test/fixtures/deck-v1.pptx 与 deck-v1-lort.pptx）；
 * 如需更大/真实样张，用环境变量覆盖：
 *   $ARTIFACT_WORKBENCH_TEST_DECK、$ARTIFACT_WORKBENCH_TEST_DECK_LORT
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadAnnotationFile,
  mutateAnnotations,
  readAnnotations,
} from '../lib/annotations.mjs';
import { ensureDeck, readSlidePng } from '../lib/render.mjs';
import { sha256File, statFile } from '../lib/util.mjs';

const FIXTURE_DECK_V1 = fileURLToPath(new URL('./fixtures/deck-v1.pptx', import.meta.url));
const FIXTURE_DECK_LORT = fileURLToPath(new URL('./fixtures/deck-v1-lort.pptx', import.meta.url));
const DECK_V1 = process.env.ARTIFACT_WORKBENCH_TEST_DECK || FIXTURE_DECK_V1;
const DECK_LORT = process.env.ARTIFACT_WORKBENCH_TEST_DECK_LORT || FIXTURE_DECK_LORT;

async function openDeck(deckPath) {
  const info = await statFile(deckPath);
  assert.ok(info, `missing test deck: ${deckPath}`);
  const { sha } = await sha256File(deckPath);
  const result = await ensureDeck(deckPath, sha, info);
  return {
    sha,
    result,
    inventory: {
      slides: result.slides,
      slideWidthEmu: result.deck.slideWidthEmu,
      slideHeightEmu: result.deck.slideHeightEmu,
    },
  };
}

const work = await mkdtemp(join(tmpdir(), 'ppt-wb-smoke-'));
const deck = join(work, 'deck.pptx');
try {
  await copyFile(DECK_V1, deck);

  // 1. deck 打开 + 渲染（首次可能 3~4 s）
  let opened = await openDeck(deck);
  assert.equal(opened.result.deck.slideCount, 12, 'slideCount');
  assert.equal(opened.result.deck.pages.length, 12, 'rendered pages');
  assert.equal(opened.result.deck.slideWidthEmu > 0, true, 'slide width');
  assert.ok(
    opened.result.deck.missingFonts.includes('思源黑体 CN'),
    'missingFonts should report the deliberately missing CJK font',
  );

  // 2. 幻灯片 PNG 可读且是 PNG
  const slide = await readSlidePng(opened.sha, 1);
  assert.ok(slide && slide.bytes.length > 1000, 'slide bytes');
  assert.equal(slide.bytes[0], 0x89, 'PNG signature');
  console.log(`[ok] deck + render: slides=${opened.result.deck.slideCount} pages=${opened.result.deck.pages.length} renderMs=${opened.result.deck.renderMs}`);

  // 3. 批注 create / resolve / reply
  const slideIndex = 9;
  const target =
    opened.result.slides[slideIndex].shapes.find((shape) => shape.name === 'EDIT-TEXT') ||
    opened.result.slides[slideIndex].shapes[0];
  const created = await mutateAnnotations(
    deck,
    opened.sha,
    opened.inventory,
    {
      op: 'create',
      slideIndex,
      shapeId: target.shapeId,
      pointNorm: { x: 0.4, y: 0.5 },
      body: '请核对这里的数字来源',
    },
    { id: 'smoke', name: 'Smoke' },
  );
  assert.equal(created.annotations.length, 1, 'annotation created');
  assert.equal(created.annotations[0].anchor.shapeName, target.name, 'anchor shape');

  const id = created.annotations[0].id;
  const resolved = await mutateAnnotations(deck, opened.sha, opened.inventory, { op: 'resolve', id }, { id: 'smoke', name: 'Smoke' });
  assert.equal(resolved.annotations[0].status, 'resolved', 'resolved');
  const replied = await mutateAnnotations(deck, opened.sha, opened.inventory, { op: 'reply', id, body: '已核对' }, { id: 'smoke', name: 'Smoke' });
  assert.equal(replied.annotations[0].replies.length, 1, 'reply');
  console.log('[ok] annotation create/resolve/reply');

  // 4. deck 被外部改写（LibreOffice round-trip，shape id 全变）→ 锚点修复
  await copyFile(DECK_LORT, deck);
  opened = await openDeck(deck);
  const repaired = await readAnnotations(deck, opened.sha, opened.inventory);
  assert.equal(repaired.repair.repaired >= 1, true, 'at least one anchor repaired');
  assert.equal(repaired.repair.orphaned, 0, 'no orphans for a shape that still exists');
  assert.equal(repaired.annotations[0].status, 'resolved', 'repair preserves a resolved status');
  assert.equal(repaired.annotations[0].anchor.shapeName, target.name, 'repaired by shape name');
  const file = await loadAnnotationFile(deck, opened.sha);
  assert.equal(file.deck.sha256, opened.sha, 'sidecar remembers current deck sha');
  console.log(`[ok] anchor repair: repaired=${repaired.repair.repaired} orphaned=${repaired.repair.orphaned} how=${repaired.repair.items[0]?.how}`);

  console.log('ALL HOST SMOKE TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
