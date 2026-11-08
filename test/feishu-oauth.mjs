/**
 * Feishu device-flow OAuth test against a local HTTP double.
 * node test/feishu-oauth.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const work = await mkdtemp(join(tmpdir(), 'wb-feishu-oauth-'));
process.env.PPT_WORKBENCH_STORAGE = work;

let polls = 0;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  if (req.url === '/oauth/v1/device_authorization') {
    assert.match(req.headers.authorization || '', /^Basic /);
    assert.match(body, /client_id=cli_test/);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ device_code: 'device-1', user_code: 'USER-1', verification_uri: 'https://verify.example/device', expires_in: 60, interval: 1 }));
    return;
  }
  if (req.url === '/oauth/v3/token') {
    const form = new URLSearchParams(body);
    if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
      assert.equal(form.get('device_code'), 'device-1');
      polls += 1;
      if (polls === 1) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'authorization_pending' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 7200, refresh_expires_in: 86400, scope: 'docx:document:readonly offline_access' }));
      return;
    }
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
    return;
  }
  if (req.url === '/open-apis/authen/v1/user_info') {
    assert.equal(req.headers.authorization, 'Bearer access-1');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 0, data: { name: '测试用户', open_id: 'ou_test' } }));
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.PPT_WORKBENCH_FEISHU_ACCOUNTS = origin;
process.env.PPT_WORKBENCH_FEISHU_OPEN = origin;
try {
  const oauth = await import('../lib/feishu-oauth.mjs');
  await oauth.saveFeishuAppConfig({ appId: 'cli_test', appSecret: 'secret_test' });
  const config = await oauth.getFeishuAppConfig();
  assert.equal(config.appId, 'cli_test');
  assert.equal(config.configured, true);

  const flow = await oauth.startFeishuLogin({ scope: 'docx:document:readonly' });
  assert.equal(flow.userCode, 'USER-1');
  assert.ok(flow.verificationUri.includes('verify'));
  const first = await oauth.pollFeishuLogin(flow.flowId);
  assert.equal(first.status, 'pending');
  const second = await oauth.pollFeishuLogin(flow.flowId);
  assert.equal(second.status, 'ok');
  assert.equal(second.user.name, '测试用户');

  const status = await oauth.getFeishuAuthStatus();
  assert.equal(status.loggedIn, true);
  assert.equal(status.user.name, '测试用户');
  assert.equal(status.configured, true);
  const token = await oauth.loadFeishuToken();
  assert.equal(token.accessToken, 'access-1');
  const mode = (await stat(join(work, 'feishu-token.json'))).mode & 0o777;
  assert.equal(mode, 0o600);
  const raw = await readFile(join(work, 'feishu-token.json'), 'utf8');
  assert.ok(!raw.includes('secret_test'));

  await oauth.logoutFeishu();
  assert.equal((await oauth.getFeishuAuthStatus()).loggedIn, false);
  console.log('[ok] Feishu device flow: config, start, pending, token, user, logout');
  console.log('ALL FEISHU OAUTH TESTS PASSED');
} finally {
  server.close();
  await rm(work, { recursive: true, force: true });
}
