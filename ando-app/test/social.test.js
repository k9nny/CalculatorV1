'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSocial } = require('../server/social');
const { telegramPublisher, createPostPublishers } = require('../server/social-publishers');
const { createBot } = require('../server/bot');
const { createAfterPublish } = require('../server/after-publish');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-social-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { carsFile: path.join(dir, 'cars.json'), leadsLog: path.join(dir, 'leads.jsonl'),
    siteUrl: 'https://andoauto.ru', photosDir: dir, postTelegramChannel: '@ando_test', telegramToken: 'test' };
  const car = { id: '123', make: 'Kia', model: 'Rio', year: 2019, price: 1390000, mileage: 74000,
    city: 'Краснодар', status: 'available', photos: ['img/cars/123-1.jpg'], defects: ['Скол на капоте'] };
  const update = (patch) => fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [{ ...car, ...patch }] }));
  update({});
  let time = Date.parse('2026-11-19T09:00:00Z');
  const calls = [];
  let fail = true;
  const adapters = ['Telegram', 'VK'].map((name) => ({ key: name, name,
    prepare: (media) => ({ text: media.text, link: media.link, photos: media.photos }),
    post: async (payload) => {
      calls.push(name);
      if (name === 'VK' && fail) throw Object.assign(new Error('Rate limit'), { retryable: true, retryAfter: 120 });
      return { id: calls.length, url: `https://example.com/${name}`, link: payload.link };
    }
  }));
  const deps = { config, publishers: () => adapters, now: () => new Date(time) };
  return { config, car, update, calls, adapters, deps, advance: (ms) => { time += ms; }, recover: () => { fail = false; } };
}

test('посты: предпросмотр сохраняется, отправка начинается только после подтверждения', async (t) => {
  const h = setup(t), s = createSocial(h.deps);
  const batch = s.preview('123');
  assert.match(batch.jobs[0].payload.text, /Краснодар/);
  assert.match(batch.jobs[0].payload.text, /Скол на капоте/);
  assert.match(batch.jobs[0].payload.link, /\/cars\/123\/$/);
  assert.equal(s.preview('123').id, batch.id);
  await s.tick();
  assert.deepEqual(h.calls, []);
  s.approve(batch.id);
  await Promise.all([s.tick(), s.tick()]);
  assert.deepEqual(h.calls, ['Telegram', 'VK']);
  assert.equal(batch.jobs[0].status, 'posted');
  assert.equal(batch.jobs[1].status, 'retry');
});

test('посты: после рестарта повторяется только ошибка и учитывается Retry-After', async (t) => {
  const h = setup(t), s = createSocial(h.deps), batch = s.preview('123');
  s.approve(batch.id); await s.tick();
  const restarted = createSocial(h.deps);
  h.recover();
  h.advance(60000); await restarted.tick();
  assert.deepEqual(h.calls, ['Telegram', 'VK']);
  h.advance(60000); await restarted.tick();
  assert.deepEqual(h.calls, ['Telegram', 'VK', 'VK']);
  restarted.approve(batch.id); await restarted.tick();
  assert.equal(restarted.get(batch.id).jobs[1].status, 'posted');
  assert.equal(h.calls.length, 3);
});

test('расписание: дата переживает рестарт, в журнале видны время и квитанции', async (t) => {
  const h = setup(t), first = createSocial(h.deps), batch = first.preview('123');
  h.recover();
  assert.throws(() => first.approve(batch.id, '2026-11-19T11:59:00+03:00'), /будущее время/);
  first.approve(batch.id, '2026-11-19T12:02:00+03:00');
  const resumed = createSocial(h.deps);
  assert.equal(resumed.list()[0].scheduledAt, '2026-11-19T09:02:00.000Z');
  assert.equal(resumed.list()[0].title, 'Kia Rio 2019');
  h.advance(119000);
  await resumed.tick();
  assert.deepEqual(h.calls, []);
  h.advance(1000);
  await resumed.tick();
  assert.deepEqual(h.calls, ['Telegram', 'VK']);
  assert.deepEqual(resumed.list()[0].jobs.map(({ status, url, postedAt }) => [status, url, postedAt]), [
    ['posted', 'https://example.com/Telegram', '2026-11-19T09:02:00.000Z'],
    ['posted', 'https://example.com/VK', '2026-11-19T09:02:00.000Z']
  ]);
  assert.throws(() => resumed.cancelSchedule(batch.id), /Время уже наступило/);
});

test('расписание: снятый с очереди пост не отправляется, изменённая цена блокирует отправку', async (t) => {
  const h = setup(t), s = createSocial(h.deps), batch = s.preview('123');
  s.approve(batch.id, '2026-11-19T09:02:00Z');
  s.cancelSchedule(batch.id);
  h.advance(120000);
  await s.tick();
  assert.deepEqual(h.calls, []);
  assert.equal(s.get(batch.id).jobs[0].status, 'draft');
  s.approve(batch.id, '2026-11-19T09:03:00Z');
  h.update({ price: 1290000 });
  h.advance(60000);
  await s.tick();
  assert.deepEqual(h.calls, []);
  assert.equal(s.list()[0].jobs[0].status, 'blocked');
});

