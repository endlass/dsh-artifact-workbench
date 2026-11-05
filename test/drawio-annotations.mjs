/**
 * P4.2 drawio cell annotation sidecar test: node test/drawio-annotations.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), 'wb-drawio-ann-'));
try {
  const path = join(workspace, 'demo.drawio');
  await copyFile(join(ROOT, 'test/fixtures/simple.drawio'), path);
  // generic annotation route is not used directly; exercise annotations module instead
  const ann = await import('../lib/annotations.mjs');
  const sha = 'a'.repeat(64);
  let result = await ann.mutateDrawioAnnotations(path, sha, {
    op: 'create', cellId: 'cell-1', cellLabel: '客户提交问题', body: '这里需要补充负责人', pageIndex: 0,
  }, { id: 'u1', name: '测试' });
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].format, 'drawio');
  assert.equal(result.annotations[0].anchor.kind, 'drawio-cell');
  assert.equal(result.annotations[0].anchor.cellId, 'cell-1');
  const id = result.annotations[0].id;
  let group = await ann.mutateDrawioAnnotations(path, sha, {
    op: 'create', cellIds: ['lane-1', 'node-2', 'node-3'], cellLabels: ['泳道 A', '节点 2', '节点 3'], pageIndex: 0, body: '整个泳道结构需要重排',
  }, { name: '测试' });
  const groupAnnotation = group.annotations.find((entry) => entry.id !== id);
  assert.equal(groupAnnotation.anchor.kind, 'drawio-cell');
  assert.deepEqual(groupAnnotation.anchor.cellIds, ['lane-1', 'node-2', 'node-3']);
  assert.ok(groupAnnotation.anchor.cellLabel.includes('泳道 A'));
  let whole = await ann.mutateDrawioAnnotations(path, sha, {
    op: 'create', scope: 'diagram', body: '整张图的三条分支顺序不合理',
  }, { name: '测试' });
  const wholeAnnotation = whole.annotations.find((entry) => entry.anchor && entry.anchor.kind === 'drawio-diagram');
  assert.ok(wholeAnnotation);
  assert.equal(wholeAnnotation.anchor.cellId, null);
  // remove extras before the existing single-annotation assertions
  await ann.mutateDrawioAnnotations(path, sha, { op: 'delete', id: groupAnnotation.id }, { name: '测试' });
  await ann.mutateDrawioAnnotations(path, sha, { op: 'delete', id: wholeAnnotation.id }, { name: '测试' });
  result = await ann.mutateDrawioAnnotations(path, sha, { op: 'resolve', id }, { name: '测试' });
  assert.equal(result.annotations[0].status, 'resolved');
  result = await ann.mutateDrawioAnnotations(path, sha, { op: 'reopen', id }, { name: '测试' });
  assert.equal(result.annotations[0].status, 'open');
  const read = await ann.readDrawioAnnotations(path, sha);
  assert.equal(read.annotations.length, 1);
  assert.equal(read.repair.repaired, 0);
  const sidecar = JSON.parse(await readFile(join(path + '.workbench', 'annotations.json'), 'utf8'));
  assert.equal(sidecar.format, 'drawio');
  result = await ann.mutateDrawioAnnotations(path, sha, { op: 'delete', id }, { name: '测试' });
  assert.equal(result.annotations.length, 0);
  console.log('[ok] drawio cell annotations create/read/resolve/reopen/delete');
  console.log('ALL DRAWIO ANNOTATION TESTS PASSED');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
