'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function inspectVideo(file, ffprobe = 'ffprobe') {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true });
    let text = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Проверка MP4 превысила 30 секунд')); }, 30000);
    child.stdout.on('data', (chunk) => { text += chunk; if (text.length > 1024 * 1024) child.kill(); });
    child.stderr.resume();
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error('ffprobe не смог проверить готовый ролик'));
      try {
        const info = JSON.parse(text);
        const video = info.streams.find((stream) => stream.codec_type === 'video');
        const duration = Number(info.format.duration);
        if (!video || video.width !== 1080 || video.height !== 1920 || video.codec_name !== 'h264' || !(duration > 0 && duration <= 180)) {
          throw new Error('Нужен вертикальный H.264 MP4 1080×1920 длительностью до 180 секунд');
        }
        resolve(info);
      } catch (error) { reject(error); }
    });
  });
}

function createRenderApi({ config, jobs, workerToken = () => config.renderWorkerToken, inspect = inspectVideo }) {
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  function authorized(req) {
    const expected = workerToken();
    if (!expected || expected.length < 32) return false;
    const actual = Buffer.from(String(req.headers.authorization || ''));
    const wanted = Buffer.from('Bearer ' + expected);
    return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
  }
  async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) throw new Error('Слишком большой запрос worker');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  async function upload(req, id, lease) {
    jobs.heartbeat(id, lease);
    const root = path.resolve(config.renderDir || path.join(path.dirname(config.leadsLog), 'renders'));
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `${id}-${crypto.randomBytes(8).toString('hex')}.upload.mp4`);
    let size = 0;
    const limit = 256 * 1024 * 1024;
    try {
      const meter = new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length;
        callback(size > limit ? new Error('Готовый ролик превышает 256 МБ') : null, chunk);
      } });
      await pipeline(req, meter, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }));
      await inspect(file, config.ffprobePath || 'ffprobe');
      return jobs.complete(id, lease, file);
    } finally {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') console.error('Не удалён временный файл рендера'); }
    }
  }
  function sendFile(req, res, file) {
    const stat = fs.statSync(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  async function route(req, res, pathname) {
    if (!authorized(req)) { req.resume(); return json(res, 401, { error: 'Нет доступа worker' }); }
    if (pathname === '/api/render/claim' && req.method === 'POST') {
      const input = await body(req);
      return json(res, 200, { job: jobs.claim(String(input.workerId || '').slice(0, 100)) });
    }
    const target = /^\/api\/render\/jobs\/([a-f0-9]{32})\/(heartbeat|complete|fail|media\/(\d+))$/.exec(pathname);
    if (!target) { req.resume(); return json(res, 404, { error: 'Задание не найдено' }); }
    const [, id, action, index] = target;
    const lease = String(req.headers['x-render-lease'] || '');
    if (action.startsWith('media/') && ['GET', 'HEAD'].includes(req.method)) return sendFile(req, res, jobs.mediaFile(id, Number(index), lease));
    if (req.method !== 'POST') { req.resume(); return json(res, 405, { error: 'Нужен POST' }); }
    if (action === 'complete') {
      if (!/^video\/mp4(?:;|$)/i.test(req.headers['content-type'] || '')) { req.resume(); return json(res, 415, { error: 'Нужен video/mp4' }); }
      const complete = jobs.get(id);
      if (complete?.status === 'ready') {
        // complete() verifies the original lease before returning the existing receipt.
        req.resume();
        return json(res, 200, { job: jobs.complete(id, lease, jobs.outputFile(id)) });
      }
      return json(res, 200, { job: await upload(req, id, lease) });
    }
    const input = await body(req);
    return json(res, 200, { job: action === 'heartbeat' ? jobs.heartbeat(id, lease) :
      jobs.fail(id, lease, { message: input.error, permanent: input.permanent === true }) });
  }
  return {
    handle(req, res, pathname) {
      const video = /^\/api\/social\/video\/([a-f0-9]{32})\.mp4$/.exec(pathname);
      if (video) {
        if (!['GET', 'HEAD'].includes(req.method)) { req.resume(); json(res, 405, { error: 'Нужен GET' }); return true; }
        try { sendFile(req, res, jobs.outputFile(video[1])); }
        catch { json(res, 404, { error: 'Ролик не найден' }); }
        return true;
      }
      if (!pathname.startsWith('/api/render/')) return false;
      route(req, res, pathname).catch((error) => {
        req.resume();
        if (!res.headersSent && !res.destroyed) json(res, 409, { error: error.message });
      });
      return true;
    }
  };
}

module.exports = { createRenderApi, inspectVideo };
