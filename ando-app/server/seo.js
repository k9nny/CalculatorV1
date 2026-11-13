'use strict';
// Страницы для поисковиков из того же каталога, что видят приложение и бот:
//   /cars/          — машины в продаже
//   /cars/101/      — страница машины (продана — 410, чтобы поисковики убрали её из выдачи)
//   /sitemap.xml    — главная, услуги, машины
// IndexNow: при каждом изменении каталога сообщает Яндексу и Bing, какие страницы машин обновить.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const L = require('./site-layout');
const { readCatalog } = require('./catalog');

const esc = L.esc;
const num = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/[   ]/g, ' ');
const rub = (n) => num(n) + ' ₽';
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};
const title = (c) => `${c.make} ${c.model}${c.generation ? ' ' + c.generation : ''}, ${c.year}`;
const visible = (c) => c && c.id != null && c.status !== 'sold';

function siteBase(req, config) {
  if (config.siteUrl) return config.siteUrl.replace(/\/?$/, '/');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim().replace(/^(app|www)\./, '');
  const proto = req.headers['x-forwarded-proto'] === 'https' || config.trustProxy ? 'https' : 'http';
  return `${proto}://${host}/`;
}

function photoUrl(site, src) {
  if (/^https?:/.test(src)) return src;
  return site + 'app/' + String(src).replace(/^\/+/, '');
}

function specs(c) {
  const e = c.engine || {};
  const h = c.history || {};
  const rows = [
    ['Год выпуска', c.year],
    ['Пробег', c.mileage != null ? num(c.mileage) + ' км' : ''],
    ['Двигатель', [e.volume ? Number(e.volume).toFixed(1) + ' л' : '', e.power ? e.power + ' л.с.' : '', e.fuel ? String(e.fuel).toLowerCase() : ''].filter(Boolean).join(', ')],
    ['Коробка', c.transmission],
    ['Привод', c.drive],
    ['Кузов', c.body],
    ['Цвет', c.color],
    ['Руль', c.wheel],
    ['Владельцев по ПТС', c.owners],
    ['ПТС', c.pts],
    ['VIN', c.vin],
    ['ДТП', h.accidents === 0 ? 'Нет' : h.accidents ? `${h.accidents} по базам` : ''],
    ['Залог', h.pledge === false ? 'Нет' : h.pledge ? 'Есть' : ''],
    ['Ограничения', h.restrictions === false ? 'Нет' : h.restrictions ? 'Есть' : ''],
    ['Окрасы', c.paint],
    ['Ключей', c.keys],
    ['Шины', c.tires],
    ['Гарантия', c.warranty]
  ];
  return rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
}

function description(c) {
  const e = c.engine || {};
  const parts = [
    `${title(c)} с пробегом ${num(c.mileage)} км`,
    [e.volume ? Number(e.volume).toFixed(1) + ' л' : '', c.transmission ? String(c.transmission).toLowerCase() : ''].filter(Boolean).join(', '),
    `цена ${rub(c.price)}`
  ].filter(Boolean);
  return `Купить ${parts.join(', ')}. Проверена по базам ГИБДД и реестру залогов. Осмотр и тест-драйв в Москве.`;
}

function vehicleJsonLd(site, c, url) {
  const e = c.engine || {};
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: title(c),
    brand: { '@type': 'Brand', name: c.make },
    model: c.model,
    vehicleModelDate: String(c.year),
    url,
    image: (c.photos || []).map((p) => photoUrl(site, p)),
    mileageFromOdometer: { '@type': 'QuantitativeValue', value: c.mileage, unitCode: 'KMT' },
    itemCondition: 'https://schema.org/UsedCondition',
    offers: {
      '@type': 'Offer',
      price: c.price,
      priceCurrency: 'RUB',
      availability: c.status === 'reserved' ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/InStock',
      url,
      seller: { '@id': site + '#org' }
    }
  };
  if (c.body) ld.bodyType = c.body;
  if (c.color) ld.color = c.color;
  if (c.transmission) ld.vehicleTransmission = c.transmission;
  if (c.drive) ld.driveWheelConfiguration = c.drive;
  if (c.owners) ld.numberOfPreviousOwners = c.owners;
  if (e.volume || e.power || e.fuel) {
    ld.vehicleEngine = { '@type': 'EngineSpecification' };
    if (e.volume) ld.vehicleEngine.engineDisplacement = { '@type': 'QuantitativeValue', value: e.volume, unitCode: 'LTR' };
    if (e.power) ld.vehicleEngine.enginePower = { '@type': 'QuantitativeValue', value: e.power, unitCode: 'BHP' };
    if (e.fuel) ld.vehicleEngine.fuelType = e.fuel;
  }
  if (!ld.image.length) delete ld.image;
  return ld;
}

