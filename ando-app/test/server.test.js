'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateInitData, signInitData } = require('../server/initdata');
const { validateLead, formatLeadMessage, normalizePhone } = require('../server/leads');
const { createApp, readConfig, createRateLimiter } = require('../server/server');

const TOKEN = '123456:TEST-token';
const CARS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'cars.json'), 'utf8')).cars;

function makeInitData(overrides = {}, token = TOKEN) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE-test',
    user: JSON.stringify({ id: 42, first_name: 'Андрей', username: 'andrey' }),
    ...overrides
  };
  fields.hash = signInitData(fields, token);
  return new URLSearchParams(fields).toString();
}

test('initData: верная подпись принимается', () => {
  const result = validateInitData(makeInitData(), TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.user.first_name, 'Андрей');
});

test('initData: подделка, чужой токен, просрочка и дубли отклоняются', () => {
  const good = makeInitData();
  assert.equal(validateInitData(good.replace('andrey', 'hacker'), TOKEN).reason, 'signature');
  assert.equal(validateInitData(makeInitData({}, 'other:token'), TOKEN).reason, 'signature');
  const old = makeInitData({ auth_date: String(Math.floor(Date.now() / 1000) - 2 * 86400) });
  assert.equal(validateInitData(old, TOKEN).reason, 'expired');
  assert.equal(validateInitData(good + '&auth_date=1', TOKEN).reason, 'malformed');
  assert.equal(validateInitData('', TOKEN).reason, 'missing');
});

test('телефон приводится к +7XXXXXXXXXX', () => {
  assert.equal(normalizePhone('8 (900) 123-45-67'), '+79001234567');
  assert.equal(normalizePhone('+7 900 123 45 67'), '+79001234567');
  assert.equal(normalizePhone('9001234567'), '+79001234567');
  assert.equal(normalizePhone('12345'), null);
});

test('заявка на машину: цена и название берутся из каталога, не из запроса', () => {
  const result = validateLead({ type: 'buy', carId: '102', phone: '89001234567', consent: true, name: 'Олег' }, CARS);
  assert.equal(result.ok, true);
  assert.equal(result.lead.car.title, 'Toyota Camry, 2018');
  assert.equal(result.lead.car.price, 2450000);
  assert.equal(validateLead({ type: 'buy', carId: 'nope', phone: '89001234567', consent: true }, CARS).ok, false);
  assert.equal(validateLead({ type: 'buy', phone: '89001234567', consent: false }, CARS).ok, false);
  assert.equal(validateLead({ type: 'spam', phone: '89001234567', consent: true }, CARS).ok, false);
});

test('заявка на выкуп: проверка полей машины', () => {
  const ok = validateLead({
    type: 'sell', phone: '+79001234567', consent: true,
    car: { make: 'Kia', model: 'Rio', year: 2016, mileage: 150000, condition: 'После ДТП', desiredPrice: 700000 }
  }, CARS);
  assert.equal(ok.ok, true);
  assert.equal(ok.lead.sellCar.condition, 'После ДТП');
  const bad = validateLead({ type: 'sell', phone: '+79001234567', consent: true, car: { make: 'Kia', model: 'Rio', year: 1800 } }, CARS);
  assert.equal(bad.ok, false);
});

test('сообщение менеджеру экранирует HTML', () => {
  const { lead } = validateLead({ type: 'callback', phone: '89001234567', consent: true, name: '<b>Хакер</b>' }, CARS);
  const text = formatLeadMessage(lead, { platform: 'web', verified: false, user: null });
  assert.match(text, /&lt;b&gt;Хакер&lt;\/b&gt;/);
  assert.match(text, /\+79001234567/);
});

test('ограничение частоты заявок', () => {
  const allow = createRateLimiter(2, 1000);
  assert.equal(allow('ip', 0), true);
  assert.equal(allow('ip', 10), true);
  assert.equal(allow('ip', 20), false);
  assert.equal(allow('ip', 2000), true);
});

async function withServer(env, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-'));
  const sent = [];
  const config = { ...readConfig({}), port: 0, leadsLog: path.join(dir, 'leads.jsonl'), ...env };
  const server = createApp(config, { sendTelegramMessage: async (token, chatId, text) => { sent.push({ chatId, text }); return true; } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, { sent, log: config.leadsLog });
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const post = (base, body, headers = {}) => fetch(base + '/api/lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body)
});

test('сервер: отдаёт приложение и не выпускает за пределы public', async () => {
  await withServer({}, async (base) => {
    const index = await fetch(base + '/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /ANDO/);
    const cars = await fetch(base + '/data/cars.json');
    assert.equal(cars.status, 200);
    for (const evil of ['/../server/server.js', '/%2e%2e/server/server.js', '/..%2fpackage.json', '/.env']) {
      assert.equal((await fetch(base + evil)).status, 404, evil);
    }
  });
});

test('сервер: каталог и фото из папки данных вне public', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-data-'));
  fs.mkdirSync(path.join(data, 'photos'));
  fs.writeFileSync(path.join(data, 'cars.json'), JSON.stringify({ cars: [{ id: '500' }] }));
  fs.writeFileSync(path.join(data, 'photos', '500-1.jpg'), 'jpg');
  fs.writeFileSync(path.join(data, 'secret.txt'), 'no');
  await withServer({ carsFile: path.join(data, 'cars.json'), photosDir: path.join(data, 'photos') }, async (base) => {
    assert.equal((await (await fetch(base + '/data/cars.json')).json()).cars[0].id, '500');
    const photo = await fetch(base + '/img/cars/500-1.jpg');
    assert.equal(photo.status, 200);
    assert.equal(await photo.text(), 'jpg');
    for (const evil of ['/img/cars/../secret.txt', '/img/cars/%2e%2e/secret.txt', '/img/cars/..%2fcars.json']) {
      assert.equal((await fetch(base + evil)).status, 404, evil);
    }
  });
});

test('сервер: заявка из Telegram с подписью уходит менеджеру и пишется в журнал', async () => {
  await withServer({ telegramToken: TOKEN, managerChatIds: ['111', '222'] }, async (base, { sent, log }) => {
    const res = await post(base, { type: 'buy', carId: '101', phone: '89001234567', consent: true, platform: 'telegram' },
      { 'X-Telegram-Init-Data': makeInitData() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, delivered: 2 });
    assert.equal(sent.length, 2);
    assert.match(sent[0].text, /Kia Rio, 2019/);
    assert.match(sent[0].text, /Telegram · Андрей @andrey/);
    const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim());
    assert.equal(entry.phone, '+79001234567');
    assert.equal(entry.source.verified, true);
  });
});

test('сервер: поддельная подпись — 401, ошибки полей — 400 с текстом', async () => {
  await withServer({ telegramToken: TOKEN, managerChatIds: ['111'] }, async (base, { sent }) => {
    const forged = await post(base, { type: 'buy', carId: '101', phone: '89001234567', consent: true },
      { 'X-Telegram-Init-Data': makeInitData({}, 'other:token') });
    assert.equal(forged.status, 401);
    const bad = await post(base, { type: 'callback', phone: '123', consent: true });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /телефон/i);
    assert.equal(sent.length, 0);
  });
});

test('сервер: REQUIRE_INIT_DATA не пускает заявки без подписи', async () => {
  await withServer({ requireInitData: true }, async (base) => {
    const res = await post(base, { type: 'callback', phone: '89001234567', consent: true });
    assert.equal(res.status, 401);
  });
});
