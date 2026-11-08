/**
 * P5.1 Feishu connector test using a local lark-cli double:
 *   node test/feishu-smoke.mjs
 */
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.PPT_WORKBENCH_LARK_CLI = fileURLToPath(new URL('./fixtures/fake-lark-cli', import.meta.url));
await chmod(process.env.PPT_WORKBENCH_LARK_CLI, 0o755);

const {
  addFeishuComment,
  feishuStatus,
  listFeishuComments,
  normalizeFeishuUrl,
  readFeishuDoc,
  replyFeishuComment,
  resolveFeishuComment,
} = await import('../lib/feishu.mjs');

const DOC_URL = 'https://example.feishu.cn/docx/doc_test';

assert.equal(normalizeFeishuUrl(DOC_URL), DOC_URL);
assert.throws(() => normalizeFeishuUrl('http://example.feishu.cn/docx/x'), /https/);
assert.throws(() => normalizeFeishuUrl('https://evil.example.com/docx/x'), /Feishu/);

const status = await feishuStatus();
assert.equal(status.appId, 'cli_test');
assert.equal(status.user.userName, '测试用户');

const doc = await readFeishuDoc(DOC_URL);
assert.equal(doc.title, '测试文档');
assert.equal(doc.documentId, 'doc_test');
assert.equal(doc.revisionId, 7);
assert.ok(doc.docxXml.includes('id="b1"'));
assert.equal(doc.comments.length, 1);
assert.equal(doc.comments[0].anchorBlockId, 'b1');
assert.equal(doc.comments[0].replies[0].text, '请补充');

const comments = await listFeishuComments(DOC_URL, 'all');
assert.equal(comments.comments.length, 1);

const created = await addFeishuComment(DOC_URL, { blockId: 'b1', text: '新评论' });
assert.equal(created.comment_id, 'c2');
const replied = await replyFeishuComment(DOC_URL, { commentId: 'c1', text: '回复' });
assert.equal(replied.reply_id, 'r2');
const resolved = await resolveFeishuComment(DOC_URL, { commentId: 'c1', solved: true });
assert.equal(resolved.is_solved, true);
console.log('[ok] Feishu connector: status/doc/comments/create/reply/resolve');
console.log('ALL FEISHU CONNECTOR TESTS PASSED');
