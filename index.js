/**
 * dsh-artifact-workbench — Host 半（P1：浏览 + 批注 + 结构化编辑）
 *
 * 路由（均挂在 /api/dsh-artifact-workbench/ 下，走 connection 的 owner 浏览器鉴权）：
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
import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { annotationFile } from './lib/annotations.mjs';
import { adapterForPath, listArtifactAdapters } from './lib/artifacts/index.mjs';
import { withDeckLock } from './lib/deck-lock.mjs';
import { EDITOR_ROUTE, serveEditorFile } from './lib/editor-server.mjs';
import { addFeishuComment, feishuStatus, listFeishuComments, readFeishuDoc, replyFeishuComment, resolveFeishuComment } from './lib/feishu.mjs';
import { getFeishuAuthStatus, saveFeishuAppConfig, startFeishuLogin, pollFeishuLogin, logoutFeishu } from './lib/feishu-oauth.mjs';
import { ARTIFACT_ROUTE, registerHtmlArtifact, serveHtmlArtifact } from './lib/html-server.mjs';
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
import { disposeRenderer, readSlidePng } from './lib/render.mjs';
import {
  STORAGE,
  configuredPath,
  errorText,
  envOpt,
  isInside,
  isInsideReal,
  log,
  sha256File,
  statFile,
  syncFile,
} from './lib/util.mjs';

const NS = '/api/dsh-artifact-workbench';
const OPS_MAX = 100;

/**
 * Native apps used by "open externally" are discovered, never hard-coded to one
 * machine. Override with the environment variables listed first in each list.
 */
function nativeAppCandidates(kind) {
  const home = homedir();
  if (kind === 'drawio') {
    return [
      configuredPath('drawio', 'ARTIFACT_WORKBENCH_DRAWIO_APP'),
      envOpt('DRAWIO'),
      '/Applications/draw.io.app',
      join(home, 'Applications/draw.io.app'),
      '/usr/bin/drawio',
      '/usr/local/bin/drawio',
      '/snap/bin/drawio',
      process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'draw.io', 'draw.io.exe') : null,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'draw.io', 'draw.io.exe') : null,
    ].filter(Boolean);
  }
  return [
    configuredPath('libreoffice', 'ARTIFACT_WORKBENCH_LIBREOFFICE'),
    '/Applications/LibreOffice.app',
    join(home, 'Applications/LibreOffice.app'),
    '/usr/bin/libreoffice',
    '/usr/bin/soffice',
    '/opt/libreoffice/program/soffice',
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, 'LibreOffice', 'program', 'soffice.exe')
      : null,
    process.env['PROGRAMFILES(X86)']
      ? join(process.env['PROGRAMFILES(X86)'], 'LibreOffice', 'program', 'soffice.exe')
      : null,
  ].filter(Boolean);
}

