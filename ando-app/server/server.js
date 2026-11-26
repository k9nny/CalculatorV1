'use strict';
// Сервер мини-приложения ANDO AUTO: раздаёт приложение и принимает заявки.
// Без зависимостей, Node 18+. Настройки — переменные окружения (см. .env.example).
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { validateInitData } = require('./initdata');
const { validateLead, formatLeadMessage } = require('./leads');
const leadPhotos = require('./lead-photos');
const { createBot, telegramApi, apiHost } = require('./bot');
const { createAdmin } = require('./admin');
const { createSeo } = require('./seo');
const { createSmartParser, createLlmStore } = require('./llm');
const telegramSettings = require('./telegram-settings');
const { createVk } = require('./vk');
const { createCarSpecs } = require('./car-specs');
const { createAfterPublish } = require('./after-publish');
const { createSocial } = require('./social');
const { threadsDraft } = require('./telegram-post');
const { createPhotoRenditions } = require('./photo-renditions');
const { createMetaSettings } = require('./meta-settings');
const { createInstagramPublisher, createThreadsPublisher } = require('./social-platforms/meta');
const { createYouTubePublisher } = require('./social-platforms/youtube');
const { createYouTubeSettings, CALLBACK: YOUTUBE_CALLBACK } = require('./youtube-settings');
const { createRenderJobs } = require('./video/render-jobs');
const { createRenderApi } = require('./video/render-api');
const { buildStoryboard } = require('./video/storyboard');
const { store } = require('./social-platforms/common');
const { createPostPublishers } = require('./social-publishers');
const { createMarketPrice } = require('./market-price');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Встраивание не запрещаем: веб-версии Telegram и MAX открывают приложение во фрейме.
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' https://telegram.org https://st.max.ru; " +
    "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; form-action 'self'"
};

function readConfig(env = process.env) {
  const root = path.resolve(__dirname, '..');
  const siteUrl = (env.SITE_URL || String(env.ALLOWED_ORIGINS || '').split(',')[0] || '').trim();
  const defaultPostChannel = /^https:\/\/(?:www\.)?andoauto\.ru\/?$/i.test(siteUrl) ? '@andoavtomsk' : '';
  return {
    port: Number(env.PORT) || 8080,
    host: env.HOST || '0.0.0.0',
    publicDir: path.resolve(env.PUBLIC_DIR || path.join(root, 'public')),
    carsFile: path.resolve(env.CARS_FILE || path.join(root, 'public', 'data', 'cars.json')),
    // Фото машин из бота. На сервере — вне репозитория, чтобы обновления кода их не трогали.
    photosDir: path.resolve(env.PHOTOS_DIR || path.join(env.PUBLIC_DIR || path.join(root, 'public'), 'img', 'cars')),
    leadsLog: path.resolve(env.LEADS_LOG || path.join(root, 'data-private', 'leads.jsonl')),
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    maxToken: env.MAX_BOT_TOKEN || '',
    managerChatIds: String(env.MANAGER_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    adminIds: String(env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    appLink: env.APP_LINK || '',
    requireInitData: env.REQUIRE_INIT_DATA === '1',
    trustProxy: env.TRUST_PROXY === '1',
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    // Адрес сайта для ссылок в карте сайта и IndexNow. По умолчанию — первый из ALLOWED_ORIGINS (основной домен).
    siteUrl,
    metrikaCounter: /^[1-9]\d{3,11}$/.test(env.METRIKA_COUNTER_ID || '') ? Number(env.METRIKA_COUNTER_ID) : null,
    clipsEnabled: env.CLIPS !== '0',
    clipsDir: path.resolve(env.CLIPS_DIR || path.join(root, 'data-private', 'clips')),
    clipTimes: env.CLIP_TIMES || '10:40,15:20,19:40',
    clipTelegramChannel: env.CLIP_TG_CHANNEL || '',
    postTelegramChannel: env.POST_TG_CHANNEL ?? defaultPostChannel,
    socialPreview: true,
    vkToken: env.VK_TOKEN || '',
    vkGroupId: env.VK_GROUP_ID || '',
    renderWorkerToken: env.RENDER_WORKER_TOKEN || '',
    // Нейросеть для разбора объявлений и фото (Kimi или другая с API как у OpenAI). Пусто — обычный разбор.
    llm: { baseUrl: env.LLM_BASE_URL || '', apiKey: env.LLM_API_KEY || '', model: env.LLM_MODEL || '', vision: env.LLM_VISION !== '0' },
    phoneLabel: env.PHONE_LABEL || '+7 928 333-95-70'
  };
}

function sendTelegramMessage(token, chatId, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
    const req = https.request(
      {
        ...apiHost(),
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 8000
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

// Не больше `limit` заявок с одного адреса за `windowMs`.
function createRateLimiter(limit = 6, windowMs = 10 * 60 * 1000) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}

function readBody(req, limit = 16 * 1024, binary = false) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(binary ? buffer : buffer.toString('utf8'));
    });
    req.on('error', reject);
  });
}

