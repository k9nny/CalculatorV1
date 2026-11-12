'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, readConfig } = require('../server/server');
const { createIndexNow } = require('../server/seo');

const CARS = [
  { id: '120', status: 'available', publishedAt: '2026-11-01', make: 'Kia', model: 'Rio', year: 2019, price: 1390000, mileage: 74000,
    engine: { volume: 1.6, power: 123, fuel: 'Бензин' }, transmission: 'Автомат', photos: ['img/cars/120-1.jpg'], defects: ['Скол на капоте'],
    description: '<script>alert(1)</script>' },
  { id: '121', status: 'reserved', publishedAt: '2026-11-02', make: 'Toyota', model: 'Camry', year: 2018, price: 2450000, mileage: 98000, photos: [] },
  { id: '122', status: 'sold', make: 'Lada', model: 'Vesta', year: 2021, price: 980000, mileage: 45000 },
  { id: '101', demo: true, status: 'available', make: 'Kia', model: 'Rio', year: 2019, price: 1, mileage: 1 }
];

async function withServer(fn, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-seo-'));
  fs.writeFileSync(path.join(dir, 'cars.json'), JSON.stringify({ updated: '2026-11-02', cars: CARS }));
  const config = { ...readConfig({}), carsFile: path.join(dir, 'cars.json'), photosDir: path.join(dir, 'photos'), leadsLog: path.join(dir, 'private', 'leads.jsonl'), ...extra };
  const server = createApp(config, { sendTelegramMessage: async () => true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, dir, config); } finally { server.close(); }
}

const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test('seo: страница машины — заголовок, цена, разметка Car, экранирование', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/cars/120/', { headers: { 'X-Forwarded-Host': 'andoauto.ru', 'X-Forwarded-Proto': 'https' } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>Kia Rio 2019 с пробегом купить в Москве — 1[\s\u202f]390[\s\u202f]000 ₽/);
    assert.match(html, /<link rel="canonical" href="https:\/\/andoauto\.ru\/cars\/120\/">/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /Скол на капоте/);
    const car = ld(html).find((j) => j['@type'] === 'Car');
    assert.equal(car.offers.price, 1390000);
    assert.equal(car.offers.priceCurrency, 'RUB');
    assert.deepEqual(car.image, ['https://andoauto.ru/app/img/cars/120-1.jpg']);
    // На поддомене app. канонический адрес — всё равно основной домен.
    const viaApp = await (await fetch(base + '/cars/120/', { headers: { 'X-Forwarded-Host': 'app.andoauto.ru', 'X-Forwarded-Proto': 'https' } })).text();
    assert.match(viaApp, /canonical" href="https:\/\/andoauto\.ru\/cars\/120\/"/);
  });
});

test('seo: проданная — 410, несуществующая — 404, демо — noindex, без слеша — 301', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(base + '/cars/122/')).status, 410);
    assert.equal((await fetch(base + '/cars/999/')).status, 404);
    assert.match(await (await fetch(base + '/cars/101/')).text(), /<meta name="robots" content="noindex, follow">/);
    const r = await fetch(base + '/cars/120', { redirect: 'manual' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/cars/120/');
    assert.ok([400, 404].includes((await fetch(base + '/cars/%E0%A4%A/')).status));
  });
});

test('seo: список машин и карта сайта без проданных и демо', async () => {
  await withServer(async (base) => {
    const list = await (await fetch(base + '/cars/')).text();
    assert.match(list, /href="120\/"/);
    assert.match(list, /href="121\/"/);
    assert.doesNotMatch(list, /href="122\/"/);
    const xml = await (await fetch(base + '/sitemap.xml', { headers: { 'X-Forwarded-Host': 'andoauto.ru', 'X-Forwarded-Proto': 'https' } })).text();
    assert.match(xml, /<loc>https:\/\/andoauto\.ru\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/andoauto\.ru\/vykup-avto-posle-dtp\/<\/loc>/);
    assert.match(xml, /cars\/120\//);
    assert.doesNotMatch(xml, /cars\/122\//);
    assert.doesNotMatch(xml, /cars\/101\//);
  }, { siteUrl: '' });
});

test('seo: IndexNow отправляет только изменённые машины и ключ доступен по адресу', async () => {
  await withServer(async (base, dir, config) => {
    const sent = [];
    const inow = createIndexNow({ ...config, siteUrl: 'https://andoauto.ru' }, { post: async (url, body) => { sent.push(body); return 200; }, log: () => {} });
    assert.equal(await inow.check(), 200);
    assert.equal(sent[0].host, 'andoauto.ru');
    assert.equal(sent[0].keyLocation, 'https://andoauto.ru/cars/indexnow.txt');
    assert.ok(sent[0].urlList.includes('https://andoauto.ru/cars/120/'));
    assert.ok(!sent[0].urlList.some((u) => u.endsWith('/101/')), 'демо не отправляем');
    assert.equal(await inow.check(), null, 'без изменений — ничего не шлём');
    const cat = JSON.parse(fs.readFileSync(config.carsFile, 'utf8'));
    cat.cars[0].price = 1350000;
    fs.writeFileSync(config.carsFile, JSON.stringify(cat));
    await inow.check();
    assert.deepEqual(sent[1].urlList, ['https://andoauto.ru/cars/', 'https://andoauto.ru/cars/120/']);
    assert.equal(await (await fetch(base + '/cars/indexnow.txt')).text(), sent[0].key);
  });
});

test('seo: страницы услуг собраны, у каждой свои title, description и canonical', () => {
  const L = require('../server/site-layout');
  const seen = new Set();
  for (const p of L.PAGES) {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'ando-site', p.slug, 'index.html'), 'utf8');
    const title = /<title>([^<]+)<\/title>/.exec(html)[1];
    assert.ok(!seen.has(title), 'title повторяется: ' + title);
    seen.add(title);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://andoauto\\.ru/${p.slug}/">`));
    assert.match(html, /<meta name="description" content="[^"]{80,200}">/);
    assert.equal((html.match(/<h1/g) || []).length, 1);
    const types = ld(html).map((j) => j['@type']);
    assert.deepEqual(types, ['AutoDealer', 'Service', 'BreadcrumbList', 'FAQPage']);
    assert.match(html, /id="form-hero"/);
  }
});
