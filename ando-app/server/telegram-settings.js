'use strict';
// Настройки Telegram из админки: адрес посредника (Cloudflare), токен бота, id администраторов.
// Хранятся в telegram.json рядом с журналом заявок (только для владельца) и важнее ando.env.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

function fileOf(config) { return path.join(path.dirname(config.leadsLog), 'telegram.json'); }

function read(config) {
  try { return JSON.parse(fs.readFileSync(fileOf(config), 'utf8')); } catch { return null; }
}

function save(config, data) {
  const file = fileOf(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

// Применить сохранённое к настройкам процесса — при запуске сервера, до запуска бота.
function apply(config, env = process.env) {
  const t = read(config);
  if (!t) return config;
  if (t.apiBase) env.TELEGRAM_API_BASE = t.apiBase;
  if (t.token) config.telegramToken = t.token;
  if (t.adminIds && t.adminIds.length) config.adminIds = t.adminIds.map(String);
  if (t.managerChatIds && t.managerChatIds.length) config.managerChatIds = t.managerChatIds.map(String);
  if (t.appLink && !config.appLink) config.appLink = t.appLink;
  return config;
}

// getMe через посредника: { ok, username } или { ok: false, error }.
function getMe(apiBase, token, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(apiBase.replace(/\/+$/, '') + `/bot${token}/getMe`); } catch { resolve({ ok: false, error: 'Неверный адрес' }); return; }
    const req = https.get(u, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* не JSON */ }
        if (body && body.ok && body.result) resolve({ ok: true, username: body.result.username });
        else if (body && body.ok === false) resolve({ ok: false, status: res.statusCode, error: res.statusCode === 401 || res.statusCode === 404 ? 'Telegram не знает такой токен. Скопируйте его заново в @BotFather.' : `Telegram ответил: ${body.description || res.statusCode}` });
        else resolve({ ok: false, status: res.statusCode, error: `Посредник ответил ${res.statusCode}, но не как Telegram. Проверьте адрес и что в Cloudflare вставлен код и нажат Deploy.` });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, error: `Сервер не может связаться с посредником: ${e.message}` }));
  });
}

module.exports = { read, save, apply, getMe, fileOf };
