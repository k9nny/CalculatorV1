'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInstagramPublisher } = require('../server/social-platforms/meta');

const APPROVED = { approved: true };
const MEDIA = { text: 'Kia Rio 2019\nЦена 1 390 000 ₽\nПробег 74 000 км',
  link: 'https://andoauto.ru/cars/123/', photos: ['https://andoauto.ru/app/img/cars/123-1.jpg'],
  car: { make: 'Kia', model: 'Rio', year: 2019 } };
const ok = (body = {}, headers = {}) => ({ status: 200, headers, body });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-platforms-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { leadsLog: path.join(dir, 'leads.jsonl'),
    instagramUserId: '123', instagramAccessToken: 'ig-secret' };
  let time = Date.parse('2026-11-19T03:00:00Z');
  const now = () => new Date(time);
  return { dir, config, now, advance: (ms) => { time += ms; } };
}

function metaTransport(platform, requests) {
  let seq = 1000;
  return async (request) => {
    requests.push(request);
    const u = new URL(request.url);
    if (request.method === 'POST' && /\/(media|threads)$/.test(u.pathname)) return ok({ id: String(++seq) });
    if (request.method === 'POST') return ok({ id: '9000' });
    if (u.searchParams.get('fields') === 'permalink') return ok({ permalink: `https://www.${platform}.com/post/9000` });
    return ok(platform === 'instagram' ? { status_code: 'FINISHED' } : { status: 'FINISHED' });
  };
}

test('платформы: подготовка не отправляет запросы, post требует подтверждения и тот же аккаунт', async (t) => {
  const h = fixture(t), requests = [];
  const instagram = createInstagramPublisher(h.config, { transport: metaTransport('instagram', requests), now: h.now });
  const payload = instagram.prepare(MEDIA);
  assert.match(payload.text, /1 390 000/);
  assert.ok(payload.text.endsWith(MEDIA.link));
  assert.equal(requests.length, 0);
  assert.doesNotMatch(JSON.stringify(payload), /ig-secret/);
  await assert.rejects(instagram.post(payload), /подтверждённый/);
  await assert.rejects(instagram.post({ ...payload, account: 'instagram:other' }, APPROVED), /Аккаунт изменился/);
  assert.equal(requests.length, 0);
  assert.throws(() => instagram.prepare({ ...MEDIA, photos: ['https://site.test/car.webp'] }), /JPEG/);
});

test('Instagram: одиночное фото, квитанция переживает рестарт и исключает повторную отправку', async (t) => {
  const h = fixture(t), requests = [];
  const opts = { transport: metaTransport('instagram', requests), now: h.now };
  const publisher = createInstagramPublisher(h.config, opts), payload = publisher.prepare(MEDIA);
  const [receipt, same] = await Promise.all([publisher.post(payload, APPROVED), publisher.post(payload, APPROVED)]);
  assert.equal(receipt.id, '9000');
  assert.deepEqual(receipt, same);
  assert.equal(requests.filter((r) => r.url.endsWith('/media_publish')).length, 1);
  const form = new URLSearchParams(requests[0].body);
  assert.equal(form.get('image_url'), MEDIA.photos[0]);
  assert.equal(form.get('caption'), payload.text);
  const before = requests.length;
  const restarted = createInstagramPublisher(h.config, opts);
  assert.deepEqual(await restarted.post(payload, APPROVED), receipt);
  assert.equal(requests.length, before);
});

test('Instagram: карусель продолжает создание детей с сохранённого checkpoint', async (t) => {
  const h = fixture(t), requests = [];
  let creates = 0, limited = true;
  const normal = metaTransport('instagram', requests);
  const transport = async (r) => {
    if (r.method === 'POST' && r.url.endsWith('/media')) {
      creates++;
      if (creates === 2 && limited) return { status: 429, headers: { 'retry-after': '90' }, body: { error: { code: 4 } } };
    }
    return normal(r);
  };
  const opts = { transport, now: h.now };
  const p = createInstagramPublisher(h.config, opts);
  const payload = p.prepare({ ...MEDIA, photos: [...MEDIA.photos, 'https://site.test/second.jpg'] });
  await assert.rejects(p.post(payload, APPROVED), (e) => e.retryable && e.retryAfter === 90);
  limited = false;
  await createInstagramPublisher(h.config, opts).post(payload, APPROVED);
  assert.equal(creates, 4); // child 1, failed child 2, child 2, carousel
  const first = requests.filter((r) => r.method === 'POST' && new URLSearchParams(r.body).get('image_url') === MEDIA.photos[0]);
  assert.equal(first.length, 1);
});

