import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
export const STORAGE = join(DSH_HOME, 'storages', 'dsh-ppt-workbench');
export const LOG_PATH = join(STORAGE, 'workbench.log');
export const RESOURCES =
  process.resourcesPath || '/Applications/DeepSeek Harness.app/Contents/Resources';
export const KIT_INDEX = join(
  RESOURCES,
  'app.asar.unpacked',
  'dsh',
  'node_modules',
  '@deepseek-ai',
  'libreoffice-kit',
  'lib',
  'index.js',
);
export const KIT_CLI = join(
  RESOURCES,
  'app.asar.unpacked',
  'dsh',
  'node_modules',
  '@deepseek-ai',
  'libreoffice-kit',
  'lib',
  'cli.js',
);
export const BUNDLED_NODE = join(
  RESOURCES,
  'runtime',
  'primary-runtime',
  'dependencies',
  'node',
  'bin',
  'node',
);
export const RUNTIME_PYTHON = join(
  DSH_HOME,
  'dsh-runtimes',
  'dsh-primary-runtime',
  'dependencies',
  'python',
  'bin',
  'python3',
);

export function findPython() {
  const candidates = [process.env.PPT_WORKBENCH_PYTHON, RUNTIME_PYTHON].filter(
    (value) => typeof value === 'string' && value.length > 0,
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'python3';
}

export async function syncFile(path) {
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function ensureStore() {
  await mkdir(STORAGE, { recursive: true });
}

export async function log(...parts) {
  try {
    await ensureStore();
    const line = parts
      .map((part) => (typeof part === 'string' ? part : safeJson(part)))
      .join(' ');
    await appendFile(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* logging must never break a request */
  }
}

export function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(path) {
  const bytes = await readFile(path);
  return { sha: sha256Bytes(bytes), bytes };
}

export async function statFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

export function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export function exists(path) {
  return existsSync(path);
}

export function errorText(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
