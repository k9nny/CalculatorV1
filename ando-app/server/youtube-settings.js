'use strict';

const crypto = require('node:crypto');
const { store, transport, check } = require('./social-platforms/common');

const SCOPES = ['youtube.upload', 'youtube.readonly'].map(name => 'https://www.googleapis.com/auth/' + name);
const CALLBACK = '/api/youtube/callback';

function createYouTubeSettings(config, { request = transport, now = Date.now } = {}) {
  const storage = store(config, 'youtube-settings', {});
  let pending;
  let latestState;

  function start(body, returnPath) {
    const clientId = String(body.clientId || '').trim();
    const clientSecret = String(body.clientSecret || '').trim();
    const channelId = String(body.channelId || '').trim();
    if (!/^[\w-]{5,160}\.apps\.googleusercontent\.com$/.test(clientId) || !/^[\w-]{10,200}$/.test(clientSecret)) {
      throw new Error('Проверьте Client ID и Client Secret веб-приложения Google.');
    }
    if (!/^UC[\w-]{22}$/.test(channelId)) throw new Error('Укажите ID канала YouTube вида UC…');
    const redirectUri = new URL(CALLBACK, config.siteUrl).href;
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    latestState = state;
    pending = { clientId, clientSecret, channelId, redirectUri, verifier, state, returnPath, expires: now() + 15 * 60000 };
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account', state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
  }

  async function finish(query) {
    if (!pending || pending.state !== query.get('state') || pending.expires < now()) {
      throw new Error('Ссылка для подключения устарела. Начните подключение заново в CRM.');
    }
    const attempt = pending;
    pending = undefined;
    const code = query.get('code');
    if (query.has('error') || !code) throw new Error('Вход в Google не завершён. Начните подключение заново в CRM.');
    const params = new URLSearchParams({ code, client_id: attempt.clientId, client_secret: attempt.clientSecret,
      code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, grant_type: 'authorization_code' });
    const token = check(await request({ url: 'https://oauth2.googleapis.com/token', method: 'POST', timeoutMs: 10000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }), 'YouTube OAuth').body;
    if (!token?.access_token || !token.refresh_token || !SCOPES.every(scope => String(token.scope || '').split(/\s+/).includes(scope))) {
      throw new Error('Google не подтвердил оба разрешения YouTube. Подключите канал заново и подтвердите доступы.');
    }
    const profile = check(await request({ url: 'https://www.googleapis.com/youtube/v3/channels?part=id%2Csnippet&mine=true',
      headers: { Authorization: 'Bearer ' + token.access_token }, timeoutMs: 10000 }), 'YouTube').body;
    const channel = profile?.items?.find(item => item.id === attempt.channelId);
    if (!channel) throw new Error('Выбран другой YouTube-канал. Вернитесь в CRM и выберите канал ANDO AUTO при входе.');
    if (latestState !== attempt.state) throw new Error('Начато другое подключение. Завершите последний вход из CRM.');
    storage.write({ youtubeClientId: attempt.clientId, youtubeClientSecret: attempt.clientSecret,
      youtubeRefreshToken: token.refresh_token, youtubeChannelId: channel.id,
      youtubeChannelTitle: String(channel.snippet?.title || channel.id) });
    return attempt.returnPath;
  }

  function status() {
    const state = storage.read();
    return state.youtubeRefreshToken ? { connected: true, channelId: state.youtubeChannelId, title: state.youtubeChannelTitle }
      : { connected: false };
  }

  function publisherConfig() {
    const state = storage.read();
    return state.youtubeRefreshToken ? { ...config, ...state, youtubePrivacyStatus: 'private' } : null;
  }

  return { start, finish, status, publisherConfig };
}

module.exports = { createYouTubeSettings, CALLBACK };
