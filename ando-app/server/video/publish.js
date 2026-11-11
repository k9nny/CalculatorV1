'use strict';
// Отправка роликов в соцсети: Telegram-канал (Bot API sendVideo) и VK (video.save).
// Только встроенные модули Node.

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// POST multipart/form-data с одним файлом. Файл читается потоком.
function postMultipart(url, fields, file) {
  return new Promise((resolve, reject) => {
    const boundary = '----ando' + crypto.randomBytes(12).toString('hex');
    const parts = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
    const head = file
      ? `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${path.basename(file.path)}"\r\nContent-Type: ${file.type || 'video/mp4'}\r\n\r\n`
      : '';
    const tail = `${file ? '\r\n' : ''}--${boundary}--\r\n`;
    const pre = Buffer.from(parts.join('') + head);
    const post = Buffer.from(tail);
    const size = file ? fs.statSync(file.path).size : 0;
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: 180000,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': pre.length + size + post.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); } catch { reject(new Error(`ответ не JSON (${res.statusCode}): ${text.slice(0, 200)}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(pre);
    if (!file) { req.end(post); return; }
    const stream = fs.createReadStream(file.path);
    stream.on('error', (e) => req.destroy(e));
    stream.on('end', () => req.end(post));
    stream.pipe(req, { end: false });
  });
}

async function telegramVideo(token, chatId, file, caption, extra = {}) {
  const base = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
  const res = await postMultipart(`${base}/bot${token}/sendVideo`, {
    chat_id: chatId, caption: caption ? caption.slice(0, 1024) : '', supports_streaming: 'true',
    width: 1080, height: 1920, ...extra,
  }, { field: 'video', path: file });
  if (!res.ok) throw new Error(res.description || 'sendVideo');
  return res.result;
}

function vkCall(method, params, token) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ ...params, access_token: token, v: '5.199' }).toString();
    const req = https.request({
      hostname: 'api.vk.com', path: `/method/${method}`, method: 'POST', timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (json.error) reject(new Error(`VK ${method}: ${json.error.error_msg}`)); else resolve(json.response);
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

// Видео в сообщество VK с публикацией на стене. Нужен ключ пользователя-админа
// сообщества с правами video и wall: video.save не работает с ключом сообщества.
async function vkVideo(token, groupId, file, name, description) {
  const save = await vkCall('video.save', {
    group_id: String(groupId).replace(/^-/, ''), name: name.slice(0, 128), description: description.slice(0, 5000),
    wallpost: 1, repeat: 0,
  }, token);
  const up = await postMultipart(save.upload_url, {}, { field: 'video_file', path: file });
  if (up.error) throw new Error('VK upload: ' + (up.error_msg || up.error));
  return { owner_id: save.owner_id, video_id: save.video_id };
}

// Куда публиковать — по заполненным переменным окружения.
function createPublishers(cfg) {
  const list = [];
  if (cfg.telegramBotToken && cfg.clipTelegramChannel) {
    list.push({ name: 'Telegram', post: (item) => telegramVideo(cfg.telegramBotToken, cfg.clipTelegramChannel, item.file, item.caption) });
  }
  if (cfg.vkToken && cfg.vkGroupId) {
    list.push({ name: 'VK', post: (item) => vkVideo(cfg.vkToken, cfg.vkGroupId, item.file, item.title || 'ANDO AUTO', item.caption) });
  }
  return list;
}

module.exports = { postMultipart, telegramVideo, vkCall, vkVideo, createPublishers };
