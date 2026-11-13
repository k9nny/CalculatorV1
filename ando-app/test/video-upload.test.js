'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, readConfig } = require('../server/server');
const { createBot } = require('../server/bot');
const { setPassword, stateFile } = require('../server/admin-cli');

// Маленький «MP4»: размер атома + «ftyp» + бренд и немного данных.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(2000, 7)]);

async function withAdmin(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-video-'));
  fs.mkdirSync(path.join(dir, 'photos'));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'cars.json'), JSON.stringify({ cars: [] }));
  const config = { ...readConfig({}), carsFile: path.join(dir, 'cars.json'), photosDir: path.join(dir, 'photos'), leadsLog: path.join(dir, 'private', 'leads.jsonl') };
  const slug = setPassword(stateFile({ LEADS_LOG: config.leadsLog }), 'correct-horse-42');
  const server = createApp(config, {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/${slug}/api/`;
  const login = await fetch(base + 'login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-42' }) });
  const h = { Origin: origin, Cookie: login.headers.get('set-cookie').split(';')[0] };
  try { await fn({ base, origin, h, dir }); } finally { server.close(); }
}

test('видео: загрузка, публикация с видео, добавление и удаление, отдача кусками', async () => {
  await withAdmin(async ({ base, origin, h, dir }) => {
    assert.equal((await fetch(base + 'video', { method: 'POST', headers: { ...h, 'Content-Type': 'video/mp4' }, body: Buffer.from('<?php') })).status, 415);
    assert.equal((await fetch(base + 'video', { method: 'POST', headers: { ...h, 'Content-Type': 'text/plain' }, body: MP4 })).status, 415);
    assert.equal((await fetch(base + 'video', { method: 'POST', headers: { 'Content-Type': 'video/mp4', Origin: origin }, body: MP4 })).status, 401);
    const up = await (await fetch(base + 'video', { method: 'POST', headers: { ...h, 'Content-Type': 'video/quicktime' }, body: MP4 })).json();
    assert.match(up.name, /^tmp-[0-9a-f]{16}\.mp4$/);

    const j = { ...h, 'Content-Type': 'application/json' };
    const { car } = await (await fetch(base + 'cars', { method: 'POST', headers: j, body: JSON.stringify({ text: 'Kia Rio 2019\nЦена 1 390 000\nПробег 74 000', photos: [], videos: [up.name, '../../etc/passwd'] }) })).json();
    assert.deepEqual(car.videos, [`img/cars/${car.id}-v1.mp4`]);

    // Сайт и приложение отдают видео, в том числе кусками (Range) — для iPhone.
    const full = await fetch(`${origin}/img/cars/${car.id}-v1.mp4`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    const part = await fetch(`${origin}/img/cars/${car.id}-v1.mp4`, { headers: { Range: 'bytes=0-9' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 0-9/${MP4.length}`);
    assert.equal(Buffer.from(await part.arrayBuffer()).length, 10);
    assert.equal((await fetch(`${origin}/img/cars/${car.id}-v1.mp4`, { headers: { Range: 'bytes=999999-' } })).status, 416);

    // Добавить к опубликованной машине, затем убрать все.
    const up2 = await (await fetch(base + 'video', { method: 'POST', headers: { ...h, 'Content-Type': 'video/mp4' }, body: MP4 })).json();
    const added = await (await fetch(base + `cars/${car.id}/videos`, { method: 'POST', headers: j, body: JSON.stringify({ name: up2.name }) })).json();
    assert.equal(added.car.videos.length, 2);
    assert.equal((await fetch(base + `cars/${car.id}/videos`, { method: 'POST', headers: j, body: JSON.stringify({ name: 'tmp-0000000000000000.mp4' }) })).status, 400);
    await fetch(base + `cars/${car.id}/videos`, { method: 'DELETE', headers: h });
    assert.equal(fs.existsSync(path.join(dir, 'photos', `${car.id}-v1.mp4`)), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'cars.json'), 'utf8')).cars[0].videos, undefined);

    // Страница машины на сайте показывает видео.
    const up3 = await (await fetch(base + 'video', { method: 'POST', headers: { ...h, 'Content-Type': 'video/mp4' }, body: MP4 })).json();
    await fetch(base + `cars/${car.id}/videos`, { method: 'POST', headers: j, body: JSON.stringify({ name: up3.name }) });
    const page = await (await fetch(`${origin}/cars/${car.id}/`)).text();
    assert.match(page, /<video class="car-video" src="\.\.\/\.\.\/app\/img\/cars\/\d+-v\d\.mp4" controls playsinline/);
    // Удаление машины удаляет и видео.
    const name = JSON.parse(fs.readFileSync(path.join(dir, 'cars.json'), 'utf8')).cars[0].videos[0];
    await fetch(base + `cars/${car.id}`, { method: 'DELETE', headers: h });
    assert.equal(fs.existsSync(path.join(dir, 'photos', path.basename(name))), false);
  });
});

test('видео: рыночная цена задаётся в админке и убирается нулём', async () => {
  await withAdmin(async ({ base, h, dir }) => {
    const j = { ...h, 'Content-Type': 'application/json' };
    const { car } = await (await fetch(base + 'cars', { method: 'POST', headers: j, body: JSON.stringify({ text: 'Kia Rio 2019\nЦена 1 390 000\nПробег 74 000' }) })).json();
    await fetch(base + `cars/${car.id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ marketPrice: 1480000 }) });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'cars.json'), 'utf8')).cars[0].marketPrice, 1480000);
    await fetch(base + `cars/${car.id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ marketPrice: 0 }) });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'cars.json'), 'utf8')).cars[0].marketPrice, undefined);
  });
});

test('бот: пересланное видео сохраняется при публикации, большое — подсказка про админку', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-bot-video-'));
  const carsFile = path.join(dir, 'cars.json');
  fs.writeFileSync(carsFile, JSON.stringify({ cars: [] }));
  const sent = [];
  const api = {
    request: async (method, p) => {
      if (method === 'getFile') return { file_path: p.file_id === 'v1' ? 'videos/a.mp4' : 'photos/a.jpg' };
      if (method === 'sendMessage') sent.push(p.text);
      return { message_id: 1 };
    },
    download: async (fp) => (fp.startsWith('videos/') ? MP4 : Buffer.from('jpeg'))
  };
  const bot = createBot({ api, adminIds: ['7'], carsFile, photosDir: path.join(dir, 'img'), debounceMs: 0 });
  const msg = (extra) => ({ message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, ...extra } });
  await bot.handleUpdate(msg({ photo: [{ file_id: 'p1' }], caption: 'Kia Rio 2019\nЦена 1 390 000\nПробег 74 000' }));
  await bot.handleUpdate(msg({ video: { file_id: 'v1', file_size: 5 * 1024 * 1024 } }));
  await bot.handleUpdate(msg({ video: { file_id: 'v2', file_size: 50 * 1024 * 1024 } }));
  assert.match(sent.at(-1), /видео: 1/);
  assert.match(sent.at(-1), /больше 20 МБ/);
  await bot.handleUpdate({ callback_query: { id: 'q', from: { id: 7 }, data: 'pub', message: { chat: { id: 7 } } } });
  const car = JSON.parse(fs.readFileSync(carsFile, 'utf8')).cars[0];
  assert.deepEqual(car.videos, [`img/cars/${car.id}-v1.mp4`]);
  assert.ok(fs.existsSync(path.join(dir, 'img', `${car.id}-v1.mp4`)));
});
