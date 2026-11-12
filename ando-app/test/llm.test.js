'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSmartParser, clean, redact, isEdit } = require('../server/llm');
const { listingText } = require('../server/listing-text');
const { createBot } = require('../server/bot');
const { createApp, readConfig } = require('../server/server');

const CFG = { baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'kimi-k3' };
const reply = (obj) => ({ choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] });
const quiet = { log: () => {} };

test('llm: телефоны, почта, ссылки и ники вырезаются до отправки', () => {
  const r = redact('Продаю, звоните +7 (900) 123-45-67 или 89001234567, почта a.b@mail.ru, t.me/seller, @seller_one');
  assert.doesNotMatch(r, /123-45-67|89001234567|mail\.ru|t\.me|seller_one/);
});

test('llm: сленговое объявление → поля; выдуманное и мусор отбрасываются', async () => {
  const sent = [];
  const post = async (url, body) => {
    sent.push(body);
    return reply({ make: 'Mercedes-Benz', model: 'E-Class', year: 2017, price: 2650000, mileage: 98000, volume: 2, power: 184, fuel: 'бензин',
      drive: 'Полный', owners: 2, transmission: 'Коробка-автомат', vin: 'WDD2130421A123456', color: 'чёрный',
      description: 'Обслуживалась у дилера, звонить [телефон].', accidents: 0, tags: ['Торг', 'Срочно'] });
  };
  const p = createSmartParser(CFG, { post, ...quiet });
  const text = 'мерс ешка 17г 2.0 бенз 184лс полный 98т.км 2 хоз цена 2 млн 650 торг тел 89001234567';
  const f = await p.parse(text);
  assert.equal(sent[0].model, 'kimi-k3');
  assert.equal(sent[0].temperature, 0);
  assert.doesNotMatch(JSON.stringify(sent[0].messages), /89001234567/);
  assert.equal(f.make, 'Mercedes-Benz');
  assert.equal(f.model, 'E-Класс');
  assert.equal(f.price, 2650000);
  assert.equal(f.mileage, 98000);
  assert.equal(f.fuel, 'Бензин');
  assert.equal(f.drive, 'Полный');
  assert.equal(f.transmission, undefined, 'значение не из списка отбрасывается');
  assert.equal(f.vin, undefined, 'VIN, которого нет в тексте, не берём');
  assert.equal(f.description, undefined, 'описание с контактами не берём');
  assert.deepEqual(f.tags, ['Торг']);
  assert.equal(f.history.accidents, 0);
  // Тот же текст второй раз — из кэша, без нового запроса.
  await p.parse(text);
  assert.equal(sent.length, 1);
});

test('llm: числа вне разумных пределов не принимаются, «цена:» из текста важнее', async () => {
  const p = createSmartParser(CFG, { post: async () => reply({ make: 'Kia', model: 'Rio', year: 2099, price: 13, mileage: -5 }), ...quiet });
  const f = await p.parse('Kia Rio 2019, пробег 74 000\nЦена: 1 390 000');
  assert.equal(f.year, 2019);
  assert.equal(f.price, 1390000);
  assert.equal(f.mileage, 74000);
  assert.deepEqual(clean({ year: '2019', price: '1390000' }, ''), { year: 2019, price: 1390000 });
});

test('llm: нет связи или не JSON — обычный разбор; короткая правка — без нейросети', async () => {
  let calls = 0;
  const down = createSmartParser(CFG, { post: async () => { calls++; throw new Error('timeout'); }, ...quiet });
  const f = await down.parse('Kia Rio 2019\nЦена 1 390 000\nПробег 74 000');
  assert.equal(f.make, 'Kia');
  assert.equal(f.price, 1390000);
  const junk = createSmartParser(CFG, { post: async () => reply('не знаю'), ...quiet });
  assert.equal((await junk.parse('Kia Rio 2019\nЦена 1 390 000\nПробег 74 000')).model, 'Rio');
  calls = 0;
  assert.ok(isEdit('цена 1 350 000'));
  assert.equal((await down.parse('цена 1 350 000')).price, 1350000);
  assert.equal(calls, 0);
  // Без ключа нейросеть не вызывается вовсе.
  const off = createSmartParser({}, { post: async () => { throw new Error('не должно'); }, ...quiet });
  assert.equal(off.enabled, false);
  assert.equal((await off.parse('Kia Rio 2019\nЦена 1 390 000\nПробег 74 000')).make, 'Kia');
});

