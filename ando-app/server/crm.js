'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createQueue, parseTimes, currentSlot } = require('./video/queue');

const crmDestinations = [
  { id: 'vk-post', platform: 'vk', name: 'ВКонтакте', format: 'Пост' },
  { id: 'vk-clip', platform: 'vk', name: 'ВКонтакте', format: 'Клип' },
  { id: 'vk-video', platform: 'vk', name: 'ВКонтакте', format: 'Видео' },
  { id: 'instagram-post', platform: 'instagram', name: 'Instagram', format: 'Пост' },
  { id: 'instagram-reel', platform: 'instagram', name: 'Instagram', format: 'Reels' },
  { id: 'threads', platform: 'threads', name: 'Threads', format: 'Пост' },
  { id: 'telegram', platform: 'telegram', name: 'Telegram', format: '' },
  { id: 'youtube', platform: 'youtube', name: 'YouTube', format: 'Shorts' }
];

function destinationFor({ key = '', kind, url }) {
  const platform = key.split(':')[/^(manual|legacy-video):/.test(key) ? 1 : 0].toLowerCase();
  const route = url && publicationUrl(url);
  if (platform === 'vk') {
    if (/^vk\.ru\/clip/.test(route || '') || key.startsWith('vk-clips:')) return 'vk-clip';
    if (/^vk\.ru\/wall/.test(route || '') || kind === 'listing') return 'vk-post';
    return 'vk-video';
  }
  if (platform === 'vk-clips') return 'vk-clip';
  if (platform === 'instagram') {
    const reel = route ? /^instagram\.com\/reel\//.test(route) : kind === 'video';
    return reel ? 'instagram-reel' : 'instagram-post';
  }
  return ['telegram', 'threads', 'youtube'].includes(platform) ? platform : 'other';
}

function publicationName({ key, name, url }) {
  if (key === 'manual:telegram') {
    const route = publicationUrl(url);
    const handle = /^t\.me\/(?!c\/)([\w]+)\/\d+$/.exec(route || '')?.[1];
    return handle ? 'Telegram @' + handle : name;
  }
  return name;
}

function configuredDestinations(channels) {
  const ids = new Set();
  for (const channel of channels) {
    if (channel.key.startsWith('instagram:')) {
      ids.add('instagram-post');
      ids.add('instagram-reel');
    } else {
      const kind = /^(?:legacy-video|youtube|vk-clips):/.test(channel.key) ? 'video' : 'listing';
      ids.add(destinationFor({ key: channel.key, kind }));
    }
  }
  return ids;
}

function legacyVideoChannels(config) {
  if (!config.clipsEnabled || !config.adminIds?.length || !config.telegramToken || config.renderBackend === 'resolve'
      || !parseTimes(config.clipTimes).length) return [];
  return [
    config.clipTelegramChannel && { key: 'legacy-video:Telegram', name: 'Telegram ' + config.clipTelegramChannel },
    config.vkToken && config.vkGroupId && { key: 'legacy-video:VK', name: 'ВКонтакте · видео' }
  ].filter(Boolean);
}

function legacyVideoBatches(config, now) {
  if (!config.clipsDir) return [];
  const queue = createQueue(path.join(config.clipsDir, 'queue.json'));
  const state = queue.read();
  const enabled = config.clipsEnabled && config.adminIds?.length && config.telegramToken && config.renderBackend !== 'resolve';
  const connections = new Map(legacyVideoChannels(config).map(channel => [channel.key, channel.name]));
  const names = enabled ? [...connections.keys()].map(key => key.split(':')[1]) : [];
  const slots = names.length ? parseTimes(config.clipTimes) : [];
  const current = currentSlot(slots, now);
  const nextItem = slots.length ? queue.next(state) : null;
  const nextDate = nextItem && (!current || current === state.lastSlot) ? nextClipDate(slots, now) : null;
  return state.items.filter(item => ['pending', 'approved', 'posted'].includes(item.status)).map(item => {
    const actual = Object.keys(item.results || {});
    const destinations = [...new Set([...(item.targets || (item.status === 'posted' ? [] : names)), ...actual])];
    if (!destinations.length) destinations.push('Видео');
    return {
      id: null, assetKey: 'legacy-video:' + item.id, carId: item.carId, kind: 'video',
      createdAt: item.createdAt, scheduledAt: nextItem?.id === item.id ? nextDate : null,
      jobs: destinations.map(name => {
        const result = item.results?.[name];
        const posted = result === 'ok' || (item.status === 'posted' && !actual.length);
        const ready = names.includes(name) && slots.length > 0;
        return { key: 'legacy-video:' + name, name: connections.get('legacy-video:' + name) || name, status: posted ? 'posted' : item.status === 'pending' ? 'draft'
          : !ready ? 'blocked' : result ? 'retry' : 'queued',
        nextAt: result && ready && nextItem?.id === item.id ? nextDate : null,
        postedAt: posted ? item.postedAt : null,
        error: !posted && (result || (item.status === 'approved' && !ready ? 'Публикация роликов для этой площадки не настроена' : null)) };
      })
    };
  });
}

