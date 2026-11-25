'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hash, failure, approved, textWithByteLimit, store, transport, header, check, accountPayload } = require('./common');
const { createYouTubeToken } = require('./tokens');

const inflight = new Map();
const CHUNK_SIZE = 8 * 1024 * 1024; // YouTube requires non-final chunks to be multiples of 256 KiB.

function fileInfo(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || !stat.size) throw failure('YouTube: файл ролика пуст или недоступен');
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, size));
  } finally { fs.closeSync(fd); }
  return { bytes: stat.size, sha256: digest.digest('hex') };
}

function createYouTubePublisher(config, opts = {}) {
  const request = opts.transport || transport;
  const channelId = String(config.youtubeChannelId || '').trim();
  if (channelId && !/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) throw failure('YouTube: укажите ID канала вида UC…');
  const key = `youtube:${channelId || hash(config.youtubeRefreshToken || '').slice(0, 24)}`;
  const token = createYouTubeToken(config, opts);

  function prepare(media) {
    if (!media.video?.file) throw failure('YouTube: сначала подготовьте вертикальный MP4');
    const file = path.resolve(media.video.file);
    const privacyStatus = media.video.privacyStatus || config.youtubePrivacyStatus || 'private';
    if (!['private', 'unlisted', 'public'].includes(privacyStatus)) throw failure('YouTube: неверный режим видимости');
    const carTitle = [media.car?.make, media.car?.model, media.car?.year].filter(Boolean).join(' ');
    const title = Array.from(String(media.video.title || carTitle || 'ANDO AUTO').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 100).join('');
    if (!title) throw failure('YouTube: добавьте название ролика');
    const text = textWithByteLimit(media.text, media.link, 5000);
    return {
      account: key, text, photos: [], title, privacyStatus, link: media.link || '',
      video: { file, ...fileInfo(file), ...(media.video.url ? { url: media.video.url } : {}) },
      ...(typeof media.video.containsSyntheticMedia === 'boolean' ? { containsSyntheticMedia: media.video.containsSyntheticMedia } : {}),
    };
  }

  async function postSnapshot(payload) {
    const checkpoint = store(config, 'youtube-post', payload);
    const state = checkpoint.read();
    if (state.receipt) return state.receipt;
    const info = fileInfo(payload.video.file);
    if (info.sha256 !== payload.video.sha256 || info.bytes !== payload.video.bytes) throw failure('Ролик изменился после предпросмотра. Подтвердите новую версию.');
    const save = () => checkpoint.write(state);

    async function api(url, options = {}) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.hostname !== 'www.googleapis.com' || target.username || target.password) {
        throw failure('YouTube: недопустимый адрес API или сохранённой сессии');
      }
      let accessToken = await token.get();
      const send = () => request({ ...options, url, headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } });
      let response = await send();
      if (response.status === 401) {
        token.invalidate();
        // A stream must be reopened on the next invocation. Its durable upload
        // session will first reconcile the acknowledged byte range.
        if (options.body?.pipe) throw failure('YouTube: обновляю доступ и продолжу загрузку', { retryable: true, retryAfter: 30 });
        accessToken = await token.get();
        response = await send();
      }
      return response;
    }
    if (channelId) {
      const result = check(await api('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true'), 'YouTube');
      if (!result.body?.items?.some((item) => item.id === channelId)) throw failure('YouTube: OAuth подключён к другому каналу');
    }

    function completed(response) {
      check(response, 'YouTube');
      if (!/^[A-Za-z0-9_-]+$/.test(String(response.body?.id || ''))) {
        throw failure('YouTube: проверяю результат загрузки', { retryable: true, retryAfter: 60 });
      }
      state.receipt = {
        id: String(response.body.id), url: `https://www.youtube.com/watch?v=${response.body.id}`,
        privacyStatus: response.body.status?.privacyStatus || payload.privacyStatus,
      };
      // Persist confirmation before returning to the scheduler.
      delete state.sessionUrl;
      save();
      return state.receipt;
    }

    function offset(response) {
      const range = header(response, 'range');
      if (!range) return 0;
      const match = /^bytes=0-(\d+)$/i.exec(String(range));
      if (!match || Number(match[1]) >= info.bytes) throw failure('YouTube: некорректный диапазон загруженных байтов', { uncertain: true });
      return Number(match[1]) + 1;
    }

    if (state.sessionUrl) {
      // A zero-byte PUT asks the same upload session what Google actually received.
      // It also recovers the final video ID after a lost successful upload response.
      const response = await api(state.sessionUrl, { method: 'PUT', headers: {
        'Content-Length': '0', 'Content-Range': `bytes */${info.bytes}`,
      } });
      if (response.status >= 200 && response.status < 300) return completed(response);
      if (response.status === 404 || response.status === 410) {
        if (state.uploadStarted) throw failure('YouTube: сессия загрузки истекла. Проверьте канал перед новой отправкой.', { uncertain: true });
        delete state.sessionUrl;
        save();
      } else {
        if (response.status !== 308) check(response, 'YouTube');
        state.offset = offset(response);
        save();
      }
    }

    if (!state.sessionUrl) {
      const status = { privacyStatus: payload.privacyStatus, selfDeclaredMadeForKids: false };
      if (typeof payload.containsSyntheticMedia === 'boolean') status.containsSyntheticMedia = payload.containsSyntheticMedia;
      const metadata = JSON.stringify({ snippet: { title: payload.title, description: payload.text, categoryId: '2' }, status });
      const response = check(await api('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(info.bytes), 'X-Upload-Content-Type': 'video/mp4' }, body: metadata,
      }), 'YouTube');
      const session = new URL(String(header(response, 'location') || ''));
      if (session.protocol !== 'https:' || session.hostname !== 'www.googleapis.com' || session.username || session.password) {
        throw failure('YouTube: неожиданный адрес сессии загрузки');
      }
      state.sessionUrl = session.href;
      state.offset = 0;
      save();
    }

    while (state.offset < info.bytes) {
      const start = state.offset;
      const end = Math.min(start + CHUNK_SIZE, info.bytes) - 1;
      // Open synchronously before awaiting OAuth so an early fs.open error cannot
      // emit an unhandled stream error while the transport is not attached yet.
      const body = fs.createReadStream(payload.video.file, { fd: fs.openSync(payload.video.file, 'r'), start, end });
      state.uploadStarted = true;
      save();
      let response;
      try {
        response = await api(state.sessionUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4',
          'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${info.bytes}` }, body });
      } finally { body.destroy(); }
      if (response.status >= 200 && response.status < 300) return completed(response);
      if (response.status !== 308) check(response, 'YouTube');
      state.offset = offset(response);
      save();
      if (state.offset <= start) throw failure('YouTube: загрузка не продвинулась. Продолжу с той же сессии.', { retryable: true, retryAfter: 60 });
    }
    throw failure('YouTube: ожидаю подтверждения загрузки', { retryable: true, retryAfter: 60 });
  }

  return {
    key, name: channelId ? `YouTube ${channelId}` : 'YouTube (OAuth-канал)', prepare, reconciles: true,
    supports: (media) => Boolean(media.video?.file),
    refresh: () => token.get(),
    async post(payload, context) {
      approved(context);
      accountPayload(payload, key);
      const lock = store(config, 'youtube-post', payload).file;
      if (!inflight.has(lock)) inflight.set(lock, postSnapshot(payload).finally(() => inflight.delete(lock)));
      return inflight.get(lock);
    },
  };
}

module.exports = { createYouTubePublisher };