test('посты: изменение цены требует нового предпросмотра, проданная машина не отправляется', async (t) => {
  const h = setup(t), s = createSocial(h.deps), batch = s.preview('123');
  h.update({ price: 1290000 });
  assert.throws(() => s.approve(batch.id), /Карточка изменилась/);
  const next = s.preview('123');
  assert.notEqual(next.id, batch.id);
  s.approve(next.id); h.update({ status: 'sold' }); await s.tick();
  assert.deepEqual(h.calls, []);
  assert.equal(next.jobs[0].status, 'blocked');
});

test('посты: новый канал не получает уже одобренный материал', async (t) => {
  const h = setup(t), s = createSocial(h.deps), batch = s.preview('123');
  s.approve(batch.id);
  h.adapters.push({ key: 'Threads', name: 'Threads', post: async () => { throw new Error('unexpected'); } });
  await s.tick();
  assert.deepEqual(h.calls, ['Telegram', 'VK']);
});

test('посты: новый предпросмотр с добавленным каналом сохраняет прежние успехи', async (t) => {
  const h = setup(t), s = createSocial(h.deps);
  h.recover();
  const first = s.preview('123'); s.approve(first.id); await s.tick();
  h.adapters.push({ key: 'new', name: 'Новый канал', prepare: (m) => ({ text: m.text }), post: async () => { h.calls.push('new'); return { id: 1 }; } });
  const second = s.preview('123'); s.approve(second.id); await s.tick();
  assert.deepEqual(h.calls, ['Telegram', 'VK', 'new']);
});

test('посты: отключение VK не блокирует отправку Telegram', async (t) => {
  const h = setup(t), s = createSocial(h.deps), batch = s.preview('123');
  s.approve(batch.id); h.adapters.pop(); await s.tick();
  assert.deepEqual(h.calls, ['Telegram']);
  assert.equal(batch.jobs[0].status, 'posted');
  assert.equal(batch.jobs[1].status, 'blocked');
});

test('посты: неоднозначный тайм-аут и sending после рестарта не повторяются автоматически', async (t) => {
  const h = setup(t);
  h.adapters[0].post = async () => { throw Object.assign(new Error('timeout'), { uncertain: true }); };
  const s = createSocial(h.deps), batch = s.preview('123');
  s.approve(batch.id); await s.tick();
  assert.equal(batch.jobs[0].status, 'review');
  const file = path.join(path.dirname(h.config.leadsLog), 'social.json');
  const data = JSON.parse(fs.readFileSync(file));
  data.batches[0].jobs[1].status = 'sending';
  fs.writeFileSync(file, JSON.stringify(data));
  const restarted = createSocial(h.deps);
  assert.equal(restarted.get(batch.id).jobs[1].status, 'review');
  const before = h.calls.length;
  restarted.retry(batch.id); await restarted.tick();
  assert.equal(h.calls.length, before);
});

test('посты: старый успешный пост VK не дублируется', async (t) => {
  const h = setup(t);
  h.update({ vk: { postId: 42, url: 'https://vk.ru/wall-12_42' } });
  const s = createSocial({ ...h.deps, publishers: () => [{ ...h.adapters[1], key: 'vk:12' }] });
  const batch = s.preview('123');
  s.approve(batch.id); await s.tick();
  assert.deepEqual(h.calls, []);
  assert.equal(batch.jobs[0].receipt.postId, 42);
});

test('Telegram: фото, точный текст и ID принятой публикации', async (t) => {
  const h = setup(t);
  const requests = [];
  const p = telegramPublisher(h.config, async (url, fields, file) => {
    requests.push({ url, fields, file }); return { ok: true, result: { message_id: 51 } };
  });
  const payload = p.prepare({ text: 'Kia Rio\nhttps://andoauto.ru/cars/123/', link: 'https://andoauto.ru/cars/123/', car: h.car, photos: [] });
  const receipt = await p.post(payload);
  assert.match(requests[0].url, /\/sendPhoto$/);
  assert.equal(requests[0].fields.caption, payload.text);
  assert.equal(requests[0].file.path, path.join(h.config.photosDir, '123-1.jpg'));
  assert.equal(receipt.url, 'https://t.me/ando_test/51');
});

test('Telegram: flood control можно повторить, тайм-аут требует сверки', async (t) => {
  const h = setup(t);
  const limited = telegramPublisher(h.config, async () => ({ ok: false, error_code: 429, parameters: { retry_after: 90 } }));
  await assert.rejects(limited.post({ text: 'test' }), (e) => e.retryable && e.retryAfter === 90);
  const uncertain = telegramPublisher(h.config, async () => { throw new Error('timeout'); });
  await assert.rejects(uncertain.post({ text: 'test' }), (e) => e.uncertain);
});

