/**
 * P5 Feishu connector (prototype).
 *
 * The first P5 slice rides the locally authorized lark-cli instead of
 * implementing OAuth. The connector is deliberately isolated so the transport
 * can later be swapped for a direct Open API + OAuth provider without touching
 * the artifact/UI layers.
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { configuredPath } from './util.mjs';

const DOC_HOSTS = /(^|\.)(feishu\.cn|larksuite\.com)$/i;
const URL_PATH = /^\/(docx|wiki)\//i;
const MAX_TIMEOUT = 60_000;
let cachedCli = null;

export function normalizeFeishuUrl(value) {
  const raw = String(value || '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid Feishu document URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !DOC_HOSTS.test(url.hostname)) {
    throw new Error('only https Feishu/Lark document URLs are supported');
  }
  if (!URL_PATH.test(url.pathname)) throw new Error('only docx or wiki URLs are supported');
  return url.href;
}

async function cliPath() {
  if (cachedCli) return cachedCli;
  const candidates = [
    configuredPath('larkCli', 'PPT_WORKBENCH_LARK_CLI'),
    join(homedir(), '.npm-global/bin/lark-cli'),
    join(homedir(), '.local/bin/lark-cli'),
    '/usr/local/bin/lark-cli',
    '/opt/homebrew/bin/lark-cli',
    'lark-cli',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate.includes('/')) {
      cachedCli = candidate;
      return candidate;
    }
    try {
      await access(candidate);
      cachedCli = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error('lark-cli is not installed; configure PPT_WORKBENCH_LARK_CLI');
}

function runLark(args, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(args[0], args.slice(1), {
        cwd: homedir(),
        env: { ...process.env, PATH: `${join(homedir(), '.npm-global/bin')}:${process.env.PATH || ''}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`lark-cli timed out after ${Math.max(1000, timeout)}ms`));
    }, Math.min(MAX_TIMEOUT, Math.max(1000, timeout)));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 8 * 1024 * 1024) {
        child.kill('SIGTERM');
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('lark-cli output is too large'));
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`lark-cli exited with ${code}: ${stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500)}`));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new Error('lark-cli returned a non-JSON response'));
        return;
      }
      if (parsed && parsed.ok === false) {
        reject(new Error(parsed.error?.message || 'lark-cli request failed'));
        return;
      }
      resolve(parsed);
    });
  });
}

async function lark(args, timeout) {
  const cli = await cliPath();
  return runLark([cli, ...args], timeout);
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function titleFromXml(xml) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(xml || ''));
  return match ? decodeXmlText(match[1]).trim() : '';
}

function replyText(reply) {
  const elements = reply?.content?.elements;
  if (!Array.isArray(elements)) return '';
  return elements.map((element) => element?.text_run?.text || element?.text || '').join('').trim();
}

export function normalizeComment(item) {
  const replies = Array.isArray(item?.reply_list?.replies) ? item.reply_list.replies : [];
  return {
    id: String(item?.comment_id || ''),
    solved: item?.is_solved === true,
    quote: String(item?.quote || ''),
    anchorBlockId: item?.extra?.content_anchor_id ? String(item.extra.content_anchor_id) : null,
    createdAt: item?.create_time ? Number(item.create_time) * 1000 : null,
    replies: replies.map((reply) => ({
      id: String(reply?.reply_id || ''),
      text: replyText(reply),
      authorId: String(reply?.user_id || ''),
      createdAt: reply?.create_time ? Number(reply.create_time) * 1000 : null,
    })),
  };
}


/** Parse the DocxXML returned by docs +fetch into comment-addressable blocks. */
export function parseDocxBlocks(xml) {
  const blocks = [];
  const pattern = /<(h[1-6]|p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(String(xml || ''))) && blocks.length < 800) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';
    const idMatch = /\bid="([^"]+)"/i.exec(attrs);
    if (!idMatch) continue;
    const text = decodeXmlText(match[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 300);
    blocks.push({
      id: idMatch[1],
      type: tag.startsWith('h') ? 'heading' : tag === 'li' ? 'listItem' : 'paragraph',
      level: tag.startsWith('h') ? Number(tag.slice(1)) : null,
      text,
    });
  }
  return blocks;
}

