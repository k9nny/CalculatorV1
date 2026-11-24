'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readCatalog } = require('./catalog');
const { officialFacts, selectFacts } = require('./telegram-post');

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Один процесс сервера владеет журналом. sending после рестарта требует сверки:
// площадка могла принять запрос до обрыва соединения.
function createSocial({ config, publishers, copywriter, now = () => new Date(), notify = async () => {} }) {
  const file = path.join(path.dirname(config.leadsLog), 'social.json');
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { batches: [] };
  }
  if (!Array.isArray(state.batches)) throw new Error('Повреждён журнал публикаций');
  const draftsInProgress = new Map();
  let busy = false;
  let timer;
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  };
  for (const batch of state.batches) {
    for (const job of batch.jobs) if (job.status === 'sending') {
      const canReconcile = publishers().some(p => p.key === job.key && p.reconciles);
      job.status = canReconcile ? 'retry' : 'review';
      job.error = canReconcile ? 'Проверяем результат отправки.' : 'Сервер перезапустился во время отправки. Проверьте канал перед повтором.';
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
  function reelAsset(car, index) {
    const src = car.videos?.[index];
    if (typeof src !== 'string' || !/^img\/cars\/[\w.-]+\.mp4$/i.test(src)) {
      throw new Error('Для Reels добавьте к машине ролик MP4.');
    }
    const file = path.join(config.photosDir, path.basename(src));
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || !stat.size) throw new Error('Файл ролика недоступен.');
    const site = String(config.siteUrl || '').replace(/\/+$/, '');
    return { video: { url: site + '/app/' + src }, key: 'video:' + digest([src, stat.size, stat.mtimeMs]) };
  }
  function postedJob(carId, rev, key, assetKey = 'listing') {
    return state.batches.filter((b) => b.carId === carId && b.revision === rev && (b.assetKey || 'listing') === assetKey)
      .flatMap((b) => b.jobs).find((j) => j.key === key && j.status === 'posted');
  }
  function preview(id, options = {}) {
    const car = carById(id);
    const media = content(car);
    const reel = options.reelIndex !== undefined ? reelAsset(car, options.reelIndex) : null;
    if (reel) media.video = reel.video;
    const platform = reel ? 'instagram' : options.platform;
    const targets = publishers().filter(p => (!platform || p.key.startsWith(platform + ':'))
      && (!p.supports || p.supports(media)));
    if (!targets.length && platform) throw new Error(platform === 'instagram' ? 'Подключите Instagram в настройках и добавьте медиа к карточке.' : 'Подключите Threads в настройках.');
    if (!targets.length) throw new Error('Каналы не подключены. /social — настройки');
    const rev = revision(car);
    if (options.expectedRevision && options.expectedRevision !== rev) {
      return preview(id, { ...options, expectedRevision: undefined, telegramFacts: undefined, enhance: true });
    }
    const telegramTarget = !reel && targets.find(target => target.template);
    const templates = telegramTarget ? [telegramTarget.template] : undefined;
    const assetKey = reel?.key || 'listing';
    const key = digest({ id, rev, targets: targets.map((p) => p.key), templates, ...(reel && { assetKey }) });
    const existing = state.batches.find((b) => b.key === key);
    if (existing && (existing.approved || !existing.jobs.some(job => job.preparationFailed))) return existing;
    const pending = !platform && state.batches.find((b) => b.carId === String(id) && b.revision === rev
      && (b.assetKey || 'listing') === assetKey && b.approved && b.jobs.some((j) => j.status !== 'posted'));
    if (pending) return pending;
    const needsTelegramDraft = telegramTarget && !postedJob(String(id), rev, telegramTarget.key);
    if (needsTelegramDraft && options.enhance && copywriter?.enabled) {
      if (draftsInProgress.has(key)) return draftsInProgress.get(key);
      const generation = selectFacts(officialFacts(car), copywriter)
        .then(telegramFacts => preview(id, { ...options, enhance: false, expectedRevision: rev, telegramFacts }))
        .finally(() => draftsInProgress.delete(key));
      draftsInProgress.set(key, generation);
      return generation;
    }
    if (telegramTarget) Object.assign(media, { telegramListing: true, telegramFacts: options.telegramFacts });
    const batch = {
      id: crypto.randomBytes(8).toString('hex'), key, carId: String(id), revision: rev,
      createdAt: now().toISOString(), approved: false, ...(reel && { assetKey, reelIndex: options.reelIndex }),
      jobs: targets.map((p) => {
        const prior = postedJob(String(id), rev, p.key, assetKey);
        const oldPost = !reel && p.key.startsWith('vk:') && car.vk?.postId &&
          String(car.vk.url || '').includes(`wall-${p.key.slice(3)}_`);
        const job = { key: p.key, name: p.name, status: prior || oldPost ? 'posted' : 'draft', attempts: 0 };
        try { return { ...job,
          ...(prior || oldPost ? { receipt: prior?.receipt || car.vk, postedAt: prior?.postedAt } : {}), payload: prior?.payload || p.prepare(media) };
        } catch (error) {
          if (platform || !p.key.startsWith('instagram:')) throw error;
          return { ...job, status: 'blocked', preparationFailed: true, error: error.message, payload: { text: '' } };
        }
      })
    };
    if (existing && !existing.approved) state.batches.splice(state.batches.indexOf(existing), 1, batch);
    else state.batches.push(batch);
    save();
    return batch;
  }
  const get = (id) => state.batches.find((b) => b.id === id);
  function validate(batch, checkChannels = true) {
    if (!batch) throw new Error('Предпросмотр не найден. Создайте новый.');
    const car = carById(batch.carId);
    if (batch.reelIndex !== undefined && reelAsset(car, batch.reelIndex).key !== batch.assetKey) throw new Error('Видео изменилось. Создайте новый предпросмотр.');
    if (revision(car) !== batch.revision) throw new Error('Карточка изменилась. Создайте новый предпросмотр.');
    const currentPublishers = publishers();
    const keys = currentPublishers.map((p) => p.key);
    if (!batch.approved && (!batch.assetKey || batch.assetKey === 'listing') && batch.jobs.some(job =>
      job.status === 'draft' && !job.payload.entities && currentPublishers.some(p => p.key === job.key && p.template))) {
      throw new Error('Формат поста обновлён. Подготовьте новый предпросмотр из карточки машины.');
    }
    if (checkChannels && batch.jobs.some((j) => j.status !== 'posted' && !keys.includes(j.key))) throw new Error('Подключения изменились. Проверьте каналы.');
  }
  function approve(id, scheduledAt) {
    const batch = get(id);
    validate(batch);
    if (batch.approved) return batch;
    const approvedAt = now();
    if (scheduledAt != null) {
      const time = typeof scheduledAt === 'string' ? Date.parse(scheduledAt) : NaN;
      if (!Number.isFinite(time) || time <= approvedAt.getTime()) throw new Error('Укажите будущее время публикации');
      batch.scheduledAt = new Date(time).toISOString();
    }
    batch.approved = true;
    batch.approvedAt = approvedAt.toISOString();
    for (const job of batch.jobs) if (job.status === 'draft') job.status = 'queued';
    save();
    return batch;
  }
  function cancelSchedule(id) {
    const batch = get(id);
    if (!batch?.approved || !batch.scheduledAt || Date.parse(batch.scheduledAt) <= now().getTime() ||
        batch.jobs.some((job) => !job.preparationFailed && job.status !== 'queued' && job.status !== 'posted')) {
      throw new Error('Время уже наступило или публикация не запланирована');
    }
    batch.approved = false;
    delete batch.approvedAt;
    delete batch.scheduledAt;
    for (const job of batch.jobs) if (job.status === 'queued') job.status = 'draft';
    save();
    return batch;
  }
  function list(inventory = readCatalog(config.carsFile).cars) {
    const cars = new Map(inventory.map((car) => [String(car.id), car]));
    return state.batches.map((batch) => {
      const car = cars.get(String(batch.carId)) || batch.jobs.find((job) => job.payload?.car)?.payload.car;
      return {
        id: batch.id, carId: batch.carId, title: [car?.make, car?.model, car?.year].filter(Boolean).join(' '),
        kind: (batch.assetKey || 'listing').startsWith('video:') ? 'video' : 'listing',
        revision: batch.revision, assetKey: batch.assetKey || 'listing',
        createdAt: batch.createdAt, approvedAt: batch.approvedAt, scheduledAt: batch.scheduledAt,
        jobs: batch.jobs.map(({ key, name, status, postedAt, nextAt, receipt, error }) => ({
          key, name, status, postedAt, nextAt: status === 'retry' ? nextAt : undefined,
          receiptId: receipt?.id ?? receipt?.postId ?? receipt?.containerId, privacyStatus: receipt?.privacyStatus,
          url: receipt?.url, error
        }))
      };
    });
  }
  function retry(id) {
    const batch = get(id);
    validate(batch, false);
    if (!batch.approved) throw new Error('Сначала подтвердите публикацию');
    for (const job of batch.jobs) if (!job.preparationFailed && ['failed', 'blocked', 'retry'].includes(job.status)) {
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
        if (batch.scheduledAt && Date.parse(batch.scheduledAt) > now().getTime()) continue;
        let changed = false;
        for (const job of batch.jobs) {
          if (!['queued', 'retry'].includes(job.status) || (job.nextAt && Date.parse(job.nextAt) > now().getTime())) continue;
          try { validate(batch, false); } catch (error) {
            job.status = 'blocked'; job.error = error.message; save(); changed = true; continue;
          }
          const publisher = publishers().find((p) => p.key === job.key);
          if (!publisher) { job.status = 'blocked'; job.error = 'Канал отключён'; save(); changed = true; continue; }
          const prior = postedJob(batch.carId, batch.revision, job.key, batch.assetKey);
          if (prior) { job.status = 'posted'; job.receipt = prior.receipt; job.postedAt = prior.postedAt; save(); changed = true; continue; }
          job.status = 'sending'; job.attempts++; save();
          try {
            const receipt = await publisher.post(job.payload, { approved: batch.approved });
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
    preview, approve, cancelSchedule, retry, get, list, tick,
    channels: () => publishers().map(({ key, name }) => ({ key, name })),
    start() { if (!timer) { save(); timer = setInterval(() => tick().catch(console.error), 5000); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; }
  };
}

module.exports = { createSocial };