function nextClipDate(slots, now) {
  const local = new Date(now.getTime() + 10800000);
  const iso = local.toISOString();
  const ahead = slots.find(slot => slot > iso.slice(11, 16));
  if (!ahead) local.setUTCDate(local.getUTCDate() + 1);
  const date = local.toISOString().slice(0, 10) + 'T' + (ahead || slots[0]) + ':00+03:00';
  const time = Date.parse(date);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function crmCar(car, inCatalog) {
  return {
    id: String(car.id), title: car.title || [car.make, car.model, car.year].filter(Boolean).join(' ') || ('Машина №' + car.id),
    make: car.make || '', model: car.model || '', year: car.year ?? null, price: car.price ?? null,
    city: car.city || '', photo: car.photos?.[0] || null, inCatalog,
    status: inCatalog ? car.status || 'available' : 'archived',
    leads: 0, openLeads: 0, publications: []
  };
}

const manualSites = [
  ['telegram', 'Telegram', /^(?:www\.)?t\.me$/, /^\/(?:c\/)?[\w]+\/\d+\/?$/],
  ['vk', 'ВКонтакте', /^(?:www\.|m\.)?vk\.(?:com|ru)$/, /^\/(?:wall|clip|video)-?\d+_\d+\/?$/],
  ['instagram', 'Instagram', /^(?:www\.)?instagram\.com$/, /^\/(?:p|reel|tv)\/[\w-]+\/?$/],
  ['threads', 'Threads', /^(?:www\.)?threads\.(?:net|com)$/, /^\/@[\w.]+\/post\/[\w-]+\/?$/],
  ['youtube', 'YouTube', /^(?:(?:www|m)\.)?youtube\.com$/, /^\/(?:shorts\/[\w-]+|watch)\/?$/],
  ['youtube', 'YouTube', /^youtu\.be$/, /^\/[\w-]+\/?$/]
];

function manualEntry(body, now) {
  if (!body || !['listing', 'video'].includes(body.kind)) return null;
  const time = body.postedAt ? Date.parse(body.postedAt) : now.getTime();
  if (!Number.isFinite(time) || time > now.getTime()) return null;
  const postedAt = new Date(time).toISOString();
  if (body.url == null || body.url === '') {
    const target = crmDestinations.find(item => item.id === body.destination);
    if (!target) return null;
    const kind = target.id === 'telegram' ? body.kind
      : ['vk-clip', 'vk-video', 'instagram-reel', 'youtube'].includes(target.id) ? 'video' : 'listing';
    return { carId: String(body.carId), kind, key: 'manual:' + target.platform,
      name: target.name, destination: target.id, url: null, postedAt };
  }
  let url;
  try { url = new URL(body.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 500) return null;
  const site = manualSites.find(([, , host, path]) => host.test(url.hostname) && path.test(url.pathname));
  if (!site) return null;
  const videoId = url.pathname === '/watch' ? url.searchParams.get('v') : null;
  if (url.pathname === '/watch' && !/^[\w-]+$/.test(videoId || '')) return null;
  url.search = videoId ? '?v=' + videoId : '';
  url.hash = '';
  let kind = body.kind;
  if (site[0] === 'vk') kind = url.pathname.startsWith('/wall') ? 'listing' : 'video';
  if (site[0] === 'instagram') kind = url.pathname.startsWith('/reel/') ? 'video' : 'listing';
  const entry = { carId: String(body.carId), kind, key: 'manual:' + site[0], name: site[1],
    url: url.href, postedAt };
  return !body.destination || destinationFor(entry) === body.destination ? entry : null;
}

function readManual(file) {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function publicationUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^(?:www|m)\./, '').replace(/^vk\.com$/, 'vk.ru').replace(/^threads\.net$/, 'threads.com');
    if (host === 'youtu.be' || (host === 'youtube.com' && /^\/(?:watch|shorts)/.test(url.pathname))) {
      return 'youtube:' + (url.searchParams.get('v') || url.pathname.split('/')[host === 'youtu.be' ? 1 : 2]);
    }
    return host + url.pathname.replace(/\/$/, '');
  } catch { return null; }
}