// Один разборщик на процесс: его кэш общий у бота и админки.
// Ключ можно задать в админке (llm.json) или в ando.env (LLM_*); админка важнее.
const shared = new Map();
function smartParser(config) {
  const key = config.leadsLog;
  if (!shared.has(key)) {
    const store = createLlmStore(path.dirname(config.leadsLog), config.llm || {});
    shared.set(key, { store, parser: createSmartParser(() => store.get()) });
  }
  return shared.get(key).parser;
}
function llmStore(config) { smartParser(config); return shared.get(config.leadsLog).store; }
// ВКонтакте и «после публикации» (справка о модели, пост в ВК) — тоже по одному на процесс.
const services = new Map();
function servicesFor(config, deps = {}) {
  if (!services.has(config.leadsLog) || deps.vk || deps.afterPublish) {
    const vk = deps.vk || createVk(config);
    const specs = deps.specs !== undefined ? deps.specs : createCarSpecs(smartParser(config));
    const market = deps.market !== undefined ? deps.market : createMarketPrice(smartParser(config));
    const instagram = createMetaSettings(config, 'instagram', { request: deps.instagramTransport });
    const threads = createMetaSettings(config, 'threads', { request: deps.threadsTransport });
    const youtube = createYouTubeSettings(config, { request: deps.youtubeTransport });
    const renditions = createPhotoRenditions(config);
    const workerSettings = store(config, 'resolve-worker', {});
    const workerToken = () => config.renderWorkerToken || workerSettings.read().token;
    const configureWorker = () => {
      const existing = workerToken();
      if (existing) return existing;
      const token = require('node:crypto').randomBytes(32).toString('hex');
      workerSettings.write({ token });
      return token;
    };
    const renderJobs = createRenderJobs({ config });
    function renderedAsset(jobId, car) {
      const job = renderJobs.get(jobId);
      if (!job || job.carId !== String(car.id) || job.status !== 'ready') throw new Error('Ролик ещё не готов');
      const file = renderJobs.outputFile(jobId);
      const url = new URL(job.result.publicUrl, config.siteUrl).href;
      return { video: { file, url, title: job.storyboard.title }, key: 'video:' + job.result.sha256 };
    }
    const publishers = () => {
      const channels = createPostPublishers(config, vk);
      const youtubeAccount = youtube.publisherConfig();
      if (youtubeAccount) {
        const publisher = createYouTubePublisher(youtubeAccount, { transport: deps.youtubeTransport });
        channels.push({ ...publisher, name: 'YouTube Shorts · ' + youtubeAccount.youtubeChannelTitle, prepare: media => {
          const car = media.car;
          const price = Number(car.price).toLocaleString('ru-RU') + ' ₽';
          const text = [[car.make, car.model, car.year].filter(Boolean).join(' '), price, car.city,
            'Все машины — по ссылке в профиле ANDO AUTO'].filter(Boolean).join('\n');
          return publisher.prepare({ ...media, text, link: '' });
        } });
      }
      const account = instagram.publisherConfig();
      if (account) {
        const publisher = createInstagramPublisher(account, { transport: deps.instagramTransport });
        channels.push({ ...publisher, name: 'Instagram @' + account.instagramUsername,
          prepare: (media) => publisher.prepare({ ...media, jpegPhotos: media.video ? undefined : renditions.urls(media.car) }) });
      }
      const threadsAccount = threads.publisherConfig();
      if (threadsAccount) {
        const publisher = createThreadsPublisher(threadsAccount, { transport: deps.threadsTransport });
        channels.push({ ...publisher, name: 'Threads @' + threadsAccount.threadsUsername,
          template: 'threads-listing-3',
          prepare: media => {
            const cover = media.photos[0];
            const photos = cover && !/\.(?:jpe?g|png)$/i.test(new URL(cover).pathname)
              ? renditions.urls({ ...media.car, photos: media.car.photos.slice(0, 1) }) : media.photos.slice(0, 1);
            return publisher.prepare({ ...media, photos, link: '', text: threadsDraft(media.car) });
          } });
      }
      return channels;
    };
    const social = createSocial({ config, copywriter: deps.copywriter || smartParser(config), publishers, renderedAsset,
      notify: async (batch) => {
        if (!config.telegramToken) return;
        const lines = batch.jobs.map((j) => `${j.name}: ${j.status}${j.error ? ' — ' + j.error : ''}${j.receipt?.url ? '\n' + j.receipt.url : ''}`);
        const api = telegramApi(config.telegramToken);
        for (const id of config.adminIds) await api.request('sendMessage', { chat_id: id,
          text: `Публикация машины №${batch.carId}\n${lines.join('\n')}\n/social ${batch.carId} — предпросмотр и статусы` }).catch(() => {});
      }
    });
    const afterPublish = deps.afterPublish || createAfterPublish({ config, specs, market });
    const all = { vk, afterPublish, specs, social, instagram, threads, youtube, renditions, renderJobs, workerToken, configureWorker, buildStoryboard };
    if (deps.vk || deps.afterPublish) return all;
    services.set(config.leadsLog, all);
  }
  return services.get(config.leadsLog);
}

