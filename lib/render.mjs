import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  KIT_INDEX,
  STORAGE,
  findPython,
  log,
  readJsonFile,
  statFile,
} from './util.mjs';

const execFileAsync = promisify(execFile);
const INVENTORY_SCRIPT = new URL('./inventory.py', import.meta.url);
const DPI = 144;
const MAX_RENDER_PAGES = 100;
const INVENTORY_VERSION = 2;

/** One converter for the plugin lifetime; the Kit serializes renders internally. */
let converterPromise = null;

function kitConverter() {
  if (converterPromise === null) {
    converterPromise = (async () => {
      const kit = await import(pathToFileURL(KIT_INDEX).href);
      return kit.createConverter({ timeoutMs: 180_000 });
    })();
  }
  return converterPromise;
}

/** Render queue: the Kit converter is serial anyway; do not start parallel renders. */
let queue = Promise.resolve();
function serial(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

const deckCache = new Map();

export function deckDirFor(sha) {
  return join(STORAGE, 'renders', sha);
}

async function runInventory(deckPath, cacheDir) {
  const startedAt = Date.now();
  const python = findPython();
  const inventoryPath = join(cacheDir, 'inventory.json');
  await mkdir(cacheDir, { recursive: true });
  await execFileAsync(python, [fileURLToPath(INVENTORY_SCRIPT), deckPath, inventoryPath], {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  const inventory = await readJsonFile(inventoryPath, null);
  if (!inventory || !Array.isArray(inventory.slides)) {
    throw new Error('inventory.py did not produce a valid inventory');
  }
  await writeFile(join(cacheDir, 'inventory.version'), String(INVENTORY_VERSION), 'utf8');
  return { inventory, inventoryMs: Date.now() - startedAt };
}

async function ensureInventory(deckPath, cacheDir) {
  const version = await readFile(join(cacheDir, 'inventory.version'), 'utf8').catch(() => '');
  const cached = await readJsonFile(join(cacheDir, 'inventory.json'), null);
  if (String(version).trim() === String(INVENTORY_VERSION) && cached && Array.isArray(cached.slides)) {
    return { inventory: cached, inventoryMs: 0, cached: true };
  }
  return { ...(await runInventory(deckPath, cacheDir)), cached: false };
}

async function ensureRender(deckPath, cacheDir, slideCount, sha) {
  const pagesDir = join(cacheDir, 'pages');
  const manifestPath = join(pagesDir, 'manifest.json');
  const cached = await readJsonFile(manifestPath, null);
  if (cached && Array.isArray(cached.images)) {
    return { manifest: cached, renderMs: 0, cached: true };
  }
  return serial(async () => {
    const again = await readJsonFile(manifestPath, null);
    if (again && Array.isArray(again.images)) {
      return { manifest: again, renderMs: 0, cached: true };
    }
    const pages = Array.from(
      { length: Math.min(slideCount, MAX_RENDER_PAGES) },
      (_, index) => index + 1,
    );
    const tmpDir = join(cacheDir, `pages.tmp-${process.pid}-${Date.now()}`);
    const startedAt = Date.now();
    try {
      const converter = await kitConverter();
      const manifest = await converter.renderImages({
        inputPath: deckPath,
        outputDir: tmpDir,
        pages,
        dpi: DPI,
      });
      await rename(tmpDir, pagesDir);
      const saved = {
        ...manifest,
        sourceSha256: sha,
        renderedAt: new Date().toISOString(),
        requestedPages: pages,
      };
      await writeFile(manifestPath, `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
      await log(
        `render ok sha=${sha.slice(0, 12)} pages=${pages.length} ms=${Date.now() - startedAt}`,
      );
      return { manifest: saved, renderMs: Date.now() - startedAt, cached: false };
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  });
}

function deckResult(deckPath, sha, info, inventoryResult, renderResult) {
  const manifest = renderResult.manifest;
  const pages = (manifest.images || []).map((image) => ({
    page: image.page,
    index: image.index,
    width: image.width,
    height: image.height,
    rectangle: image.rectangle,
    file: image.path ? image.path.split('/').pop() : `page-${String(image.page).padStart(4, '0')}.png`,
  }));
  return {
    deck: {
      path: deckPath,
      sha256: sha,
      bytes: info.size,
      mtimeMs: info.mtimeMs,
      slideCount: inventoryResult.inventory.slideCount,
      renderedPages: pages.length,
      truncated: inventoryResult.inventory.slideCount > pages.length,
      dpi: DPI,
      slideWidthEmu: inventoryResult.inventory.slideWidthEmu,
      slideHeightEmu: inventoryResult.inventory.slideHeightEmu,
      missingFonts: manifest.missingFonts || [],
      pages,
      renderMs: renderResult.renderMs,
      renderCached: renderResult.cached,
      inventoryMs: inventoryResult.inventoryMs,
      inventoryCached: inventoryResult.cached,
    },
    slides: inventoryResult.inventory.slides,
  };
}

/**
 * Ensure inventory + rendered pages exist for a deck content hash.
 * Concurrent callers for the same sha share one promise.
 */
export async function ensureDeck(deckPath, sha, info) {
  const existing = deckCache.get(sha);
  if (existing) return existing;
  const promise = (async () => {
    const cacheDir = deckDirFor(sha);
    await mkdir(cacheDir, { recursive: true });
    const inventoryResult = await ensureInventory(deckPath, cacheDir);
    const renderResult = await ensureRender(
      deckPath,
      cacheDir,
      inventoryResult.inventory.slideCount,
      sha,
    );
    return deckResult(deckPath, sha, info, inventoryResult, renderResult);
  })();
  deckCache.set(sha, promise);
  try {
    return await promise;
  } finally {
    deckCache.delete(sha);
  }
}

export async function readSlidePng(sha, page) {
  const pagesDir = join(deckDirFor(sha), 'pages');
  const manifest = await readJsonFile(join(pagesDir, 'manifest.json'), null);
  if (!manifest || !Array.isArray(manifest.images)) return null;
  const image = manifest.images.find((entry) => entry.page === page);
  if (!image || typeof image.path !== 'string') return null;
  const filePath = join(pagesDir, image.path.split('/').pop());
  const fileInfo = await statFile(filePath);
  if (!fileInfo) return null;
  return { bytes: await readFile(filePath), info: fileInfo, image };
}

export async function disposeRenderer() {
  const pending = converterPromise;
  converterPromise = null;
  if (pending) {
    try {
      const converter = await pending;
      await converter.dispose?.();
    } catch {
      /* ignore */
    }
  }
}

