import { copyFile, link, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { readJsonFile, syncFile, writeJsonFile } from './util.mjs';

const HISTORY_SCHEMA = 'dsh-ppt-history@1';
const MAX_ITEMS = 30;

export function workbenchDir(deckPath) {
  return `${deckPath}.workbench`;
}

export function historyDir(deckPath) {
  return join(workbenchDir(deckPath), 'history');
}

export function historyFile(deckPath) {
  return join(workbenchDir(deckPath), 'history.json');
}

export function emptyHistory(deckPath) {
  return {
    schema: HISTORY_SCHEMA,
    deck: { path: deckPath },
    cursor: 0,
    items: [],
  };
}

export async function loadHistory(deckPath) {
  const file = await readJsonFile(historyFile(deckPath), null);
  if (!file || file.schema !== HISTORY_SCHEMA || !Array.isArray(file.items)) {
    return emptyHistory(deckPath);
  }
  if (!file.deck || typeof file.deck !== 'object') file.deck = { path: deckPath };
  file.deck.path = deckPath;
  if (!Number.isInteger(file.cursor)) file.cursor = 0;
  return file;
}

export async function saveHistory(deckPath, history) {
  history.deck = { ...(history.deck || {}), path: deckPath, updatedAt: new Date().toISOString() };
  await writeJsonFile(historyFile(deckPath), history);
}

export function historySummary(history) {
  const current = history.items[history.cursor];
  const last = history.items[history.items.length - 1];
  return {
    version: current ? current.version : 0,
    latestVersion: last ? last.version : 0,
    cursor: history.cursor,
    canUndo: history.cursor > 0,
    canRedo: history.cursor < history.items.length - 1,
    itemCount: history.items.length,
  };
}

async function makeSnapshot(deckPath, version, sha) {
  const dir = historyDir(deckPath);
  await mkdir(dir, { recursive: true });
  const name = `v${version}-${sha.slice(0, 12)}.pptx`;
  const target = join(dir, name);
  try {
    await link(deckPath, target);
  } catch (error) {
    if (error.code === 'EEXIST') {
      await rm(target, { force: true });
      await link(deckPath, target);
    } else {
      await copyFile(deckPath, target);
    }
  }
  return { name, path: target };
}

function nextVersion(history) {
  let max = 0;
  for (const item of history.items) {
    if (Number.isInteger(item.version) && item.version > max) max = item.version;
  }
  return max + 1;
}

async function dropRedoBranch(deckPath, history) {
  const removed = history.items.splice(history.cursor + 1);
  for (const item of removed) {
    if (item && item.file) {
      await unlink(join(historyDir(deckPath), item.file)).catch(() => {});
    }
  }
}

async function trimHistory(deckPath, history) {
  while (history.items.length > MAX_ITEMS) {
    const removed = history.items.shift();
    if (removed && removed.file) {
      await unlink(join(historyDir(deckPath), removed.file)).catch(() => {});
    }
    if (history.cursor > 0) history.cursor -= 1;
  }
}

/** Ensure the current deck state has a history entry; returns the history. */
export async function ensureCurrentSnapshot(deckPath, sha, opCount = 0) {
  const history = await loadHistory(deckPath);
  const current = history.items[history.cursor];
  if (current && current.sha === sha) return history;
  if (history.cursor < history.items.length - 1) {
    // A new edit from an undone position starts a new branch.
    await dropRedoBranch(deckPath, history);
  }
  const version = nextVersion(history);
  const snapshot = await makeSnapshot(deckPath, version, sha);
  history.items.push({
    version,
    sha,
    file: snapshot.name,
    ts: new Date().toISOString(),
    opCount: Number.isInteger(opCount) ? opCount : 0,
  });
  history.cursor = history.items.length - 1;
  await trimHistory(deckPath, history);
  await saveHistory(deckPath, history);
  return history;
}

/** Record the new deck state after an edit (deck file already replaced). */
export async function recordEdit(deckPath, oldSha, newSha, opCount = 0) {
  const history = await loadHistory(deckPath);
  const current = history.items[history.cursor];
  if (!current || current.sha !== oldSha) {
    throw Object.assign(new Error('history does not contain the edited version'), {
      status: 409,
      code: 'stale',
    });
  }
  await dropRedoBranch(deckPath, history);
  const version = nextVersion(history);
  const snapshot = await makeSnapshot(deckPath, version, newSha);
  history.items.push({
    version,
    sha: newSha,
    file: snapshot.name,
    ts: new Date().toISOString(),
    opCount: Number.isInteger(opCount) ? opCount : 0,
  });
  history.cursor = history.items.length - 1;
  await trimHistory(deckPath, history);
  await saveHistory(deckPath, history);
  return history;
}

async function restoreSnapshot(deckPath, item) {
  const source = join(historyDir(deckPath), item.file);
  const workbench = workbenchDir(deckPath);
  await mkdir(workbench, { recursive: true });
  const tmp = join(workbench, `restore-${process.pid}-${Date.now()}.pptx`);
  try {
    await copyFile(source, tmp);
    await syncFile(tmp);
    await rename(tmp, deckPath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function undo(deckPath, currentSha) {
  const history = await loadHistory(deckPath);
  if (history.cursor <= 0) {
    throw Object.assign(new Error('nothing to undo'), { status: 409, code: 'no-history' });
  }
  const current = history.items[history.cursor];
  if (current && current.sha !== currentSha) {
    throw Object.assign(new Error('file changed since the last history entry'), {
      status: 409,
      code: 'stale',
      currentSha,
    });
  }
  const target = history.items[history.cursor - 1];
  await restoreSnapshot(deckPath, target);
  history.cursor -= 1;
  await saveHistory(deckPath, history);
  return { item: target, history };
}

export async function redo(deckPath, currentSha) {
  const history = await loadHistory(deckPath);
  if (history.cursor >= history.items.length - 1) {
    throw Object.assign(new Error('nothing to redo'), { status: 409, code: 'no-history' });
  }
  const current = history.items[history.cursor];
  if (current && current.sha !== currentSha) {
    throw Object.assign(new Error('file changed since the last history entry'), {
      status: 409,
      code: 'stale',
      currentSha,
    });
  }
  const target = history.items[history.cursor + 1];
  await restoreSnapshot(deckPath, target);
  history.cursor += 1;
  await saveHistory(deckPath, history);
  return { item: target, history };
}

export async function fsyncDirectory(path) {
  try {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* best effort on platforms that reject directory fsync */
  }
}
