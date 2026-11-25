'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, readConfig } = require('../server/server');
const { setPassword, rotateLink, newSlug, stateFile } = require('../server/admin-cli');

const PASSWORD = 'correct-horse-42';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(64, 1)]);
const LISTING = 'Kia Rio 2019, 1.6 АКПП 123 л.с.\nПробег 74 000 км\nЦена 1 390 000\nНедостатки: скол на капоте';

test('CRM сохраняет ручную публикацию и повторно не записывает тот же URL', async () => {
  await withAdmin(async ({ call, login, config }) => {
    fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [{ id: 17, make: 'Kia', model: 'Rio' }] }));
    const entry = { carId: 17, url: 'https://www.youtube.com/shorts/ABCDE?si=share', kind: 'video', postedAt: '2026-07-01T14:00:00Z' };
    const post = (json) => call('/api/crm/publications', { method: 'POST', json });
    assert.equal((await post(entry)).status, 401);
    await login();
    assert.equal((await post({ ...entry, url: 'https://example.test/shorts/ABCDE' })).status, 400);
    assert.equal((await post(entry)).status, 201);
    assert.equal((await post({ ...entry, url: 'https://youtu.be/ABCDE' })).status, 200);
    assert.equal((await post({ ...entry, kind: 'listing' })).status, 409);
    const data = await (await call('/api/crm')).json();
    assert.equal(data.totals.postedVideos, 1);
    assert.equal(data.cars[0].publications[0].url, 'https://www.youtube.com/shorts/ABCDE');
  });
});

test('CRM требует вход и считает все заявки без вывода телефонов', async () => {
  await withAdmin(async ({ call, login, config }) => {
    assert.equal((await call('/api/crm')).status, 401);
    await login();
    fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [{ id: 17, make: 'Kia', model: 'Rio' }, { id: '18', demo: true }] }));
    const lead = JSON.stringify({ car: { id: '17' }, phone: '+79999999999' });
    fs.writeFileSync(config.leadsLog, Array(301).fill(lead).join('\n') + '\n' + JSON.stringify({ type: 'sell' }));
    const response = await call('/api/crm');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.totals.cars, 1);
    assert.equal(data.totals.unpublishedCars, 1);
    assert.equal(data.totals.leads, 302);
    assert.equal(data.totals.unassignedLeads, 1);
    assert.equal(data.cars[0].openLeads, 301);
    assert.equal(JSON.stringify(data).includes('+79999999999'), false);
  });
});

test('админка: снимок соцсетей защищён входом, подтверждение отдельное и повтор безопасен', async () => {
  let posts = 0;
  const vk = { status: () => ({ connected: true, groupId: 123, groupName: 'Тестовая группа' }), postCar: async () => { posts++; return { postId: 1 }; } };
  await withAdmin(async ({ call, login, config }) => {
    fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [{ id: '456', status: 'available', make: 'Kia', model: 'Rio', year: 2019, mileage: 74000, price: 1390000, photos: [] }] }));
    assert.equal((await call('/api/cars/456/social', { method: 'POST', json: {} })).status, 401);
    assert.equal((await call('/api/social')).status, 401);
    await login();
    const res = await call('/api/cars/456/social', { method: 'POST', json: {} });
    assert.equal(res.status, 200);
    const { batch } = await res.json();
    assert.equal(batch.approved, false);
    assert.match(batch.jobs[0].payload.text, /cars\/456\//);
    assert.equal(posts, 0);
    const date = new Date(Date.now() + 60000).toISOString();
    const scheduled = await call(`/api/social/${batch.id}/approve`, { method: 'POST', json: { scheduledAt: date } });
    assert.equal(scheduled.status, 200);
    const { batches } = await (await call('/api/social')).json();
    assert.equal(batches[0].scheduledAt, date);
    assert.equal(batches[0].jobs[0].payload, undefined);
    assert.equal((await call(`/api/social/${batch.id}/cancel-schedule`, { method: 'POST', json: {} })).status, 200);
    const approved = await call(`/api/social/${batch.id}/approve`, { method: 'POST', json: {} });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).batch.jobs[0].status, 'queued');
    const duplicate = await call(`/api/social/${batch.id}/approve`, { method: 'POST', json: {} });
    assert.equal(duplicate.status, 200);
    assert.equal(posts, 0, 'HTTP-подтверждение только ставит задание в очередь');
    assert.equal((await call('/api/cars/456/vk', { method: 'POST', json: {} })).status, 409);
  }, { overrides: { siteUrl: 'https://andoauto.ru' }, deps: { vk } });
});

