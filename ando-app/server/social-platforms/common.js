'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function failure(message, attributes = {}) {
  return Object.assign(new Error(message), attributes);
}

function approved(context) {
  if (context?.approved !== true) throw failure('Для отправки нужен подтверждённый предпросмотр');
}

function secureUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password) throw failure('Медиа должны быть доступны по HTTPS');
  return url.href;
}

function textWithLink(text, link, limit, units = () => 1) {
  const length = (value) => Array.from(value).reduce((total, char) => total + units(char), 0);
  const suffix = link && !String(text).endsWith(link) ? '\n' + link : '';
  const full = String(text || '') + suffix;
  if (length(full) <= limit) return full;
  const end = link ? '\n' + link : '';
  let room = limit - length(end) - units('…');
  if (room < 0) throw failure('Ссылка превышает ограничение площадки');
  const parts = [];
  for (const char of String(text || '')) {
    if (room < units(char)) break;
    parts.push(char);
    room -= units(char);
  }
  return parts.join('') + '…' + end;
}

function textWithByteLimit(text, link, limit) {
  const full = textWithLink(text, link, limit);
  if (Buffer.byteLength(full, 'utf8') <= limit) return full;
  const end = link ? '…\n' + link : '…';
  let room = limit - Buffer.byteLength(end, 'utf8');
  if (room < 0) throw failure('Ссылка превышает ограничение площадки');
  const parts = [];
  for (const char of String(text || '')) {
    const bytes = Buffer.byteLength(char, 'utf8');
    if (room < bytes) break;
    parts.push(char);
    room -= bytes;
  }
  return parts.join('') + end;
}

// Files are private, outside public/. Each checkpoint belongs to one account and snapshot.
function store(config, name, identity) {
  const dir = config.socialPlatformDir || path.join(path.dirname(config.leadsLog), 'social-platforms');
  const file = path.join(dir, `${name}-${hash(identity)}.json`);
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  function write(data) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  return { read, write, file };
}

// transport returns {status, headers, body}; tests inject this interface without sockets.
function transport({ url, method = 'GET', headers = {}, body, timeoutMs = 180000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(failure('API требует HTTPS'));
    const req = https.request(target, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) req.destroy(failure('Слишком большой ответ API'));
        else chunks.push(chunk);
      });
      res.on('aborted', () => req.destroy(failure('Ответ API прерван')));
      res.on('error', (error) => req.destroy(error));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { /* caller checks HTTP status first */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('timeout', () => req.destroy(failure('API timeout', { code: 'ETIMEDOUT' })));
    req.on('error', (error) => {
      if (body && typeof body.destroy === 'function') body.destroy();
      // Never include a URL, request headers, or access tokens in errors shown to admins.
      const networkCode = /^[A-Z][A-Z0-9_]{1,60}$/.test(error.code || '') ? error.code : undefined;
      reject(failure('Не удалось получить ответ API', { network: true, retryable: true, networkCode }));
    });
    if (body && typeof body.pipe === 'function') {
      body.on('error', (error) => req.destroy(error));
      body.pipe(req);
    } else req.end(body);
  });
}

function header(response, name) {
  const headers = response.headers || {};
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name.toLowerCase()] || headers[name];
}

function check(response, platform) {
  if (response.status >= 200 && response.status < 300 && !response.body?.error) return response;
  const code = response.body?.error?.code;
  const reason = response.body?.error?.errors?.[0]?.reason;
  const throttled = response.status === 429 || [4, 17, 32, 613].includes(code) || reason === 'rateLimitExceeded';
  const temporary = response.status >= 500 || response.body?.error?.is_transient === true;
  // Use codes only: upstream errors sometimes echo a secret or a signed media URL.
  throw failure(`${platform}: API отклонил запрос (HTTP ${response.status}${code ? ', код ' + code : ''}${reason ? ', ' + reason : ''})`, {
    status: response.status, code, retryable: throttled || temporary,
    retryAfter: Number(header(response, 'retry-after')) || undefined,
  });
}

function numericId(value, platform) {
  if (!/^\d+$/.test(String(value || ''))) throw failure(`${platform}: укажите числовой ID аккаунта`);
  return String(value);
}

function accountPayload(payload, key) {
  if (!payload || payload.account !== key) throw failure('Аккаунт изменился после предпросмотра');
}

module.exports = { hash, failure, approved, secureUrl, textWithLink, textWithByteLimit, store, transport, header, check, numericId, accountPayload };
