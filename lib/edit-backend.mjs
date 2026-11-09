import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { workbenchDir } from './history.mjs';
import { ensureSafeDir } from './util.mjs';
import { findPython, syncFile } from './util.mjs';

const execFileAsync = promisify(execFile);
const EDIT_SCRIPT = fileURLToPath(new URL('./edit_ops.py', import.meta.url));

export class EditOpError extends Error {
  constructor(opIndex, message) {
    super(message);
    this.name = 'EditOpError';
    this.opIndex = opIndex;
    this.status = 422;
    this.code = 'bad-op';
  }
}

/**
 * Edit backend contract. The python-pptx backend is the shipped P1 implementation;
 * a future official `@deepseek-ai/libreoffice-kit/editor` backend can implement the
 * same methods without touching the Client API.
 */
export class EditBackend {
  static id = 'base';

  get id() {
    return this.constructor.id;
  }

  /** @returns {Promise<{id: string, ops: string[], limitations: string[]}>} */
  async capabilities() {
    return { id: this.id, ops: [], limitations: [] };
  }

  /**
   * Apply ops to a deck copy.
   * @param {{deckPath: string, ops: object[], signal?: AbortSignal}} request
   * @returns {Promise<{outPath: string, applied: number, warnings: string[]}>}
   */
  async apply() {
    throw new Error('EditBackend.apply is not implemented');
  }
}

const OPS = [
  'setText',
  'setFont',
  'setShapeBox',
  'setNotes',
  'setTableCell',
  'setChartData',
  'deleteShape',
  'duplicateSlide',
  'deleteSlide',
  'moveSlide',
  'insertSlide',
];

export class PptxEditBackend extends EditBackend {
  static id = 'pptx';

  async capabilities() {
    return {
      id: this.id,
      ops: OPS,
      limitations: [
        'top-level shapes only (group children are read-only)',
        'no picture replacement, animations, transitions, SmartArt or media',
      ],
    };
  }

  async apply({ deckPath, ops, signal }) {
    const work = join(workbenchDir(deckPath), 'edit-tmp');
    await ensureSafeDir(workbenchDir(deckPath), 'deck workbench directory');
    await ensureSafeDir(work, 'edit temp directory');
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const opsPath = join(work, `ops-${token}.json`);
    const outPath = join(work, `out-${token}.pptx`);
    try {
      await writeFile(opsPath, JSON.stringify(ops), 'utf8');
      const python = findPython();
      let stdout = '';
      let stderr = '';
      try {
        const result = await execFileAsync(
          python,
          [EDIT_SCRIPT, deckPath, opsPath, outPath],
          {
            timeout: 120_000,
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, PYTHONUTF8: '1' },
            signal,
          },
        );
        stdout = String(result.stdout || '');
        stderr = String(result.stderr || '');
      } catch (error) {
        stdout = String(error.stdout || '');
        stderr = String(error.stderr || '');
        const parsed = parseReport(stdout);
        if (parsed && parsed.ok === false) {
          throw new EditOpError(
            Number.isInteger(parsed.opIndex) ? parsed.opIndex : null,
            parsed.message || stderr || 'edit failed',
          );
        }
        throw Object.assign(new Error(stderr || error.message || 'edit failed'), {
          status: 500,
          code: 'edit-failed',
        });
      }
      const report = parseReport(stdout);
      if (!report || report.ok !== true) {
        throw Object.assign(new Error(stderr || 'edit backend returned no report'), {
          status: 500,
          code: 'edit-failed',
        });
      }
      await syncFile(outPath);
      return {
        outPath,
        applied: report.applied,
        warnings: Array.isArray(report.warnings) ? report.warnings : [],
        slideCount: report.slideCount,
      };
    } catch (error) {
      await rm(outPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await rm(opsPath, { force: true }).catch(() => {});
    }
  }
}

function parseReport(stdout) {
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

const backends = new Map([[PptxEditBackend.id, new PptxEditBackend()]]);

export function getEditBackend(id = 'pptx') {
  const backend = backends.get(id);
  if (!backend) throw new Error(`unknown edit backend: ${id}`);
  return backend;
}

export async function describeEditBackend() {
  const backend = getEditBackend();
  return { ...(await backend.capabilities()) };
}