test('Instagram: безопасно подключается проверенный аккаунт и Reels отделён от поста', async () => {
  const token = 'fixture-instagram-token';
  const seen = [];
  const instagramTransport = async ({url, headers}) => {
    const pathname = new URL(url).pathname;
    assert.equal(headers.Authorization, 'Bearer ' + token);
    seen.push(pathname);
    if (pathname.endsWith('/me')) return { status: 200, body: { user_id: '741', username: 'andoauto_test' } };
    assert.match(pathname, /\/741\/content_publishing_limit$/);
    return { status: 200, body: { data: [{ quota_usage: 0 }] } };
  };
  await withAdmin(async ({ call, login, config, base }) => {
    assert.equal((await call('/api/instagram', { method: 'POST', json: { accessToken: token } })).status, 401);
    await login();
    assert.match(await (await fetch(base + '/')).text(), /id="instagram-connect"/);
    const add = await call('/api/instagram', { method: 'POST', json: { accessToken: token } });
    assert.equal(add.status, 200);
    const html = await add.text();
    assert.match(html, /andoauto_test/);
    assert.doesNotMatch(html, /fixture-instagram-token/);
    assert.equal(seen.length, 2);
    fs.writeFileSync(path.join(config.photosDir, '751-1.jpg'), JPEG);
    fs.writeFileSync(path.join(config.photosDir, '751-v1.mp4'), Buffer.from('test-video'));
    const car = { id: '751', make: 'Kia', model: 'Rio', year: 2019, price: 1900000, mileage: 74000,
      status: 'available', photos: ['img/cars/751-1.jpg'], videos: ['img/cars/751-v1.mp4'] };
    fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [car] }));
    const preview = async options => {
      const res = await call('/api/cars/751/social', { method: 'POST', json: { platform: 'instagram', ...options } });
      assert.equal(res.status, 200);
      return (await res.json()).batch;
    };
    const post = await preview({});
    const reel = await preview({ reelIndex: 0 });
    assert.equal(post.jobs[0].payload.kind, 'IMAGE');
    assert.match(post.jobs[0].payload.photos[0], /\/api\/social\/photo\/751\/0\/[a-f0-9]+\.jpg$/);
    assert.equal(reel.jobs[0].payload.kind, 'REELS');
    assert.equal(reel.jobs[0].payload.video.url, 'https://andoauto.ru/app/img/cars/751-v1.mp4');
    assert.equal(reel.jobs.length, 1);
    assert.notEqual(reel.id, post.id);
    assert.equal(post.approved, false);
    assert.equal(reel.approved, false);
    assert.equal(seen.length, 2);
    const crm = await (await call('/api/crm')).json();
    assert.deepEqual(crm.cars[0].publications.map(pub => pub.destination), ['instagram-post', 'instagram-reel']);
  }, { overrides: { siteUrl: 'https://andoauto.ru' }, deps: { instagramTransport } });
});

test('Threads: токен проверяется, текст со ссылкой готовится без отправки', async () => {
  const token = 'fixture-threads-token';
  const seen = [];
  const threadsTransport = async ({url, headers}) => {
    const pathname = new URL(url).pathname;
    assert.equal(headers.Authorization, 'Bearer ' + token);
    seen.push(pathname);
    if (pathname.endsWith('/me')) return { status: 200, body: { id: '741', username: 'andoauto_test' } };
    assert.match(pathname, /\/741\/threads_publishing_limit$/);
    return { status: 200, body: { data: [{ quota_usage: 0 }] } };
  };
  await withAdmin(async ({ call, login, config, base }) => {
    assert.equal((await call('/api/threads', { method: 'POST', json: { accessToken: token } })).status, 401);
    await login();
    assert.match(await (await fetch(base + '/')).text(), /id="threads-connect"/);
    const add = await call('/api/threads', { method: 'POST', json: { accessToken: token } });
    assert.equal(add.status, 200);
    const html = await add.text();
    assert.match(html, /andoauto_test/);
    assert.doesNotMatch(html, /fixture-threads-token/);
    assert.equal(seen.length, 2);
    fs.writeFileSync(path.join(config.photosDir, '751-1.jpg'), JPEG);
    fs.writeFileSync(path.join(config.photosDir, '751-v1.mp4'), Buffer.from('test-video'));
    const car = { id: '751', make: 'Kia', model: 'Rio', year: 2019, price: 1900000, mileage: 74000,
      status: 'available', photos: ['img/cars/751-1.jpg'], videos: ['img/cars/751-v1.mp4'] };
    car.engine = { volume: 1.6, power: 123 };
    car.description = 'Двигатель работает ровно.';
    fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [car] }));
    const preview = async options => {
      const res = await call('/api/cars/751/social', { method: 'POST', json: { platform: 'threads', ...options } });
      assert.equal(res.status, 200);
      return (await res.json()).batch;
    };
    const post = await preview({});
    assert.equal(post.jobs.length, 1);
    assert.equal(post.jobs[0].payload.kind, 'IMAGE');
    assert.deepEqual(post.jobs[0].payload.photos, ['https://andoauto.ru/app/img/cars/751-1.jpg']);
    assert.match(post.jobs[0].payload.text, /^[👀🔥🚗].*\?\n\n🚘/u);
    assert.match(post.jobs[0].payload.text, /💵 1[\s]900[\s]000 ₽/);
    assert.match(post.jobs[0].payload.text, /123 л\.с\./);
    assert.match(post.jobs[0].payload.text, /По описанию продавца:\n✅ Двигатель работает стабильно/);
    assert.doesNotMatch(post.jobs[0].payload.text, /https?:\/\//);
    assert.ok(post.jobs[0].payload.text.endsWith('Все машины в профиле'));
    assert.equal(post.approved, false);
    assert.equal(seen.length, 2);
  }, { overrides: { siteUrl: 'https://andoauto.ru' }, deps: { threadsTransport } });
});

