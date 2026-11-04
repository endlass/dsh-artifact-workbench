/**
 * 批注侧车并发写测试（复现 2026-11-04 保存 ENOENT 竞态）：
 *   node test/annotation-concurrency.mjs
 *
 * 旧实现 tmp 文件名只有 pid+毫秒；同一毫秒两个 repair 写会争同一个 tmp，
 * 一个 rename 成功后另一个 ENOENT。现在要求：并发读修复/写入全部成功且 JSON 可读。
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadAnnotationFile,
  readAnnotations,
  saveAnnotationFile,
} from '../lib/annotations.mjs';
import { ensureDeck } from '../lib/render.mjs';
import { sha256File, statFile, writeJsonFile } from '../lib/util.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const DECK_V1 = join(ROOT, 'research/ppt-workbench/engine/deck/deck-v1.pptx');
const work = await mkdtemp(join(tmpdir(), 'ppt-wb-ann-conc-'));
const deck = join(work, 'deck.pptx');

try {
  await copyFile(DECK_V1, deck);
  const info = await statFile(deck);
  const { sha } = await sha256File(deck);
  const { slides } = await ensureDeck(deck, sha, info);
  const inventory = {
    slides,
    slideWidthEmu: 12191695,
    slideHeightEmu: 6858000,
  };

  // 1) 并发写同一 JSON 文件：不能出现 ENOENT
  await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      writeJsonFile(join(work, 'race.json'), { index, at: Date.now() }),
    ),
  );
  const raced = await loadAnnotationFile(deck, sha);
  assert.equal(raced.schema, 'dsh-ppt-annotation@1');
  console.log('[ok] concurrent writeJsonFile x40');

  // 2) 并发 readAnnotations 修复写：全部 resolve，无 ENOENT
  const results = await Promise.all(
    Array.from({ length: 24 }, () => readAnnotations(deck, sha, inventory)),
  );
  assert.equal(results.length, 24);
  assert.ok(results.every((entry) => Array.isArray(entry.annotations)));
  console.log('[ok] concurrent readAnnotations x24');

  // 3) 交替 sha 强制每次修复写
  const alternate = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      readAnnotations(deck, index % 2 === 0 ? sha : 'f'.repeat(64), inventory),
    ),
  );
  assert.equal(alternate.length, 24);
  const final = await loadAnnotationFile(deck, sha);
  assert.ok(Array.isArray(final.annotations));
  console.log('[ok] alternating repair writes x24');

  // 4) 并发 saveAnnotationFile：临时文件不得互相踩
  const file = await loadAnnotationFile(deck, sha);
  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      saveAnnotationFile(deck, {
        ...file,
        deck: { ...file.deck, marker: index },
      }),
    ),
  );
  const after = await loadAnnotationFile(deck, sha);
  assert.ok(after.deck.marker >= 0);
  console.log('[ok] concurrent saveAnnotationFile x30');

  console.log('ALL ANNOTATION CONCURRENCY TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
