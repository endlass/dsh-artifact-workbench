/**
 * P1 编辑链路 smoke test（不启动 DSH）：
 *   node test/edit-smoke.mjs
 *
 * 覆盖：python-pptx 后端 ops、原子替换、历史快照、undo/redo、外部改写冲突。
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getEditBackend } from '../lib/edit-backend.mjs';
import {
  ensureCurrentSnapshot,
  historySummary,
  loadHistory,
  recordEdit,
  redo,
  undo,
} from '../lib/history.mjs';
import { ensureDeck } from '../lib/render.mjs';
import { sha256File, statFile } from '../lib/util.mjs';

const DECK_V1 =
  process.env.ARTIFACT_WORKBENCH_TEST_DECK ||
  fileURLToPath(new URL('./fixtures/deck-v1.pptx', import.meta.url));

const work = await mkdtemp(join(tmpdir(), 'ppt-wb-edit-'));
const deck = join(work, 'deck.pptx');
try {
  await copyFile(DECK_V1, deck);
  async function open() {
    const info = await statFile(deck);
    const { sha } = await sha256File(deck);
    const result = await ensureDeck(deck, sha, info);
    return {
      sha,
      text: result.slides[9].shapes.find((shape) => shape.name === 'EDIT-TEXT')?.text || '',
      slideCount: result.deck.slideCount,
    };
  }

  const before = await open();
  assert.equal(before.slideCount, 12);
  assert.match(before.text, /EDIT-TEXT/);
  const history0 = await loadHistory(deck);
  assert.equal(history0.items.length, 0, 'history starts empty');

  await ensureCurrentSnapshot(deck, before.sha, 0);
  const backend = getEditBackend('pptx');
  const result = await backend.apply({
    deckPath: deck,
    ops: [
      { op: 'setText', slideIndex: 9, shapeId: 3, text: 'P1 编辑测试\n第二行' },
      { op: 'setFont', slideIndex: 9, shapeId: 3, sizePt: 30, bold: true, color: 'C00000' },
      { op: 'setNotes', slideIndex: 6, text: 'P1 备注' },
    ],
  });
  assert.equal(result.applied, 3);
  await rename(result.outPath, deck);
  const newSha = (await sha256File(deck)).sha;
  assert.notEqual(newSha, before.sha);
  await recordEdit(deck, before.sha, newSha, 3);
  let history = await loadHistory(deck);
  assert.equal(historySummary(history).canUndo, true);
  assert.equal(history.items.length, 2);
  let after = await open();
  assert.match(after.text, /P1 编辑测试/);
  assert.equal(after.sha, newSha);
  console.log('[ok] edit apply + record:', historySummary(history).version, 'versions');

  const undone = await undo(deck, newSha);
  assert.equal(undone.item.sha, before.sha);
  const restored = await open();
  assert.equal(restored.sha, before.sha);
  assert.match(restored.text, /EDIT-TEXT/);
  history = await loadHistory(deck);
  assert.equal(historySummary(history).canRedo, true);
  console.log('[ok] undo restores old bytes');

  const redone = await redo(deck, restored.sha);
  assert.equal(redone.item.sha, newSha);
  const redoneDeck = await open();
  assert.equal(redoneDeck.sha, newSha);
  assert.match(redoneDeck.text, /P1 编辑测试/);
  console.log('[ok] redo restores new bytes');

  // 外部改写后不能 undo 覆盖
  await copyFile(DECK_V1, deck);
  const externalSha = (await sha256File(deck)).sha;
  await assert.rejects(
    () => undo(deck, externalSha),
    (error) => error.code === 'stale',
    'undo must refuse when the deck changed externally',
  );
  console.log('[ok] stale conflict refuses undo');

  // 页面级 ops
  const structural = await backend.apply({
    deckPath: deck,
    ops: [
      { op: 'duplicateSlide', slideIndex: 1 },
      { op: 'insertSlide', afterIndex: -1 },
    ],
  });
  assert.equal(structural.applied, 2);
  await rename(structural.outPath, deck);
  const structuralSha = (await sha256File(deck)).sha;
  const structuralDeck = await ensureDeck(deck, structuralSha, await statFile(deck));
  assert.equal(structuralDeck.deck.slideCount, 14);
  console.log('[ok] page ops: slideCount', structuralDeck.deck.slideCount);

  console.log('ALL EDIT SMOKE TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
