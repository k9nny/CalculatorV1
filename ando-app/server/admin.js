'use strict';
// Админка: добавить машину (фото + текст объявления), менять статус и цену, удалять, смотреть заявки.
// Работает без Telegram.
// Защита: админка живёт только по секретному адресу /<slug>/ — slug случайный, создаётся на сервере
// (server/admin-cli.js) и в репозитории его нет; по любому другому адресу — обычный 404.
// Пароль задаётся только на сервере, в браузере его создать нельзя. Подбор пароля ограничен.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseListing, toCar, missing } = require('./listing-parser');
const { readCatalog, writeCatalog, nextId } = require('./catalog');

const COOKIE = 'ando_admin';
const SESSION_DAYS = 30;
const MAX_PHOTO = 15 * 1024 * 1024;
const MAX_PHOTOS = 15;
const STATUSES = ['available', 'reserved', 'sold'];
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const UI_DIR = path.join(__dirname, 'admin-ui');
const UI_FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'], '/admin.css': ['admin.css', 'text/css; charset=utf-8'] };
// Заголовки страниц админки: не индексировать, не встраивать в чужие сайты, не передавать адрес наружу.
const PRIVATE = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

// Картинка ли это на самом деле — по первым байтам, а не по заявленному типу.
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return '.png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 64 * 1024) {
  const raw = await readRaw(req, limit);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hashPassword = (password, salt) => crypto.scryptSync(String(password), salt, 32).toString('hex');

