'use strict';

const { hash, store, transport, check, failure } = require('./common');
const DAY = 86400000;
const inflight = new Map();

function createMetaToken(config, platform, opts = {}) {
  const request = opts.transport || transport;
  const now = opts.now || (() => new Date());
  const original = String(config[platform + 'AccessToken'] || '');
  const identity = { account: config[platform + 'UserId'], token: hash(original) };
  const cache = store(config, platform + '-token', identity);
  const origin = platform === 'instagram' ? 'https://graph.instagram.com' : 'https://graph.threads.com';

  async function refresh() {
    const time = now().getTime();
    const saved = cache.read();
    const configuredExpiry = config[platform + 'TokenExpiresAt'];
    const state = saved.accessToken ? saved : {
      accessToken: original,
      expiresAt: configuredExpiry || null,
      // A supplied long-lived token normally lives for 60 days. Its expiry
      // lets us refresh an old token immediately after installing the adapter.
      refreshedAt: configuredExpiry && Number.isFinite(Date.parse(configuredExpiry))
        ? new Date(Date.parse(configuredExpiry) - 60 * DAY).toISOString() : now().toISOString(),
    };
    if (!state.accessToken) throw failure(`${platform}: подключите аккаунт`);
    const expiresAt = state.expiresAt ? Date.parse(state.expiresAt) : null;
    if (state.expiresAt && !Number.isFinite(expiresAt)) throw failure(`${platform}: неверная дата истечения токена`);
    if (expiresAt && expiresAt <= time) throw failure(`${platform}: токен истёк, подключите аккаунт заново`);
    if (!saved.accessToken) cache.write(state);
    const oldEnough = time - Date.parse(state.refreshedAt) >= DAY;
    const due = expiresAt ? expiresAt - time < 7 * DAY : oldEnough;
    if (!oldEnough || !due) return state.accessToken;
    const url = new URL('/refresh_access_token', origin);
    url.searchParams.set('grant_type', platform === 'instagram' ? 'ig_refresh_token' : 'th_refresh_token');
    url.searchParams.set('access_token', state.accessToken);
    const response = check(await request({ url: url.href }), platform);
    const token = response.body;
    if (!token?.access_token || !(Number(token.expires_in) > 0)) throw failure(`${platform}: не удалось обновить токен`);
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

module.exports = { createMetaToken };
