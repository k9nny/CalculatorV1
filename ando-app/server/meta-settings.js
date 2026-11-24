'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { transport, check, numericId } = require('./social-platforms/common');

const platforms = {
  instagram: { label: 'Instagram', origin: 'https://graph.instagram.com', version: 'v27.0', fields: 'user_id,username', limit: 'content_publishing_limit' },
  threads: { label: 'Threads', origin: 'https://graph.threads.com', version: 'v1.0', fields: 'id,username', limit: 'threads_publishing_limit' }
};

function createMetaSettings(config, platform, { request = transport, now = () => new Date() } = {}) {
  const spec = platforms[platform];
  const file = path.join(path.dirname(config.leadsLog), platform + '.json');
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function status() {
    const state = read();
    return state ? { connected: true, username: state[platform + 'Username'], accountId: state[platform + 'UserId'],
      expiresAt: state[platform + 'TokenExpiresAt'], checkedAt: state.checkedAt } : { connected: false };
  }
  function publisherConfig() {
    const state = read();
    return state && { ...config, ...state, [platform + 'ApiVersion']: spec.version };
  }
  async function attach(raw, expiry) {
    const accessToken = String(raw || '').trim();
    if (!/^[\w.-]{16,4096}$/.test(accessToken)) throw new Error('Вставьте ' + spec.label + ' User Access Token.');
    let expiresAt = '';
    if (expiry) {
      const date = Date.parse(expiry);
      if (!Number.isFinite(date) || date <= now().getTime()) throw new Error('Укажите будущую дату истечения токена.');
      expiresAt = new Date(date).toISOString();
    }
    async function get(endpoint, fields) {
      const url = new URL(spec.origin + '/' + spec.version + '/' + endpoint);
      url.searchParams.set('fields', fields);
      return check(await request({ url: url.href, timeoutMs: 10000, headers: { Authorization: 'Bearer ' + accessToken } }), spec.label).body;
    }
    const profile = await get('me', spec.fields);
    const id = numericId(profile?.user_id || profile?.id, spec.label);
    if (!/^[\w.]{1,30}$/.test(profile?.username || '')) throw new Error(spec.label + ' не вернул имя профиля.');
    const quota = await get(id + '/' + spec.limit, 'quota_usage');
    if (!Array.isArray(quota?.data) || !quota.data.length) throw new Error(spec.label + ' не подтвердил доступ к публикациям.');
    const state = { [platform + 'UserId']: id, [platform + 'Username']: profile.username,
      [platform + 'AccessToken']: accessToken, [platform + 'TokenExpiresAt']: expiresAt, checkedAt: now().toISOString() };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return status();
  }
  return { status, attach, publisherConfig };
}

module.exports = { createMetaSettings };
