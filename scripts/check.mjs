#!/usr/bin/env node
/**
 * Syntax check for every hand-written JavaScript file in the repository.
 *
 * Runs `node --check` over the Host half, the browser Client half, `lib/`,
 * `test/` and local `scripts/`, skipping the vendored draw.io editor tree
 * (`editor/`, third-party minified assets) and dependencies.
 *
 *   node scripts/check.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['editor', 'node_modules', '.git']);
const EXTENSIONS = new Set(['.js', '.mjs']);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walk(full));
    } else if (entry.isFile() && EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      files.push(full);
    }
  }
  return files;
}

const files = [
  join(ROOT, 'index.js'),
  join(ROOT, 'client.js'),
  ...walk(join(ROOT, 'lib')),
  ...walk(join(ROOT, 'test')),
  ...walk(join(ROOT, 'scripts')),
].filter((file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
});

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    const detail = String(error.stderr || error.message).trim();
    console.error(`[fail] ${relative(ROOT, file)}\n${detail}\n`);
  }
}

if (failed > 0) {
  console.error(`${failed}/${files.length} file(s) failed syntax check`);
  process.exitCode = 1;
} else {
  console.log(`[ok] syntax check passed for ${files.length} files`);
}
