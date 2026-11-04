/**
 * dsh-ppt-workbench — Host 半（P1：浏览 + 批注 + 结构化编辑）
 *
 * 路由（均挂在 /api/dsh-ppt-workbench/ 下，走 connection 的 owner 浏览器鉴权）：
 * - GET  deck              deck 元信息：inventory + 渲染页面 + 批注 + 历史摘要
 * - GET  slide             某页 PNG 字节
 * - GET  annotations       读批注（含锚点修复）
 * - POST annotations       批注 create/update/resolve/reopen/reply/delete
 * - POST edit              应用一批白名单 op（python-pptx 后端）
 * - GET  history           撤销/重做状态与版本列表
 * - POST undo / redo       快照回滚
 * - GET  health            健康检查
 *
 * 安全：/api 路由由 connection 做 owner 浏览器鉴权；本文件再校验 session 存活、路径存在与 workspace 写边界。
 * 只依赖 node 内置模块与本地 lib/*；不 import 任何 @deepseek-ai/*。
 */

import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  annotationFile,
  mutateAnnotations,
  readAnnotations,
} from './lib/annotations.mjs';
import { withDeckLock } from './lib/deck-lock.mjs';
import { EditOpError, getEditBackend } from './lib/edit-backend.mjs';
import {
  ensureCurrentSnapshot,
  fsyncDirectory,
  historySummary,
  loadHistory,
  recordEdit,
  redo,
  undo,
} from './lib/history.mjs';
import { disposeRenderer, ensureDeck, readSlidePng } from './lib/render.mjs';
import {
  STORAGE,
  errorText,
  isInside,
  log,
  sha256File,
  statFile,
} from './lib/util.mjs';

const NS = '/api/dsh-ppt-workbench';
const OPS_MAX = 100;
const LIBREOFFICE_APP = '/Applications/LibreOffice.app';
const nativeOpenAt = new Map();

export const inject = ['connection', 'sessions', 'workingDirectory'];

function json(status, value) {
  return Response.json(value, { status });
}

function failure(status, code, message, extra) {
  return json(status, { ok: false, code, message, ...(extra || {}) });
}

function userError(message, status, code, extra) {
  return Object.assign(new Error(message), { status, code, ...(extra || {}) });
}

function resolveDeckPath(ctx, sessionId, rawPath) {
  if (typeof sessionId !== 'string' || !sessionId) {
    throw userError('missing sessionId', 400, 'missing-session');
  }
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw userError('missing path', 400, 'missing-path');
  }
  const session = ctx.sessions.get(sessionId);
  if (!session) {
    throw userError('session is not live; open the session first', 404, 'session-not-live');
  }
  const cwd = ctx.workingDirectory.get(session);
  const absolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(join(cwd, rawPath));
  return { session, cwd, absolutePath: absolute };
}

async function inspectDeckMeta(ctx, payload) {
  const { session, cwd, absolutePath } = resolveDeckPath(
    ctx,
    payload.sessionId,
    payload.path,
  );
  if (!/\.pptx$/i.test(absolutePath)) {
    throw userError('only .pptx files are supported', 415, 'unsupported-format');
  }
  const info = await statFile(absolutePath);
  if (!info) throw userError('file not found', 404, 'not-found');
  if (info.size > 200 * 1024 * 1024) {
    throw userError('file is too large', 413, 'too-large');
  }
  const { sha, bytes } = await sha256File(absolutePath);
  return {
    session,
    cwd,
    absolutePath,
    info,
    sha,
    bytes,
    writeAllowed: isInside(cwd, absolutePath),
  };
}

async function inspectDeck(ctx, payload) {
  const meta = await inspectDeckMeta(ctx, payload);
  const deck = await ensureDeck(meta.absolutePath, meta.sha, {
    size: meta.info.size,
    mtimeMs: meta.info.mtimeMs,
  });
  deck.deck.path = meta.absolutePath;
  deck.deck.requestedPath = payload.path;
  deck.deck.bytes = meta.bytes.length;
  deck.deck.writeAllowed = meta.writeAllowed;
  deck.deck.annotationsFile = annotationFile(meta.absolutePath);
  return { ...meta, deck };
}

function inventoryOf(deck) {
  return {
    slides: deck.slides,
    slideWidthEmu: deck.deck.slideWidthEmu,
    slideHeightEmu: deck.deck.slideHeightEmu,
  };
}

