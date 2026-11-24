'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMarketPrice, applyEstimate } = require('../server/market-price');
const { createAfterPublish } = require('../server/after-publish');
const { createSmartParser } = require('../server/llm');

function parserReturning(obj, seen = []) {
  return createSmartParser({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'kimi-k3' }, {
    post: async (u, b) => { seen.push(b); return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(obj) } }] }; }, log: () => {}
  });
}
const CAR = { id: '120', make: 'Kia', model: 'Rio', year: 2019, mileage: 74000, price: 1390000, engine: { volume: 1.6 }, transmission: 'Автомат' };

test('оценка рынка: наша цена в запрос не уходит; ниже оценки — отметка, не ниже — без отметки', async () => {
  const seen = [];
  const m = createMarketPrice(parserReturning({ median: 1520000, low: 1400000, high: 1650000, count: 9, sources: ['https://auto.ru/x'] }, seen), { now: () => new Date('2026-11-16T10:00:00Z') });
  const p = await m.estimate(CAR);
  assert.doesNotMatch(JSON.stringify(seen[0].messages), /1390000|1 390 000/, 'нашу цену нейросети не показываем');
  assert.equal(p.marketPrice, 1520000);
  assert.deepEqual(p.marketEstimate, { price: 1520000, low: 1400000, high: 1650000, count: 9, sources: ['https://auto.ru/x'], web: false, at: '2026-11-16' });
  const above = await createMarketPrice(parserReturning({ median: 1300000 })).estimate(CAR);
  assert.equal(above.marketPrice, null);
  const car = applyEstimate({ ...CAR, marketPrice: 999 }, above);
  assert.equal(car.marketPrice, undefined, 'цена не ниже рынка — marketPrice убирается');
  assert.equal(car.marketEstimate.price, 1300000);
  // Неправдоподобная оценка не используется.
  assert.equal(await createMarketPrice(parserReturning({ median: 50000 })).estimate(CAR), null);
  assert.equal(await createMarketPrice(parserReturning({})).estimate(CAR), null);
});

test('отметка на карточке: «Сильно ниже рынка» от 8%, «Ниже рынка» — меньше, выше рынка — ничего', () => {
  global.window = global.window || {};
  delete require.cache[require.resolve('../public/card.js')];
  require('../public/card.js');
  const { rating } = global.window.AndoCard;
  assert.equal(rating({ price: 900000, marketPrice: 1000000 }).label, 'Сильно ниже рынка');
  assert.equal(rating({ price: 960000, marketPrice: 1000000 }).label, 'Ниже рынка');
  const html = global.window.AndoCard.cardHtml({ id: 'p', make: 'Kia', model: 'Rio', year: 2020, price: 960000, marketPrice: 1000000 });
  const visible = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(visible, /960 000 ₽/);
  assert.match(visible, /Ниже рынка/);
  assert.doesNotMatch(visible, /40 000|1 000 000|\d\s*%/);
  assert.equal(rating({ price: 1000000, marketPrice: 1000000 }), null);
  assert.equal(rating({ price: 1100000, marketPrice: 1000000 }), null);
  assert.equal(rating({ price: 1000000 }), null);
});

test('оценка рынка для уже опубликованных машин — в фоне, по одной', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-market-'));
  const config = { carsFile: path.join(dir, 'cars.json'), leadsLog: path.join(dir, 'leads.jsonl') };
  fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [CAR, { ...CAR, id: '121', price: 2000000 }, { ...CAR, id: '122', demo: true }] }));
  const market = createMarketPrice(parserReturning({ median: 1600000 }));
  const ap = createAfterPublish({ config, market, log: () => {} });
  await ap.estimateAll(JSON.parse(fs.readFileSync(config.carsFile, 'utf8')).cars);
  const cars = JSON.parse(fs.readFileSync(config.carsFile, 'utf8')).cars;
  assert.equal(cars[0].marketPrice, 1600000);
  assert.equal(cars[1].marketPrice, undefined);
  assert.equal(cars[1].marketEstimate.price, 1600000);
  assert.equal(cars[2].marketEstimate, undefined, 'демо не оцениваем');
});
