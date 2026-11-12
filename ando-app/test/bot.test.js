'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseListing, toCar, missing, parseAmount } = require('../server/listing-parser');
const { createBot } = require('../server/bot');

test('суммы: разные способы записи', () => {
  assert.equal(parseAmount('1 390 000 ₽'), 1390000);
  assert.equal(parseAmount('1,39 млн'), 1390000);
  assert.equal(parseAmount('1390 тыс'), 1390000);
  assert.equal(parseAmount('74к'), 74000);
  assert.equal(parseAmount('1.390.000'), 1390000);
});

test('разбор: типичное объявление', () => {
  const f = parseListing([
    'Kia Rio 2019, 1.6 АКПП 123 л.с.',
    'Пробег 74 000 км',
    'Цена 1 390 000',
    '2 владельца, ПТС оригинал, белый седан, передний привод',
    '- Замена масла и фильтров',
    '- Новые колодки',
    'Торг'
  ].join('\n'));
  const car = toCar(f);
  assert.equal(car.make, 'Kia');
  assert.equal(car.model, 'Rio');
  assert.equal(car.year, 2019);
  assert.equal(car.price, 1390000);
  assert.equal(car.mileage, 74000);
  assert.deepEqual(car.engine, { volume: 1.6, power: 123 });
  assert.equal(car.transmission, 'Автомат');
  assert.equal(car.drive, 'Передний');
  assert.equal(car.body, 'Седан');
  assert.equal(car.color, 'Белый');
  assert.equal(car.owners, 2);
  assert.equal(car.pts, 'Оригинал');
  assert.deepEqual(car.serviceDone, ['Замена масла и фильтров', 'Новые колодки']);
  assert.deepEqual(car.tags, ['Торг']);
  assert.deepEqual(missing(f), []);
});

test('разбор: по-русски, цена в миллионах, пробег в тысячах, VIN скрывается', () => {
  const f = parseListing('Продаю Тойота Камри XV70 2018 г.\n2.5 бензин, автомат, 181 л.с.\nпробег 98 тыс км\n2,45 млн\nчёрный, один владелец\nVIN XW7BF4FK10S123456\nг. Краснодар');
  const car = toCar(f);
  assert.equal(car.make, 'Toyota');
  assert.equal(car.model, 'Camry');
  assert.equal(car.generation, 'XV70');
  assert.equal(car.year, 2018);
  assert.equal(car.price, 2450000);
  assert.equal(car.mileage, 98000);
  assert.deepEqual(car.engine, { volume: 2.5, power: 181, fuel: 'Бензин' });
  assert.equal(car.color, 'Чёрный');
  assert.equal(car.owners, 1);
  assert.equal(car.vin, 'XW7BF****0*****56');
  assert.equal(car.city, 'Краснодар');
  assert.equal(car.description, undefined);
});

test('разбор: строки «поле значение» для правки', () => {
  const f = parseListing('цена 1 350 000\nпробег 80 тыс\nмодель Rio X\nрынок 1 480 000\nкоробка вариатор\nпривод полный');
  assert.equal(f.price, 1350000);
  assert.equal(f.mileage, 80000);
  assert.equal(f.model, 'Rio X');
  assert.equal(f.marketPrice, 1480000);
  assert.equal(f.transmission, 'Вариатор');
  assert.equal(f.drive, 'Полный');
});

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-bot-'));
  const carsFile = path.join(dir, 'cars.json');
  fs.writeFileSync(carsFile, JSON.stringify({ cars: [{ id: '101', demo: true, status: 'available', make: 'Kia', model: 'Rio', year: 2019, price: 1, mileage: 1 }] }));
  const sent = [];
  const api = {
    request: async (method, params) => {
      sent.push({ method, params });
      if (method === 'getFile') return { file_path: `photos/${params.file_id}.jpg` };
      return { message_id: sent.length };
    },
    download: async (filePath) => Buffer.from('jpeg:' + filePath)
  };
  const bot = createBot({ api, adminIds: ['1'], carsFile, photosDir: path.join(dir, 'img'), appLink: 'https://t.me/ando_bot/catalog', debounceMs: 0,
    now: () => new Date('2026-11-02T10:00:00Z') });
  const messages = () => sent.filter((s) => s.method === 'sendMessage').map((s) => s.params.text);
  const read = () => JSON.parse(fs.readFileSync(carsFile, 'utf8')).cars;
  return { bot, sent, messages, read, dir };
}
const msg = (extra) => ({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, ...extra } });

test('бот: фото + текст → превью → «Опубликовать» → машина в каталоге с фото', async () => {
  const { bot, sent, messages, read, dir } = harness();
  await bot.handleUpdate(msg({ photo: [{ file_id: 'small' }, { file_id: 'A' }], caption: 'Hyundai Solaris 2017 1.6 АКПП\nпробег 112 тыс\nцена 1 090 000' }));
  await bot.handleUpdate(msg({ photo: [{ file_id: 'B' }] }));
  assert.match(messages().at(-1), /Hyundai Solaris, 2017/);
  assert.match(messages().at(-1), /Фото: 2/);
  assert.match(messages().at(-1), /Всё нужное есть/);
  await bot.handleUpdate(msg({ text: 'цена 1 050 000' }));
  assert.match(messages().at(-1), /1 050 000 ₽/);
  await bot.handleUpdate({ callback_query: { id: 'q', from: { id: 1 }, data: 'pub', message: { chat: { id: 1 } } } });
  const car = read()[0];
  assert.equal(car.id, '102');
  assert.equal(car.price, 1050000);
  assert.equal(car.publishedAt, '2026-11-02');
  assert.deepEqual(car.photos, ['img/cars/102-1.jpg', 'img/cars/102-2.jpg']);
  assert.equal(fs.readFileSync(path.join(dir, 'img', '102-1.jpg'), 'utf8'), 'jpeg:photos/A.jpg');
  assert.match(messages().at(-1), /startapp=car_102/);
  assert.doesNotMatch(messages().at(-1), /Текст для канала/);
  const pubMsg = sent.filter((s) => s.method === 'sendMessage').at(-1);
  const postBtn = pubMsg.params.reply_markup.inline_keyboard[0][0];
  assert.equal(postBtn.callback_data, 'post:102');
  assert.equal(bot.drafts.size, 0);
  await bot.handleUpdate({ callback_query: { id: 'q2', from: { id: 1 }, data: 'post:102', message: { chat: { id: 1 } } } });
  assert.match(messages().at(-1), /Hyundai Solaris/);
});