function createApp(config = readConfig(), deps = {}) {
  const send = deps.sendTelegramMessage || sendTelegramMessage;
  const allow = deps.rateLimiter || createRateLimiter();
  const allowPhoto = createRateLimiter(24);

  function json(res, status, payload, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
    res.end(JSON.stringify(payload));
  }

  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !config.allowedOrigins.includes(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data, X-Max-Init-Data',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin'
    };
  }

  function loadCars() {
    try {
      const data = JSON.parse(fs.readFileSync(config.carsFile, 'utf8'));
      return Array.isArray(data) ? data : data.cars || [];
    } catch {
      return [];
    }
  }

  // Кто прислал заявку: подпись мессенджера проверяется токеном его бота.
  function identify(req) {
    const tg = req.headers['x-telegram-init-data'];
    const max = req.headers['x-max-init-data'];
    const platform = tg ? 'telegram' : max ? 'max' : 'web';
    if (platform === 'web') return { platform, verified: false, user: null };
    const token = platform === 'telegram' ? config.telegramToken : config.maxToken;
    if (!token) return { platform, verified: false, user: null };
    const result = validateInitData(tg || max, token);
    if (!result.ok) return { platform, invalid: result.reason };
    return { platform, verified: true, user: result.user };
  }

  function appendLog(entry) {
    try {
      fs.mkdirSync(path.dirname(config.leadsLog), { recursive: true });
      fs.appendFileSync(config.leadsLog, JSON.stringify(entry) + '\n', { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }

  async function handleLead(req, res) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Метод не поддерживается' }, cors);
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Нужен JSON' }, cors);

    const ip = (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    if (!allow(ip)) return json(res, 429, { error: 'Слишком много заявок. Попробуйте позже или позвоните нам.' }, cors);

    const source = identify(req);
    if (source.invalid) return json(res, 401, { error: 'Откройте приложение заново из мессенджера' }, cors);
    if (config.requireInitData && !source.verified) return json(res, 401, { error: 'Откройте приложение из Telegram или MAX' }, cors);

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, err.status || 400, { error: 'Не удалось прочитать заявку' }, cors);
    }
    const checked = validateLead(body, loadCars());
    if (!checked.ok) return json(res, 400, { error: checked.error }, cors);

    const lead = checked.lead;
    const uploadToken = lead.type === 'sell' && ['homepage-buyout', 'service-buyout'].includes(lead.entryPoint)
      ? randomBytes(32).toString('hex') : null;
    const logged = appendLog({
      at: new Date().toISOString(),
      ...lead,
      ...(uploadToken ? { photoKey: leadPhotos.digest(uploadToken) } : {}),
      source: { platform: source.platform, verified: source.verified, userId: source.user && source.user.id }
    });

    let delivered = 0;
    if (config.telegramToken && config.managerChatIds.length) {
      const text = formatLeadMessage(lead, source);
      const results = await Promise.all(config.managerChatIds.map((id) => send(config.telegramToken, id, text)));
      delivered = results.filter(Boolean).length;
    }
    if (!logged && !delivered) return json(res, 502, { error: 'Не получилось принять заявку. Позвоните нам.' }, cors);
    return json(res, 200, { ok: true, delivered, ...(logged && uploadToken ? { uploadToken } : {}) }, cors);
  }

  async function handleLeadPhoto(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Метод не поддерживается' });
    if (req.headers['content-type'] !== 'image/jpeg') return json(res, 415, { error: 'Нужно фото JPEG.' });
    if (Number(req.headers['content-length']) > leadPhotos.limit) return json(res, 413, { error: 'Фото слишком большое.' });
    const token = req.headers['x-ando-lead-upload'];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return json(res, 403, { error: 'Загрузка недоступна.' });
    const ip = (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
    if (!allowPhoto(ip)) return json(res, 429, { error: 'Слишком много загрузок. Попробуйте позже.' });
    const key = leadPhotos.digest(token);
    let eligible = false;
    try {
      eligible = fs.readFileSync(config.leadsLog, 'utf8').split('\n').some(line => {
        if (!line.includes(key)) return false;
        const entry = JSON.parse(line);
        return entry.photoKey === key && Date.now() - Date.parse(entry.at) < 86400000;
      });
    } catch { /* журнал недоступен */ }
    if (!eligible) return json(res, 403, { error: 'Загрузка недоступна.' });
    const bytes = await readBody(req, leadPhotos.limit, true);
    const result = leadPhotos.savePhoto(config.leadsLog, key, bytes);
    return json(res, result.status, result.error ? { error: result.error } : { count: result.count });
  }

  function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, SECURITY_HEADERS);
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400, SECURITY_HEADERS);
      res.end();
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    // Каталог и фото могут лежать вне public (CARS_FILE, PHOTOS_DIR) — отдаём их по тем же адресам.
    let base = config.publicDir;
    let file = path.normalize(path.join(base, pathname));
    if (pathname === '/data/cars.json') { base = path.dirname(config.carsFile); file = config.carsFile; }
    else if (pathname.startsWith('/img/cars/')) { base = config.photosDir; file = path.normalize(path.join(base, pathname.slice('/img/cars/'.length))); }
    const inside = file.startsWith(base + path.sep);
    const hidden = pathname.split('/').some((part) => part.startsWith('.'));
    if (!inside || hidden) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        res.end('Not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const fresh = ext === '.html' || ext === '.json' || ext === '.js' || ext === '.css';
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': fresh ? 'no-cache' : 'public, max-age=86400',
        'Accept-Ranges': 'bytes',
        ...SECURITY_HEADERS
      };
      if (config.metrikaCounter && pathname === '/index.html') {
        headers['Content-Security-Policy'] = headers['Content-Security-Policy']
          .replace("https://st.max.ru;", "https://st.max.ru https://mc.yandex.ru;")
          .replace("connect-src 'self';", "connect-src 'self' https://mc.yandex.ru;");
      }
      // Видео отдаётся кусками (Range): без этого Safari на iPhone не играет и не перематывает.
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (range && stat.size > 0) {
        let start = range[1] === '' ? Math.max(0, stat.size - Number(range[2])) : Number(range[1]);
        let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : stat.size - 1;
        end = Math.min(end, stat.size - 1);
        if (!(start <= end) || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, ...SECURITY_HEADERS });
          res.end();
          return;
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  // Админка — только по секретному адресу из admin.json (deploy/admin.sh); остальным она не видна.
  const services = servicesFor(config, deps);
  const admin = createAdmin(config, { parser: deps.parser || smartParser(config), llmStore: deps.llmStore || llmStore(config), discover: deps.discover, makeParser: deps.makeParser,
    telegram: deps.telegram, restart: deps.restart, ...services });
  const { vk, youtube, renditions, renderJobs, workerToken } = services;
  const renderApi = createRenderApi({ config, jobs: renderJobs, workerToken, inspect: deps.inspectVideo });
  // Страницы машин, список и карта сайта для поисковиков.
  const seo = createSeo(config, deps.seo);

  return http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (admin.handle(req, res, pathname)) return;
    if (renderApi.handle(req, res, pathname)) return;
    if (seo.handle(req, res, pathname)) return;
    if (renditions.handle(req, res, pathname)) return;
    if (pathname === '/api/lead') {
      handleLead(req, res).catch(() => json(res, 500, { error: 'Ошибка сервера' }));
      return;
    }
    if (pathname === '/api/public-analytics' && req.method === 'GET') return json(res, 200, { metrikaCounter: config.metrikaCounter || null });
    if (pathname === '/api/lead-photo') {
      handleLeadPhoto(req, res).catch(error => json(res, error.status || 500, { error: 'Фото не удалось сохранить.' }));
      return;
    }
    if (pathname === '/healthz') return json(res, 200, { ok: true });
    if (pathname === YOUTUBE_CALLBACK && req.method === 'GET') {
      const query = new URL(req.url, 'http://x').searchParams;
      const headers = { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
      youtube.finish(query).then(returnPath => {
        res.writeHead(303, { ...headers, Location: returnPath });
        res.end();
      }).catch(error => {
        res.writeHead(400, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(error.message);
      });
      return;
    }
    // Возврат из VK ID после «Подключить ВК» в админке: без state, выданного админкой, ничего не делает.
    if (pathname === '/api/vk/callback' && req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const page = (title, text) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...SECURITY_HEADERS });
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
          `<body style="font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px"><h1 style="font-size:22px">${title}</h1><p>${text}</p></body>`);
      };
      if (q.get('error')) { page('ВКонтакте не подключён', 'ВК отказал во входе. Вернитесь в админку и попробуйте ещё раз.'); return; }
      vk.finish({ code: q.get('code') || '', state: q.get('state') || '', deviceId: q.get('device_id') || '' })
        .then((d) => page('ВКонтакте подключён', `Группа: ${String(d.groupName || d.groupId).replace(/[<>&"]/g, '')}. Вернитесь в админку — новые машины будут публиковаться в группе.`))
        .catch((e) => page('ВКонтакте не подключён', String(e.message).replace(/[<>&"]/g, '') + ' Вернитесь в админку и попробуйте ещё раз.'));
      return;
    }
    serveStatic(req, res);
  });
}