test('llm: температура не поддерживается — повтор без неё', async () => {
  const bodies = [];
  const p = createSmartParser(CFG, { post: async (u, b) => { bodies.push(b); if ('temperature' in b) throw new Error('HTTP 400: invalid temperature'); return reply({ make: 'Kia' }); }, ...quiet });
  assert.equal((await p.parse('Kia Rio 2019 года, хорошая машина, пробег 74 тыс')).make, 'Kia');
  assert.equal(bodies.length, 2);
  assert.equal('temperature' in bodies[1], false);
});

test('llm: по фото только марка, модель, поколение, кузов, цвет — и только чего нет в тексте', async () => {
  const p = createSmartParser(CFG, { post: async (u, b) => {
    assert.match(b.messages[0].content[0].image_url.url, /^data:image\/jpeg;base64,/);
    return reply({ make: 'Toyota', model: 'Camry', generation: 'XV70', body: 'Седан', color: 'Белый', price: 5, mileage: 1 });
  }, ...quiet });
  const img = Buffer.from([0xFF, 0xD8, 0xFF, 1, 2, 3]);
  assert.deepEqual(await p.fillFromPhoto({ price: 2000000 }, img), { price: 2000000, make: 'Toyota', model: 'Camry', generation: 'XV70', body: 'Седан', color: 'Белый' });
  // Цвет в тексте — остаётся; марка в тексте другая — модель с фото не берём.
  assert.deepEqual(await p.fillFromPhoto({ make: 'Kia', color: 'Синий' }, img), { make: 'Kia', color: 'Синий', body: 'Седан' });
  const novision = createSmartParser({ ...CFG, vision: false }, { post: async () => { throw new Error('не должно'); }, ...quiet });
  assert.deepEqual(await novision.fillFromPhoto({ price: 1 }, img), { price: 1 });
});

test('шаблон объявления: одинаковые разделы, заголовок как на Авито, только данные из карточки', () => {
  const a = listingText({ make: 'Kia', model: 'Rio', year: 2019, price: 1390000, mileage: 74000, transmission: 'Автомат', engine: { volume: 1.6 }, defects: [] });
  const b = listingText({ make: 'Lada', model: 'Vesta', year: 2021, price: 980000, mileage: 45000, transmission: 'Механика', drive: 'Полный', defects: ['Скол на капоте'], tags: ['Торг'] });
  assert.match(a, /^Kia Rio 1\.6 AT, 2019, 74 000 км\n\nЦена: 1 390 000 ₽\.\n\nОсновное\n• Год выпуска: 2019\n• Пробег: 74 000 км/);
  assert.match(b, /^Lada Vesta MT 4WD, 2021, 45 000 км\n\nЦена: 980 000 ₽\. Торг при осмотре\./);
  for (const t of [a, b]) {
    assert.match(t, /Продаёт компания ANDO AUTO, договор купли-продажи\./);
    assert.match(t, /\+7 \(928\) 333-95-70/);
    assert.doesNotMatch(t, /undefined|null|NaN|!|срочно|идеал/i);
  }
  assert.doesNotMatch(a, /Известные недостатки/, 'нет недостатков — раздела нет');
  assert.match(b, /Известные недостатки\n• Скол на капоте\./);
  assert.doesNotMatch(a, /Документы и история|Владельцев|Комплектация/, 'чего нет в карточке — того нет в тексте');
  // Для Авито: без цены и контактов в описании.
  const m = listingText({ make: 'Kia', model: 'Rio', year: 2019, price: 1390000, mileage: 74000 }, { mode: 'market', link: 'https://x' });
  assert.doesNotMatch(m, /1 390 000|\+7|https/);
  assert.match(m, /Напишите в чат или позвоните/);
});

