'use strict';
// Сервер мини-приложения ANDO AUTO: раздаёт приложение и принимает заявки.
// Без зависимостей, Node 18+. Настройки — переменные окружения (см. .env.example).
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { validateInitData } = require('./initdata');
const { validateLead, formatLeadMessage } = require('./leads');

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
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Встраивание не запрещаем: веб-версии Telegram и MAX открывают приложение во фрейме.
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' https://telegram.org https://st.max.ru; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; form-action 'self'"
};

function readConfig(env = process.env) {
  const root = path.resolve(__dirname, '..');
  return {
    port: Number(env.PORT) || 8080,
    host: env.HOST || '0.0.0.0',
    publicDir: path.resolve(env.PUBLIC_DIR || path.join(root, 'public')),
    carsFile: path.resolve(env.CARS_FILE || path.join(root, 'public', 'data', 'cars.json')),
    leadsLog: path.resolve(env.LEADS_LOG || path.join(root, 'data-private', 'leads.jsonl')),
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    maxToken: env.MAX_BOT_TOKEN || '',
    managerChatIds: String(env.MANAGER_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    requireInitData: env.REQUIRE_INIT_DATA === '1',
    trustProxy: env.TRUST_PROXY === '1',
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  };
}

function sendTelegramMessage(token, chatId, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
    const req = https.request(
      {
        hostname: 'api.telegram.org',
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

function readBody(req, limit = 16 * 1024) {
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createApp(config = readConfig(), deps = {}) {
  const send = deps.sendTelegramMessage || sendTelegramMessage;
  const allow = deps.rateLimiter || createRateLimiter();

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
    const logged = appendLog({
      at: new Date().toISOString(),
      ...lead,
      source: { platform: source.platform, verified: source.verified, userId: source.user && source.user.id }
    });

    let delivered = 0;
    if (config.telegramToken && config.managerChatIds.length) {
      const text = formatLeadMessage(lead, source);
      const results = await Promise.all(config.managerChatIds.map((id) => send(config.telegramToken, id, text)));
      delivered = results.filter(Boolean).length;
    }
    if (!logged && !delivered) return json(res, 502, { error: 'Не получилось принять заявку. Позвоните нам.' }, cors);
    return json(res, 200, { ok: true, delivered }, cors);
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
    const file = path.normalize(path.join(config.publicDir, pathname));
    const inside = file.startsWith(config.publicDir + path.sep);
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
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': fresh ? 'no-cache' : 'public, max-age=86400',
        ...SECURITY_HEADERS
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  return http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/api/lead') {
      handleLead(req, res).catch(() => json(res, 500, { error: 'Ошибка сервера' }));
      return;
    }
    if (pathname === '/healthz') return json(res, 200, { ok: true });
    serveStatic(req, res);
  });
}

if (require.main === module) {
  const config = readConfig();
  createApp(config).listen(config.port, config.host, () => {
    const notify = config.telegramToken && config.managerChatIds.length ? `в Telegram (${config.managerChatIds.length} чат.)` : 'только в журнал';
    console.log(`ANDO AUTO: http://${config.host}:${config.port} — заявки ${notify}, журнал ${config.leadsLog}`);
  });
}

module.exports = { createApp, readConfig, createRateLimiter };
