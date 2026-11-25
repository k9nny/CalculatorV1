'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readCatalog } = require('../catalog');

const LEASE_MS = 5 * 60 * 1000;
const clone = (value) => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function revision(car) {
  const { marketEstimate, modelSpecs, vk, ...fields } = car;
  return digest(fields);
}

function safeStoryboard(value) {
  if (Array.isArray(value)) return value.map(safeStoryboard);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(src|file|path|localPath|localSrc|publicDir|photosDir|outDir|sources)$/i.test(key))
    .map(([key, item]) => [key, safeStoryboard(item)]));
}

function createRenderJobs({ config, now = () => new Date(), notify = async () => {} }) {
  const stateFile = path.join(path.dirname(config.leadsLog), 'render-jobs.json');
  const outputDir = path.resolve(config.renderDir || path.join(path.dirname(config.leadsLog), 'renders'));
  const time = () => new Date(now()).getTime();
  function read() {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (!Array.isArray(state.jobs)) throw new Error('Некорректная очередь рендера');
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return { jobs: [] };
      throw error;
    }
  }
  function save(state) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, stateFile);
  }
  function publicJob(job, includeLease = false) {
    if (!job) return null;
    const result = {
      id: job.id, carId: job.carId, revision: job.revision, status: job.status,
      createdAt: job.createdAt, updatedAt: job.updatedAt, attempts: job.attempts,
      storyboard: safeStoryboard(job.storyboard),
      sources: job.sources.map((source, index) => ({
        kind: source.kind, index, url: `/api/render/jobs/${job.id}/media/${index}`
      }))
    };
    if (job.error) result.error = job.error;
    if (job.nextAttemptAt) result.nextAttemptAt = job.nextAttemptAt;
    if (job.result) result.result = {
      sha256: job.result.sha256, bytes: job.result.bytes,
      publicUrl: `/api/social/video/${job.id}.mp4`
    };
    if (job.leaseExpiresAt) result.leaseExpiresAt = job.leaseExpiresAt;
    if (includeLease) {
      result.leaseToken = job.leaseToken;
      result.workerId = job.workerId;
    }
    return result;
  }
  function current(job) {
    const car = readCatalog(config.carsFile).cars.find((item) => String(item.id) === job.carId);
    if (!car || car.status === 'sold') return 'Машина продана или удалена из каталога';
    if (revision(car) !== job.revision) return 'Карточка изменилась. Создайте новый предпросмотр';
    return '';
  }
  function block(state, job, error) {
    job.status = 'blocked';
    job.error = error;
    job.updatedAt = new Date(time()).toISOString();
    save(state);
  }
  function sourceFile(src, car) {
    let root, relative;
    if (typeof src !== 'string' || src.includes('\\') || /[?#%]/.test(src)) {
      throw new Error('Недопустимый путь исходника');
    }
    if (/^img\/cars\/[^/]+$/.test(src)) {
      root = config.photosDir;
      relative = src.slice('img/cars/'.length);
    } else if (car.demo && /^img\/demo\/[^/]+$/.test(src)) {
      root = path.join(config.publicDir, 'img', 'demo');
      relative = src.slice('img/demo/'.length);
    } else {
      throw new Error('Разрешены только локальные кадры машины');
    }
    if (relative === '.' || relative === '..') throw new Error('Недопустимый путь исходника');
    const base = fs.realpathSync(root);
    const file = fs.realpathSync(path.join(base, relative));
    if (path.dirname(file) !== base || !fs.statSync(file).isFile()) throw new Error('Недопустимый путь исходника');
    return file;
  }
  function enqueue(car, storyboard) {
    const snapshot = clone(car);
    const story = clone(storyboard);
    const rev = revision(snapshot);
    const hash = digest(story);
    const state = read();
    const existing = state.jobs.find((job) => job.carId === String(car.id) && job.revision === rev && job.storyboardHash === hash);
    if (existing) return publicJob(existing);
    const job = {
      id: crypto.randomBytes(16).toString('hex'), carId: String(car.id), revision: rev,
      storyboardHash: hash, car: snapshot, storyboard: story, sources: [],
      status: 'queued', attempts: 0, createdAt: new Date(time()).toISOString(), updatedAt: new Date(time()).toISOString()
    };
    const invalid = current(job);
    if (invalid) throw new Error(invalid);
    job.sources = [
      ...(snapshot.videos || []).map((src) => ({ kind: 'video', file: sourceFile(src, snapshot) })),
      ...(snapshot.photos || []).map((src) => ({ kind: 'photo', file: sourceFile(src, snapshot) }))
    ];
    if (!job.sources.length) throw new Error('Для рендера нужны реальные фото или видео');
    if (Array.isArray(story.sources)) {
      const expected = [...(snapshot.videos || []), ...(snapshot.photos || [])];
      if (story.sources.length !== expected.length || story.sources.some((item, index) => item.src !== expected[index])) {
        throw new Error('Кадры сценария не совпадают с карточкой');
      }
    }
    state.jobs.push(job);
    save(state);
    return publicJob(job);
  }
  function get(id) { return publicJob(read().jobs.find((job) => job.id === String(id))); }
  function list() { return read().jobs.map((job) => publicJob(job)); }
  function retry(id) {
    const state = read();
    const job = state.jobs.find(item => item.id === id && ['failed', 'blocked'].includes(item.status));
    if (!job) throw new Error('Задание не готово к повтору');
    const invalid = current(job);
    if (invalid) throw new Error(invalid);
    job.status = 'queued';
    job.attempts = 0;
    job.updatedAt = new Date(time()).toISOString();
    delete job.error;
    delete job.nextAttemptAt;
    save(state);
    return publicJob(job);
  }
  function claim(workerId) {
    if (!String(workerId || '').trim()) throw new Error('Нужен идентификатор worker');
    const state = read();
    for (const job of state.jobs) {
      if (!['queued', 'failed'].includes(job.status) && !(job.status === 'rendering' && Date.parse(job.leaseExpiresAt) <= time())) continue;
      if (job.status === 'failed' && Date.parse(job.nextAttemptAt) > time()) continue;
      const invalid = current(job);
      if (invalid) { block(state, job, invalid); continue; }
      job.status = 'rendering';
      job.workerId = String(workerId);
      job.leaseToken = crypto.randomBytes(32).toString('hex');
      job.leaseExpiresAt = new Date(time() + LEASE_MS).toISOString();
      job.updatedAt = new Date(time()).toISOString();
      job.attempts += 1;
      delete job.error;
      delete job.nextAttemptAt;
      save(state);
      return publicJob(job, true);
    }
    return null;
  }
  function owned(job, lease, allowExpired = false) {
    const token = typeof lease === 'string' ? lease : lease?.leaseToken;
    if (!job || job.status !== 'rendering' || !token || job.leaseToken !== token ||
        (lease?.workerId && lease.workerId !== job.workerId)) throw new Error('Задание принадлежит другому worker или уже завершено');
    if (!allowExpired && Date.parse(job.leaseExpiresAt) <= time()) throw new Error('Аренда задания истекла');
  }
  function heartbeat(id, lease) {
    const state = read();
    const job = state.jobs.find((item) => item.id === String(id));
    owned(job, lease);
    job.leaseExpiresAt = new Date(time() + LEASE_MS).toISOString();
    job.updatedAt = new Date(time()).toISOString();
    save(state);
    return publicJob(job, true);
  }
  function fail(id, lease, error) {
    const state = read();
    const job = state.jobs.find((item) => item.id === String(id));
    owned(job, lease);
    job.status = error?.permanent || job.attempts >= 5 ? 'blocked' : 'failed';
    job.error = String(error?.message || error || 'Ошибка рендера').slice(0, 500);
    job.updatedAt = new Date(time()).toISOString();
    if (job.status === 'failed') job.nextAttemptAt = new Date(time() + Math.min(30 * 60000, 30000 * 2 ** job.attempts)).toISOString();
    save(state);
    return publicJob(job);
  }
  function mediaFile(id, index, lease) {
    const job = read().jobs.find((item) => item.id === String(id));
    owned(job, lease);
    if (!Number.isInteger(Number(index)) || Number(index) < 0 || !job.sources[Number(index)]) throw new Error('Кадр не найден');
    const source = job.sources[Number(index)];
    // Проверяем разрешённый путь повторно после возможной замены файла или симлинка.
    const original = [...(job.car.videos || []), ...(job.car.photos || [])][Number(index)];
    const allowed = sourceFile(original, job.car);
    if (allowed !== source.file) throw new Error('Исходный файл изменился');
    return allowed;
  }
  function artifact(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Нужен локальный MP4-файл');
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 12) throw new Error('Пустой или некорректный MP4');
    const fd = fs.openSync(file, 'r');
    const hash = crypto.createHash('sha256');
    try {
      const header = Buffer.alloc(12);
      fs.readSync(fd, header, 0, 12, 0);
      if (header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Результат должен быть MP4 с заголовком ftyp');
      const chunk = Buffer.alloc(1024 * 1024);
      let bytes;
      while ((bytes = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, bytes));
    } finally { fs.closeSync(fd); }
    return { bytes: stat.size, sha256: hash.digest('hex') };
  }
  function complete(id, lease, file) {
    const state = read();
    const job = state.jobs.find((item) => item.id === String(id));
    const token = typeof lease === 'string' ? lease : lease?.leaseToken;
    if (job?.status === 'ready' && job.completedLeaseToken === token && token) {
      const incoming = artifact(file);
      if (incoming.sha256 !== job.result.sha256) throw new Error('Этот worker уже завершил задание другим файлом');
      return publicJob(job);
    }
    // Просроченный worker может закончить, пока задание ещё не перехвачено новым.
    owned(job, lease, true);
    const invalid = current(job);
    if (invalid) { block(state, job, invalid); throw new Error(invalid); }
    const result = artifact(file);
    fs.mkdirSync(outputDir, { recursive: true });
    const target = path.join(outputDir, `${job.id}.mp4`);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.copyFileSync(file, temporary);
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
    job.status = 'ready';
    job.updatedAt = new Date(time()).toISOString();
    job.completedLeaseToken = token;
    job.result = { ...result, file: target };
    delete job.error;
    save(state);
    const ready = publicJob(job);
    Promise.resolve().then(() => notify(ready)).catch(() => {});
    return ready;
  }
  function outputFile(id) {
    const job = read().jobs.find((item) => item.id === String(id));
    if (!job || job.status !== 'ready') throw new Error('Ролик ещё не готов');
    const invalid = current(job);
    if (invalid) throw new Error(invalid);
    const target = path.resolve(job.result.file);
    if (path.dirname(target) !== outputDir || fs.realpathSync(target) !== target) throw new Error('Недопустимый путь результата');
    return target;
  }
  return { enqueue, get, list, retry, claim, heartbeat, fail, complete, mediaFile, outputFile };
}

module.exports = { createRenderJobs };