test('бот: объявление разбирает нейросеть, недостающее берётся с фото', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-llm-bot-'));
  const carsFile = path.join(dir, 'cars.json');
  fs.writeFileSync(carsFile, JSON.stringify({ cars: [] }));
  const sent = [];
  const api = {
    request: async (method, p) => { if (method === 'getFile') return { file_path: 'photos/a.jpg' }; if (method === 'sendMessage') sent.push(p.text); return { message_id: 1 }; },
    download: async () => Buffer.from([0xFF, 0xD8, 0xFF, 0])
  };
  const parser = createSmartParser(CFG, { post: async (u, b) => {
    if (Array.isArray(b.messages[0].content)) return reply({ make: 'Hyundai', model: 'Solaris', body: 'Седан', color: 'Серый' });
    return reply({ year: 2018, price: 1150000, mileage: 120000, transmission: 'Автомат' });
  }, ...quiet });
  const bot = createBot({ api, adminIds: ['7'], carsFile, photosDir: path.join(dir, 'img'), debounceMs: 0, parser });
  await bot.handleUpdate({ message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, photo: [{ file_id: 'p1' }],
    caption: 'продаю срочно, 18 год, 120т.км, автомат, отдам за лям сто пятьдесят' } });
  const preview = sent.at(-1);
  assert.match(preview, /Hyundai Solaris, 2018/);
  assert.match(preview, /По фото определил: марка, модель, кузов, цвет/);
  assert.match(preview, /Всё нужное есть/);
  assert.doesNotMatch(preview, /продаю срочно|лям/i, 'сырые слова продавца в карточку не попадают');
});

