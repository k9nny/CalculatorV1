'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVk } = require('../server/vk');
const { createCarSpecs, clean, specRows } = require('../server/car-specs');
const { createAfterPublish } = require('../server/after-publish');
const { createSmartParser } = require('../server/llm');
const { listingText } = require('../server/listing-text');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-vk-'));
  fs.mkdirSync(path.join(dir, 'photos'));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'photos', '120-1.jpg'), 'jpg');
  fs.writeFileSync(path.join(dir, 'photos', '120-2.jpg'), 'jpg');
  const car = { id: '120', make: 'Kia', model: 'Rio', year: 2019, price: 1390000, mileage: 74000, photos: ['img/cars/120-1.jpg', 'img/cars/120-2.jpg'] };
  fs.writeFileSync(path.join(dir, 'cars.json'), JSON.stringify({ cars: [car] }));
  return { dir, car, config: { carsFile: path.join(dir, 'cars.json'), photosDir: path.join(dir, 'photos'), leadsLog: path.join(dir, 'private', 'leads.jsonl'), siteUrl: 'https://andoauto.ru' } };
}

test('ВК: вход через VK ID с PKCE, чужой state отклоняется, ключ обновляется сам', async () => {
  const { config } = setup();
  const forms = [];
  const vk = createVk(config, {
    postForm: async (url, p) => { forms.push(p); return p.grant_type === 'authorization_code' ? { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, user_id: 7 } : { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }; },
    vkCall: async (method, params) => (method === 'groups.getById' ? { groups: [{ id: 555, name: 'ANDO AUTO' }] } : {}),
    log: () => {}
  });
  const url = new URL(vk.authorizeUrl({ clientId: '52345678', group: 'https://vk.ru/andoauto', redirectUri: 'https://andoauto.ru/api/vk/callback' }));
  assert.equal(url.origin, 'https://id.vk.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /wall/);
  await assert.rejects(vk.finish({ code: 'c', state: 'чужой' }), /устарела/);
  // После неудачи нужен новый вход.
  const url2 = new URL(vk.authorizeUrl({ clientId: '52345678', group: 'https://vk.ru/andoauto', redirectUri: 'https://andoauto.ru/api/vk/callback' }));
  const d = await vk.finish({ code: 'CODE', state: url2.searchParams.get('state'), deviceId: 'dev1' });
  assert.equal(d.groupId, 555);
  assert.ok(forms[0].code_verifier.length >= 43);
  assert.equal(vk.status().connected, true);
  assert.equal(vk.status().auto, true);
  assert.equal(fs.statSync(path.join(path.dirname(config.leadsLog), 'vk.json')).mode & 0o777, 0o600);
  // Истекающий ключ обновляется по refresh_token.
  const f = path.join(path.dirname(config.leadsLog), 'vk.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), expiresAt: Date.now() + 1000 }));
  assert.equal(await vk.token(), 'AT2');
  assert.equal(forms.at(-1).grant_type, 'refresh_token');
});

test('ВК: пост о машине — фото на стену и текст по шаблону', async () => {
  const { config, car } = setup();
  const calls = [];
  const vk = createVk(config, {
    vkCall: async (method, params) => {
      calls.push([method, params]);
      if (method === 'photos.getWallUploadServer') return { upload_url: 'https://pu.vk.com/x' };
      if (method === 'photos.saveWallPhoto') return [{ owner_id: -555, id: calls.length }];
      if (method === 'wall.post') return { post_id: 42 };
      return {};
    },
    postMultipart: async () => ({ server: 1, photo: '[{"x":1}]', hash: 'h' }),
    log: () => {}
  });
  await vk.setToken({ token: 'vk1.a.0123456789abcdefghij', group: '555' });
  const r = await vk.postCar(car, 'https://andoauto.ru/cars/120/');
  assert.deepEqual(r, { postId: 42, url: 'https://vk.ru/wall-555_42' });
  const post = calls.find((c) => c[0] === 'wall.post')[1];
  assert.equal(post.owner_id, -555);
  assert.equal(post.from_group, 1);
  assert.equal(post.attachments.split(',').length, 2);
  assert.match(post.message, /^Kia Rio, 2019, 74 000 км/);
  assert.match(post.message, /https:\/\/andoauto\.ru\/cars\/120\//);
});

test('справка о модели: только проверенные числа, отдельно от машины; поиск в интернете с откатом', async () => {
  assert.deepEqual(clean({ power: '123', acceleration: '11,2 с', clearance: 99999, trunk: 'много', engine: '1.6 MPI G4FG', sources: ['https://auto.ru/x', 'javascript:alert(1)'] }),
    { power: 123, acceleration: 11.2, engine: '1.6 MPI G4FG', sources: ['https://auto.ru/x'] });
  const bodies = [];
  const post = async (url, b) => {
    bodies.push(b);
    if (b.tools && bodies.length === 1) return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 't1', type: 'builtin_function', function: { name: '$web_search', arguments: '{"q":"kia rio 2019"}' } }] } }] };
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ power: 123, acceleration: 11.2, consumption: 6.6, clearance: 160, gearbox: '6-ступенчатый автомат' }) } }] };
  };
  const parser = createSmartParser({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'kimi-k3' }, { post, log: () => {} });
  const specs = createCarSpecs(parser, { now: () => new Date('2026-11-13T10:00:00Z') });
  const patch = await specs.lookup({ make: 'Kia', model: 'Rio', year: 2019, engine: { volume: 1.6 }, transmission: 'Автомат' });
  assert.equal(bodies[0].tools[0].function.name, '$web_search');
  assert.equal(bodies[1].messages.at(-1).role, 'tool');
  assert.equal(patch.modelSpecs.web, true);
  assert.equal(patch.modelSpecs.consumption, 6.6);
  assert.equal(patch.engine.power, 123, 'мощность — в карточку, раз продавец её не указал');
  // Продавец указал мощность — справка её не перебивает.
  const keep = await specs.lookup({ make: 'Kia', model: 'Rio', year: 2019, engine: { volume: 1.6, power: 100 } });
  assert.equal(keep.engine, undefined);
  // Посредник не умеет поиск — ответ по знаниям модели.
  const noSearch = createSmartParser({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm' }, {
    post: async (u, b) => { if (b.tools) throw new Error('HTTP 400: tools not supported'); return { choices: [{ message: { content: '{"clearance": 170}' } }] }; }, log: () => {} });
  const p2 = await createCarSpecs(noSearch).lookup({ make: 'Lada', model: 'Vesta', year: 2021 });
  assert.equal(p2.modelSpecs.clearance, 170);
  assert.equal(p2.modelSpecs.web, false);
  // Показ и текст объявления.
  assert.deepEqual(specRows({ power: 123, clearance: 160 }), [['Мощность', '123 л.с.'], ['Клиренс', '160 мм']]);
  assert.match(listingText({ make: 'Kia', model: 'Rio', year: 2019, modelSpecs: { acceleration: 11.2, clearance: 160 } }), /О модели\n• Разгон 0–100 км\/ч: 11,2 с\n• Клиренс: 160 мм/);
});

test('после публикации: справка и пост в ВК в фоне, повторно не публикуется', async () => {
  const { config, car } = setup();
  let posts = 0;
  const vk = { status: () => ({ connected: true, auto: true }), postCar: async () => { posts++; return { postId: 1, url: 'https://vk.ru/wall-1_1' }; } };
  const specs = { lookup: async () => ({ modelSpecs: { clearance: 160 } }) };
  const ap = createAfterPublish({ config, vk, specs, log: () => {} });
  ap.publish(car);
  await ap.idle();
  const saved = JSON.parse(fs.readFileSync(config.carsFile, 'utf8')).cars[0];
  assert.equal(saved.modelSpecs.clearance, 160);
  assert.equal(saved.vk.postId, 1);
  ap.publish(saved);
  await ap.idle();
  assert.equal(posts, 1);
  // Демо не публикуем.
  ap.publish({ ...car, id: '999', demo: true });
  await ap.idle();
  assert.equal(posts, 1);
});
