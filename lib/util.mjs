import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { appendFile, chmod, lstat, mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');

const ENV_PREFIX = 'ARTIFACT_WORKBENCH_';
const LEGACY_ENV_PREFIX = 'PPT_WORKBENCH_';

/** Read a plugin-scoped environment variable, preferring the new prefix and
 *  falling back to the pre-rename `PPT_WORKBENCH_*` names. */
export function envOpt(name) {
  const value = process.env[ENV_PREFIX + name];
  if (value !== undefined) return value;
  return process.env[LEGACY_ENV_PREFIX + name];
}

const LEGACY_STORAGE = join(DSH_HOME, 'storages', 'dsh-ppt-workbench');
const explicitStorage = envOpt('STORAGE');

/** Plugin-owned cache/state directory. Override to keep runs self-contained. */
export const STORAGE = explicitStorage || join(DSH_HOME, 'storages', 'dsh-artifact-workbench');
export const LOG_PATH = join(STORAGE, 'workbench.log');

// One-time migration from the pre-rename storage directory. Explicit
// ARTIFACT_WORKBENCH_STORAGE/PPT_WORKBENCH_STORAGE settings are never touched.
try {
  if (!explicitStorage && existsSync(LEGACY_STORAGE) && !existsSync(STORAGE)) {
    renameSync(LEGACY_STORAGE, STORAGE);
  }
} catch {
  /* leave the legacy directory in place; a fresh one will be created */
}

/**
 * DSH app resources directory. In the DSH host `process.resourcesPath` is set;
 * standalone scripts/tests have to discover it. `DSH_RESOURCES` (or the
 * plugin-scoped `ARTIFACT_WORKBENCH_RESOURCES`, legacy `PPT_WORKBENCH_RESOURCES`
 * is still accepted) overrides the detection.
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
  envOpt('RESOURCES') ||
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
  const fromEnv = envName
    ? process.env[envName] ??
      (envName.startsWith(ENV_PREFIX)
        ? process.env[LEGACY_ENV_PREFIX + envName.slice(ENV_PREFIX.length)]
        : undefined)
    : undefined;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  const fromConfig = pluginConfig()[key];
  return typeof fromConfig === 'string' && fromConfig.length > 0 ? fromConfig : undefined;
}

export function findPython() {
  const fallback = process.platform === 'win32' ? 'python' : 'python3';
  const candidates = [configuredPath('python', 'ARTIFACT_WORKBENCH_PYTHON'), RUNTIME_PYTHON].filter(
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

function unsafePathError(label) {
  const error = new Error(`${label} must not be a symbolic link`);
  error.status = 403;
  error.code = 'unsafe-path';
  return error;
}

/**
 * Return true when `path` exists and is not a symlink. A symlink at any path
 * component that would be followed by a write is rejected by the callers.
 */
export async function assertNotSymlink(path, label = 'path') {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw unsafePathError(label);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Create (or verify) a writable directory that is not a symlink. Plugin data
 * written next to user artifacts must stay inside the real artifact directory:
 * a symlinked `.workbench` directory would otherwise let annotation/history
 * writes escape the session workspace.
 */
export async function ensureSafeDir(dir, label = 'directory') {
  try {
    const info = await lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) throw unsafePathError(label);
    return;
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error;
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw unsafePathError(label);
  await chmod(dir, 0o700).catch(() => {});
}

export async function ensureStore() {
  await mkdir(STORAGE, { recursive: true, mode: 0o700 });
  await chmod(STORAGE, 0o700).catch(() => {});
}

export async function log(...parts) {
  try {
    await ensureStore();
    const line = parts
      .map((part) => (typeof part === 'string' ? part : safeJson(part)))
      .join(' ');
    await appendFile(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`, { mode: 0o600 });
    await chmod(LOG_PATH, 0o600).catch(() => {});
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
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {});
  await rename(tmp, path);
}

export function exists(path) {
  return existsSync(path);
}

export function errorText(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
