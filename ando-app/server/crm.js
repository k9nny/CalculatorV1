'use strict';

const fs = require('node:fs');

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
  let url;
  try { url = new URL(body.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 500) return null;
  const site = manualSites.find(([, , host, path]) => host.test(url.hostname) && path.test(url.pathname));
  const time = Date.parse(body.postedAt);
  if (!site || !['listing', 'video'].includes(body.kind) || !Number.isFinite(time) || time > now.getTime()) return null;
  const videoId = url.pathname === '/watch' ? url.searchParams.get('v') : null;
  if (url.pathname === '/watch' && !/^[\w-]+$/.test(videoId || '')) return null;
  url.search = videoId ? '?v=' + videoId : '';
  url.hash = '';
  return { carId: String(body.carId), kind: body.kind, key: 'manual:' + site[0], name: site[1],
    url: url.href, postedAt: new Date(time).toISOString() };
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

  for (const entry of manual) {
    if (demo.has(entry.carId)) continue;
    const car = byId(entry.carId);
    const existing = car.publications.find(pub => pub.kind === entry.kind && pub.status === 'posted'
      && publicationUrl(pub.url) === publicationUrl(entry.url));
    if (existing) { existing.postedAt ||= entry.postedAt; continue; }
    car.publications.push({ ...entry, batchId: null, status: 'posted', manual: true });
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
      if (pub.status === 'posted') totals[pub.kind === 'video' ? 'postedVideos' : 'postedListings']++;
      if (pub.status === 'scheduled') totals.scheduled++;
      if (pub.status === 'uploaded') totals.uploaded++;
      if (['sending', 'retry', 'queued'].includes(pub.status)) totals.queued++;
      if (['review', 'blocked', 'failed'].includes(pub.status)) totals.attention++;
    }
  }

  return { generatedAt: now.toISOString(), channels, cars: Array.from(cars.values()), totals };
}

module.exports = { buildCrm, manualEntry, readManual, publicationUrl };
