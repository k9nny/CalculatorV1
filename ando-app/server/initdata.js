'use strict';
// Проверка initData мини-приложения. Схема одна у Telegram и MAX:
// secret = HMAC_SHA256(key = "WebAppData", data = токен бота),
// hash   = HMAC_SHA256(key = secret, data = поля кроме hash, отсортированные, "key=value" через \n).
const crypto = require('node:crypto');

const DEFAULT_MAX_AGE_SEC = 24 * 60 * 60;
const CLOCK_SKEW_SEC = 300;

function decode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parsePairs(raw) {
  const pairs = [];
  for (const part of raw.split('&')) {
    if (!part) continue;
    const at = part.indexOf('=');
    pairs.push(at === -1 ? [decode(part), ''] : [decode(part.slice(0, at)), decode(part.slice(at + 1))]);
  }
  return pairs;
}

function signInitData(fields, botToken) {
  const check = Object.keys(fields).filter((k) => k !== 'hash').sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  return crypto.createHmac('sha256', secret).update(check).digest('hex');
}

function validateInitData(raw, botToken, { maxAgeSec = DEFAULT_MAX_AGE_SEC, now = Date.now() } = {}) {
  if (typeof raw !== 'string' || !raw || raw.length > 8192) return { ok: false, reason: 'missing' };
  if (!botToken) return { ok: false, reason: 'no-token' };

  const pairs = parsePairs(raw);
  const keys = pairs.map(([key]) => key);
  if (new Set(keys).size !== keys.length) return { ok: false, reason: 'malformed' };
  const fields = Object.fromEntries(pairs);
  if (!/^[0-9a-f]{64}$/i.test(fields.hash || '')) return { ok: false, reason: 'malformed' };

  const expected = Buffer.from(signInitData(fields, botToken), 'hex');
  const given = Buffer.from(fields.hash.toLowerCase(), 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'signature' };
  }

  const authDate = Number(fields.auth_date);
  if (!Number.isInteger(authDate)) return { ok: false, reason: 'malformed' };
  const nowSec = Math.floor(now / 1000);
  if (maxAgeSec && nowSec - authDate > maxAgeSec) return { ok: false, reason: 'expired' };
  if (authDate - nowSec > CLOCK_SKEW_SEC) return { ok: false, reason: 'malformed' };

  let user = null;
  try {
    user = fields.user ? JSON.parse(fields.user) : null;
  } catch {
    user = null;
  }
  return { ok: true, user, startParam: fields.start_param || null, authDate };
}

module.exports = { validateInitData, signInitData, parsePairs };
