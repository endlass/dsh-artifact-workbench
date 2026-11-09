/**
 * P0 regression: symlink containment + annotation read-repair/create race.
 * node test/p0-regression.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isInsideReal } from '../lib/util.mjs';
import { ARTIFACT_ROUTE, registerHtmlArtifact, serveHtmlArtifact } from '../lib/html-server.mjs';
import {
  loadAnnotationFile,
  mutateAnnotations,
  readAnnotations,
  saveAnnotationFile,
} from '../lib/annotations.mjs';
import { saveHistory } from '../lib/history.mjs';

const work = await mkdtemp(join(tmpdir(), 'wb-p0-'));

try {
  // 1) symlink boundary
  const inside = join(work, 'inside');
  const outside = join(work, 'outside');
  await mkdir(inside);
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(outside, join(inside, 'link-dir'));
  await symlink(join(outside, 'secret.txt'), join(inside, 'link-file'));
  assert.equal(await isInsideReal(inside, join(inside, 'link-file')), false);
  assert.equal(await isInsideReal(inside, join(inside, 'link-dir', 'secret.txt')), false);
  assert.equal(await isInsideReal(inside, join(inside, 'new-file.txt')), true);
  console.log('[ok] realpath containment rejects symlink escapes');

  // 1b) annotation sidecar directory must not be a symlink (workspace write
  // boundary also covers <artifact>.workbench, history, locks and backups).
  const deckDir = join(work, 'deck-dir');
  await mkdir(deckDir);
  const deckPath = join(deckDir, 'deck.pptx');
  await writeFile(deckPath, 'fake deck');
  const sidecarOutside = join(work, 'sidecar-outside');
  await mkdir(sidecarOutside);
  await symlink(sidecarOutside, `${deckPath}.workbench`);
  let rejected = false;
  try {
    await saveAnnotationFile(deckPath, {
      schema: 'dsh-artifact-annotation@2',
      format: 'pptx',
      deck: { path: deckPath, sha256: 'a'.repeat(64) },
      annotations: [],
    });
  } catch (error) {
    rejected = true;
    assert.equal(error.status, 403);
  }
  assert.equal(rejected, true);
  assert.deepEqual(await readdir(sidecarOutside), []);
  let historyRejected = false;
  try {
    await saveHistory(deckPath, { schema: 'dsh-ppt-history@1', items: [], cursor: 0 });
  } catch (error) {
    historyRejected = true;
    assert.equal(error.status, 403);
  }
  assert.equal(historyRejected, true);
  assert.deepEqual(await readdir(sidecarOutside), []);
  console.log('[ok] annotation/history sidecars reject symlinked .workbench directories');

  // 2) H5 artifact directory must not expose siblings or symlinks
  const htmlRoot = join(work, 'report');
  await mkdir(htmlRoot);
  await writeFile(join(htmlRoot, 'report.html'), '<!doctype html><html><head><link rel="stylesheet" href="report.css"></head><body>ok</body></html>');
  await writeFile(join(htmlRoot, 'report.css'), 'body{color:#111}');
  await writeFile(join(work, 'outside-marker.css'), 'body{display:none}');
  await symlink(join(work, 'outside-marker.css'), join(htmlRoot, 'escape.css'));
  const artifact = await registerHtmlArtifact(join(htmlRoot, 'report.html'));
  const server = createServer((req, res) => { void serveHtmlArtifact(req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(origin + artifact.url);
    assert.equal(page.status, 200);
    const css = await fetch(`${origin}${ARTIFACT_ROUTE}/${artifact.token}/report.css`);
    assert.equal(css.status, 200);
    const unknown = await fetch(`${origin}${ARTIFACT_ROUTE}/${artifact.token}/escape.css`);
    assert.equal(unknown.status, 404);
    const sibling = await fetch(`${origin}${ARTIFACT_ROUTE}/${artifact.token}/../outside-marker.txt`);
    assert.ok([404, 400].includes(sibling.status));
    const sidecar = await fetch(`${origin}${ARTIFACT_ROUTE}/${artifact.token}/.workbench/annotations.json`);
    assert.equal(sidecar.status, 404);
  } finally {
    server.close();
  }
  console.log('[ok] H5 artifact rejects symlinks, siblings, sidecars');

  // 3) read-repair must not overwrite a concurrently created annotation
  const deck = join(work, 'deck.pptx');
  await writeFile(deck, 'fake deck');
  const sha = 'a'.repeat(64);
  const inventory = { format: 'pdf', slides: [{ slideId: 1, index: 0, shapes: [] }], slideWidthEmu: 1, slideHeightEmu: 1 };
  for (let trial = 0; trial < 40; trial += 1) {
    const seed = await loadAnnotationFile(deck, sha, 'pdf');
    seed.annotations = [];
    seed.deck.sha256 = 'b'.repeat(64);
    await saveAnnotationFile(deck, seed);
    await Promise.all([
      readAnnotations(deck, sha, inventory, { writeAllowed: true }),
      mutateAnnotations(deck, sha, inventory, {
        op: 'create', slideIndex: 0, body: `new-${trial}`,
      }, { name: 'test' }),
    ]);
    const final = await loadAnnotationFile(deck, sha, 'pdf');
    assert.equal(final.annotations.length, 1, `trial ${trial} lost annotation`);
  }
  console.log('[ok] 40 read-repair/create races keep the new annotation');

  // 4) corrupt sidecar must not be overwritten
  const corrupt = await loadAnnotationFile(deck, sha, 'pdf');
  const file = join(deck + '.workbench', 'annotations.json');
  await writeFile(file, '{not json');
  await assert.rejects(
    () => readAnnotations(deck, sha, inventory, { writeAllowed: true }),
    /corrupt|JSON|Unexpected/i,
  );
  console.log('[ok] corrupt sidecar is reported, not overwritten');
} finally {
  await rm(work, { recursive: true, force: true });
}
