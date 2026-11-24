'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { readCatalog } = require('./catalog');

function fingerprint(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex').slice(0, 16);
}

function createPhotoRenditions(config, { run } = {}) {
  const cacheDir = path.join(path.dirname(config.leadsLog), 'social-jpeg');
  const inFlight = new Map();
  const convert = run || ((args) => new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath || 'ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Подготовка JPEG превысила 30 секунд'));
    }, 30000);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`Не удалось запустить FFmpeg: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg не подготовил JPEG (${code}): ${stderr}`));
    });
  }));

  function source(src) {
    if (typeof src !== 'string' || !/^img\/cars\/[^/\\%?#]+\.(?:jpe?g|png|webp)$/i.test(src)) {
      throw new Error('Для Instagram нужны локальные фото машины или публичные HTTPS JPEG');
    }
    const root = fs.realpathSync(config.photosDir);
    const file = fs.realpathSync(path.join(root, src.slice('img/cars/'.length)));
    if (path.dirname(file) !== root || !fs.statSync(file).isFile()) throw new Error('Фото находится вне папки автомобилей');
    return file;
  }

  function urls(car) {
    if (!car || car.demo || car.status !== 'available') throw new Error('Для Instagram нужна доступная машина из каталога');
    if (!/^[\w-]{1,100}$/.test(String(car.id))) throw new Error('Некорректный номер машины');
    const base = String(config.siteUrl || '').replace(/\/+$/, '');
    return (car.photos || []).slice(0, 10).map((src, index) => {
      if (typeof src === 'string' && /^https:\/\//i.test(src)) {
        const url = new URL(src);
        if (!/\.jpe?g$/i.test(url.pathname) || url.username || url.password) {
          throw new Error('Внешнее фото для Instagram должно быть публичным HTTPS JPEG (.jpg или .jpeg)');
        }
        return src;
      }
      if (!/^https:\/\//i.test(base)) throw new Error('Для Instagram настройте публичный HTTPS адрес SITE_URL');
      let file;
      try { file = source(src); } catch (error) {
        if (error.code === 'ENOENT') throw new Error('Фото машины не найдено для подготовки Instagram');
        throw error;
      }
      return `${base}/api/social/photo/${car.id}/${index}/${fingerprint(file)}.jpg`;
    });
  }

  function validJpeg(file) {
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const head = Buffer.alloc(3);
        return fs.fstatSync(fd).size > 3 && fs.readSync(fd, head, 0, 3, 0) === 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      } finally { fs.closeSync(fd); }
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  function ensure(file, hash) {
    const target = path.join(cacheDir, `${hash}.jpg`);
    if (validJpeg(target)) return Promise.resolve(target);
    if (inFlight.has(hash)) return inFlight.get(hash);
    const work = (async () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      const temporary = path.join(cacheDir, `${hash}.${crypto.randomBytes(8).toString('hex')}.tmp.jpg`);
      try {
        const args = ['-y', '-v', 'error', '-i', file, '-vf',
          'scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1',
          '-frames:v', '1', '-q:v', '2', '-pix_fmt', 'yuvj420p', '-f', 'image2', temporary];
        await convert(args, temporary);
        if (!validJpeg(temporary)) throw new Error('FFmpeg вернул некорректный JPEG');
        if (fingerprint(file) !== hash) throw new Error('Фото изменилось во время подготовки JPEG');
        fs.chmodSync(temporary, 0o600);
        fs.renameSync(temporary, target);
        return target;
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    })();
    inFlight.set(hash, work);
    work.then(() => inFlight.delete(hash), () => inFlight.delete(hash));
    return work;
  }

  function reply(res, code, message) {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(message);
  }

  function currentSource(id, index, hash) {
    const car = readCatalog(config.carsFile).cars.find((item) => String(item.id) === id);
    if (!car || car.demo || car.status !== 'available') return null;
    const src = car.photos?.[index];
    if (!src || index >= 10) return null;
    try {
      const file = source(src);
      return fingerprint(file) === hash ? file : null;
    } catch { return null; }
  }

  function handle(req, res, pathname) {
    const match = /^\/api\/social\/photo\/([\w-]{1,100})\/(\d)\/([a-f0-9]{16})\.jpg$/.exec(pathname);
    if (!match) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      reply(res, 405, 'Метод не поддерживается');
      return true;
    }
    const [, id, rawIndex, hash] = match;
    const index = Number(rawIndex);
    const file = currentSource(id, index, hash);
    if (!file) { reply(res, 404, 'Фото недоступно'); return true; }
    ensure(file, hash).then((output) => {
      // Машина могла быть продана или фото заменено во время рендера.
      if (!currentSource(id, index, hash)) { reply(res, 404, 'Фото недоступно'); return; }
      const bytes = fs.readFileSync(output);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg', 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    }).catch(() => {
      if (!res.headersSent) reply(res, 503, 'Не удалось подготовить JPEG для Instagram');
      else res.destroy();
    });
    return true;
  }

  return { urls, handle };
}

module.exports = { createPhotoRenditions };
