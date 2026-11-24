'use strict';

const { hash, store, transport, check, failure } = require('./common');
const DAY = 86400000;
const inflight = new Map();

function createInstagramToken(config, opts = {}) {
  const request = opts.transport || transport;
  const now = opts.now || (() => new Date());
  const original = String(config.instagramAccessToken || '');
  const identity = { account: config.instagramUserId, token: hash(original) };
  const cache = store(config, 'instagram-token', identity);
  const origin = 'https://graph.instagram.com';

  async function refresh() {
    const time = now().getTime();
    const saved = cache.read();
    const configuredExpiry = config.instagramTokenExpiresAt;
    const state = saved.accessToken ? saved : {
      accessToken: original,
      expiresAt: configuredExpiry || null,
      // A supplied long-lived token normally lives for 60 days. Its expiry
      // lets us refresh an old token immediately after installing the adapter.
      refreshedAt: configuredExpiry && Number.isFinite(Date.parse(configuredExpiry))
        ? new Date(Date.parse(configuredExpiry) - 60 * DAY).toISOString() : now().toISOString(),
    };
    if (!state.accessToken) throw failure(`Instagram: подключите аккаунт`);
    const expiresAt = state.expiresAt ? Date.parse(state.expiresAt) : null;
    if (state.expiresAt && !Number.isFinite(expiresAt)) throw failure(`Instagram: неверная дата истечения токена`);
    if (expiresAt && expiresAt <= time) throw failure(`Instagram: токен истёк, подключите аккаунт заново`);
    if (!saved.accessToken) cache.write(state);
    const oldEnough = time - Date.parse(state.refreshedAt) >= DAY;
    const due = expiresAt ? expiresAt - time < 7 * DAY : oldEnough;
    if (!oldEnough || !due) return state.accessToken;
    const url = new URL('/refresh_access_token', origin);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', state.accessToken);
    const response = check(await request({ url: url.href, timeoutMs: 15000 }), 'Instagram');
    const token = response.body;
    if (!token?.access_token || !(Number(token.expires_in) > 0)) throw failure(`Instagram: не удалось обновить токен`);
    cache.write({ accessToken: token.access_token,
      expiresAt: new Date(time + Number(token.expires_in) * 1000).toISOString(), refreshedAt: now().toISOString() });
    return token.access_token;
  }
  return {
    get() {
      if (!inflight.has(cache.file)) inflight.set(cache.file, refresh().finally(() => inflight.delete(cache.file)));
      return inflight.get(cache.file);
    }
  };
}

module.exports = { createInstagramToken };
