import { open, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { ensureSafeDir } from './util.mjs';

const queues = new Map();

function workbenchDir(deckPath) {
  return `${deckPath}.workbench`;
}

/**
 * Serialize edits for one deck across callers in this Host process.
 * A lock file is also used so a stray second Host process cannot interleave writes.
 */
export async function withDeckLock(deckPath, task, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 20_000;
  const previous = queues.get(deckPath) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  queues.set(deckPath, tail);
  await previous.catch(() => {});

  const lockPath = join(workbenchDir(deckPath), 'edit.lock');
  await ensureSafeDir(workbenchDir(deckPath), 'deck workbench directory');
  const startedAt = Date.now();
  let acquired = false;
  try {
    while (Date.now() - startedAt <= timeoutMs) {
      try {
        const handle = await open(lockPath, 'wx');
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, at: Date.now() }),
          'utf8',
        );
        await handle.close();
        acquired = true;
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const info = await stat(lockPath).catch(() => null);
        if (!info || Date.now() - info.mtimeMs > 120_000) {
          await rm(lockPath, { force: true }).catch(() => {});
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    if (!acquired) {
      throw Object.assign(new Error('deck is being edited by another request'), {
        status: 423,
        code: 'busy',
      });
    }
    return await task();
  } finally {
    if (acquired) {
      await rm(lockPath, { force: true }).catch(() => {});
    }
    release();
    if (queues.get(deckPath) === tail) queues.delete(deckPath);
  }
}