async function resolveNativeApp(kind) {
  for (const candidate of nativeAppCandidates(kind)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const nativeOpenAt = new Map();

export const inject = ['connection', 'sessions', 'workingDirectory', 'webServer', 'tools'];

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
  const adapter = adapterForPath(absolutePath);
  if (!adapter) {
    throw userError('unsupported artifact format (supported: .pptx, .pdf, .html, .drawio, .mmd, .mermaid)', 415, 'unsupported-format');
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
    adapter,
    info,
    sha,
    bytes,
    writeAllowed: await isInsideReal(cwd, absolutePath),
  };
}

async function inspectDeck(ctx, payload) {
  const meta = await inspectDeckMeta(ctx, payload);
  const deck = await meta.adapter.load({
    path: meta.absolutePath,
    sha: meta.sha,
    info: meta.info,
  });
  deck.deck.path = meta.absolutePath;
  deck.deck.requestedPath = payload.path;
  deck.deck.bytes = meta.bytes.length;
  deck.deck.format = meta.adapter.format;
  deck.deck.editable = meta.adapter.editable === true;
  deck.deck.writeAllowed = meta.writeAllowed;
  deck.deck.annotationsFile = annotationFile(meta.absolutePath);
  return { ...meta, deck };
}

function inventoryOf(deck, adapter) {
  return {
    format: deck.deck.format || (adapter && adapter.format) || 'pptx',
    slides: deck.slides,
    slideWidthEmu: deck.deck.slideWidthEmu,
    slideHeightEmu: deck.deck.slideHeightEmu,
  };
}

async function deckResponse(ctx, payload, extras) {
  const { sha, deck, absolutePath, adapter } = await inspectDeck(ctx, payload);
  let annotations;
  try {
    annotations = await adapter.readAnnotations({
      path: deck.deck.path,
      sha,
      inventory: inventoryOf(deck, adapter),
      writeAllowed: deck.deck.writeAllowed,
    });
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
  const isDiagram = /\.(drawio|mmd|mermaid)$/i.test(meta.absolutePath);
  const kind = isDiagram ? 'drawio' : 'libreoffice';
  const appName = isDiagram ? 'draw.io' : 'LibreOffice';
  const envHint = isDiagram
    ? 'ARTIFACT_WORKBENCH_DRAWIO_APP (or ARTIFACT_WORKBENCH_DRAWIO)'
    : 'ARTIFACT_WORKBENCH_LIBREOFFICE';
  const appPath = await resolveNativeApp(kind);
  if (!appPath) {
    throw userError(
      `${appName} was not found; install it or set ${envHint} to the app/binary path`,
      500,
      'native-app-missing',
    );
  }
  const previous = nativeOpenAt.get(meta.absolutePath) || 0;
  if (Date.now() - previous < 3000) {
    throw userError('the artifact was just opened externally', 429, 'rate-limited');
  }
  nativeOpenAt.set(meta.absolutePath, Date.now());
  if (envOpt('OPEN_DRY_RUN') === '1') {
    return { ok: true, app: appName, path: meta.absolutePath, dryRun: true };
  }
  // macOS app bundles are launched through LaunchServices; on Linux/Windows the
  // resolved binary is spawned directly with the file as its only argument.
  const child =
    process.platform === 'darwin' && appPath.endsWith('.app')
      ? spawn('open', ['-a', appPath, meta.absolutePath], { detached: true, stdio: 'ignore' })
      : spawn(appPath, [meta.absolutePath], { detached: true, stdio: 'ignore' });
  child.on('error', (error) => {
    void log(`open-native spawn failed: ${errorText(error)}`);
  });
  child.unref();
  await log(`open-native app=${appName} file=${meta.absolutePath.split('/').pop()}`);
  return { ok: true, app: appName, path: meta.absolutePath };
}

const SOURCE_MAX_BYTES = 200 * 1024;
const SOURCE_BACKUP_LIMIT = 5;

function isEditableSource(artifactPath) {
  return /\.(mmd|mermaid|drawio)$/i.test(String(artifactPath || ''));
}

async function sourceBackupDir(artifactPath) {
  return join(`${artifactPath}.workbench`, 'source-backups');
}

async function backupMermaidSource(artifactPath) {
  const dir = await sourceBackupDir(artifactPath);
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const lower = artifactPath.toLowerCase();
  const extension = lower.endsWith('.mermaid') ? 'mermaid' : lower.endsWith('.drawio') ? 'drawio' : 'mmd';
  const target = join(dir, `${timestamp}.${extension}`);
  await copyFile(artifactPath, target);
  const entries = (await readdir(dir).catch(() => [])).filter((name) => !name.startsWith('.')).sort();
  for (const name of entries.slice(0, Math.max(0, entries.length - SOURCE_BACKUP_LIMIT))) {
    await rm(join(dir, name), { force: true }).catch(() => {});
  }
  return target;
}

async function readMermaidSource(meta) {
  if (!isEditableSource(meta.absolutePath) || !meta.adapter || meta.adapter.id !== 'diagram') {
    throw userError('source editing is available for .mmd/.mermaid/.drawio', 422, 'not-source-editable');
  }
  const info = await statFile(meta.absolutePath);
  if (!info) throw userError('file not found', 404, 'not-found');
  if (info.size > SOURCE_MAX_BYTES) throw userError('source is too large', 413, 'too-large');
  const text = await readFile(meta.absolutePath, 'utf8');
  return { text, info };
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
  if (!meta.adapter.editable) {
    throw userError(`${meta.adapter.format} is read-only in the workbench`, 422, 'not-editable');
  }
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
    }, `dsh-artifact-workbench: route ${path}`);
  };

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: EDITOR_ROUTE,
    handler: serveEditorFile,
  }), 'dsh-artifact-workbench: drawio editor assets');

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ARTIFACT_ROUTE,
    handler: serveHtmlArtifact,
  }), 'dsh-artifact-workbench: h5 artifact assets');

  route('health', ['GET'], 'buffered', async () => {
    return json(200, {
      ok: true,
      plugin: 'dsh-artifact-workbench',
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
      const { sha, deck, adapter } = await inspectDeck(ctx, {
        sessionId: url.searchParams.get('sessionId'),
        path: url.searchParams.get('path'),
      });
      const annotations = await adapter.readAnnotations({
        path: deck.deck.path,
        sha,
        inventory: inventoryOf(deck, adapter),
        writeAllowed: deck.deck.writeAllowed,
      });
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
    const { cwd, absolutePath, sha, deck, adapter, writeAllowed } = await inspectDeck(ctx, payload);
    if (!writeAllowed) {
      return failure(
        403,
        'outside-workspace',
        'annotations can only be saved inside the session workspace',
      );
    }
    const result = await adapter.mutateAnnotations({
      path: absolutePath,
      sha,
      inventory: inventoryOf(deck, adapter),
      payload,
      author: payload.author,
    });
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

  ctx.effect(() => ctx.tools.register({
    name: 'feishu_doc_read',
    description: 'Read a Feishu/Lark docx or wiki document: current title, revision, markdown body, comment-addressable blocks, and all comments with replies. Use this when the user asks to continue based on a Feishu document or its comments. It returns text/comments only; it does not edit the document.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Feishu docx or wiki URL.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['title', 'url', 'markdown', 'comments'],
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          revisionId: { type: 'number' },
          markdown: { type: 'string' },
          comments: { type: 'array', items: { type: 'object', additionalProperties: true } },
          blocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Feishu document: ${value.title}`,
          value.url,
          `revision: ${value.revisionId || 0} · comments: ${value.comments.length}`,
          '',
          String(value.markdown || '').slice(0, 12000),
        ].join('\n'),
      }],
    },
    async execute(args) {
      const doc = await readFeishuDoc(args.url);
      return {
        title: doc.title,
        url: doc.url,
        revisionId: Number(doc.revisionId) || 0,
        markdown: doc.markdown,
        blocks: doc.blocks,
        comments: doc.comments,
      };
    },
  }), 'dsh-artifact-workbench: feishu_doc_read tool');

  route('feishu/auth-status', ['GET'], 'buffered', async () => {
    try {
      return json(200, { ok: true, ...(await getFeishuAuthStatus()) });
    } catch (error) {
      return failure(500, 'feishu-auth-failed', errorText(error));
    }
  });

  route('feishu/config', ['POST'], 'buffered', async (request) => {
    let payload;
    try { payload = await request.json(); } catch { return failure(400, 'bad-json', 'body must be JSON'); }
    try {
      const app = await saveFeishuAppConfig({ appId: payload?.appId, appSecret: payload?.appSecret });
      return json(200, { ok: true, ...app });
    } catch (error) {
      return failure(422, 'feishu-config-failed', errorText(error));
    }
  });

  route('feishu/login/start', ['POST'], 'buffered', async (request) => {
    let payload = {};
    try { payload = await request.json(); } catch { payload = {}; }
    try {
      return json(200, { ok: true, ...(await startFeishuLogin({ scope: payload?.scope })) });
    } catch (error) {
      return failure(422, 'feishu-login-failed', errorText(error));
    }
  });

  route('feishu/login/poll', ['POST'], 'buffered', async (request) => {
    let payload;
    try { payload = await request.json(); } catch { return failure(400, 'bad-json', 'body must be JSON'); }
    try {
      return json(200, { ok: true, ...(await pollFeishuLogin(payload?.flowId)) });
    } catch (error) {
      return failure(422, 'feishu-login-failed', errorText(error));
    }
  });

  route('feishu/logout', ['POST'], 'buffered', async () => {
    try {
      return json(200, { ok: true, ...(await logoutFeishu()) });
    } catch (error) {
      return failure(500, 'feishu-logout-failed', errorText(error));
    }
  });

  route('feishu-status', ['GET'], 'buffered', async () => {
    try {
      return json(200, { ok: true, ...(await feishuStatus()) });
    } catch (error) {
      return failure(502, 'feishu-failed', errorText(error));
    }
  });

  route('feishu-doc', ['GET'], 'buffered', async (request) => {
    const url = new URL(request.url);
    try {
      return json(200, { ok: true, ...(await readFeishuDoc(url.searchParams.get('url'))) });
    } catch (error) {
      return failure(422, 'feishu-failed', errorText(error));
    }
  });

  route('feishu-comments', ['GET'], 'buffered', async (request) => {
    const url = new URL(request.url);
    try {
      return json(200, {
        ok: true,
        ...(await listFeishuComments(url.searchParams.get('url'), url.searchParams.get('status') || 'all')),
      });
    } catch (error) {
      return failure(422, 'feishu-failed', errorText(error));
    }
  });

  route('feishu-comment', ['POST'], 'buffered', async (request) => {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return failure(400, 'bad-json', 'body must be JSON');
    }
    try {
      const action = payload?.action || 'create';
      if (action === 'create') {
        return json(200, { ok: true, ...(await addFeishuComment(payload.url, { blockId: payload.blockId, text: payload.text })) });
      }
      if (action === 'reply') {
        return json(200, { ok: true, ...(await replyFeishuComment(payload.url, { commentId: payload.commentId, text: payload.text })) });
      }
      if (action === 'resolve' || action === 'reopen') {
        return json(200, { ok: true, ...(await resolveFeishuComment(payload.url, { commentId: payload.commentId, solved: action === 'resolve' })) });
      }
      return failure(400, 'bad-request', 'action must be create, reply, resolve or reopen');
    } catch (error) {
      return failure(422, 'feishu-failed', errorText(error));
    }
  });

  route('artifact-url', ['GET'], 'buffered', async (request) => {
    const url = new URL(request.url);
    const meta = await inspectDeckMeta(ctx, {
      sessionId: url.searchParams.get('sessionId'),
      path: url.searchParams.get('path'),
    });
    if (!/\.(html?|htm)$/i.test(meta.absolutePath)) {
      throw userError('artifact-url is only available for .html/.htm', 422, 'not-html');
    }
    if (!meta.writeAllowed) {
      throw userError('html artifacts are only served inside the session workspace', 403, 'outside-workspace');
    }
    const artifact = await registerHtmlArtifact(meta.absolutePath);
    return json(200, {
      ok: true,
      url: artifact.url,
      title: basename(meta.absolutePath),
      sha256: meta.sha,
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

  route('source', ['GET', 'POST'], 'buffered', async (request) => {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const meta = await inspectDeckMeta(ctx, {
        sessionId: url.searchParams.get('sessionId'),
        path: url.searchParams.get('path'),
      });
      const { text, info } = await readMermaidSource(meta);
      return json(200, {
        ok: true,
        path: meta.absolutePath,
        sha256: meta.sha,
        size: info.size,
        text,
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return failure(400, 'bad-json', 'body must be JSON');
    }
    if (!payload || typeof payload.text !== 'string') {
      throw userError('text must be a string', 422, 'bad-source');
    }
    if (Buffer.byteLength(payload.text, 'utf8') > SOURCE_MAX_BYTES) {
      throw userError('source is too large', 413, 'too-large');
    }
    if (!/^[0-9a-f]{64}$/.test(String(payload.baseSha || ''))) {
      throw userError('baseSha must be a 64-char sha256', 400, 'bad-request');
    }
    const meta = await inspectDeckMeta(ctx, payload);
    if (!isEditableSource(meta.absolutePath) || meta.adapter.id !== 'diagram') {
      throw userError('source editing is available for .mmd/.mermaid/.drawio', 422, 'not-source-editable');
    }
    if (!meta.writeAllowed) {
      throw userError('source editing is only allowed inside the session workspace', 403, 'outside-workspace');
    }
    return withDeckLock(meta.absolutePath, async () => {
      const current = await sha256File(meta.absolutePath);
      if (current.sha !== payload.baseSha) {
        throw userError('file changed on disk', 409, 'stale', { currentSha: current.sha });
      }
      const backup = await backupMermaidSource(meta.absolutePath);
      const workbench = `${meta.absolutePath}.workbench`;
      await mkdir(workbench, { recursive: true });
      const tmp = join(workbench, `source-${process.pid}-${Date.now()}.${meta.absolutePath.toLowerCase().endsWith('.mermaid') ? 'mermaid' : meta.absolutePath.toLowerCase().endsWith('.drawio') ? 'drawio' : 'mmd'}`);
      try {
        await writeFile(tmp, payload.text, 'utf8');
        await syncFile(tmp);
        await rename(tmp, meta.absolutePath);
        await fsyncDirectory(dirname(meta.absolutePath));
        const newSha = (await sha256File(meta.absolutePath)).sha;
        if (payload.render === false) {
          await log(`source save file=${meta.absolutePath.split('/').pop()} bytes=${Buffer.byteLength(payload.text, 'utf8')} sha=${newSha.slice(0, 12)} render=skip`);
          return json(200, {
            ok: true,
            path: meta.absolutePath,
            sha256: newSha,
            size: Buffer.byteLength(payload.text, 'utf8'),
            source: {
              oldSha: current.sha,
              newSha,
              bytes: Buffer.byteLength(payload.text, 'utf8'),
            },
          });
        }
        let response;
        try {
          response = await deckResponse(ctx, payload, {
            source: {
              oldSha: current.sha,
              newSha,
              bytes: Buffer.byteLength(payload.text, 'utf8'),
            },
          });
        } catch (error) {
          // An external editor may have written during render. Only roll back
          // when the file is still exactly the version this request wrote.
          const afterFailure = await sha256File(meta.absolutePath).catch(() => null);
          if (afterFailure && afterFailure.sha !== newSha) {
            const conflictDir = join(workbench, 'conflict');
            await mkdir(conflictDir, { recursive: true }).catch(() => {});
            const extension = meta.absolutePath.toLowerCase().endsWith('.drawio') ? 'drawio' : 'mmd';
            const conflictCopy = join(conflictDir, `source-${Date.now()}-${process.pid}.${extension}`);
            await copyFile(meta.absolutePath, conflictCopy).catch(() => {});
            throw userError('render failed and the file changed on disk during save', 409, 'stale', {
              currentSha: afterFailure.sha,
              conflictCopy,
            });
          }
          await copyFile(backup, meta.absolutePath).catch(() => {});
          throw error;
        }
        await log(`source save file=${meta.absolutePath.split('/').pop()} bytes=${Buffer.byteLength(payload.text, 'utf8')} sha=${newSha.slice(0, 12)}`);
        return response;
      } finally {
        await rm(tmp, { force: true }).catch(() => {});
      }
    });
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
    return json(200, {
      ok: true,
      backend: await describeEditBackend(),
      artifacts: listArtifactAdapters().map((adapter) => ({
        id: adapter.id,
        format: adapter.format,
        extensions: adapter.extensions,
        editable: adapter.editable === true,
        capabilities: adapter.capabilities || null,
      })),
    });
  });

  ctx.effect(() => {
    return () => {
      disposeRenderer().catch(() => {});
    };
  }, 'dsh-artifact-workbench: renderer lifetime');

  void log('host plugin applied (P1)');
}

export { EditOpError };