test('бот: без обязательных полей не публикует', async () => {
  const { bot, messages, read } = harness();
  await bot.handleUpdate(msg({ text: 'Kia Rio 2019' }));
  assert.match(messages().at(-1), /Не хватает: цена, пробег/);
  await bot.handleUpdate({ callback_query: { id: 'q', from: { id: 1 }, data: 'pub', message: { chat: { id: 1 } } } });
  assert.match(messages().at(-1), /Не могу опубликовать/);
  assert.equal(read().length, 1);
});

test('бот: команды статуса, цены и чужие пользователи', async () => {
  const { bot, messages, read } = harness();
  await bot.handleUpdate(msg({ text: '/reserve 101' }));
  assert.equal(read()[0].status, 'reserved');
  await bot.handleUpdate(msg({ text: '/price 101 1 200 000' }));
  assert.equal(read()[0].price, 1200000);
  await bot.handleUpdate(msg({ text: '/cleardemo' }));
  assert.equal(read().length, 0);
  await bot.handleUpdate({ message: { chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'Kia Rio 2019 цена 1 000 000 пробег 1' } });
  assert.match(messages().at(-1), /Каталог машин/);
  assert.equal(bot.drafts.has(5), false);
});

test('разбор: состояние, опции и проверки по VIN', () => {
  const car = toCar(parseListing([
    'Kia Rio 2019', 'Цена 1 390 000', 'Пробег 74 000',
    'Опции: подогрев сидений, камера', 'Недостатки: скол на капоте; потёртость руля', 'Окрасы: заднее крыло, 250 мкм',
    'Таможня: не растаможен', 'Ключи: 2', 'Резина: зима на дисках', 'Гарантия: 1 месяц на двигатель и коробку',
    'ДТП: нет', 'Залог: нет', 'Ограничения: нет', 'Розыск: не числится', 'Такси: нет', 'Скрутка: нет', 'Владеет 3 года'
  ].join('\n')));
  assert.deepEqual(car.features, ['Подогрев сидений', 'Камера']);
  assert.deepEqual(car.defects, ['Скол на капоте', 'Потёртость руля']);
  assert.equal(car.paint, 'Заднее крыло, 250 мкм');
  assert.equal(car.customs, false);
  assert.equal(car.keys, 2);
  assert.equal(car.lastOwnerYears, 3);
  assert.equal(car.mileage, 74000);
  assert.deepEqual(car.history, { accidents: 0, pledge: false, restrictions: false, wanted: false, taxi: false, mileageOk: true });
  const bad = toCar(parseListing('Kia Rio 2019\nДТП: 2\nЗалог: есть\nНедостатки: нет'));
  assert.deepEqual(bad.history, { accidents: 2, pledge: true });
  assert.deepEqual(bad.defects, []);
});

test('бот: /delete убирает машину из каталога вместе с фото', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-del-'));
  const carsFile = path.join(dir, 'cars.json');
  const photosDir = path.join(dir, 'img');
  fs.mkdirSync(photosDir);
  fs.writeFileSync(path.join(photosDir, '300-1.jpg'), 'x');
  fs.writeFileSync(carsFile, JSON.stringify({ cars: [
    { id: '300', make: 'Kia', model: 'Rio', year: 2019, price: 1, mileage: 1, photos: ['img/cars/300-1.jpg'] },
    { id: '301', make: 'Lada', model: 'Vesta', year: 2021, price: 1, mileage: 1, photos: [] }
  ] }));
  const sent = [];
  const api = { request: async (m, p) => { if (m === 'sendMessage') sent.push(p.text); return {}; }, download: async () => Buffer.from('') };
  const bot = createBot({ api, adminIds: ['7'], carsFile, photosDir, debounceMs: 0 });
  const msg = (text, from = 7) => ({ message: { chat: { id: from, type: 'private' }, from: { id: from }, text } });
  await bot.handleUpdate(msg('/delete 300', 99)); // чужой не может
  assert.equal(JSON.parse(fs.readFileSync(carsFile, 'utf8')).cars.length, 2);
  await bot.handleUpdate(msg('/delete 300'));
  assert.deepEqual(JSON.parse(fs.readFileSync(carsFile, 'utf8')).cars.map((c) => c.id), ['301']);
  assert.equal(fs.existsSync(path.join(photosDir, '300-1.jpg')), false);
  assert.match(sent[sent.length - 1], /удалена из каталога/);
  await bot.handleUpdate(msg('/delete 999'));
  assert.match(sent[sent.length - 1], /нет в каталоге/);
});
