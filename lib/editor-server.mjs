import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDITOR_ROUTE = '/plugins/dsh-ppt-workbench/editor';
const EDITOR_ROOT = resolve(fileURLToPath(new URL('../editor/', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

function fileForRequest(pathname) {
  let relative = pathname.slice(EDITOR_ROUTE.length);
  if (relative === '' || relative === '/') relative = '/index.html';
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const normalized = normalize(decoded).replace(/^([/\\])+/, '');
  if (normalized.split(/[\\/]+/).includes('..')) return null;
  const absolute = resolve(join(EDITOR_ROOT, normalized));
  if (absolute !== EDITOR_ROOT && !absolute.startsWith(EDITOR_ROOT + sep)) return null;
  return absolute;
}

export async function serveEditorFile(req, res) {
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
  if (pathname !== EDITOR_ROUTE && !pathname.startsWith(`${EDITOR_ROUTE}/`)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const file = fileForRequest(pathname);
  if (!file) {
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
  if (file.endsWith(`${sep}index.html`)) {
    try {
      const html = await readFile(file, 'utf8');
      const injected = html.includes('__dsh-bridge.js')
        ? html
        : html.replace(/<\/body>/i, '<script src="./__dsh-bridge.js"></script>\n</body>');
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
      /* fall through to the raw stream */
    }
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}
