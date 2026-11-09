import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
/** Plugin-owned cache/state directory. Override to keep runs self-contained. */
export const STORAGE =
  process.env.PPT_WORKBENCH_STORAGE || join(DSH_HOME, 'storages', 'dsh-ppt-workbench');
export const LOG_PATH = join(STORAGE, 'workbench.log');

/**
 * DSH app resources directory. In the DSH host `process.resourcesPath` is set;
 * standalone scripts/tests have to discover it. `DSH_RESOURCES` (or the
 * plugin-scoped alias `PPT_WORKBENCH_RESOURCES`) overrides the detection.
 */
function detectResources() {
  const candidates = [
    process.resourcesPath,
    '/Applications/DeepSeek Harness.app/Contents/Resources',
    join(homedir(), 'Applications/DeepSeek Harness.app/Contents/Resources'),
    '/opt/DeepSeek Harness/resources',
    '/opt/deepseek-harness/resources',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources') : null,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'app.asar.unpacked'))) return candidate;
  }
  return candidates[0];
}

export const RESOURCES =
  process.env.DSH_RESOURCES ||
  process.env.PPT_WORKBENCH_RESOURCES ||
  detectResources();
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

const CONFIG_PATH = join(STORAGE, 'config.json');
let cachedConfig = null;

/**
 * Optional user config: `$STORAGE/config.json`. DSH desktop apps do not inherit
 * shell environment variables, so a file is the practical way to pin external
 * program paths. Keys: `chrome`, `drawio`, `libreoffice`, `larkCli`, `python`.
 * Environment variables take precedence; missing/invalid file means `{}`.
 */
export function pluginConfig() {
  if (cachedConfig !== null) return cachedConfig;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    cachedConfig = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    cachedConfig = {};
  }
  return cachedConfig;
}

export function configuredPath(key, envName) {
  const fromEnv = envName ? process.env[envName] : undefined;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  const fromConfig = pluginConfig()[key];
  return typeof fromConfig === 'string' && fromConfig.length > 0 ? fromConfig : undefined;
}

export function findPython() {
  const fallback = process.platform === 'win32' ? 'python' : 'python3';
  const candidates = [configuredPath('python', 'PPT_WORKBENCH_PYTHON'), RUNTIME_PYTHON].filter(
    (value) => typeof value === 'string' && value.length > 0,
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return fallback;
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

/**
 * Symlink-aware containment check. The lexical check above is not a security
 * boundary: a link inside a workspace can point outside it.
 */
export async function isInsideReal(parent, child) {
  let parentReal;
  try {
    parentReal = await realpath(resolve(parent));
  } catch {
    parentReal = resolve(parent);
  }
  const target = resolve(child);
  let targetReal;
  try {
    targetReal = await realpath(target);
  } catch {
    // A write target may not exist yet. Resolve its nearest existing parent and
    // append the remaining lexical suffix, so a symlinked parent still fails.
    let cursor = dirname(target);
    const suffix = [target.slice(cursor.length + 1)];
    while (true) {
      try {
        const resolved = await realpath(cursor);
        targetReal = resolve(resolved, ...suffix);
        break;
      } catch {
        const next = dirname(cursor);
        if (next === cursor) {
          targetReal = target;
          break;
        }
        suffix.unshift(cursor.slice(next.length + 1));
        cursor = next;
      }
    }
  }
  const rel = relative(parentReal, targetReal);
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