function createAdmin(config, { now = () => new Date() } = {}) {
  const dir = path.dirname(config.leadsLog);
  const stateFile = path.join(dir, 'admin.json');
  const leadsStateFile = path.join(dir, 'leads-state.json');
  const attempts = new Map(); // ip → [время неудачных входов]

  // Состояние читается с диска (его меняет и admin-cli.js), но не чаще, чем файл меняется.
  let cache = { mtime: -1, st: null };
  function readState() {
    let mtime = 0;
    try { mtime = fs.statSync(stateFile).mtimeMs; } catch { cache = { mtime: -1, st: null }; return null; }
    if (mtime !== cache.mtime) {
      try { cache = { mtime, st: JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch { cache = { mtime: -1, st: null }; }
    }
    return cache.st;
  }
  function writeState(st) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(st), { mode: 0o600 });
    fs.renameSync(stateFile + '.tmp', stateFile);
  }

  // Подпись сессии: срок + HMAC. Смена пароля меняет секрет — старые входы перестают работать.
  function sign(st, exp) { return exp + '.' + crypto.createHmac('sha256', st.secret).update(String(exp)).digest('hex'); }
  function session(req) {
    const st = readState();
    if (!st || !st.hash || !st.secret) return false;
    const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)').exec(req.headers.cookie || '');
    if (!m) return false;
    const exp = parseInt(m[1], 10);
    return exp > Date.now() && safeEqual(m[1], sign(st, exp));
  }
  function cookie(req, value, maxAge) {
    const secure = req.headers['x-forwarded-proto'] === 'https' || config.trustProxy ? '; Secure' : '';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
  }
  function slug() { const st = readState(); return st && /^[a-z0-9]{20,64}$/.test(st.slug || '') ? st.slug : ''; }

  // 8 неверных попыток с одного адреса — пауза 15 минут; 30 со всех адресов за час — вход закрыт на час.
  let globalFails = [];
  function limited(ip) {
    const t = Date.now();
    const list = (attempts.get(ip) || []).filter((x) => t - x < 15 * 60 * 1000);
    attempts.set(ip, list);
    globalFails = globalFails.filter((x) => t - x < 60 * 60 * 1000);
    return list.length >= 8 || globalFails.length >= 30;
  }
  function failed(ip) {
    (attempts.get(ip) || attempts.set(ip, []).get(ip)).push(Date.now());
    globalFails.push(Date.now());
    if (attempts.size > 5000) attempts.clear();
  }

  function json(res, status, payload, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE, ...headers });
    res.end(JSON.stringify(payload));
  }

  function photoPath(name) { return path.join(config.photosDir, path.basename(name)); }
  // Фото, загруженные, но так и не опубликованные, удаляются через сутки.
  function cleanTmp() {
    let names = [];
    try { names = fs.readdirSync(config.photosDir); } catch { return; }
    for (const n of names) {
      if (!n.startsWith('tmp-')) continue;
      try { if (Date.now() - fs.statSync(photoPath(n)).mtimeMs > 864e5) fs.unlinkSync(photoPath(n)); } catch { /* уже нет */ }
    }
  }
  const PREFIX = 'img/cars/';

  function leadsList() {
    let lines = [];
    try { lines = fs.readFileSync(config.leadsLog, 'utf8').split('\n'); } catch { /* заявок ещё нет */ }
    let done = {};
    try { done = JSON.parse(fs.readFileSync(leadsStateFile, 'utf8')).done || {}; } catch { /* нет отметок */ }
    const out = [];
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try { out.push({ id: String(i), done: !!done[i], ...JSON.parse(line) }); } catch { /* битая строка */ }
    });
    return out.reverse().slice(0, 300);
  }

  async function route(req, res, pathname) {
    const ip = (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    const m = req.method;
    // Запросы с изменениями — только со своей страницы (защита от подделки запросов с чужих сайтов).
    if (m !== 'GET') {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      let ok = false;
      try { ok = new URL(req.headers.origin).host === host; } catch { ok = false; }
      if (!ok) return json(res, 403, { error: 'Чужой сайт' });
    }

    if (pathname === '/api/admin/status' && m === 'GET') return json(res, 200, { authed: session(req) });

    if (pathname === '/api/admin/login' && m === 'POST') {
      const st = readState();
      if (!st || !st.hash) return json(res, 409, { error: 'Пароль ещё не задан. Задайте его на сервере.' });
      if (limited(ip)) return json(res, 429, { error: 'Слишком много попыток. Подождите 15 минут.' });
      const body = await readJson(req);
      if (!safeEqual(hashPassword(body.password || '', st.salt), st.hash)) { failed(ip); return json(res, 403, { error: 'Неверный пароль' }); }
      const exp = Date.now() + SESSION_DAYS * 864e5;
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, sign(st, exp), SESSION_DAYS * 86400) });
    }

    if (pathname === '/api/admin/logout' && m === 'POST') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }

    if (!session(req)) return json(res, 401, { error: 'Войдите заново' });

    if (pathname === '/api/admin/parse' && m === 'POST') {
      const body = await readJson(req);
      const fields = parseListing(String(body.text || ''));
      return json(res, 200, { car: toCar(fields), missing: missing(fields) });
    }

    // Фото загружается до публикации: временное имя, при публикации переименуется в «номер-n».
    if (pathname === '/api/admin/photo' && m === 'POST') {
      if (!IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()]) return json(res, 415, { error: 'Нужна картинка JPEG, PNG или WebP' });
      const buf = await readRaw(req, MAX_PHOTO);
      const ext = sniffImage(buf);
      if (!ext) return json(res, 415, { error: 'Это не картинка JPEG, PNG или WebP' });
      fs.mkdirSync(config.photosDir, { recursive: true });
      cleanTmp();
      const name = 'tmp-' + crypto.randomBytes(8).toString('hex') + ext;
      fs.writeFileSync(photoPath(name), buf);
      return json(res, 200, { name });
    }

    if (pathname === '/api/admin/cars' && m === 'GET') {
      return json(res, 200, { cars: readCatalog(config.carsFile).cars });
    }

    if (pathname === '/api/admin/cars' && m === 'POST') {
      const body = await readJson(req);
      const fields = parseListing(String(body.text || ''));
      const lack = missing(fields);
      if (lack.length) return json(res, 400, { error: 'Не хватает: ' + lack.join(', ') });
      const catalog = readCatalog(config.carsFile);
      const id = nextId(catalog.cars);
      const photos = [];
      (Array.isArray(body.photos) ? body.photos : []).slice(0, MAX_PHOTOS).forEach((tmp, i) => {
        const base = path.basename(String(tmp));
        if (!/^tmp-[0-9a-f]{16}\.(jpg|png|webp)$/.test(base) || !fs.existsSync(photoPath(base))) return;
        const name = `${id}-${i + 1}${path.extname(base)}`;
        fs.renameSync(photoPath(base), photoPath(name));
        photos.push(PREFIX + name);
      });
      const car = { id, status: 'available', publishedAt: now().toISOString().slice(0, 10), ...toCar(fields), photos };
      if (!STATUSES.includes(car.status)) car.status = 'available';
      catalog.cars.unshift(car);
      writeCatalog(config.carsFile, catalog, now());
      return json(res, 200, { car });
    }

    const one = /^\/api\/admin\/cars\/([^/]+)$/.exec(pathname);
    if (one && (m === 'PATCH' || m === 'DELETE')) {
      const id = decodeURIComponent(one[1]);
      const catalog = readCatalog(config.carsFile);
      const car = catalog.cars.find((c) => String(c.id) === id);
      if (!car) return json(res, 404, { error: 'Такой машины уже нет' });
      if (m === 'DELETE') {
        catalog.cars = catalog.cars.filter((c) => c !== car);
        writeCatalog(config.carsFile, catalog, now());
        for (const src of car.photos || []) {
          if (src.startsWith(PREFIX)) { try { fs.unlinkSync(photoPath(src)); } catch { /* уже нет */ } }
        }
        return json(res, 200, { ok: true });
      }
      const body = await readJson(req);
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return json(res, 400, { error: 'Неизвестный статус' });
        car.status = body.status;
      }
      if (body.price !== undefined) {
        const price = Math.round(Number(String(body.price).replace(/\s/g, '')));
        if (!(price > 0 && price < 1e9)) return json(res, 400, { error: 'Проверьте цену' });
        car.price = price;
      }
      writeCatalog(config.carsFile, catalog, now());
      return json(res, 200, { car });
    }

    if (pathname === '/api/admin/cleardemo' && m === 'POST') {
      const catalog = readCatalog(config.carsFile);
      const before = catalog.cars.length;
      catalog.cars = catalog.cars.filter((c) => !c.demo);
      writeCatalog(config.carsFile, catalog, now());
      return json(res, 200, { removed: before - catalog.cars.length });
    }

    if (pathname === '/api/admin/leads' && m === 'GET') return json(res, 200, { leads: leadsList() });

    const lead = /^\/api\/admin\/leads\/(\d+)$/.exec(pathname);
    if (lead && m === 'PATCH') {
      const body = await readJson(req);
      let st = { done: {} };
      try { st = JSON.parse(fs.readFileSync(leadsStateFile, 'utf8')); } catch { /* первая отметка */ }
      st.done = st.done || {};
      if (body.done) st.done[lead[1]] = true; else delete st.done[lead[1]];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(leadsStateFile, JSON.stringify(st), { mode: 0o600 });
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Нет такого действия' });
  }

  function serveUi(res, file, type) {
    fs.readFile(path.join(UI_DIR, file), (err, data) => {
      if (err) { res.writeHead(404, PRIVATE); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': type, ...PRIVATE });
      res.end(data);
    });
  }

  return {
    // true — запрос обработан админкой; false — это не админка, дальше обычная раздача файлов (и 404).
    handle(req, res, pathname) {
      const key = slug();
      if (!key) return false;
      const base = '/' + key;
      if (pathname === base) { res.writeHead(308, { Location: base + '/', ...PRIVATE }); res.end(); return true; }
      if (!pathname.startsWith(base + '/')) return false;
      const sub = pathname.slice(base.length);
      if (sub.startsWith('/api/')) {
        route(req, res, '/api/admin/' + sub.slice(5)).catch((err) => json(res, err.status || 500, { error: err.status === 413 ? 'Файл слишком большой' : 'Ошибка сервера' }));
        return true;
      }
      const ui = UI_FILES[sub];
      if (ui && req.method === 'GET') { serveUi(res, ui[0], ui[1]); return true; }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...PRIVATE });
      res.end('Not found');
      return true;
    }
  };
}

module.exports = { createAdmin };
