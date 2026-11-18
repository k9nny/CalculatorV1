'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readCatalog } = require('./catalog');

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Один процесс сервера владеет журналом. sending после рестарта требует сверки:
// площадка могла принять запрос до обрыва соединения.
function createSocial({ config, publishers, now = () => new Date(), notify = async () => {} }) {
  const file = path.join(path.dirname(config.leadsLog), 'social.json');
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { batches: [] };
  }
  if (!Array.isArray(state.batches)) throw new Error('Повреждён журнал публикаций');
  let busy = false;
  let timer;
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  };
  for (const batch of state.batches) {
    for (const job of batch.jobs) if (job.status === 'sending') {
      job.status = 'review';
      job.error = 'Сервер перезапустился во время отправки. Проверьте канал перед повтором.';
    }
  }
  function carById(id) {
    const car = readCatalog(config.carsFile).cars.find((c) => String(c.id) === String(id));
    if (!car || car.demo || (car.status && car.status !== 'available')) throw new Error('Для публикации нужна настоящая машина в продаже');
    return car;
  }
  function content(car) {
    const site = String(config.siteUrl || '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(site)) throw new Error('Укажите HTTPS-адрес сайта в SITE_URL');
    const link = `${site}/cars/${encodeURIComponent(car.id)}/`;
    const fmt = (n) => Number(n).toLocaleString('ru-RU');
    const text = [
      `${car.make} ${car.model}, ${car.year}`,
      `${fmt(car.price)} ₽ · ${fmt(car.mileage)} км`,
      car.city,
      [car.engine?.volume && `${car.engine.volume} л`, car.transmission, car.drive].filter(Boolean).join(' · '),
      car.description,
      car.paint && `Окрасы: ${car.paint}`,
      car.defects?.length && `Недостатки: ${car.defects.join(', ')}`,
      car.serviceDone?.length && `Обслуживание: ${car.serviceDone.join(', ')}`,
      'Фото и запись на осмотр', link
    ].filter(Boolean).join('\n');
    const photos = (car.photos || []).slice(0, 10).map((src) => {
      if (/^https:\/\//.test(src)) return src;
      const base = config.appLink?.startsWith('https://') && !config.appLink.includes('t.me/')
        ? config.appLink : site + '/app/';
      return new URL(src, base.replace(/\/?$/, '/')).href;
    });
    return { link, text, photos, car: JSON.parse(JSON.stringify(car)) };
  }
  function revision(car) {
    // Не включаем оценки нейросети и внешние квитанции в пользовательский снимок.
    const { marketEstimate, modelSpecs, vk, ...fields } = car;
    return digest(fields);
  }
  function postedJob(carId, rev, key) {
    return state.batches.filter((b) => b.carId === carId && b.revision === rev)
      .flatMap((b) => b.jobs).find((j) => j.key === key && j.status === 'posted');
  }
  function preview(id) {
    const car = carById(id);
    const media = content(car);
    const targets = publishers();
    if (!targets.length) throw new Error('Каналы не подключены. /social — настройки');
    const rev = revision(car);
    const key = digest({ id, rev, targets: targets.map((p) => p.key) });
    const existing = state.batches.find((b) => b.key === key);
    if (existing) return existing;
    const pending = state.batches.find((b) => b.carId === String(id) && b.revision === rev && b.approved && b.jobs.some((j) => j.status !== 'posted'));
    if (pending) return pending;
    const batch = {
      id: crypto.randomBytes(8).toString('hex'), key, carId: String(id), revision: rev,
      createdAt: now().toISOString(), approved: false,
      jobs: targets.map((p) => {
        const prior = postedJob(String(id), rev, p.key);
        const oldPost = p.key.startsWith('vk:') && car.vk?.postId &&
          String(car.vk.url || '').includes(`wall-${p.key.slice(3)}_`);
        return { key: p.key, name: p.name, status: prior || oldPost ? 'posted' : 'draft', attempts: 0,
          ...(prior || oldPost ? { receipt: prior?.receipt || car.vk } : {}), payload: p.prepare(media) };
      })
    };
    state.batches.push(batch);
    save();
    return batch;
  }
  const get = (id) => state.batches.find((b) => b.id === id);
  function validate(batch, checkChannels = true) {
    if (!batch) throw new Error('Предпросмотр не найден. Создайте новый.');
    if (revision(carById(batch.carId)) !== batch.revision) throw new Error('Карточка изменилась. Создайте новый предпросмотр.');
    const keys = publishers().map((p) => p.key);
    if (checkChannels && batch.jobs.some((j) => j.status !== 'posted' && !keys.includes(j.key))) throw new Error('Подключения изменились. Проверьте каналы.');
  }
  function approve(id) {
    const batch = get(id);
    validate(batch);
    if (batch.approved) return batch;
    batch.approved = true;
    batch.approvedAt = now().toISOString();
    for (const job of batch.jobs) if (job.status === 'draft') job.status = 'queued';
    save();
    return batch;
  }
  function retry(id) {
    const batch = get(id);
    validate(batch, false);
    if (!batch.approved) throw new Error('Сначала подтвердите публикацию');
    for (const job of batch.jobs) if (['failed', 'blocked', 'retry'].includes(job.status)) {
      job.status = 'queued';
      job.attempts = 0;
      delete job.nextAt;
    }
    save();
    return batch;
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const batch of state.batches.filter((b) => b.approved)) {
        let changed = false;
        for (const job of batch.jobs) {
          if (!['queued', 'retry'].includes(job.status) || (job.nextAt && Date.parse(job.nextAt) > now().getTime())) continue;
          try { validate(batch, false); } catch (error) {
            job.status = 'blocked'; job.error = error.message; save(); changed = true; continue;
          }
          const publisher = publishers().find((p) => p.key === job.key);
          if (!publisher) { job.status = 'blocked'; job.error = 'Канал отключён'; save(); changed = true; continue; }
          const prior = postedJob(batch.carId, batch.revision, job.key);
          if (prior) { job.status = 'posted'; job.receipt = prior.receipt; save(); changed = true; continue; }
          job.status = 'sending'; job.attempts++; save();
          try {
            const receipt = await publisher.post(job.payload);
            job.status = 'posted'; job.receipt = receipt; job.postedAt = now().toISOString(); delete job.error;
          } catch (error) {
            job.error = error.message.slice(0, 300);
            if (error.retryable && job.attempts < 5) {
              job.status = 'retry';
              job.nextAt = new Date(now().getTime() + Math.max(Number(error.retryAfter) || 0, 30 * 2 ** (job.attempts - 1)) * 1000).toISOString();
            } else job.status = error.uncertain ? 'review' : error.retryable ? 'failed' : 'blocked';
          }
          save(); changed = true;
        }
        if (changed) await notify(batch).catch(() => {});
      }
    } finally { busy = false; }
  }
  return {
    preview, approve, retry, get, tick,
    channels: () => publishers().map(({ key, name }) => ({ key, name })),
    start() { if (!timer) { save(); timer = setInterval(() => tick().catch(console.error), 5000); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; }
  };
}

module.exports = { createSocial };