function carPage(site, c) {
  const root = '../../';
  const url = `${site}cars/${encodeURIComponent(c.id)}/`;
  const photos = (c.photos || []).map((p) => root + 'app/' + String(p).replace(/^\/+/, ''));
  const book = `${root}app/?car=${encodeURIComponent(c.id)}`;
  const h = title(c);
  const pageTitle = `${c.make} ${c.model} ${c.year} с пробегом купить в Москве — ${rub(c.price)} | ${L.BRAND}`;
  const robots = c.demo ? 'noindex, follow' : '';
  const sub = [c.trim, c.body, c.color].filter(Boolean).join(' · ');
  const list = (arr) => (Array.isArray(arr) ? arr : arr ? [arr] : []).filter(Boolean);
  const defects = list(c.defects);
  return L.head({
    root, siteUrl: site, title: pageTitle, description: description(c), canonical: url, robots,
    image: c.photos && c.photos[0] ? photoUrl(site, c.photos[0]) : '',
    jsonLd: [vehicleJsonLd(site, c, url), L.breadcrumbsJsonLd(site, [{ name: 'Машины в продаже', url: site + 'cars/' }, { name: h, url }])]
  }) + L.header(root) + `
<main id="top">
  <section class="car-hero dark">
    <div class="wrap">
      ${L.crumbs(root, [{ name: 'Машины в продаже', href: '../' }, { name: h }])}
      <h1>${esc(h)}</h1>
      ${sub ? `<p class="car-sub">${esc(sub)}</p>` : ''}
    </div>
  </section>
  <section class="section">
    <div class="wrap car-layout">
      <div class="car-block">
        <div class="gallery">
${photos.length ? photos.map((src, i) => `          <a href="${esc(book)}"><img src="${esc(src)}" alt="${esc(h)}${i ? ', фото ' + (i + 1) : ''}" loading="${i ? 'lazy' : 'eager'}" decoding="async"></a>`).join('\n')
    : '          <p class="empty-note">Фото скоро добавим. Позвоните — пришлём в мессенджер.</p>'}
        </div>
        ${list(c.videos).length ? `<h2>Видео</h2>\n${list(c.videos).map((v) => `        <video class="car-video" src="${esc(root + 'app/' + String(v).replace(/^\/+/, ''))}" controls playsinline preload="metadata"></video>`).join('\n')}` : ''}
        ${c.description ? `<h2>Описание</h2><p>${esc(c.description)}</p>` : ''}
        ${list(c.features).length ? `<h2>Комплектация и опции</h2><div class="chips">${list(c.features).map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
        ${list(c.serviceDone).length ? `<h2>Что сделали перед продажей</h2><div class="chips">${list(c.serviceDone).map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
        ${defects.length ? `<h2>Известные недостатки</h2>\n        <p>${esc(defects.join('\n'))}</p>` : ''}
        <h2>Характеристики</h2>
        <dl class="specs">
${specs(c).map(([k, v]) => `          <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
        </dl>
      </div>
      <aside class="car-aside">
        <div class="box">
          ${c.status === 'reserved' ? '<span class="car-status">Забронирована</span>' : ''}
          <span class="car-price">${rub(c.price)}</span>
          ${c.marketPrice && c.marketPrice > c.price ? `<span class="deal good">Ниже рыночной оценки на ${rub(c.marketPrice - c.price)}</span>` : ''}
          <a class="btn btn-primary btn-block" href="${esc(book)}">Записаться на осмотр</a>
          <a class="btn btn-ghost btn-block" href="tel:${L.PHONE}">${L.ICON.phone}${L.PHONE_LABEL}</a>
          <p class="hint">Номер объявления: ${esc(c.id)}. Машина в Москве, осмотр и тест-драйв по записи.</p>
        </div>
      </aside>
    </div>
  </section>
</main>` + L.footer(root);
}

function listPage(site, cars) {
  const root = '../';
  const url = site + 'cars/';
  const n = cars.length;
  const items = cars.map((c) => {
    const ph = c.photos && c.photos[0] ? root + 'app/' + String(c.photos[0]).replace(/^\/+/, '') : '';
    const e = c.engine || {};
    return `      <article class="card${c.status === 'reserved' ? ' is-reserved' : ''}">
        <a class="card-media" href="${encodeURIComponent(c.id)}/">${ph ? `<div class="card-track"><img src="${esc(ph)}" alt="${esc(title(c))}" loading="lazy" decoding="async"></div>` : ''}${c.status === 'reserved' ? '<span class="status reserved">Забронирована</span>' : ''}</a>
        <div class="card-body">
          <div class="card-head"><div><h2 class="card-title"><a href="${encodeURIComponent(c.id)}/">${esc(c.year + ' ' + c.make + ' ' + c.model)}</a></h2>
          <p class="card-trim">${esc([c.generation, c.trim, c.body].filter(Boolean).join(' · '))}</p></div>
          <div class="card-price"><span class="price">${rub(c.price)}</span></div></div>
          <ul class="facts"><li><span>${num(c.mileage)} км</span></li><li><span>${esc([e.volume ? Number(e.volume).toFixed(1) + ' л' : '', c.transmission].filter(Boolean).join(' · '))}</span></li></ul>
        </div>
      </article>`;
  }).join('\n');
  const lead = n ? `${n} ${plural(n, 'машина', 'машины', 'машин')} в наличии. Каждую проверяем по базам ГИБДД и реестру залогов, показываем и даём тест-драйв в Москве.`
    : 'Сейчас все машины проданы. Новые появляются каждую неделю.';
  return L.head({
    root, siteUrl: site, title: `Авто с пробегом в Москве — купить проверенную машину | ${L.BRAND}`,
    description: 'Автомобили с пробегом в наличии в Москве: проверка по базам ГИБДД и реестру залогов, честное описание недостатков, осмотр и тест-драйв.',
    canonical: url,
    jsonLd: [L.orgJsonLd(site), L.breadcrumbsJsonLd(site, [{ name: 'Машины в продаже', url }]),
      { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: cars.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${url}${encodeURIComponent(c.id)}/`, name: title(c) })) }]
  }) + L.header(root) + `
<main id="top">
  <section class="car-hero dark">
    <div class="wrap">
      ${L.crumbs(root, [{ name: 'Машины в продаже' }])}
      <h1>Авто с пробегом в Москве</h1>
      <p class="car-sub">${esc(lead)}</p>
    </div>
  </section>
  <section class="section">
    <div class="wrap">
      ${n ? `<div class="cards">\n${items}\n      </div>` : '<p class="empty-note">Сейчас все машины проданы. Позвоните — расскажем, что скоро появится.</p>'}
      <div class="related">
        <a href="${root}app/">Каталог с фильтрами</a>
        <a href="${root}">Продать свою машину</a>
      </div>
    </div>
  </section>
</main>` + L.footer(root);
}

