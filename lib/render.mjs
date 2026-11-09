import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  KIT_INDEX,
  STORAGE,
  configuredPath,
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

async function ensurePdfRender(pdfPath, cacheDir, sha) {
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
    const tmpDir = join(cacheDir, `pages.tmp-${process.pid}-${Date.now()}`);
    const startedAt = Date.now();
    try {
      const converter = await kitConverter();
      const manifest = await converter.renderImages({
        inputPath: pdfPath,
        outputDir: tmpDir,
        pages: 'all',
        dpi: DPI,
      });
      await rename(tmpDir, pagesDir);
      const saved = {
        ...manifest,
        sourceSha256: sha,
        renderedAt: new Date().toISOString(),
      };
      await writeFile(manifestPath, `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
      await log(
        `pdf render ok sha=${sha.slice(0, 12)} pages=${(saved.images || []).length} ms=${Date.now() - startedAt}`,
      );
      return { manifest: saved, renderMs: Date.now() - startedAt, cached: false };
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  });
}

/**
 * Local draw.io Desktop CLI candidates (used only for diagram image export).
 * Override with `ARTIFACT_WORKBENCH_DRAWIO`; docs/SECURITY.md list the supported setup.
 */
function drawioCandidates() {
  return [
    configuredPath('drawio', 'ARTIFACT_WORKBENCH_DRAWIO'),
    '/Applications/draw.io.app/Contents/MacOS/draw.io',
    '/Applications/drawio.app/Contents/MacOS/drawio',
    '/usr/bin/drawio',
    '/usr/local/bin/drawio',
    '/snap/bin/drawio',
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'draw.io', 'draw.io.exe') : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'draw.io', 'draw.io.exe') : null,
  ].filter(Boolean);
}

async function findDrawio() {
  for (const candidate of drawioCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function exportDrawioPng(sourcePath, pngPath, extension, page) {
  const drawio = await findDrawio();
  if (!drawio) {
    throw Object.assign(new Error('draw.io Desktop was not found for diagram rendering'), {
      status: 501,
      code: 'drawio-unavailable',
    });
  }
  const tmp = `${pngPath}.tmp-${process.pid}-${Date.now()}.png`;
  try {
    await execFileAsync(
      drawio,
      [
        '-x', '-f', 'png', '-s', '2', '-b', '8', '--disable-update',
        ...(Number.isInteger(page) && page > 0 ? ['-p', String(page)] : []),
        '-o', tmp, sourcePath,
      ],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const written = await statFile(tmp);
    if (!written || written.size < 100) throw new Error('draw.io produced an empty PNG');
    await rename(tmp, pngPath);
    return { width: await pngWidth(pngPath), height: await pngHeight(pngPath), extension };
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function pngWidth(path) {
  const data = await readFile(path);
  return data.readUInt32BE(16);
}

async function pngHeight(path) {
  const data = await readFile(path);
  return data.readUInt32BE(20);
}

/**
 * Local Chrome/Chromium candidates (used only for H5 -> PDF snapshots).
 * Override with `ARTIFACT_WORKBENCH_CHROME`; any Chromium-compatible binary works.
 */
function chromeCandidates() {
  return [
    configuredPath('chrome', 'ARTIFACT_WORKBENCH_CHROME'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
  ].filter(Boolean);
}

async function findChrome() {
  for (const candidate of chromeCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function snapshotHtmlToPdf(htmlPath, pdfPath) {
  const chrome = await findChrome();
  if (!chrome) {
    throw Object.assign(new Error('Chrome/Chromium was not found for H5 snapshot rendering'), {
      status: 501,
      code: 'snapshot-unavailable',
    });
  }
  const tmp = `${pdfPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await execFileAsync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        '--virtual-time-budget=2500',
        `--print-to-pdf=${tmp}`,
        pathToFileURL(htmlPath).href,
      ],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const written = await statFile(tmp);
    if (!written || written.size < 100) throw new Error('HTML snapshot produced an empty PDF');
    await rename(tmp, pdfPath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Render a drawio diagram or Mermaid source to a single page image with the
 * installed draw.io Desktop CLI. Diagram workbenches are read-only annotation
 * surfaces for now (drawio external editing / Mermaid source editing come later).
 */
export async function ensureDiagramDeck(sourcePath, sha, info) {
  const existing = deckCache.get(sha);
  if (existing) return existing;
  const promise = (async () => {
    const cacheDir = deckDirFor(sha);
    const pagesDir = join(cacheDir, 'pages');
    const manifestPath = join(pagesDir, 'manifest.json');
    await mkdir(pagesDir, { recursive: true });
    let manifest = await readJsonFile(manifestPath, null);
    const sourceText = await readFile(sourcePath, 'utf8').catch(() => '');
    const isDrawio = /\.drawio$/i.test(sourcePath);
    const pageMatches = isDrawio ? [...sourceText.matchAll(/<diagram\b/g)] : [];
    const declaredPages = isDrawio ? Math.max(1, pageMatches.length) : 1;
    const toRender = Math.min(declaredPages, 30);
    if (!manifest || !Array.isArray(manifest.images) || manifest.images.length === 0) {
      const startedAt = Date.now();
      const images = [];
      for (let page = 1; page <= toRender; page += 1) {
        const fileName = `page-${String(page).padStart(4, '0')}.png`;
        const pngPath = join(pagesDir, fileName);
        const tmpPng = `${pngPath}.export-${process.pid}-${Date.now()}.png`;
        const image = await exportDrawioPng(sourcePath, tmpPng, sourcePath.split('.').pop().toLowerCase(), isDrawio ? page : undefined);
        await rename(tmpPng, pngPath);
        images.push({
          index: page,
          page,
          path: fileName,
          width: image.width,
          height: image.height,
          rectangle: { x: 0, y: 0, width: image.width / 2, height: image.height / 2 },
        });
      }
      manifest = {
        images,
        pageCount: declaredPages,
        missingFonts: [],
        sourceSha256: sha,
        renderedAt: new Date().toISOString(),
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await log(`diagram render ok sha=${sha.slice(0, 12)} pages=${toRender}/${declaredPages} ms=${Date.now() - startedAt}`);
    }
    const images = Array.isArray(manifest.images) ? manifest.images : [];
    if (images.length === 0) throw new Error('diagram produced no renderable pages');
    const declared = Number.isInteger(manifest.pageCount) && manifest.pageCount > 0
      ? manifest.pageCount
      : images.length;
    const first = images[0];
    const slideWidthEmu = Math.round(Number(first.width) * 9525);
    const slideHeightEmu = Math.round(Number(first.height) * 9525);
    const slides = images.map((image) => ({
      index: image.page - 1,
      slideId: image.page,
      notes: '',
      textSha1: '',
      shapes: [],
    }));
    return {
      deck: {
        path: sourcePath,
        sha256: sha,
        bytes: info.size,
        mtimeMs: info.mtimeMs,
        format: 'pdf',
        sourceFormat: isDrawio ? 'drawio' : 'mermaid',
        editable: false,
        slideCount: declared,
        renderedPages: images.length,
        truncated: declared > images.length,
        dpi: 96,
        slideWidthEmu,
        slideHeightEmu,
        missingFonts: manifest.missingFonts || [],
        pages: images.map((image) => ({
          page: image.page,
          index: image.page,
          width: image.width,
          height: image.height,
          rectangle: image.rectangle,
          file: image.path,
        })),
        renderMs: 0,
        renderCached: true,
        inventoryMs: 0,
        inventoryCached: true,
      },
      slides,
    };
  })();
  deckCache.set(sha, promise);
  try {
    return await promise;
  } finally {
    deckCache.delete(sha);
  }
}

/**
 * Render a local report HTML into a PDF snapshot, then reuse the PDF page pipeline.
 * H5 is read-only in the workbench; annotations are page/area based on the snapshot.
 *//**
 * Render a local report HTML into a PDF snapshot, then reuse the PDF page pipeline.
 * H5 is read-only in the workbench; annotations are page/area based on the snapshot.
 */
export async function ensureHtmlDeck(htmlPath, sha, info) {
  const existing = deckCache.get(sha);
  if (existing) return existing;
  const promise = (async () => {
    const cacheDir = deckDirFor(sha);
    await mkdir(cacheDir, { recursive: true });
    const snapshot = join(cacheDir, 'source.pdf');
    let snapshotInfo = await statFile(snapshot);
    if (!snapshotInfo) {
      await snapshotHtmlToPdf(htmlPath, snapshot);
      snapshotInfo = await statFile(snapshot);
      if (!snapshotInfo) throw new Error('HTML snapshot was not written');
      await log(`html snapshot ok sha=${sha.slice(0, 12)} bytes=${snapshotInfo.size}`);
    }
    const renderResult = await ensurePdfRender(snapshot, cacheDir, sha);
    const images = Array.isArray(renderResult.manifest.images) ? renderResult.manifest.images : [];
    if (images.length === 0) throw new Error('HTML snapshot produced no renderable pages');
    const rect = images[0].rectangle || {};
    const slideWidthEmu = Math.round(Number(rect.width || 0) * 9525);
    const slideHeightEmu = Math.round(Number(rect.height || 0) * 9525);
    const slideCount = Number.isInteger(renderResult.manifest.pageCount)
      ? renderResult.manifest.pageCount
      : images.length;
    const slides = images.map((image) => ({
      index: image.page - 1,
      slideId: image.page,
      notes: '',
      textSha1: '',
      shapes: [],
    }));
    const inventory = { slideCount, slides, slideWidthEmu, slideHeightEmu };
    const deck = deckResult(htmlPath, sha, info, { inventory, inventoryMs: 0, cached: true }, renderResult);
    deck.deck.format = 'pdf';
    deck.deck.sourceFormat = 'html';
    deck.deck.editable = false;
    deck.deck.snapshot = true;
    deck.deck.snapshotPath = snapshot;
    return deck;
  })();
  deckCache.set(sha, promise);
  try {
    return await promise;
  } finally {
    deckCache.delete(sha);
  }
}

/**
 * Ensure a PDF artifact has rendered pages and a page-only inventory.
 * PDF is read-only in the workbench; annotations are page/area based.
 */
export async function ensurePdfDeck(pdfPath, sha, info) {
  const existing = deckCache.get(sha);
  if (existing) return existing;
  const promise = (async () => {
    const cacheDir = deckDirFor(sha);
    await mkdir(cacheDir, { recursive: true });
    const renderResult = await ensurePdfRender(pdfPath, cacheDir, sha);
    const images = Array.isArray(renderResult.manifest.images) ? renderResult.manifest.images : [];
    if (images.length === 0) throw new Error('PDF produced no renderable pages');
    const first = images[0];
    const rect = first.rectangle || {};
    const slideWidthEmu = Math.round(Number(rect.width || 0) * 9525);
    const slideHeightEmu = Math.round(Number(rect.height || 0) * 9525);
    const slideCount = Number.isInteger(renderResult.manifest.pageCount)
      ? renderResult.manifest.pageCount
      : images.length;
    const slides = images.map((image) => ({
      index: image.page - 1,
      slideId: image.page,
      notes: '',
      textSha1: '',
      shapes: [],
    }));
    const inventory = { slideCount, slides, slideWidthEmu, slideHeightEmu };
    const deck = deckResult(pdfPath, sha, info, { inventory, inventoryMs: 0, cached: true }, renderResult);
    deck.deck.format = 'pdf';
    deck.deck.editable = false;
    return deck;
  })();
  deckCache.set(sha, promise);
  try {
    return await promise;
  } finally {
    deckCache.delete(sha);
  }
}

/**
 * Ensure inventory + rendered pages exist for a deck content hash.
 * Concurrent callers for the same sha share one promise.
 *//**
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