test('Meta: потерянный ответ publish восстанавливается по PUBLISHED без второй публикации', async (t) => {
  const h = fixture(t), requests = [];
  let published = false;
  const normal = metaTransport('instagram', requests);
  const opts = { now: h.now, transport: async (r) => {
    if (r.url.endsWith('/media_publish')) { requests.push(r); published = true; throw new Error('socket closed'); }
    if (published && new URL(r.url).searchParams.get('fields') === 'status_code,status') return ok({ status_code: 'PUBLISHED' });
    return normal(r);
  } };
  const p = createInstagramPublisher(h.config, opts), payload = p.prepare(MEDIA);
  await assert.rejects(p.post(payload, APPROVED), (e) => e.retryable);
  const result = await createInstagramPublisher(h.config, opts).post(payload, APPROVED);
  assert.equal(result.confirmedPublished, true);
  assert.equal(requests.filter((r) => r.url.endsWith('/media_publish')).length, 1);
});

test('Meta: FINISHED после неизвестного результата не приводит к слепому повтору publish', async (t) => {
  const h = fixture(t), requests = [];
  const normal = metaTransport('instagram', requests);
  const opts = { now: h.now, transport: async (r) => {
    if (r.url.endsWith('/media_publish')) { requests.push(r); throw new Error('timeout'); }
    return normal(r);
  } };
  const p = createInstagramPublisher(h.config, opts), payload = p.prepare(MEDIA);
  await assert.rejects(p.post(payload, APPROVED), (e) => e.retryable);
  await assert.rejects(p.post(payload, APPROVED), (e) => e.retryable);
  h.advance(6 * 60000);
  await assert.rejects(p.post(payload, APPROVED), (e) => e.uncertain && !e.retryable);
  assert.equal(requests.filter((r) => r.url.endsWith('/media_publish')).length, 1);
});

test('Meta: ошибка OAuth до publish не записывается как неизвестная отправка', async (t) => {
  const h = fixture(t), requests = [];
  h.config.instagramTokenExpiresAt = new Date(h.now().getTime() + 60 * 86400000).toISOString();
  const normal = metaTransport('instagram', requests);
  const p = createInstagramPublisher(h.config, { now: h.now, transport: async (r) => {
    const response = await normal(r);
    if (new URL(r.url).searchParams.get('fields') === 'status_code,status') h.advance(61 * 86400000);
    return response;
  } });
  await assert.rejects(p.post(p.prepare(MEDIA), APPROVED), /токен истёк/);
  const directory = path.join(h.dir, 'social-platforms');
  const checkpoint = fs.readdirSync(directory).find((f) => f.startsWith('instagram-post'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, checkpoint))).publishAttemptedAt, undefined);
  assert.equal(requests.filter((r) => r.url.endsWith('/media_publish')).length, 0);
});

test('Instagram: ролик создаёт REELS из публичного URL', async (t) => {
  const h = fixture(t), requests = [];
  const p = createInstagramPublisher(h.config, { transport: metaTransport('instagram', requests), now: h.now });
  const payload = p.prepare({ ...MEDIA, video: { url: 'https://site.test/123.mp4' } });
  await p.post(payload, APPROVED);
  const form = new URLSearchParams(requests[0].body);
  assert.equal(form.get('media_type'), 'REELS');
  assert.equal(form.get('video_url'), 'https://site.test/123.mp4');
  assert.equal(form.get('image_url'), null);
});

test('Meta: обновляет long-lived токен, хранит его приватно и использует после рестарта', async (t) => {
  const h = fixture(t), requests = [];
  h.config.instagramTokenExpiresAt = new Date(h.now().getTime() + 2 * 86400000).toISOString();
  const normal = metaTransport('instagram', requests);
  const opts = { now: h.now, transport: async (r) => {
    if (r.url.includes('/refresh_access_token')) { requests.push(r); return ok({ access_token: 'renewed', expires_in: 5184000 }); }
    return normal(r);
  } };
  const p = createInstagramPublisher(h.config, opts);
  await p.post(p.prepare(MEDIA), APPROVED);
  assert.ok(requests.some((r) => r.headers?.Authorization === 'Bearer renewed'));
  assert.equal(requests.filter((r) => r.url.includes('/refresh_access_token')).length, 1);
  await createInstagramPublisher(h.config, opts).refresh();
  assert.equal(requests.filter((r) => r.url.includes('/refresh_access_token')).length, 1);
  const tokenFile = fs.readdirSync(path.join(h.dir, 'social-platforms')).find((f) => f.startsWith('instagram-token'));
  const file = path.join(h.dir, 'social-platforms', tokenFile);
  assert.match(fs.readFileSync(file, 'utf8'), /renewed/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('Meta: ожидающая обработка повторно использует контейнер без новой загрузки', async (t) => {
  const h = fixture(t), requests = [];
  let processing = true;
  const normal = metaTransport('instagram', requests);
  const opts = { now: h.now, transport: async (r) => {
    if (new URL(r.url).searchParams.get('fields') === 'status_code,status' && processing) return ok({ status_code: 'IN_PROGRESS' });
    return normal(r);
  } };
  const p = createInstagramPublisher(h.config, opts), payload = p.prepare(MEDIA);
  await assert.rejects(p.post(payload, APPROVED), (e) => e.retryable);
  processing = false;
  await createInstagramPublisher(h.config, opts).post(payload, APPROVED);
  assert.equal(requests.filter((r) => r.url.endsWith('/media')).length, 1);
});
