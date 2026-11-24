'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { transport, check, numericId } = require('./social-platforms/common');

const API_VERSION = 'v27.0';

function createInstagramSettings(config, { request = transport, now = () => new Date() } = {}) {
  const file = path.join(path.dirname(config.leadsLog), 'instagram.json');
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function status() {
    const state = read();
    return state ? { connected: true, username: state.instagramUsername, accountId: state.instagramUserId,
      expiresAt: state.instagramTokenExpiresAt, checkedAt: state.checkedAt } : { connected: false };
  }
  function publisherConfig() {
    const state = read();
    return state && { ...config, ...state, instagramApiVersion: API_VERSION };
  }
  async function attach(raw, expiry) {
    const accessToken = String(raw || '').trim();
    if (!/^[\w.-]{16,4096}$/.test(accessToken)) throw new Error('Вставьте Instagram User Access Token.');
    let expiresAt = '';
    if (expiry) {
      const date = Date.parse(expiry);
      if (!Number.isFinite(date) || date <= now().getTime()) throw new Error('Укажите будущую дату истечения токена.');
      expiresAt = new Date(date).toISOString();
    }
    async function get(endpoint, fields) {
      const url = new URL('https://graph.instagram.com/' + API_VERSION + '/' + endpoint);
      url.searchParams.set('fields', fields);
      return check(await request({ url: url.href, timeoutMs: 10000, headers: { Authorization: 'Bearer ' + accessToken } }), 'Instagram').body;
    }
    const profile = await get('me', 'user_id,username');
    const id = numericId(profile?.user_id || profile?.id, 'Instagram');
    if (!/^[\w.]{1,30}$/.test(profile?.username || '')) throw new Error('Instagram не вернул имя профиля.');
    const quota = await get(id + '/content_publishing_limit', 'quota_usage');
    if (!Array.isArray(quota?.data) || !quota.data.length) throw new Error('Instagram не подтвердил доступ к публикациям.');
    const state = { instagramUserId: id, instagramUsername: profile.username,
      instagramAccessToken: accessToken, instagramTokenExpiresAt: expiresAt, checkedAt: now().toISOString() };
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

module.exports = { createInstagramSettings };