if (require.main === module) {
  // Настройки Telegram из админки (telegram.json) важнее ando.env.
  const config = telegramSettings.apply(readConfig());
  createApp(config).listen(config.port, config.host, () => {
    const notify = config.telegramToken && config.managerChatIds.length ? `в Telegram (${config.managerChatIds.length} чат.)` : 'только в журнал';
    console.log(`ANDO AUTO: http://${config.host}:${config.port} — заявки ${notify}, журнал ${config.leadsLog}`);
  });
  servicesFor(config).social.start();
  // Оценка рынка: машинам без оценки (в том числе опубликованным до неё) и с оценкой старше 30 дней —
  // через 2 минуты после запуска и потом раз в сутки. Работает, когда подключена нейросеть.
  {
    const refreshMarket = () => {
      const svc = servicesFor(config);
      if (!smartParser(config).enabled || !svc.afterPublish.estimateAll) return;
      const stale = (c) => !c.marketEstimate || Date.now() - new Date(c.marketEstimate.at).getTime() > 30 * 864e5;
      const cars = require('./catalog').readCatalog(config.carsFile).cars.filter((c) => c.status !== 'sold' && !c.demo && stale(c));
      if (cars.length) { console.log(`Оценка рынка: ${cars.length} машин в очереди`); svc.afterPublish.estimateAll(cars); }
    };
    setTimeout(refreshMarket, 120000);
    setInterval(refreshMarket, 864e5);
  }
  // IndexNow: каталог изменился (бот или админка) — через минуту сообщаем Яндексу адреса изменённых машин.
  if (config.siteUrl && process.env.INDEXNOW !== '0') {
    const indexNow = require('./seo').createIndexNow(config);
    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => indexNow.check().catch(() => {}), 60000); };
    fs.watchFile(config.carsFile, { interval: 15000 }, later);
    later();
  }
  // Бот для объявлений: администраторы присылают фото и текст — машина появляется в каталоге.
  if (config.telegramToken && config.adminIds.length) {
    const api = telegramApi(config.telegramToken);
    let clips = null;
    if (config.clipsEnabled) {
      // Ролики: 3 на машину, после одобрения выходят по расписанию (CLIP_TIMES, МСК).
      const { renderCar } = require('./video/clips');
      const { createQueue, startScheduler, parseTimes } = require('./video/queue');
      const { createPublishers } = require('./video/publish');
      const queue = createQueue(path.join(config.clipsDir, 'queue.json'));
      const times = parseTimes(config.clipTimes);
      const publishers = createPublishers({ ...config, telegramBotToken: config.telegramToken });
      clips = {
        queue, times, targets: publishers.map((p) => p.name),
        render: (car, link) => renderCar(car, { publicDir: config.publicDir, photosDir: config.photosDir, outDir: config.clipsDir, appLink: link, phoneLabel: config.phoneLabel })
      };
      startScheduler({
        queue, times, publishers,
        notify: (item, results) => Promise.all(config.adminIds.map((id) => api.request('sendMessage', {
          chat_id: id, text: `Вышел ролик «${item.name}» по № ${item.carId}: ` +
            Object.entries(results).map(([k, v]) => `${k} — ${v === 'ok' ? 'готово' : 'ошибка: ' + v}`).join('; ')
        }).catch(() => {})))
      });
      console.log(`Ролики: слоты ${times.join(', ')} МСК, публикация в ${publishers.map((p) => p.name).join(', ') || 'никуда (не настроено)'}`);
    }
    createBot({
      api,
      adminIds: config.adminIds,
      carsFile: config.carsFile,
      photosDir: config.photosDir,
      appLink: config.appLink,
      social: servicesFor(config).social,
      parser: smartParser(config),
      onPublished: (car) => servicesFor(config).afterPublish.publish(car),
      clips
    }).start();
    console.log(`Бот объявлений запущен, администраторов: ${config.adminIds.length}`);
    if (smartParser(config).enabled) console.log(`Разбор объявлений нейросетью: ${config.llm.model}`);
  }
}

module.exports = { createApp, readConfig, createRateLimiter };