function sitemap(site, cars, updated) {
  const urls = [
    { loc: site, lastmod: updated, priority: '1.0' },
    ...L.PAGES.map((p) => ({ loc: site + p.slug + '/', priority: '0.8' })),
    { loc: site + 'cars/', lastmod: updated, priority: '0.9' },
    ...cars.filter((c) => !c.demo).map((c) => ({ loc: `${site}cars/${encodeURIComponent(c.id)}/`, lastmod: c.publishedAt, priority: '0.7' }))
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n';
}

// IndexNow (Яндекс, Bing): ключ хранится рядом с журналом заявок, файл ключа — /cars/indexnow.txt.
function createIndexNow(config, { post = postJson, log = console.log } = {}) {
  const dir = path.dirname(config.leadsLog);
  const keyFile = path.join(dir, 'indexnow-key.txt');
  const stateFile = path.join(dir, 'indexnow-state.json');
  function key() {
    try { const k = fs.readFileSync(keyFile, 'utf8').trim(); if (/^[a-f0-9]{32}$/.test(k)) return k; } catch { /* создадим */ }
    const k = crypto.randomBytes(16).toString('hex');
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(keyFile, k); } catch { /* без IndexNow */ }
    return k;
  }
  const sig = (c) => [c.status, c.price, (c.photos || []).length, c.mileage].join('|');
  async function check() {
    if (!config.siteUrl) return null;
    const site = config.siteUrl.replace(/\/?$/, '/');
    const cars = readCatalog(config.carsFile).cars.filter((c) => c && c.id != null && !c.demo);
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* первый запуск */ }
    const now = {};
    const changed = [];
    for (const c of cars) { now[c.id] = sig(c); if (prev[c.id] !== now[c.id]) changed.push(c.id); }
    for (const id of Object.keys(prev)) if (!(id in now)) changed.push(id);
    if (!changed.length) return null;
    const urlList = [site + 'cars/', ...changed.map((id) => `${site}cars/${encodeURIComponent(id)}/`)].slice(0, 1000);
    const body = { host: new URL(site).host, key: key(), keyLocation: site + 'cars/indexnow.txt', urlList };
    try {
      const status = await post('https://yandex.com/indexnow', body);
      if (status >= 200 && status < 300) {
        fs.writeFileSync(stateFile, JSON.stringify(now));
        log(`IndexNow: отправлено ${urlList.length} адресов, ответ ${status}`);
      } else log(`IndexNow: ответ ${status}, попробуем позже`);
      return status;
    } catch (e) {
      log('IndexNow: нет связи — ' + e.message);
      return null;
    }
  }
  return { key, check };
}

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