async function deckResponse(ctx, payload, extras) {
  const { sha, deck, absolutePath } = await inspectDeck(ctx, payload);
  let annotations;
  try {
    annotations = await readAnnotations(deck.deck.path, sha, inventoryOf(deck));
  } catch (error) {
    // Reading/repairing annotations is a side channel; a failure here must not make
    // a successfully saved edit (or a normal deck read) look like a 500.
    await log(`annotations read failed (non-fatal): ${errorText(error)}`);
    annotations = {
      annotations: [],
      repair: { repaired: 0, orphaned: 0, items: [], error: errorText(error) },
    };
  }
  const history = await loadHistory(absolutePath);
  deck.deck.history = historySummary(history);
  return json(200, {
    ok: true,
    deck: deck.deck,
    slides: deck.slides,
    annotations: annotations.annotations,
    annotationsRepair: annotations.repair,
    ...(extras || {}),
  });
}

function validateEditPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw userError('body must be a JSON object', 400, 'bad-json');
  }
  if (!/^[0-9a-f]{64}$/.test(String(payload.baseSha || ''))) {
    throw userError('baseSha must be a 64-char sha256', 400, 'bad-request');
  }
  if (!Array.isArray(payload.ops) || payload.ops.length === 0) {
    throw userError('ops must be a non-empty array', 422, 'bad-op', { opIndex: 0 });
  }
  if (payload.ops.length > OPS_MAX) {
    throw userError(`too many ops (max ${OPS_MAX})`, 422, 'bad-op', { opIndex: 0 });
  }
  for (let index = 0; index < payload.ops.length; index += 1) {
    const op = payload.ops[index];
    if (!op || typeof op !== 'object' || typeof op.op !== 'string') {
      throw userError('each op must be an object with an op name', 422, 'bad-op', {
        opIndex: index,
      });
    }
  }
}

async function openNative(meta) {
  if (!meta.writeAllowed) {
    throw userError('external editing is only allowed inside the session workspace', 403, 'outside-workspace');
  }
  if (process.platform !== 'darwin') {
    throw userError('external LibreOffice editing is currently implemented for macOS only', 501, 'unsupported-platform');
  }
  try {
    await access(LIBREOFFICE_APP);
  } catch {
    throw userError('LibreOffice.app was not found at /Applications', 500, 'native-app-missing');
  }
  const previous = nativeOpenAt.get(meta.absolutePath) || 0;
  if (Date.now() - previous < 3000) {
    throw userError('the deck was just opened in LibreOffice', 429, 'rate-limited');
  }
  nativeOpenAt.set(meta.absolutePath, Date.now());
  if (process.env.PPT_WORKBENCH_OPEN_DRY_RUN === '1') {
    return { ok: true, app: 'LibreOffice', path: meta.absolutePath, dryRun: true };
  }
  const child = spawn('open', ['-a', LIBREOFFICE_APP, meta.absolutePath], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (error) => {
    void log(`open-native spawn failed: ${errorText(error)}`);
  });
  child.unref();
  await log(`open-native file=${meta.absolutePath.split('/').pop()}`);
  return { ok: true, app: 'LibreOffice', path: meta.absolutePath };
}

async function historyResponse(ctx, payload) {
  const meta = await inspectDeckMeta(ctx, payload);
  const history = await loadHistory(meta.absolutePath);
  return json(200, {
    ok: true,
    path: meta.absolutePath,
    writeAllowed: meta.writeAllowed,
    ...historySummary(history),
    items: history.items.map((item) => ({
      version: item.version,
      sha: item.sha,
      ts: item.ts,
      opCount: item.opCount,
    })),
  });
}

async function writeConflictCopy(absolutePath, ops) {
  try {
    const dir = join(`${absolutePath}.workbench`, 'conflict');
    await mkdir(dir, { recursive: true });
    const target = join(dir, `conflict-${Date.now()}.pptx`);
    await copyFile(absolutePath, target);
    if (Array.isArray(ops) && ops.length > 0) {
      try {
        const backend = getEditBackend('pptx');
        const result = await backend.apply({ deckPath: absolutePath, ops });
        await rename(result.outPath, target);
      } catch (error) {
        await log(`conflict copy: ops could not be replayed: ${errorText(error)}`);
      }
    }
    await log(`conflict copy written: ${target}`);
    return target;
  } catch (error) {
    await log(`conflict copy failed: ${errorText(error)}`);
    return null;
  }
}