test('YouTube: OAuth проверяет канал, скрывает ключи и готовит приватный ролик', async () => {
  const channelId = 'UC751OsxXbkvP9FqqA3tQH7Q';
  const clientSecret = 'test-secret-abc';
  const scopes = ['youtube.upload', 'youtube.readonly'].map(s => 'https://www.googleapis.com/auth/' + s).join(' ');
  const requests = [];
  let returnedChannel = 'UC' + 'X'.repeat(22);
  const youtubeTransport = async request => {
    requests.push(request);
    if (request.url === 'https://oauth2.googleapis.com/token') {
      return { status: 200, body: { access_token: 'access-test', refresh_token: 'refresh-test', scope: scopes } };
    }
    assert.match(request.url, /\/youtube\/v3\/channels\?/);
    assert.equal(request.headers.Authorization, 'Bearer access-test');
    return { status: 200, body: { items: [{ id: returnedChannel, snippet: { title: 'ANDO AUTO' } }] } };
  };
  await withAdmin(async ({ config, call, login, origin, slug }) => {
    const credentials = { channelId, clientId: 'test-client.apps.googleusercontent.com', clientSecret };
    const start = { method: 'POST', json: credentials };
    assert.equal((await call('/api/youtube', start)).status, 401);
    await login();
    const authorize = async () => {
      const response = await call('/api/youtube', start);
      assert.equal(response.status, 200);
      const url = new URL((await response.json()).url);
      assert.equal(url.origin, 'https://accounts.google.com');
      assert.equal(url.searchParams.get('redirect_uri'), 'https://andoauto.ru/api/youtube/callback');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(url.searchParams.get('scope'), scopes);
      assert.ok(!url.href.includes(clientSecret));
      return url.searchParams.get('state');
    };
    const callback = state => fetch(origin + '/api/youtube/callback?code=test-code&state=' + state, { redirect: 'manual' });
    const state = await authorize();
    assert.equal((await callback('invalid')).status, 400);
    assert.equal(requests.length, 0);
    assert.match(await (await callback(state)).text(), /Выбран другой YouTube-канал/);
    assert.deepEqual(await (await call('/api/youtube')).json(), { connected: false });
    returnedChannel = channelId;
    const newState = await authorize();
    const response = await callback(newState);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/' + slug + '/#settings');
    assert.equal((await callback(newState)).status, 400);
    assert.equal(new URLSearchParams(requests[2].body).get('client_secret'), clientSecret);
    assert.deepEqual(await (await call('/api/youtube')).json(), { connected: true, channelId, title: 'ANDO AUTO' });

    fs.writeFileSync(path.join(config.photosDir, '751-v1.mp4'), 'test-video');
    fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [{ id: '751', make: 'Kia', model: 'Rio',
      year: 2019, price: 1390000, status: 'available', videos: ['img/cars/751-v1.mp4'] }] }));
    const preview = await call('/api/cars/751/social', { method: 'POST', json: { platform: 'youtube', reelIndex: 0 } });
    assert.equal(preview.status, 200);
    const { batch } = await preview.json();
    assert.equal(batch.approved, false);
    assert.equal(batch.jobs.length, 1);
    assert.equal(batch.jobs[0].key, 'youtube:' + channelId);
    assert.equal(batch.jobs[0].payload.privacyStatus, 'private');
    assert.equal(batch.jobs[0].payload.video.url, 'https://andoauto.ru/app/img/cars/751-v1.mp4');
    assert.equal(requests.length, 4);
  }, { overrides: { siteUrl: 'https://andoauto.ru' }, deps: { youtubeTransport } });
});

