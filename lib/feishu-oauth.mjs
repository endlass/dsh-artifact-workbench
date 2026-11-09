/**
 * Feishu user OAuth (device flow) for the Artifact Workbench prototype.
 *
 * The app credentials and user tokens are plugin-owned secrets: they are stored
 * under the plugin storage directory with mode 600, never returned to the client
 * and never written to logs. The app is identified by App ID; the token endpoint
 * returns a user_access_token, so subsequent Feishu API calls act as the user.
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCOUNTS = process.env.PPT_WORKBENCH_FEISHU_ACCOUNTS || 'https://accounts.feishu.cn';
const OPEN = process.env.PPT_WORKBENCH_FEISHU_OPEN || 'https://open.feishu.cn';
const DEVICE_PATH = '/oauth/v1/device_authorization';
const TOKEN_PATH = '/oauth/v3/token';
const USER_INFO_PATH = '/open-apis/authen/v1/user_info';
const STORAGE =
  process.env.PPT_WORKBENCH_STORAGE ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'dsh-ppt-workbench');
const APP_FILE = join(STORAGE, 'feishu-app.json');
const TOKEN_FILE = join(STORAGE, 'feishu-token.json');
const pending = new Map();

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeSecret(file, value) {
  await mkdir(STORAGE, { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
}

function basic(appId, appSecret) {
  return Buffer.from(`${appId}:${appSecret}`, 'utf8').toString('base64');
}

async function request(url, options, timeout = 20_000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: 'invalid_response', error_description: text.slice(0, 300) };
  }
  return { response, data };
}

function summarizeUser(data) {
  const user = data?.data || data?.user || {};
  return {
    name: String(user.name || user.en_name || ''),
    openId: String(user.open_id || user.openId || ''),
    unionId: String(user.union_id || user.unionId || ''),
    avatarUrl: String(user.avatar_url || user.avatarUrl || ''),
  };
}

export async function getFeishuAppConfig() {
  const saved = await readJson(APP_FILE);
  return {
    appId: typeof saved?.appId === 'string' ? saved.appId : '',
    configured: typeof saved?.appId === 'string' && saved.appId.length > 0 && typeof saved?.appSecret === 'string' && saved.appSecret.length > 0,
  };
}

export async function saveFeishuAppConfig({ appId, appSecret }) {
  const previous = await readJson(APP_FILE);
  const nextAppId = typeof appId === 'string' && appId.trim() ? appId.trim() : previous?.appId || '';
  const nextSecret = typeof appSecret === 'string' && appSecret.trim() ? appSecret.trim() : previous?.appSecret || '';
  if (!nextAppId) throw new Error('appId is required');
  if (!nextSecret) throw new Error('appSecret is required the first time');
  await writeSecret(APP_FILE, { appId: nextAppId, appSecret: nextSecret });
  if (previous?.appId && previous.appId !== nextAppId) await rm(TOKEN_FILE, { force: true });
  return getFeishuAppConfig();
}

export async function loadFeishuToken() {
  return readJson(TOKEN_FILE);
}

export async function getFeishuAuthStatus() {
  const app = await getFeishuAppConfig();
  const token = await loadFeishuToken();
  if (!token?.accessToken) {
    return { appId: app.appId, configured: app.configured, loggedIn: false, user: null, expiresAt: null, scope: '' };
  }
  return {
    appId: app.appId,
    configured: app.configured,
    loggedIn: true,
    user: token.user || null,
    expiresAt: token.expiresAt || null,
    scope: token.scope || '',
  };
}

export async function logoutFeishu() {
  await rm(TOKEN_FILE, { force: true });
  return { loggedIn: false };
}

export async function startFeishuLogin({ scope } = {}) {
  const app = await readJson(APP_FILE);
  if (!app?.appId || !app?.appSecret) throw new Error('Feishu app credentials are not configured');
  const requestedScope = (typeof scope === 'string' && scope.trim()
    ? scope.trim()
    : 'docx:document:readonly docx:document:write_only docs:document.comment:read docs:document.comment:write_only drive:drive.metadata:readonly')
    .replace(/\s+/g, ' ')
    .trim();
  const form = new URLSearchParams();
  form.set('client_id', app.appId);
  form.set('scope', requestedScope.includes('offline_access') ? requestedScope : `${requestedScope} offline_access`);
  const { response, data } = await request(`${ACCOUNTS}${DEVICE_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic(app.appId, app.appSecret)}`,
    },
    body: form.toString(),
  });
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || `device authorization failed (${response.status})`);
  }
  if (!data.device_code) throw new Error('device authorization response is missing device_code');
  const flowId = randomUUID();
  const expiresIn = Number(data.expires_in) || 240;
  const interval = Number(data.interval) || 5;
  pending.set(flowId, {
    appId: app.appId,
    appSecret: app.appSecret,
    deviceCode: data.device_code,
    expiresAt: Date.now() + expiresIn * 1000,
    interval,
  });
  return {
    flowId,
    userCode: String(data.user_code || ''),
    verificationUri: String(data.verification_uri || data.verification_uri_complete || ''),
    verificationUriComplete: String(data.verification_uri_complete || data.verification_uri || ''),
    expiresIn,
    interval,
    scope: requestedScope,
  };
}

async function fetchUserInfo(accessToken) {
  try {
    const { response, data } = await request(`${OPEN}${USER_INFO_PATH}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    }, 15_000);
    if (!response.ok || (data.code !== undefined && data.code !== 0)) return null;
    return summarizeUser(data);
  } catch {
    return null;
  }
}

export async function pollFeishuLogin(flowId) {
  const flow = pending.get(String(flowId || ''));
  if (!flow) throw new Error('login flow not found or expired');
  if (Date.now() > flow.expiresAt) {
    pending.delete(flowId);
    return { status: 'expired', error: 'device authorization expired' };
  }
  const form = new URLSearchParams();
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
  form.set('device_code', flow.deviceCode);
  form.set('client_id', flow.appId);
  form.set('client_secret', flow.appSecret);
  const { response, data } = await request(`${ACCOUNTS}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (response.ok && data.access_token) {
    const now = Date.now();
    const user = await fetchUserInfo(data.access_token);
    const token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      tokenType: data.token_type || 'Bearer',
      scope: data.scope || '',
      expiresAt: now + (Number(data.expires_in) || 7200) * 1000,
      refreshExpiresAt: data.refresh_expires_in ? now + Number(data.refresh_expires_in) * 1000 : null,
      user,
    };
    await writeSecret(TOKEN_FILE, token);
    pending.delete(flowId);
    return { status: 'ok', user, expiresAt: token.expiresAt, scope: token.scope };
  }
  const error = String(data.error || '');
  if (error === 'authorization_pending') return { status: 'pending', interval: flow.interval };
  if (error === 'slow_down') {
    flow.interval = Math.min(60, (flow.interval || 5) + 5);
    return { status: 'pending', interval: flow.interval };
  }
  pending.delete(flowId);
  return { status: 'failed', error: data.error_description || error || `token request failed (${response.status})` };
}

/** Read a user token for direct API use, refreshing it when close to expiry. */
export async function getFeishuAccessToken() {
  const token = await loadFeishuToken();
  if (!token?.accessToken) return null;
  if (Number(token.expiresAt) > Date.now() + 60_000) return token.accessToken;
  if (!token.refreshToken) return null;
  const app = await readJson(APP_FILE);
  if (!app?.appId || !app?.appSecret) return null;
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', token.refreshToken);
  form.set('client_id', app.appId);
  form.set('client_secret', app.appSecret);
  const { response, data } = await request(`${ACCOUNTS}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok || !data.access_token) return null;
  const next = {
    ...token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token.refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
    scope: data.scope || token.scope,
  };
  await writeSecret(TOKEN_FILE, next);
  return next.accessToken;
}