function buildCrm(inventory, batches, channels, leads, now, manual = []) {
  const cars = new Map();
  const demo = new Set(inventory.filter((car) => car.demo).map((car) => String(car.id)));
  for (const car of inventory) if (!car.demo) cars.set(String(car.id), crmCar(car, true));

  function byId(id, title) {
    const key = String(id);
    if (!cars.has(key)) cars.set(key, crmCar({ id: key, title }, false));
    return cars.get(key);
  }

  // Один результат может находиться в нескольких предпросмотрах и в старой записи VK.
  const receipts = new Map();
  function addDelivery(car, publication, identity) {
    if (identity != null) {
      const key = JSON.stringify([car.id, publication.kind, publication.key, identity]);
      const existing = receipts.get(key);
      if (existing) {
        existing.postedAt ||= publication.postedAt;
        existing.url ||= publication.url;
        return;
      }
      receipts.set(key, publication);
    }
    car.publications.push(publication);
  }

  for (const batch of batches) {
    if (demo.has(String(batch.carId))) continue;
    const car = byId(batch.carId, batch.title);
    for (const job of batch.jobs) {
      let status = job.status;
      if (status === 'queued' && Date.parse(batch.scheduledAt) > now.getTime()) status = 'scheduled';
      if (status === 'posted' && ['private', 'unlisted'].includes(job.privacyStatus)) status = 'uploaded';
      const receipt = job.status === 'posted'
        ? String(job.receiptId ?? job.url ?? JSON.stringify([batch.revision || batch.id, batch.assetKey]))
        : null;
      addDelivery(car, {
        batchId: batch.id, kind: batch.kind, key: job.key, name: job.name, status,
        createdAt: batch.createdAt, scheduledAt: batch.scheduledAt || null, postedAt: job.postedAt || null,
        nextAt: job.nextAt || null, url: job.url || null, error: job.error || null,
        privacyStatus: job.privacyStatus || null
      }, receipt);
    }
  }
  for (const car of inventory) {
    if (car.demo || !car.vk?.postId) continue;
    const groupId = /wall-(\d+)_/.exec(car.vk.url || '')?.[1];
    const key = groupId ? 'vk:' + groupId : 'vk:legacy';
    addDelivery(cars.get(String(car.id)), {
      batchId: null, kind: 'listing', key, name: channels.find((ch) => ch.key === key)?.name || 'ВКонтакте',
      status: 'posted', createdAt: null, scheduledAt: null, postedAt: null, nextAt: null,
      url: car.vk.url || null, error: null, privacyStatus: null
    }, String(car.vk.postId));
  }

  for (const entry of [...manual.filter(item => item.url), ...manual.filter(item => !item.url)]) {
    if (demo.has(entry.carId)) continue;
    const car = byId(entry.carId);
    const existing = car.publications.find(pub => pub.kind === entry.kind && pub.status === 'posted'
      && (entry.url ? publicationUrl(pub.url) === publicationUrl(entry.url)
        : (pub.destination || destinationFor(pub)) === entry.destination));
    if (existing) { existing.postedAt ||= entry.postedAt; continue; }
    car.publications.push({ ...entry, name: publicationName(entry), batchId: null, status: 'posted', manual: true });
  }

  const totals = { cars: 0, publishedCars: 0, unpublishedCars: 0, postedListings: 0, postedVideos: 0,
    scheduled: 0, queued: 0, attention: 0, uploaded: 0, leads: 0, openLeads: 0, unassignedLeads: 0 };
  for (const lead of leads) {
    if (demo.has(String(lead.car?.id))) continue;
    totals.leads++;
    if (!lead.done) totals.openLeads++;
    if (lead.car?.id == null) { totals.unassignedLeads++; continue; }
    const car = byId(lead.car.id, lead.car.title);
    car.leads++;
    if (!lead.done) car.openLeads++;
  }
  for (const car of cars.values()) {
    if (car.inCatalog) {
      totals.cars++;
      if (car.publications.some((pub) => pub.status === 'posted')) totals.publishedCars++;
      else totals.unpublishedCars++;
    }
    for (const pub of car.publications) {
      pub.destination ||= destinationFor(pub);
      if (pub.status === 'posted') totals[pub.kind === 'video' ? 'postedVideos' : 'postedListings']++;
      if (pub.status === 'scheduled') totals.scheduled++;
      if (pub.status === 'uploaded') totals.uploaded++;
      if (['sending', 'retry', 'queued'].includes(pub.status)) totals.queued++;
      if (['review', 'blocked', 'failed'].includes(pub.status)) totals.attention++;
    }
  }

  const configured = configuredDestinations(channels);
  const used = new Set(Array.from(cars.values()).flatMap(car => car.publications.map(pub => pub.destination)));
  const destinations = crmDestinations.filter(item => item.id !== 'vk-video' || configured.has(item.id) || used.has(item.id))
    .map(item => ({ ...item, configured: configured.has(item.id) }));
  if (used.has('other')) destinations.push({ id: 'other', platform: 'other', name: 'Другие площадки', format: '', configured: false });
  return { generatedAt: now.toISOString(), channels, destinations, cars: Array.from(cars.values()), totals };
}

module.exports = { buildCrm, manualEntry, readManual, publicationUrl, legacyVideoBatches, legacyVideoChannels };