async function withAdmin(fn, { configure = true, overrides = {}, deps = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-admin-'));
  fs.mkdirSync(path.join(dir, 'photos'));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'cars.json'), JSON.stringify({ cars: [{ id: '101', demo: true, make: 'Kia', model: 'Rio', year: 2019, price: 1, mileage: 1, photos: [] }] }));
  const config = {
    ...readConfig({}),
    carsFile: path.join(dir, 'cars.json'),
    photosDir: path.join(dir, 'photos'),
    leadsLog: path.join(dir, 'private', 'leads.jsonl'),
    ...overrides
  };
  const slug = configure ? setPassword(stateFile({ LEADS_LOG: config.leadsLog }), PASSWORD) : '';
  const server = createApp(config, { sendTelegramMessage: async () => true, ...deps });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/${slug}`;
  let cookie = '';
  const call = async (p, { method = 'GET', json, body, type, headers = {} } = {}) => {
    const h = { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers };
    if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (type) h['Content-Type'] = type;
    return fetch(base + p, { method, headers: h, body });
  };
  const login = async () => {
    const res = await call('/api/login', { method: 'POST', json: { password: PASSWORD } });
    assert.equal(res.status, 200);
    cookie = res.headers.get('set-cookie').split(';')[0];
  };
  try {
    await fn({ origin, base, slug, call, login, dir, config });
  } finally {
    server.close();
  }
}

test('админка: секретный адрес случайный и длинный', () => {
  const a = newSlug();
  assert.match(a, /^[a-z0-9]{24}$/);
  assert.notEqual(a, newSlug());
});

test('админка: пока не настроена на сервере — её нет ни по одному адресу', async () => {
  await withAdmin(async ({ origin }) => {
    for (const p of ['/admin', '/admin/', '/api/admin/status', '/api/admin/login', '/undefined/', '//api/status']) {
      assert.equal((await fetch(origin + p)).status, 404, p);
    }
    const res = await fetch(origin + '/api/admin/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"password":"x"}' });
    assert.notEqual(res.status, 200);
  }, { configure: false });
});

test('админка: открывается только по секретному адресу, не индексируется', async () => {
  await withAdmin(async ({ origin, base, slug }) => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('x-robots-tag'), /noindex/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await page.text(), /Вход/);
    assert.equal((await fetch(base, { redirect: 'manual' })).status, 308);
    const near = slug.slice(0, -1) + (slug.endsWith('a') ? 'b' : 'a');
    for (const p of ['/admin/', '/' + near + '/', '/' + slug.toUpperCase() + '/', '/api/admin/status', '/' + slug + '/../admin.json', '/' + slug + '/admin.json']) {
      assert.equal((await fetch(origin + p)).status, 404, p);
    }
    // Ничто в публичных файлах не ссылается на админку.
    const pub = path.join(__dirname, '..', 'public');
    assert.equal(fs.existsSync(path.join(pub, 'admin')), false);
    assert.equal((await fetch(origin + '/admin-ui/index.html')).status, 404);
  });
});

test('админка: без входа ничего нельзя, неверный пароль, лимит попыток', async () => {
  await withAdmin(async ({ call }) => {
    assert.deepEqual(await (await call('/api/status')).json(), { authed: false });
    assert.equal((await call('/api/cars')).status, 401);
    assert.equal((await call('/api/cars', { method: 'POST', json: { text: LISTING } })).status, 401);
    assert.equal((await call('/api/cars/101', { method: 'DELETE' })).status, 401);
    assert.equal((await call('/api/leads')).status, 401);
    // Поддельная cookie не проходит.
    assert.equal((await call('/api/cars', { headers: { Cookie: 'ando_admin=9999999999999.' + 'a'.repeat(64) } })).status, 401);
    for (let i = 0; i < 8; i++) assert.equal((await call('/api/login', { method: 'POST', json: { password: 'wrong' + i } })).status, 403);
    // После 8 ошибок даже верный пароль не принимается какое-то время.
    assert.equal((await call('/api/login', { method: 'POST', json: { password: PASSWORD } })).status, 429);
  });
});

test('админка: запросы с чужого сайта и без Origin отклоняются', async () => {
  await withAdmin(async ({ call, login }) => {
    await login();
    assert.equal((await call('/api/cars/101', { method: 'DELETE', headers: { Origin: 'https://evil.example' } })).status, 403);
    const noOrigin = await call('/api/cars/101', { method: 'DELETE', headers: { Origin: '' } });
    assert.equal(noOrigin.status, 403);
  });
});

test('админка: cookie сессии HttpOnly и SameSite=Strict, выход и новая ссылка сбрасывают вход', async () => {
  await withAdmin(async ({ call, origin, config }) => {
    const res = await call('/api/login', { method: 'POST', json: { password: PASSWORD } });
    const set = res.headers.get('set-cookie');
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Strict/);
    const cookie = set.split(';')[0];
    assert.equal((await call('/api/cars', { headers: { Cookie: cookie } })).status, 200);
    const fresh = rotateLink(stateFile({ LEADS_LOG: config.leadsLog }));
    // Старый адрес больше не открывается, по новому старая сессия недействительна.
    assert.equal((await call('/api/cars', { headers: { Cookie: cookie } })).status, 404);
    const res2 = await fetch(`${origin}/${fresh}/api/cars`, { headers: { Cookie: cookie } });
    assert.equal(res2.status, 401);
  });
});

test('админка: фото, публикация, статус, цена, удаление — сразу в общем каталоге', async () => {
  await withAdmin(async ({ call, login, origin, dir }) => {
    await login();
    assert.equal((await call('/api/photo', { method: 'POST', type: 'image/jpeg', body: Buffer.from('<?php echo 1; ?>') })).status, 415);
    assert.equal((await call('/api/photo', { method: 'POST', type: 'text/html', body: JPEG })).status, 415);
    const up = await (await call('/api/photo', { method: 'POST', type: 'image/jpeg', body: JPEG })).json();
    assert.match(up.name, /^tmp-[0-9a-f]{16}\.jpg$/);

    const parsed = await (await call('/api/parse', { method: 'POST', json: { text: LISTING } })).json();
    assert.deepEqual(parsed.missing, []);
    assert.equal(parsed.car.price, 1390000);

    const bad = await call('/api/cars', { method: 'POST', json: { text: 'Kia', photos: [] } });
    assert.equal(bad.status, 400);
    const res = await call('/api/cars', { method: 'POST', json: { text: LISTING.replace('Пробег 74 000 км\n', ''), photos: [up.name, '../../etc/passwd', 'tmp-0000000000000000.jpg'] } });
    assert.equal(res.status, 200);
    const { car } = await res.json();
    assert.equal(car.id, '102');
    assert.deepEqual(car.photos, ['img/cars/102-1.jpg']);
    assert.ok(fs.existsSync(path.join(dir, 'photos', '102-1.jpg')));

    // Тот же каталог видят сайт, Telegram и MAX.
    const pub = await (await fetch(origin + '/data/cars.json')).json();
    assert.equal(pub.cars[0].id, '102');
    assert.equal(pub.cars[0].mileage, undefined);
    assert.equal((await fetch(origin + '/img/cars/102-1.jpg')).status, 200);

    assert.equal((await call('/api/cars/102', { method: 'PATCH', json: { status: 'hacked' } })).status, 400);
    assert.equal((await call('/api/cars/102', { method: 'PATCH', json: { status: 'reserved', price: '1 350 000' } })).status, 200);
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'cars.json'), 'utf8')).cars[0];
    assert.equal(after.status, 'reserved');
    assert.equal(after.price, 1350000);

    assert.deepEqual(await (await call('/api/cleardemo', { method: 'POST' })).json(), { removed: 1 });
    assert.equal((await call('/api/cars/102', { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(path.join(dir, 'photos', '102-1.jpg')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'cars.json'), 'utf8')).cars.length, 0);
  });
});

test('админка: заявки видны и отмечаются обработанными', async () => {
  await withAdmin(async ({ call, login, origin }) => {
    const lead = await fetch(origin + '/api/lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ type: 'callback', phone: '89001234567', consent: true, name: 'Олег' })
    });
    assert.equal(lead.status, 200);
    await login();
    const { leads } = await (await call('/api/leads')).json();
    assert.equal(leads.length, 1);
    assert.equal(leads[0].phone, '+79001234567');
    assert.equal(leads[0].done, false);
    assert.equal((await call('/api/leads/' + leads[0].id, { method: 'PATCH', json: { done: true } })).status, 200);
    assert.equal((await (await call('/api/leads')).json()).leads[0].done, true);
  });
});
