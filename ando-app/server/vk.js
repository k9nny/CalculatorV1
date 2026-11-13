'use strict';
// Автопостинг машин в группу ВКонтакте.
// Пост на стене группы с фото публикуется только с ключом пользователя-администратора группы
// (ключ сообщества этого не умеет). С 2024 года такой ключ выдаёт VK ID (OAuth 2.1 с PKCE):
// приложение на id.vk.com → кнопка «Подключить ВК» в админке → вход в ВК → ключ сохраняется на сервере
// и обновляется сам (access_token живёт около часа, refresh_token — дольше).
// Хранится в vk.json рядом с журналом заявок (только для владельца).
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { vkCall, postMultipart } = require('./video/publish');
const { listingText } = require('./listing-text');

const VKID = 'https://id.vk.com';
const SCOPE = 'wall photos groups';
const MAX_PHOTOS = 10; // в посте ВК — до 10 вложений

function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: 20000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error(`VK ID ответил не JSON (${res.statusCode})`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createVk(config, deps = {}) {
  const call = deps.vkCall || vkCall;
  const form = deps.postForm || postForm;
  const upload = deps.postMultipart || postMultipart;
  const log = deps.log || console.log;
  const file = path.join(path.dirname(config.leadsLog), 'vk.json');
  let pending = null; // { state, verifier, redirectUri, at } — вход через VK ID, пока владелец на странице ВК

  function read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
  function save(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }

  // «https://vk.ru/andoauto», «club123», «-123» → числовой id группы.
  async function resolveGroup(input, token) {
    const raw = String(input || '').trim().replace(/^https?:\/\/(m\.)?vk\.(com|ru)\//, '').replace(/[/?#].*$/, '');
    const m = /^(?:club|public|-)?(\d+)$/.exec(raw);
    if (m) return { id: Number(m[1]), name: '' };
    if (!token) return { screen: raw };
    const r = await call('groups.getById', { group_id: raw }, token);
    const g = Array.isArray(r) ? r[0] : (r && r.groups ? r.groups[0] : null);
    if (!g) throw new Error('Группа не найдена');
    return { id: g.id, name: g.name };
  }

  // Шаг 1: адрес входа через VK ID. clientId — «ID приложения» из кабинета id.vk.com.
  function authorizeUrl({ clientId, group, redirectUri }) {
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(24));
    pending = { state, verifier, redirectUri, clientId: String(clientId), group: String(group || ''), at: Date.now() };
    const q = new URLSearchParams({
      response_type: 'code', client_id: String(clientId), redirect_uri: redirectUri, state, scope: SCOPE,
      code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256'
    });
    return `${VKID}/authorize?${q}`;
  }

  // Шаг 2: VK ID вернул code — меняем на ключи. Без нашего state (выданного в шаге 1) — отказ.
  async function finish({ code, state, deviceId }) {
    if (!pending || !state || state !== pending.state || Date.now() - pending.at > 15 * 60 * 1000) throw new Error('Ссылка входа устарела. Нажмите «Подключить ВК» ещё раз.');
    const p = pending;
    pending = null;
    const t = await form(`${VKID}/oauth2/auth`, {
      grant_type: 'authorization_code', code, code_verifier: p.verifier, client_id: p.clientId,
      device_id: deviceId || '', redirect_uri: p.redirectUri, state
    });
    if (!t || !t.access_token) throw new Error('VK ID не выдал ключ: ' + ((t && (t.error_description || t.error)) || 'нет ответа'));
    const group = await resolveGroup(p.group, t.access_token);
    const data = { ...read(), clientId: p.clientId, deviceId: deviceId || '', accessToken: t.access_token, refreshToken: t.refresh_token || '',
      expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000, userId: t.user_id || null, groupId: group.id, groupName: group.name || '' };
    if (data.auto === undefined) data.auto = true;
    save(data);
    return data;
  }

  // Ключ вручную (если он получен другим способом).
  async function setToken({ token, group }) {
    const g = await resolveGroup(group, token);
    // Проверка прав: сервер загрузки фото на стену выдаётся только с правами photos у администратора группы.
    await call('photos.getWallUploadServer', { group_id: g.id }, token);
    const data = { ...read(), accessToken: token, refreshToken: '', expiresAt: 0, groupId: g.id, groupName: g.name || '' };
    if (data.auto === undefined) data.auto = true;
    save(data);
    return data;
  }

  async function token() {
    const d = read();
    if (!d.accessToken) throw new Error('ВКонтакте не подключён');
    if (!d.expiresAt || d.expiresAt - Date.now() > 60000 || !d.refreshToken) return d.accessToken;
    const t = await form(`${VKID}/oauth2/auth`, {
      grant_type: 'refresh_token', refresh_token: d.refreshToken, client_id: d.clientId, device_id: d.deviceId || '',
      state: b64url(crypto.randomBytes(16))
    });
    if (!t || !t.access_token) throw new Error('Ключ ВК устарел — подключите ВК заново в настройках');
    save({ ...d, accessToken: t.access_token, refreshToken: t.refresh_token || d.refreshToken, expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000 });
    return t.access_token;
  }

  // Пост о машине: текст по общему шаблону + до 10 фото. Возвращает { postId, url }.
  async function postCar(car, link) {
    const d = read();
    if (!d.groupId) throw new Error('Не выбрана группа ВК');
    const tk = await token();
    const attachments = [];
    for (const src of (car.photos || []).slice(0, MAX_PHOTOS)) {
      const local = path.join(config.photosDir, path.basename(String(src)));
      if (!/^img\/cars\//.test(src) || !fs.existsSync(local)) continue;
      const srv = await call('photos.getWallUploadServer', { group_id: d.groupId }, tk);
      const up = await upload(srv.upload_url, {}, { field: 'photo', path: local, type: /\.png$/i.test(local) ? 'image/png' : 'image/jpeg' });
      if (!up || !up.photo || up.photo === '[]') continue;
      const saved = await call('photos.saveWallPhoto', { group_id: d.groupId, photo: up.photo, server: up.server, hash: up.hash }, tk);
      const ph = Array.isArray(saved) ? saved[0] : null;
      if (ph) attachments.push(`photo${ph.owner_id}_${ph.id}`);
    }
    const message = listingText(car, { link, mode: 'channel' });
    const r = await call('wall.post', { owner_id: -d.groupId, from_group: 1, message, attachments: attachments.join(',') }, tk);
    const postId = r && r.post_id;
    if (!postId) throw new Error('ВК не принял пост');
    return { postId, url: `https://vk.ru/wall-${d.groupId}_${postId}` };
  }

  function status() {
    const d = read();
    return { connected: !!d.accessToken, groupId: d.groupId || null, groupName: d.groupName || '', auto: d.auto !== false,
      clientId: d.clientId || '', renewable: !!d.refreshToken };
  }
  function setAuto(on) { const d = read(); save({ ...d, auto: !!on }); return status(); }
  function disconnect() { save({}); return status(); }

  return { authorizeUrl, finish, setToken, postCar, status, setAuto, disconnect, token, resolveGroup, _read: read, _log: log };
}

module.exports = { createVk, SCOPE };
