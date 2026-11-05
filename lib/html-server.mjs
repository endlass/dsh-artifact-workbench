import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARTIFACT_ROUTE = '/plugins/dsh-ppt-workbench/artifact';
const BRIDGE_PATH = fileURLToPath(new URL('./html-bridge.js', import.meta.url));
const TOKEN_TTL_MS = 60 * 60 * 1000;
const artifacts = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

export function registerHtmlArtifact(file) {
  const absolute = resolve(file);
  const token = randomBytes(18).toString('hex');
  artifacts.set(token, { root: dirname(absolute), file: absolute, expires: Date.now() + TOKEN_TTL_MS });
  return {
    token,
    url: `${ARTIFACT_ROUTE}/${token}/${encodeURIComponent(basename(absolute))}`,
  };
}

function alive(token) {
  const entry = artifacts.get(token);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    artifacts.delete(token);
    return null;
  }
  return entry;
}

function inside(root, target) {
  return target === root || target.startsWith(root + sep);
}

export async function serveHtmlArtifact(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  if (!pathname.startsWith(`${ARTIFACT_ROUTE}/`)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const rest = pathname.slice(ARTIFACT_ROUTE.length + 1);
  const slash = rest.indexOf('/');
  if (slash < 0) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const token = rest.slice(0, slash);
  const entry = alive(token);
  if (!entry) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  let relative = rest.slice(slash + 1);
  if (relative === '__dsh-bridge.js') {
    const bridge = await readFile(BRIDGE_PATH);
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': bridge.length,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : bridge);
    return;
  }
  try {
    relative = decodeURIComponent(relative);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  if (relative === '') relative = basename(entry.file);
  const normalized = normalize(relative).replace(/^([/\\])+/, '');
  if (normalized.split(/[\\/]+/).includes('..')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const file = resolve(entry.root, normalized);
  if (!inside(entry.root, file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const extension = extname(file).toLowerCase();
  if (extension === '.html' || extension === '.htm') {
    try {
      const html = await readFile(file, 'utf8');
      const injected = html.includes('__dsh-bridge.js')
        ? html
        : html.replace(/<\/body>/i, `<script src="./__dsh-bridge.js"></script>\n</body>`);
      const bytes = Buffer.from(injected, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': bytes.length,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
      return;
    } catch {
      /* fall through */
    }
  }
  res.writeHead(200, {
    'content-type': MIME[extension] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }).pipe(res);
}