function createSeo(config, deps = {}) {
  const indexNow = createIndexNow(config, deps);
  const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
  function send(res, status, type, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...HEADERS, ...extra });
    res.end(body);
  }
  return {
    indexNow,
    // true — ответили; false — не наш адрес.
    handle(req, res, pathname) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      const html = 'text/html; charset=utf-8';
      if (pathname === '/sitemap.xml') {
        const cat = readCatalog(config.carsFile);
        send(res, 200, 'application/xml; charset=utf-8', sitemap(siteBase(req, config), cat.cars.filter(visible), cat.updated));
        return true;
      }
      if (pathname === '/cars') { res.writeHead(301, { Location: '/cars/' }); res.end(); return true; }
      if (pathname === '/cars/indexnow.txt') { send(res, 200, 'text/plain; charset=utf-8', indexNow.key()); return true; }
      if (pathname === '/cars/' || pathname === '/cars/index.html') {
        const cars = readCatalog(config.carsFile).cars.filter(visible);
        cars.sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved') || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
        send(res, 200, html, listPage(siteBase(req, config), cars));
        return true;
      }
      const m = /^\/cars\/([^/]+)\/?$/.exec(pathname);
      if (m) {
        let id;
        try { id = decodeURIComponent(m[1]); } catch { return false; }
        if (!pathname.endsWith('/')) { res.writeHead(301, { Location: pathname + '/' }); res.end(); return true; }
        const car = readCatalog(config.carsFile).cars.find((c) => c && String(c.id) === id);
        const site = siteBase(req, config);
        if (!car || car.status === 'sold') {
          // 410 — машины больше нет: поисковики быстрее уберут страницу из выдачи.
          send(res, car ? 410 : 404, html, L.head({ root: '../../', siteUrl: site, title: `Машина продана | ${L.BRAND}`, description: 'Эта машина уже продана.', canonical: site + 'cars/', robots: 'noindex, follow' }) +
            L.header('../../') + `<main id="top"><section class="car-hero dark"><div class="wrap"><h1>${car ? 'Эту машину уже купили' : 'Такой машины нет'}</h1><p class="car-sub">Посмотрите другие машины в наличии.</p><div class="related"><a href="../">Машины в продаже</a></div></div></section></main>` + L.footer('../../'));
          return true;
        }
        send(res, 200, html, carPage(site, car));
        return true;
      }
      return false;
    }
  };
}

module.exports = { createSeo, createIndexNow, sitemap, carPage, listPage, vehicleJsonLd };