async function mutateDeck(ctx, payload, mode, signal) {
  const meta = await inspectDeckMeta(ctx, payload);
  if (!meta.writeAllowed) {
    throw userError(
      'editing is only allowed inside the session workspace',
      403,
      'outside-workspace',
    );
  }
  const edit = await withDeckLock(meta.absolutePath, async () => {
    const current = await sha256File(meta.absolutePath);
    if (mode === 'edit') {
      if (current.sha !== payload.baseSha) {
        const conflictCopy = await writeConflictCopy(meta.absolutePath, payload.ops);
        throw userError('file changed on disk', 409, 'stale', {
          currentSha: current.sha,
          conflictCopy,
        });
      }
      await ensureCurrentSnapshot(meta.absolutePath, current.sha, 0);
      const backend = getEditBackend('pptx');
      const result = await backend.apply({
        deckPath: meta.absolutePath,
        ops: payload.ops,
        signal,
      });
      try {
        const after = await sha256File(meta.absolutePath);
        if (after.sha !== current.sha) {
          const conflictCopy = await writeConflictCopy(meta.absolutePath, payload.ops);
          throw userError('file changed during edit', 409, 'stale', {
            currentSha: after.sha,
            conflictCopy,
          });
        }
        try {
          await rename(result.outPath, meta.absolutePath);
        } catch (error) {
          await rm(result.outPath, { force: true }).catch(() => {});
          throw error;
        }
        await fsyncDirectory(dirname(meta.absolutePath));
        const newSha = (await sha256File(meta.absolutePath)).sha;
        const history = await recordEdit(
          meta.absolutePath,
          current.sha,
          newSha,
          payload.ops.length,
        );
        await log(
          `edit ok file=${meta.absolutePath.split('/').pop()} ops=${payload.ops.length} sha=${newSha.slice(0, 12)}`,
        );
        return {
          action: 'edit',
          oldSha: current.sha,
          newSha,
          opsApplied: result.applied,
          warnings: result.warnings,
          history: historySummary(history),
        };
      } catch (error) {
        await rm(result.outPath, { force: true }).catch(() => {});
        throw error;
      }
    }

    const currentHistory = await loadHistory(meta.absolutePath);
    const cursorItem = currentHistory.items[currentHistory.cursor];
    if (!cursorItem || cursorItem.sha !== current.sha) {
      throw userError('file changed since the history entry', 409, 'stale', {
        currentSha: current.sha,
      });
    }
    const outcome =
      mode === 'undo'
        ? await undo(meta.absolutePath, current.sha)
        : await redo(meta.absolutePath, current.sha);
    const newSha = (await sha256File(meta.absolutePath)).sha;
    await log(
      `${mode} ok file=${meta.absolutePath.split('/').pop()} sha=${newSha.slice(0, 12)}`,
    );
    return {
      action: mode,
      oldSha: current.sha,
      newSha,
      opsApplied: 0,
      warnings: [],
      history: historySummary(outcome.history),
    };
  });

  return deckResponse(ctx, payload, { edit });
}

