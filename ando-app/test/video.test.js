'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const say = require('../server/video/speech');
const { scripts, caption, wrap } = require('../server/video/clips');
const { createQueue, startScheduler, parseTimes, currentSlot } = require('../server/video/queue');
const { createBot } = require('../server/bot');

const CAR = {
  id: '120', make: 'Kia', model: 'Rio', year: 2019, price: 1390000, marketPrice: 1480000, mileage: 74000,
  engine: { volume: 1.6, power: 123 }, transmission: 'Автомат', drive: 'Передний', owners: 2, pts: 'Оригинал',
  photos: ['img/cars/120-1.jpg'], serviceDone: ['Замена ремня ГРМ', 'Новые колодки'],
};

test('озвучка: числа словами с согласованием', () => {
  assert.equal(say.rub(1390000), 'один миллион триста девяносто тысяч рублей');
  assert.equal(say.rub(2000), 'две тысячи рублей');
  assert.equal(say.km(52000), 'пятьдесят две тысячи километров');
  assert.equal(say.km(21), 'двадцать один километр');
  assert.equal(say.hp(122), 'сто двадцать две лошадиные силы');
  assert.equal(say.hp(367), 'триста шестьдесят семь лошадиных сил');
  assert.equal(say.numWords(2021), 'две тысячи двадцать один');
  assert.equal(say.litres(1.6), 'один и шесть');
  assert.equal(say.litres(2), 'два литра');
});

test('озвучка: марки, модели и аббревиатуры по-русски', () => {
  assert.equal(say.sayCar({ make: 'Kia', model: 'Rio' }), 'Киа Рио');
  assert.equal(say.sayCar({ make: 'Mercedes-Benz', model: 'S-Класс' }), 'Мерседес эс Класс');
  assert.equal(say.sayLatin('RAV4'), 'Рав четыре');
  assert.equal(say.sayLatin('GLE'), 'гэ эль е');
  assert.match(say.abbr('Замена ремня ГРМ, ПТС оригинал'), /гэ эр эм.*пэтээс/);
});

test('сценарии: три разных ролика, в тексте нет цифр для синтезатора', () => {
  const list = scripts(CAR, { phoneLabel: '+7 989 085-31-77' });
  assert.deepEqual(list.map((c) => c.key), ['obzor', 'cena', 'servis']);
  const voices = list.map((c) => c.scenes.map((s) => s.voice).join(' '));
  assert.equal(new Set(voices).size, 3);
  for (const v of voices) assert.doesNotMatch(v, /\d/);
  assert.match(voices[1], /дешевле рынка на девяносто тысяч рублей/);
  assert.match(caption(CAR, list[1], 'https://t.me/x/app'), /Ниже средней цены на 90 000 ₽[\s\S]*https:\/\/t\.me\/x\/app/);
  // без сервиса третий ролик — про детали, без рынка — просто цена
  const plain = scripts({ ...CAR, serviceDone: [], marketPrice: 0 });
  assert.equal(plain[2].key, 'detali');
  assert.doesNotMatch(plain[1].scenes[0].voice, /рынка/);
});

test('сценарии: длинные строки переносятся по словам', () => {
  const lines = wrap('Компьютерная диагностика всех систем и замена масла в двигателе', 'body', 46);
  assert.ok(lines.length >= 2);
  assert.equal(lines.join(' '), 'Компьютерная диагностика всех систем и замена масла в двигателе');
});

test('очередь: слоты по Москве', () => {
  const times = parseTimes('19:40, 10:40,9:05');
  assert.deepEqual(times, ['09:05', '10:40', '19:40']);
  assert.equal(currentSlot(times, new Date('2026-10-30T05:00:00Z')), ''); // 08:00 МСК
  assert.equal(currentSlot(times, new Date('2026-10-30T08:00:00Z')), '2026-10-30 10:40'); // 11:00 МСК
  assert.equal(currentSlot(times, new Date('2026-10-30T22:30:00Z')), ''); // 01:30 МСК следующего дня
  assert.equal(currentSlot(times, new Date('2026-10-30T20:00:00Z')), '2026-10-30 19:40'); // 23:00 МСК
});

