'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInstagramPublisher, createThreadsPublisher } = require('../server/social-platforms/meta');
const { createMetaSettings } = require('../server/meta-settings');

const APPROVED = { approved: true };
const MEDIA = { text: 'Kia Rio 2019\nЦена 1 390 000 ₽\nПробег 74 000 км',
  link: 'https://andoauto.ru/cars/123/', photos: ['https://andoauto.ru/app/img/cars/123-1.jpg'],
  car: { make: 'Kia', model: 'Rio', year: 2019 } };
const ok = (body = {}, headers = {}) => ({ status: 200, headers, body });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-platforms-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { leadsLog: path.join(dir, 'leads.jsonl'),
    instagramUserId: '123', instagramAccessToken: 'ig-secret', threadsUserId: '456', threadsAccessToken: 'threads-secret' };
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
test('Threads: короткая подпись со ссылкой, выдержка обработки и checkpoint контейнера', async (t) => {
  const h = fixture(t), requests = [];
  const opts = { transport: metaTransport('threads', requests), now: h.now };
  const p = createThreadsPublisher(h.config, opts);
  const payload = p.prepare({ ...MEDIA, text: 'А'.repeat(700), photos: [] });
  assert.ok(Array.from(payload.text).length <= 500);
  assert.ok(payload.text.endsWith(MEDIA.link));
  await assert.rejects(p.post(payload, APPROVED), (e) => e.retryable && e.retryAfter === 30);
  assert.equal(requests.filter((r) => r.url.endsWith('/threads_publish')).length, 0);
  h.advance(30000);
  const receipt = await createThreadsPublisher(h.config, opts).post(payload, APPROVED);
  assert.equal(receipt.id, '9000');
  assert.equal(requests.filter((r) => r.url.endsWith('/threads')).length, 1);
  assert.equal(new URLSearchParams(requests[0].body).get('media_type'), 'TEXT');
});

test('Threads отправляет обложку автомобиля и подпись без ссылки', async (t) => {
  const h = fixture(t), requests = [];
  const p = createThreadsPublisher(h.config, { transport: metaTransport('threads', requests), now: h.now });
  const caption = 'Все машины в профиле';
  const payload = p.prepare({ ...MEDIA, photos: MEDIA.photos.slice(0, 1), text: caption, link: '' });
  await assert.rejects(p.post(payload, APPROVED), (e) => e.retryable);
  const body = new URLSearchParams(requests.find(r => r.url.endsWith('/threads')).body);
  assert.equal(body.get('media_type'), 'IMAGE');
  assert.equal(body.get('image_url'), MEDIA.photos[0]);
  assert.equal(body.get('text'), caption);
  h.advance(30000);
  assert.equal((await p.post(payload, APPROVED)).id, '9000');
});

test('Threads: неизвестный ответ при публикации проверяется без повторной отправки', async (t) => {
  const h = fixture(t), requests = [];
  const normal = metaTransport('threads', requests);
  let publishCalls = 0;
  const publisher = createThreadsPublisher(h.config, { now: h.now, transport: async (request) => {
    if (!request.url.endsWith('/threads_publish')) return normal(request);
    publishCalls++;
    return { status: 400, body: { error: { code: 1, error_subcode: 501, fbtrace_id: 'Trace_123', message: 'private data' } } };
  } });
  const payload = publisher.prepare(MEDIA);
  await assert.rejects(publisher.post(payload, APPROVED), /готовится/);
  h.advance(30_000);
  await assert.rejects(publisher.post(payload, APPROVED), (error) => {
    assert.match(error.message, /публикация.*HTTP 400, код 1, подкод 501, ID Meta Trace_123/);
    assert.doesNotMatch(error.message, /private data/);
    return error.uncertain && error.retryable;
  });
  h.advance(60_000);
  await assert.rejects(publisher.post(payload, APPROVED), /результат предыдущей отправки/);
  assert.equal(publishCalls, 1);
});

test('Instagram: единый вход использует назначенный аккаунт и Facebook Graph для публикации', async (t) => {
  const h = fixture(t), requests = [];
  const normal = metaTransport('instagram', requests);
  const request = async (options) => {
    const url = new URL(options.url);
    if (url.origin === 'https://graph.instagram.com') {
      assert.equal(url.pathname, '/v27.0/me');
      return { status: 400, body: { error: { code: 190 } } };
    }
    assert.equal(url.origin, 'https://graph.facebook.com');
    if (url.pathname === '/v27.0/me/assigned_instagram_accounts') return ok({ data: [{ id: '456', username: 'ando.auto' }] });
    if (url.pathname === '/v27.0/456/content_publishing_limit') return ok({ data: [{ quota_usage: 0 }] });
    return normal(options);
  };
  const settings = createMetaSettings(h.config, 'instagram', { request, now: h.now });
  const token = 'unified-test-token';
  assert.equal((await settings.attach(token)).username, 'ando.auto');
  h.advance(2 * 86400000);
  const publisher = createInstagramPublisher(settings.publisherConfig(), { transport: request, now: h.now });
  assert.equal((await publisher.post(publisher.prepare(MEDIA), APPROVED)).id, '9000');
  assert.ok(requests.some(({ url }) => url === 'https://graph.facebook.com/v27.0/456/media_publish'));
});

test('Threads: emoji учитываются в лимите, ссылка сохраняется целиком', (t) => {
  const h = fixture(t);
  const p = createThreadsPublisher(h.config, { now: h.now });
  const payload = p.prepare({ ...MEDIA, text: '🚗'.repeat(500) });
  const units = Array.from(payload.text).reduce((sum, char) => sum + (/\p{Extended_Pictographic}/u.test(char) ? Buffer.byteLength(char, 'utf8') : 1), 0);
  assert.ok(units <= 500);
  assert.ok(payload.text.endsWith(MEDIA.link));
});

test('Threads: обновление использует th_refresh_token и просроченный токен требует входа', async (t) => {
  const h = fixture(t), requests = [];
  h.config.threadsTokenExpiresAt = new Date(h.now().getTime() + 2 * 86400000).toISOString();
  const p = createThreadsPublisher(h.config, { now: h.now, transport: async (r) => {
    requests.push(r);
    const u = new URL(r.url);
    assert.equal(u.origin, 'https://graph.threads.com');
    assert.equal(u.searchParams.get('grant_type'), 'th_refresh_token');
    return ok({ access_token: 'new-threads', expires_in: 5184000 });
  } });
  await p.refresh();
  assert.equal(requests.length, 1);
  h.config.threadsAccessToken = 'expired-token';
  h.config.threadsTokenExpiresAt = new Date(h.now().getTime() - 1000).toISOString();
  await assert.rejects(createThreadsPublisher(h.config, { now: h.now, transport: async () => { throw new Error('unexpected request'); } }).refresh(), /истёк/);
});
