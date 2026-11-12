'use strict';
// Текст объявления по одному шаблону: одни и те же разделы в одном порядке для всех машин.
// Пишется только то, что есть в карточке; пустые строки пропускаются. Ничего не дописывает.
const { PHONE_LABEL, BRAND } = require('./site-layout');

const num = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/[   ]/g, ' ');
const low = (s) => String(s || '').toLowerCase();
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};
// Строчная первая буква только у русских слов: «Подогрев руля» → «подогрев руля», но «Bluetooth», «ABS» как есть.
const lowRu = (s) => { const t = String(s || '').trim(); return /^[А-ЯЁ][а-яё]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t; };
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentence = (s) => { const t = String(s || '').trim(); return t ? t[0].toUpperCase() + t.slice(1).replace(/[.;,\s]+$/, '') + '.' : ''; };

function checks(h = {}) {
  return [
    h.accidents != null && (h.accidents ? `ДТП по базам: ${h.accidents}` : 'без ДТП'),
    h.pledge != null && (h.pledge ? 'в залоге' : 'не в залоге'),
    h.restrictions != null && (h.restrictions ? 'есть ограничения' : 'без ограничений'),
    h.wanted != null && (h.wanted ? 'в розыске' : 'не в розыске'),
    h.taxi != null && (h.taxi ? 'работала в такси' : 'не в такси'),
    h.mileageOk != null && (h.mileageOk ? 'пробег подтверждён' : 'пробег не подтверждён')
  ].filter(Boolean);
}

// car — объект из cars.json; link — ссылка на машину (необязательно). Возвращает обычный текст.
function listingText(car, link = '') {
  const e = car.engine || {};
  const name = [car.make, car.model, car.generation].filter(Boolean).join(' ') + (car.year ? `, ${car.year}` : '');
  const rows = [
    car.mileage != null && `Пробег: ${num(car.mileage)} км`,
    (e.volume || e.power || e.fuel) && `Двигатель: ${[e.volume && Number(e.volume).toFixed(1) + ' л', e.power && e.power + ' л.с.', e.fuel && low(e.fuel)].filter(Boolean).join(', ')}`,
    (car.transmission || car.drive) && [car.transmission && `Коробка: ${low(car.transmission)}`, car.drive && `привод: ${low(car.drive)}`].filter(Boolean).join(' · '),
    (car.body || car.color) && `Кузов: ${[low(car.body), low(car.color)].filter(Boolean).join(', ')}`,
    (car.owners || car.pts) && [car.owners && `Владельцев по ПТС: ${car.owners}`, car.pts && `ПТС: ${low(car.pts)}`].filter(Boolean).join(' · '),
    car.wheel === 'Правый' && 'Руль: правый',
    car.customs === false && 'Не растаможен',
    car.trim && `Комплектация: ${car.trim}`
  ].filter(Boolean).map((r) => '• ' + capFirst(r));
  const list = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);
  const ch = checks(car.history);
  const condition = [
    ch.length && sentence('Проверка: ' + ch.join(', ')),
    list(car.serviceDone).length && sentence('Перед продажей: ' + list(car.serviceDone).map(lowRu).join(', ')),
    list(car.features).length && sentence('Оснащение: ' + list(car.features).map(lowRu).join(', ')),
    car.paint && sentence(car.paint),
    Array.isArray(car.defects) && sentence(car.defects.length ? 'Недостатки: ' + car.defects.map(lowRu).join(', ') : 'Существенных недостатков нет'),
    (car.keys || car.tires) && sentence([car.keys && `${car.keys} ${plural(car.keys, 'ключ', 'ключа', 'ключей')}`, car.tires && `резина: ${low(car.tires)}`].filter(Boolean).join(', ')),
    car.warranty && sentence('Гарантия: ' + low(car.warranty))
  ].filter(Boolean);
  const blocks = [
    [name, car.price ? `${num(car.price)} ₽` : ''].filter(Boolean).join('\n'),
    rows.join('\n'),
    condition.join('\n'),
    car.description ? sentence(car.description) : '',
    list(car.tags).length ? [list(car.tags).includes('Торг') && 'Возможен торг.', list(car.tags).includes('Обмен') && 'Рассмотрим обмен.'].filter(Boolean).join(' ') : '',
    [`Осмотр и тест-драйв в Москве по записи. ${BRAND}, ${PHONE_LABEL}`, link && `Фото и запись на осмотр: ${link}`].filter(Boolean).join('\n')
  ].filter(Boolean);
  return blocks.join('\n\n');
}

module.exports = { listingText };
