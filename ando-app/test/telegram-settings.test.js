'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, readConfig } = require('../server/server');
const tg = require('../server/telegram-settings');
const { setPassword, stateFile } = require('../server/admin-cli');

const TOKEN = '123456789:AAHtest-token_abcdefghijklmnopqrstu';

test('админка: Telegram подключается с телефона — проверка через посредника, сохранение, перезапуск', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-tg-'));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'cars.json'), JSON.stringify({ cars: [] }));
  const config = { ...readConfig({}), carsFile: path.join(dir, 'cars.json'), photosDir: path.join(dir, 'photos'), leadsLog: path.join(dir, 'private', 'leads.jsonl') };
  const slug = setPassword(stateFile({ LEADS_LOG: config.leadsLog }), 'correct-horse-42');
  const calls = [];
  let restarted = 0;
  const telegram = { ...tg, getMe: async (base, token) => { calls.push([base, token]); return token === TOKEN ? { ok: true, username: 'andoavtobot' } : { ok: false, error: 'Telegram не знает такой токен.' }; } };
  const server = createApp(config, { telegram, restart: () => { restarted++; } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/${slug}/api/`;
  try {
    const login = await fetch(base + 'login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-42' }) });
    const h = { Origin: origin, Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    const post = (b) => fetch(base + 'telegram', { method: 'POST', headers: h, body: JSON.stringify(b) });
    assert.equal((await post({ apiBase: 'http://x.workers.dev', token: TOKEN, ids: '1234567' })).status, 400, 'только https');
    assert.equal((await post({ apiBase: 'https://ando-tg.me.workers.dev', token: 'nope', ids: '1234567' })).status, 400);
    assert.equal((await post({ apiBase: 'https://ando-tg.me.workers.dev', token: TOKEN, ids: 'Вася' })).status, 400);
    const wrong = await post({ apiBase: 'https://ando-tg.me.workers.dev', token: '123456789:BBBwrong-token_abcdefghijklmnopqrs', ids: '1234567' });
    assert.equal(wrong.status, 400);
    assert.equal(restarted, 0);
    const ok = await (await post({ apiBase: 'https://ando-tg.me.workers.dev/', token: ` ${TOKEN} `, ids: '1234567, 7654321' })).json();
    assert.equal(ok.bot, 'andoavtobot');
    assert.equal(restarted, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'private', 'telegram.json'), 'utf8'));
    assert.deepEqual(saved.adminIds, ['1234567', '7654321']);
    assert.equal(saved.apiBase, 'https://ando-tg.me.workers.dev');
    assert.equal(fs.statSync(path.join(dir, 'private', 'telegram.json')).mode & 0o777, 0o600);
    const st = await (await fetch(base + 'telegram', { headers: h })).json();
    assert.equal(st.bot, 'andoavtobot');
    assert.equal(JSON.stringify(st).includes(TOKEN), false, 'токен наружу не отдаётся');
    // Повторно без токена — берётся сохранённый.
    assert.equal((await post({ apiBase: 'https://ando-tg.me.workers.dev', ids: '1234567' })).status, 200);
    assert.equal(calls.at(-1)[1], TOKEN);
    // Без входа — нельзя.
    assert.equal((await fetch(base + 'telegram', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    // При запуске сервера сохранённое применяется.
    const env = {};
    const applied = tg.apply({ ...config, telegramToken: '', adminIds: [] }, env);
    assert.equal(applied.telegramToken, TOKEN);
    assert.equal(env.TELEGRAM_API_BASE, 'https://ando-tg.me.workers.dev');
    assert.equal(applied.appLink, 'https://t.me/andoavtobot/cars');
  } finally { server.close(); }
});