test('VK: отправляется текст из утверждённого снимка', async (t) => {
  const h = setup(t); let sent;
  const vk = { status: () => ({ connected: true, groupId: 12 }), postCar: async (...args) => { sent = args; return { postId: 2 }; } };
  const publisher = createPostPublishers(h.config, vk)[1];
  const payload = publisher.prepare({ car: h.car, text: 'Точный текст', photos: [], link: 'https://andoauto.ru/cars/123/' });
  await publisher.post(payload);
  assert.equal(sent[2].text, 'Точный текст');
});

test('бот: /social → предпросмотр → отдельная кнопка, чужой пользователь не публикует', async (t) => {
  const h = setup(t), social = createSocial(h.deps), sent = [];
  const bot = createBot({ api: { request: async (method, p) => { sent.push({ method, ...p }); } },
    adminIds: ['7'], carsFile: h.config.carsFile, photosDir: h.config.photosDir, social });
  await bot.handleUpdate({ message: { text: '/social 123', chat: { id: 7 }, from: { id: 7 } } });
  const button = sent.at(-1).reply_markup.inline_keyboard[0][0];
  assert.match(button.callback_data, /^social_ok:/);
  const id = button.callback_data.split(':')[1];
  await bot.handleUpdate({ callback_query: { id: 'q1', data: button.callback_data, from: { id: 99 }, message: { chat: { id: 99 } } } });
  assert.equal(social.get(id).approved, false);
  await bot.handleUpdate({ callback_query: { id: 'q2', data: button.callback_data, from: { id: 7 }, message: { chat: { id: 7 } } } });
  assert.equal(social.get(id).approved, true);
  assert.deepEqual(h.calls, []);
  await social.tick(); assert.deepEqual(h.calls, ['Telegram', 'VK']);
});

test('сохранение карточки не обходит подтверждение даже с прежним vk.auto', async (t) => {
  const h = setup(t); let posts = 0, previews = 0;
  const after = createAfterPublish({ config: { ...h.config, socialPreview: true },
    vk: { status: () => ({ connected: true, auto: true }), postCar: async () => { posts++; } },
    onPrepared: async () => { previews++; } });
  await after.publish(h.car);
  assert.equal(posts, 0); assert.equal(previews, 1);
});

test('Telegram собирает оформленный пост из подтверждённых фактов и отправляет гиперссылки', async (t) => {
  const h = setup(t);
  let prompts = 0;
  const requests = [];
  h.update({ make: 'Škoda', model: 'Roomster', year: 2012, price: 280000, mileage: 198000,
    description: 'Двигатель работает ровно. Коробка передач без заявленных проблем. Есть ржавчина.',
    paint: 'Крыша и проёмы — родная краска.',
    features: ['климат-контроль', 'камера не работает', 'вмятина'] });
  const copywriter = { enabled: true, async complete(messages) {
    prompts++;
    assert.doesNotMatch(messages[1].content, /ржавчина|вмятина|не работает/);
    return { content: '[3,1,2,4,999]' };
  } };
  const publisher = telegramPublisher(h.config, async (url, fields) => {
    requests.push(fields);
    return { ok: true, result: { message_id: 42 } };
  });
  const social = createSocial({ ...h.deps, copywriter, publishers: () => [publisher] });
  const [batch, repeat] = await Promise.all([social.preview('123', { enhance: true }), social.preview('123', { enhance: true })]);
  assert.equal(batch.id, repeat.id);
  assert.equal(prompts, 1);
  const payload = batch.jobs[0].payload;
  assert.match(payload.text, /В продаже Škoda Roomster, 2012 год/);
  assert.match(payload.text, /🛣 Пробег 198\s000 км/);
  assert.match(payload.text, /💵 Цена 280\s000 ₽/);
  assert.match(payload.text, /Крыша и дверные проёмы в родной краске/);
  assert.match(payload.text, /По описанию продавца/);
  assert.match(payload.text, /Двигатель работает стабильно/);
  assert.doesNotMatch(payload.text, /Скол|ржавчина|не работает|https/);
  assert.deepEqual(payload.entities.filter(e => e.type === 'text_link').map(e => [payload.text.slice(e.offset, e.offset + e.length), e.url]), [
    ['ПОДРОБНЕЕ НА САЙТЕ', 'https://andoauto.ru/cars/123/'],
    ['ПОДРОБНЕЕ В БОТЕ', 'https://t.me/andoavtobot/cars?startapp=car_123']
  ]);
  await social.tick();
  assert.equal(requests.length, 0);
  social.approve(batch.id);
  await social.tick();
  assert.equal(requests[0].caption, payload.text);
  assert.deepEqual(JSON.parse(requests[0].caption_entities), payload.entities);
});