test('очередь: один ролик на слот, машины чередуются', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-q-'));
  const q = createQueue(path.join(dir, 'queue.json'));
  const a = q.add([{ carId: '1', name: 'Обзор' }, { carId: '1', name: 'Цена' }, { carId: '2', name: 'Обзор' }]);
  a.forEach((i) => q.setStatus(i.id, 'approved'));
  const posted = [];
  const sched = startScheduler({ queue: q, times: ['10:40', '15:20'], publishers: [{ name: 'Тест', post: async (i) => posted.push(i) }], intervalMs: 1e9 });
  sched.stop();
  await sched.tick(new Date('2026-10-30T07:41:00Z')); // 10:41 МСК
  await sched.tick(new Date('2026-10-30T07:50:00Z')); // тот же слот — ничего
  await sched.tick(new Date('2026-10-30T12:21:00Z')); // 15:21 МСК
  assert.deepEqual(posted.map((i) => i.carId), ['1', '2']);
  assert.equal(q.read().items.filter((i) => i.status === 'posted').length, 2);
});

test('очередь: если соцсеть не приняла ролик, он остаётся в очереди', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-q-'));
  const q = createQueue(path.join(dir, 'queue.json'));
  const [item] = q.add([{ carId: '1', name: 'Обзор' }]);
  q.setStatus(item.id, 'approved');
  const sched = startScheduler({ queue: q, times: ['10:40'], publishers: [{ name: 'VK', post: async () => { throw new Error('нет доступа'); } }], intervalMs: 1e9, log: { error() {} } });
  sched.stop();
  const r = await sched.tick(new Date('2026-10-30T07:41:00Z'));
  assert.equal(r.results.VK, 'нет доступа');
  assert.equal(q.read().items[0].status, 'approved');
});

test('бот: после публикации делает ролики и ставит их в очередь по кнопке', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-bot-clips-'));
  const carsFile = path.join(dir, 'cars.json');
  fs.writeFileSync(carsFile, JSON.stringify({ cars: [] }));
  const sent = [], videos = [];
  const api = {
    request: async (method, p) => { if (method === 'sendMessage') sent.push(p.text); return { message_id: 1 }; },
    download: async () => Buffer.from('x'),
    sendVideo: async (chatId, file, cap, extra) => { videos.push({ file, cap, extra }); return {}; },
  };
  const queue = createQueue(path.join(dir, 'queue.json'));
  const render = async (car) => ['obzor', 'cena', 'servis'].map((key) => ({ key, name: key, file: `/x/${car.id}-${key}.mp4`, caption: 'c' }));
  const bot = createBot({ api, adminIds: ['7'], carsFile, photosDir: path.join(dir, 'img'), debounceMs: 0, clips: { render, queue, times: [], targets: [] } });
  const msg = (text) => ({ message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, text } });
  await bot.handleUpdate(msg('Kia Rio 2019\nЦена 1 390 000\nПробег 74 000'));
  await bot.handleUpdate({ callback_query: { id: 'q', from: { id: 7 }, data: 'pub', message: { chat: { id: 7 }, message_id: 5 } } });
  await bot.clipsIdle();
  assert.equal(videos.length, 3);
  const okData = videos[0].extra.reply_markup.inline_keyboard[0][0].callback_data;
  assert.match(okData, /^clip_ok:\d+$/);
  assert.equal(queue.read().items.filter((i) => i.status === 'pending').length, 3);
  await bot.handleUpdate({ callback_query: { id: 'q2', from: { id: 7 }, data: okData, message: { chat: { id: 7 }, message_id: 6 } } });
  assert.equal(queue.read().items.filter((i) => i.status === 'approved').length, 1);
  // чужой человек не может одобрить
  await bot.handleUpdate({ callback_query: { id: 'q3', from: { id: 99 }, data: 'clip_ok:2', message: { chat: { id: 99 }, message_id: 7 } } });
  assert.equal(queue.read().items.filter((i) => i.status === 'approved').length, 1);
  await bot.handleUpdate(msg('/queue'));
  assert.match(sent[sent.length - 1], /Ждут публикации: 1/);
});
