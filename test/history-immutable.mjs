/**
 * P1 regression: history snapshots must not share an inode with the live deck.
 * node test/history-immutable.mjs
 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureCurrentSnapshot, historyFile, loadHistory, undo } from '../lib/history.mjs';
import { sha256Bytes, sha256File } from '../lib/util.mjs';

const work = await mkdtemp(join(tmpdir(), 'wb-history-'));
const deck = join(work, 'deck.pptx');
try {
  await copyFile(fileURLToPath(new URL('./fixtures/deck-v1.pptx', import.meta.url)), deck);
  const original = await sha256File(deck);
  const history = await ensureCurrentSnapshot(deck, original.sha, 0);
  assert.equal(history.items.length, 1);
  const snapshotPath = join(deck + '.workbench', 'history', history.items[0].file);
  const snapshotBytes = await readFile(snapshotPath);
  assert.equal(sha256Bytes(snapshotBytes), original.sha);

  // Simulate an external editor truncating/writing the live file in place.
  const replacement = Buffer.from(snapshotBytes);
  replacement[0] = replacement[0] ^ 0xff;
  await writeFile(deck, replacement);
  const afterExternal = await readFile(snapshotPath);
  assert.equal(sha256Bytes(afterExternal), original.sha, 'snapshot inode was mutated');
  assert.notEqual((await sha256File(deck)).sha, original.sha);

  // Create a second history entry, then corrupt the first snapshot. Undo must
  // validate the snapshot before restoring and refuse the corrupt backup.
  const changedSha = (await sha256File(deck)).sha;
  await ensureCurrentSnapshot(deck, changedSha, 0);
  const snapshotFile = join(deck + '.workbench', 'history', history.items[0].file);
  await writeFile(snapshotFile, 'corrupt');
  await assert.rejects(() => undo(deck, changedSha), /history|corrupt/i);
  const loaded = await loadHistory(deck);
  assert.equal(loaded.schema, 'dsh-ppt-history@1');
  console.log('[ok] history snapshot is independent and restore is guarded');
  console.log('ALL HISTORY IMMUTABLE TESTS PASSED');
} finally {
  await rm(work, { recursive: true, force: true });
}