test('админка: разбор с фото и готовый текст объявления', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-llm-admin-'));
  fs.mkdirSync(path.join(dir, 'photos'));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'cars.json'), JSON.stringify({ cars: [] }));
  const config = { ...readConfig({}), carsFile: path.join(dir, 'cars.json'), photosDir: path.join(dir, 'photos'), leadsLog: path.join(dir, 'private', 'leads.jsonl'), siteUrl: 'https://andoauto.ru' };
  const { setPassword, stateFile } = require('../server/admin-cli');
  const slug = setPassword(stateFile({ LEADS_LOG: config.leadsLog }), 'correct-horse-42');
  let photoCalls = 0;
  const parser = createSmartParser(CFG, { post: async (u, b) => {
    if (Array.isArray(b.messages[0].content)) { photoCalls++; return reply({ make: 'Lada', model: 'Vesta', color: 'Белый' }); }
    return reply({ year: 2021, price: 980000, mileage: 45000 });
  }, ...quiet });
  const server = createApp(config, { parser });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/${slug}/api/`;
  try {
    const login = await fetch(base + 'login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-42' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const h = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' };
    const up = await (await fetch(base + 'photo', { method: 'POST', headers: { ...h, 'Content-Type': 'image/jpeg' }, body: Buffer.from([0xFF, 0xD8, 0xFF, 0, 1]) })).json();
    const text = '21 год, 45 тыщ пробега, белая, хочу 980';
    const parsed = await (await fetch(base + 'parse', { method: 'POST', headers: h, body: JSON.stringify({ text, photos: [up.name] }) })).json();
    assert.equal(parsed.car.make, 'Lada');
    assert.deepEqual(parsed.fromPhoto, ['make', 'model', 'color']);
    assert.deepEqual(parsed.missing, []);
    // Повторный разбор того же фото — без нового запроса к нейросети.
    await fetch(base + 'parse', { method: 'POST', headers: h, body: JSON.stringify({ text: text + ' ', photos: [up.name] }) });
    assert.equal(photoCalls, 1);
    const { car } = await (await fetch(base + 'cars', { method: 'POST', headers: h, body: JSON.stringify({ text, photos: [up.name] }) })).json();
    assert.equal(car.model, 'Vesta');
    const t = await (await fetch(base + `cars/${car.id}/text`, { headers: h })).json();
    assert.match(t.text, /^Lada Vesta, 2021, 45 000 км\n\nЦена: 980 000 ₽/);
    assert.match(t.text, /https:\/\/andoauto\.ru\/cars\/\d+\//);
    const mk = await (await fetch(base + `cars/${car.id}/text?mode=market`, { headers: h })).json();
    assert.doesNotMatch(mk.text, /980 000|andoauto\.ru/);
  } finally { server.close(); }
});

test('админка: ключ Kimi вставляется в настройках, проверяется и сразу включает разбор', async () => {
  const { createLlmStore } = require('../server/llm');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-llm-key-'));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'cars.json'), JSON.stringify({ cars: [] }));
  const config = { ...readConfig({}), carsFile: path.join(dir, 'cars.json'), photosDir: path.join(dir, 'photos'), leadsLog: path.join(dir, 'private', 'leads.jsonl') };
  const { setPassword, stateFile } = require('../server/admin-cli');
  const slug = setPassword(stateFile({ LEADS_LOG: config.leadsLog }), 'correct-horse-42');
  const store = createLlmStore(path.join(dir, 'private'), {});
  const mockPost = async (u, b, h) => {
    assert.equal(h.Authorization, 'Bearer sk-good-key-1234567890');
    if (Array.isArray(b.messages[0].content)) return reply({});
    return reply({ make: 'Mercedes-Benz', model: 'E-Class', year: 2017, price: 2650000, mileage: 98000 });
  };
  const deps = {
    llmStore: store,
    parser: createSmartParser(() => store.get(), { post: mockPost, ...quiet }),
    makeParser: (c) => createSmartParser(c, { post: mockPost, ...quiet }),
    discover: async (key) => key === 'sk-good-key-1234567890'
      ? { ok: true, baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', models: ['kimi-k2', 'kimi-k3'] }
      : { ok: false, error: 'Kimi не принял ключ.' }
  };
  const server = createApp(config, deps);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/${slug}/api/`;
  try {
    const login = await fetch(base + 'login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-42' }) });
    const h = { Origin: origin, Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    assert.equal((await (await fetch(base + 'llm', { headers: h })).json()).enabled, false);
    const bad = await fetch(base + 'llm', { method: 'POST', headers: h, body: JSON.stringify({ key: 'sk-wrong-key-000000000' }) });
    assert.equal(bad.status, 400);
    const ok = await (await fetch(base + 'llm', { method: 'POST', headers: h, body: JSON.stringify({ key: ' sk-good-key-1234567890 \n' }) })).json();
    assert.equal(ok.model, 'kimi-k3');
    assert.equal(ok.sample.make, 'Mercedes-Benz');
    assert.equal(ok.keyEnd, '…7890');
    const st = await (await fetch(base + 'llm', { headers: h })).json();
    assert.equal(st.enabled, true);
    assert.equal(JSON.stringify(st).includes('sk-good'), false, 'ключ целиком наружу не отдаётся');
    assert.equal(fs.statSync(path.join(dir, 'private', 'llm.json')).mode & 0o777, 0o600);
    // Разбор сразу идёт через нейросеть, без перезапуска.
    const parsed = await (await fetch(base + 'parse', { method: 'POST', headers: h, body: JSON.stringify({ text: 'мерс ешка 17г 98т.км 2 млн 650 торг, полный, бенз' }) })).json();
    assert.equal(parsed.car.model, 'E-Класс');
    await fetch(base + 'llm', { method: 'DELETE', headers: h });
    assert.equal((await (await fetch(base + 'llm', { headers: h })).json()).enabled, false);
  } finally { server.close(); }
});