export async function feishuStatus() {
  const result = await lark(['auth', 'status', '--json']);
  const identities = result?.identities || {};
  return {
    appId: result?.appId || '',
    identity: result?.identity || '',
    user: identities.user ? {
      status: identities.user.status || '',
      available: identities.user.available === true,
      userName: identities.user.userName || '',
      openId: identities.user.openId || '',
    } : null,
    bot: identities.bot ? { status: identities.bot.status || '', available: identities.bot.available === true } : null,
  };
}

export async function readFeishuDoc(value) {
  const url = normalizeFeishuUrl(value);
  const [xmlResult, mdResult, commentsResult] = await Promise.all([
    lark(['docs', '+fetch', '--doc', url, '--detail', 'full', '--doc-format', 'xml', '--as', 'user'],
      MAX_TIMEOUT),
    lark(['docs', '+fetch', '--doc', url, '--doc-format', 'markdown', '--as', 'user'],
      MAX_TIMEOUT).catch(() => ({ data: { document: { content: '' } } })),
    lark(['drive', '+list-comments', '--url', url, '--solved-status', 'all', '--page-size', '100', '--as', 'user'],
      MAX_TIMEOUT).catch(() => ({ data: { items: [] } })),
  ]);
  const document = xmlResult?.data?.document || {};
  const markdown = mdResult?.data?.document?.content || '';
  const items = Array.isArray(commentsResult?.data?.items) ? commentsResult.data.items : [];
  return {
    url,
    title: titleFromXml(document.content) || markdown.split('\n').find((line) => line.startsWith('# '))?.slice(2).trim() || '',
    documentId: document.document_id || '',
    revisionId: document.revision_id ?? null,
    markdown,
    docxXml: document.content || '',
    blocks: parseDocxBlocks(document.content || ''),
    comments: items.map(normalizeComment).filter((comment) => comment.id),
  };
}

export async function listFeishuComments(value, status = 'all') {
  const url = normalizeFeishuUrl(value);
  const solved = ['all', 'false', 'true'].includes(status) ? status : 'all';
  const result = await lark(['drive', '+list-comments', '--url', url, '--solved-status', solved, '--page-size', '100', '--as', 'user'], MAX_TIMEOUT);
  return {
    url,
    comments: (Array.isArray(result?.data?.items) ? result.data.items : []).map(normalizeComment).filter((comment) => comment.id),
  };
}

function contentJson(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error('comment text must not be empty');
  if (value.length > 10_000) throw new Error('comment text is too long');
  return JSON.stringify([{ type: 'text', text: value }]);
}

export async function addFeishuComment(value, { blockId, text }) {
  const url = normalizeFeishuUrl(value);
  const args = ['drive', '+add-comment', '--doc', url, '--content', contentJson(text), '--as', 'user'];
  if (blockId) args.splice(4, 0, '--block-id', String(blockId));
  const result = await lark(args, MAX_TIMEOUT);
  return { ...result.data, url };
}

export async function replyFeishuComment(value, { commentId, text }) {
  const url = normalizeFeishuUrl(value);
  if (!commentId) throw new Error('commentId is required');
  const result = await lark(['drive', '+add-reply', '--url', url, '--comment-id', String(commentId), '--content', contentJson(text), '--as', 'user'], MAX_TIMEOUT);
  return { ...result.data, url };
}

export async function resolveFeishuComment(value, { commentId, solved = true }) {
  const url = normalizeFeishuUrl(value);
  if (!commentId) throw new Error('commentId is required');
  const result = await lark([
    'drive',
    solved ? '+resolve-comment' : '+restore-comment',
    '--url', url,
    '--comment-id', String(commentId),
    '--as', 'user',
  ], MAX_TIMEOUT);
  return { ...result.data, url };
}
