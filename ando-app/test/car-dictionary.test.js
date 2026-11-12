'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectCar, canonical } = require('../server/car-dictionary');
const { parseListing } = require('../server/listing-parser');

test('словарь: сленг → марка и модель, поколение — только если названо или однозначно по году', () => {
  assert.deepEqual(detectCar('мерс ешка 17г', 2017), { make: 'Mercedes-Benz', model: 'E-Класс', generation: 'W213' });
  assert.deepEqual(detectCar('крузак 200 4.5 дизель'), { make: 'Toyota', model: 'Land Cruiser', generation: '200' });
  assert.deepEqual(detectCar('камри 50 2013'), { make: 'Toyota', model: 'Camry', generation: 'XV50' });
  assert.deepEqual(detectCar('каптюр 2021'), { make: 'Renault', model: 'Kaptur' });
  assert.equal(detectCar('солярис 2017', 2017).generation, undefined, '2017 — стык поколений, не угадываем');
  assert.equal(detectCar('приора 2012').make, 'Lada');
});

test('словарь: двусмысленное и коды без марки не срабатывают', () => {
  assert.deepEqual(detectCar('семерка 1.5 карб'), {});
  assert.deepEqual(detectCar('x5 2019'), {});
  assert.equal(detectCar('бмв x5 2019', 2019).model, 'X5');
  assert.deepEqual(detectCar('продаю 2017 год 130 пробег'), {});
});

test('словарь: одно написание для всех объявлений', () => {
  assert.deepEqual(canonical('Mercedes-Benz', 'E-Class'), { make: 'Mercedes-Benz', model: 'E-Класс' });
  assert.deepEqual(canonical('ВАЗ', 'Priora'), { make: 'Lada', model: 'Priora' });
  assert.deepEqual(canonical('Tesla', 'Model Y'), { make: 'Tesla', model: 'Model Y' });
});

test('разбор одной строкой со сленгом — без нейросети', () => {
  const f = parseListing('мерс ешка 17г 2.0 бенз полный 98т.км 2 хоз цена 2 млн 650 торг');
  assert.equal(f.make, 'Mercedes-Benz'); assert.equal(f.model, 'E-Класс'); assert.equal(f.year, 2017);
  assert.equal(f.price, 2650000); assert.equal(f.mileage, 98000); assert.equal(f.owners, 2);
  assert.equal(f.fuel, 'Бензин'); assert.equal(f.drive, 'Полный'); assert.deepEqual(f.tags, ['Торг']);
  const s = parseListing('солярис 18 год автомат 120т.км отдам за лям сто');
  assert.equal(s.make, 'Hyundai'); assert.equal(s.year, 2018); assert.equal(s.mileage, 120000); assert.equal(s.price, 1100000);
  const p = parseListing('приора 2012 мех, гбо, не бита не крашена, 300');
  assert.equal(p.transmission, 'Механика'); assert.equal(p.price, 300000); assert.equal(p.paint, 'Без окрасов'); assert.equal(p.history.accidents, 0);
});