test('llm: поиск адреса по ключу — Moonshot, kimi.com, OpenRouter, свой адрес; понятная причина отказа', async () => {
  const { discover, basesFor } = require('../server/llm');
  const asked = [];
  const get = async (url) => {
    asked.push(url);
    if (url.startsWith('https://api.kimi.com/')) return { status: 200, body: { data: [{ id: 'kimi-for-coding' }, { id: 'kimi-k3' }] } };
    return { status: 401, body: { error: 'invalid' } };
  };
  const r = await discover('sk-abc', { get });
  assert.equal(r.ok, true);
  assert.equal(r.baseUrl, 'https://api.kimi.com/coding/v1');
  assert.equal(r.model, 'kimi-k3');
  assert.equal(asked.length, 3);
  assert.deepEqual(basesFor('sk-or-v1-xyz'), ['https://openrouter.ai/api/v1']);
  assert.deepEqual(basesFor('k', 'https://api.vsegpt.ru/v1/chat/completions'), ['https://api.vsegpt.ru/v1']);
  const bad = await discover('sk-bad', { get: async () => ({ status: 401, body: {} }) });
  assert.equal(bad.ok, false);
  assert.match(bad.details.join('\n'), /Moonshot: ключ не подходит \(401\)/);
  const down = await discover('sk-x', { get: async () => { throw new Error('timeout'); } });
  assert.match(down.error, /не может связаться/);
});

test('llm: сторонний адрес без списка моделей — модель из поля или kimi-k3', async () => {
  const { discover } = require('../server/llm');
  const r = await discover('sk-x', { base: 'https://1-2-3-4.sslip.io/v1/', get: async () => ({ status: 404, body: null }) });
  assert.deepEqual(r, { ok: true, baseUrl: 'https://1-2-3-4.sslip.io/v1', model: 'kimi-k3', models: [] });
  const named = await discover('sk-x', { base: 'https://1-2-3-4.sslip.io/v1', model: 'kimi-k3-preview', get: async () => ({ status: 404, body: null }) });
  assert.equal(named.model, 'kimi-k3-preview');
  const denied = await discover('sk-x', { base: 'https://1-2-3-4.sslip.io/v1', get: async () => ({ status: 401, body: {} }) });
  assert.equal(denied.ok, false);
});

test('цена и пробег «как пишут»: 500 рублей — 500 000, 1.5 — 1,5 млн, пробег 120 — 120 000 км', async () => {
  const { parseListing } = require('../server/listing-parser');
  const cases = { 'цена 500 рублей': 500000, 'цена 500р': 500000, 'Цена: 500': 500000, 'цена 1.5': 1500000, 'цена 2,65': 2650000,
    'цена 1390': 1390000, 'цена 1 390 000': 1390000, 'цена 1.390.000': 1390000, 'цена 650 тыс': 650000, 'цена 1,39 млн': 1390000 };
  for (const [t, v] of Object.entries(cases)) assert.equal(parseListing(t).price, v, t);
  assert.equal(parseListing('Kia Rio 2019\nпробег 120\nцена 500').mileage, 120000);
  assert.equal(parseListing('Kia Rio 2019\nналог 5000 руб').price, undefined, 'налог — не цена');
  // Нейросеть вернула «500» — это тоже 500 000.
  assert.equal(clean({ price: 500, mileage: 120 }, '').price, 500000);
  assert.equal(clean({ price: 500, mileage: 120 }, '').mileage, 120000);
  assert.equal(clean({ price: 1.5 }, '').price, 1500000);
});

test('настоящие тексты продавцов: цена, год, пробег, ключи без нейросети; «полная комплектация» — не привод', () => {
  const { parseListing } = require('../server/listing-parser');
  const a = parseListing('2017 год \n130 пробег \n1хоз\nДва комплекта колес\nПодкрасы\nНиз водительской\nдвери \nниз крышки багажника \n900к');
  assert.equal(a.year, 2017); assert.equal(a.mileage, 130000); assert.equal(a.owners, 1); assert.equal(a.price, 900000);
  const b = parseListing('2021 год \n1.6 автомат \n2 элемента кручены, по толщику вся в родне \nХоз я \n2 ключа \n1🍋');
  assert.equal(b.price, 1000000); assert.equal(b.keys, 2); assert.equal(b.transmission, 'Автомат'); assert.equal(b.volume, 1.6);
  const c = parseListing('2010 год \n1.6 автомат \nПолная комплектация \n3 окраса \nХозяин \nБесключевой доступ,складывание зеркал, климат\n550₽');
  assert.equal(c.price, 550000); assert.equal(c.drive, undefined); assert.equal(c.year, 2010);
  assert.equal(parseListing('цена 1.2кк').price, 1200000);
  assert.equal(parseListing('полный привод').drive, 'Полный');
});