export function apply(ctx) {
  const route = (path, methods, requestBody, handler) => {
    ctx.effect(() => {
      const dispose = ctx.connection.fetch.register({
        path: `${NS}/${path}`,
        methods,
        requestBody,
        fetch: async (request) => {
          try {
            return await handler(request);
          } catch (error) {
            const status = Number.isInteger(error && error.status) ? error.status : 500;
            const extra = {};
            if (error && error.currentSha !== undefined) extra.currentSha = error.currentSha;
            if (error && error.opIndex !== undefined && error.opIndex !== null) {
              extra.opIndex = error.opIndex;
            }
            if (error && error.conflictCopy) extra.conflictCopy = error.conflictCopy;
            await log(`route ${path} failed (${status}): ${errorText(error)}`);
            return failure(
              status,
              (error && error.code) || 'internal',
              errorText(error),
              extra,
            );
          }
        },
      });
      return () => {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      };
    }, `dsh-ppt-workbench: route ${path}`);
  };

  route('health', ['GET'], 'buffered', async () => {
    return json(200, {
      ok: true,
      plugin: 'dsh-ppt-workbench',
      phase: 'P1',
      node: process.version,
      storage: STORAGE,
    });
  });

  route('deck', ['GET'], 'buffered', async (request) => {
    const url = new URL(request.url);
    const startedAt = Date.now();
    const payload = {
      sessionId: url.searchParams.get('sessionId'),
      path: url.searchParams.get('path'),
    };
    const response = await deckResponse(ctx, payload);
    const data = await response.clone().json();
    await log(
      `deck open sha=${String(data?.deck?.sha256 || '').slice(0, 12)} slides=${data?.deck?.slideCount} renderMs=${data?.deck?.renderMs} totalMs=${Date.now() - startedAt}`,
    );
    return response;
  });

  route('slide', ['GET'], 'buffered', async (request) => {
    const url = new URL(request.url);
    const sha = url.searchParams.get('sha') || '';
    const page = Number(url.searchParams.get('page'));
    if (!/^[0-9a-f]{64}$/.test(sha) || !Number.isInteger(page) || page < 1) {
      return failure(400, 'bad-request', 'sha and page are required');
    }
    const result = await readSlidePng(sha, page);
    if (!result) return failure(404, 'not-rendered', 'slide is not rendered');
    return new Response(result.bytes, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, max-age=31536000, immutable',
        etag: `"${sha}-${page}"`,
      },
    });
  });

  route('annotations', ['GET', 'POST'], 'buffered', async (request) => {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const { sha, deck } = await inspectDeck(ctx, {
        sessionId: url.searchParams.get('sessionId'),
        path: url.searchParams.get('path'),
      });
      const annotations = await readAnnotations(deck.deck.path, sha, inventoryOf(deck));
      return json(200, {
        ok: true,
        deckSha: sha,
        annotations: annotations.annotations,
        annotationsRepair: annotations.repair,
        writeAllowed: deck.deck.writeAllowed,
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return failure(400, 'bad-json', 'body must be JSON');
    }
    const { cwd, absolutePath, sha, deck } = await inspectDeck(ctx, payload);
    if (!isInside(cwd, absolutePath)) {
      return failure(
        403,
        'outside-workspace',
        'annotations can only be saved inside the session workspace',
      );
    }
    const result = await mutateAnnotations(
      absolutePath,
      sha,
      inventoryOf(deck),
      payload,
      payload.author,
    );
    await log(
      `annotation ${payload.op || 'create'} file=${absolutePath.split('/').pop()} count=${result.annotations.length}`,
    );
    return json(200, {
      ok: true,
      deckSha: sha,
      annotations: result.annotations,
      annotationsRepair: result.repair,
      writeAllowed: true,
    });
  });

  route('open-native', ['POST'], 'buffered', async (request) => {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return failure(400, 'bad-json', 'body must be JSON');
    }
    const meta = await inspectDeckMeta(ctx, payload);
    return json(200, await openNative(meta));
  });

  route('edit', ['POST'], 'buffered', async (request) => {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return failure(400, 'bad-json', 'body must be JSON');
    }
    validateEditPayload(payload);
    return mutateDeck(ctx, payload, 'edit', request.signal);
  });

  route('history', ['GET'], 'buffered', async (request) => {
    const url = new URL(request.url);
    return historyResponse(ctx, {
      sessionId: url.searchParams.get('sessionId'),
      path: url.searchParams.get('path'),
    });
  });

  route('undo', ['POST'], 'buffered', async (request) => {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return failure(400, 'bad-json', 'body must be JSON');
    }
    return mutateDeck(ctx, payload, 'undo');
  });

  route('redo', ['POST'], 'buffered', async (request) => {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return failure(400, 'bad-json', 'body must be JSON');
    }
    return mutateDeck(ctx, payload, 'redo');
  });

  route('capabilities', ['GET'], 'buffered', async () => {
    const { describeEditBackend } = await import('./lib/edit-backend.mjs');
    return json(200, { ok: true, backend: await describeEditBackend() });
  });

  ctx.effect(() => {
    return () => {
      disposeRenderer().catch(() => {});
    };
  }, 'dsh-ppt-workbench: renderer lifetime');

  void log('host plugin applied (P1)');
}

export { EditOpError };
