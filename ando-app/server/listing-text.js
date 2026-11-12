'use strict';
// Текст объявления по одному шаблону — как у дилеров на Авито, Авто.ру и Дроме:
// заголовок → цена → основное → документы и история → состояние → комплектация → обслуживание →
// известные недостатки → в комплекте → условия. Пустые разделы пропускаются; пишется только то, что есть в карточке.
// Без капса, эмодзи, «!», «срочно», «идеал», «лучшая цена» (38-ФЗ, правила площадок).
// mode: 'channel' — для Telegram-канала (цена, телефон, ссылка); 'market' — для Авито и Авто.ру
// (цена — в отдельном поле площадки, контакты в описании запрещены).
const { PHONE_LABEL, BRAND } = require('./site-layout');

const num = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/[   ]/g, ' ');
const low = (s) => String(s || '').toLowerCase();
// Строчная первая буква только у русских слов: «Подогрев руля» → «подогрев руля», а «Bluetooth», «ABS» как есть.
const lowRu = (s) => { const t = String(s || '').trim(); return /^[А-ЯЁ][а-яё]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t; };
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentence = (s) => { const t = String(s || '').trim(); return t ? capFirst(t).replace(/[.;,\s]+$/, '') + '.' : ''; };
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};
const list = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);
const date = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };

const GEARBOX = { 'Автомат': ['AT', 'автоматическая'], 'Механика': ['MT', 'механическая'], 'Робот': ['AMT', 'роботизированная'], 'Вариатор': ['CVT', 'вариатор'] };

// «Hyundai Solaris II 1.6 AT, 2018, 120 000 км» — как строит заголовок Авито.
function title(car) {
  const e = car.engine || {};
  const head = [car.make, car.model, car.generation,
    e.volume && e.fuel !== 'Электро' ? Number(e.volume).toFixed(1) : '',
    GEARBOX[car.transmission] ? GEARBOX[car.transmission][0] : '',
    car.drive === 'Полный' ? '4WD' : ''].filter(Boolean).join(' ');
  return [head, car.year, car.mileage != null ? `${num(car.mileage)} км` : ''].filter(Boolean).join(', ');
}

function section(name, lines) {
  const l = lines.filter(Boolean);
  return l.length ? `${name}\n${l.map((x) => '• ' + x).join('\n')}` : '';
}

function listingText(car, opts = {}) {
  const { link = '', mode = 'channel' } = typeof opts === 'string' ? { link: opts } : opts;
  const e = car.engine || {};
  const h = car.history || {};
  const tags = list(car.tags);

  const price = mode === 'channel' && car.price
    ? [`Цена: ${num(car.price)} ₽.`, tags.includes('Торг') && 'Торг при осмотре.', tags.includes('Обмен') && 'Возможен обмен.'].filter(Boolean).join(' ')
    : (mode === 'market' ? [tags.includes('Торг') && 'Торг при осмотре.', tags.includes('Обмен') && 'Возможен обмен.'].filter(Boolean).join(' ') : '');

  const main = section('Основное', [
    car.year && `Год выпуска: ${car.year}`,
    car.mileage != null && `Пробег: ${num(car.mileage)} км`,
    (e.volume || e.power || e.fuel) && `Двигатель: ${[e.volume && Number(e.volume).toFixed(1) + ' л', e.power && e.power + ' л.с.', e.fuel && low(e.fuel)].filter(Boolean).join(', ')}`,
    GEARBOX[car.transmission] && `Коробка: ${GEARBOX[car.transmission][1]}`,
    car.drive && `Привод: ${low(car.drive)}`,
    (car.body || car.color) && [car.body && `Кузов: ${low(car.body)}`, car.color && `цвет: ${low(car.color)}`].filter(Boolean).join('; '),
    car.wheel === 'Правый' && 'Руль: правый',
    car.owners && `Владельцев по ПТС: ${car.owners}`,
    car.pts && `ПТС: ${low(car.pts)}`,
    car.customs === false && 'Не растаможен',
    car.vin && `VIN: ${car.vin}`
  ]);

  const checked = h.checkedAt ? ` (проверка по базам ГИБДД и реестру залогов от ${date(h.checkedAt)})` : '';
  const clean = h.restrictions === false && h.pledge === false && h.wanted !== true;
  const docs = section('Документы и история', [
    clean ? `Ограничений на регистрационные действия${h.wanted === false ? ', розыска' : ''} и залога не выявлено${checked}.`
      : [h.pledge === true && 'Автомобиль в залоге — погашение и снятие залога при сделке.', h.restrictions === true && 'Есть ограничения на регистрационные действия.'].filter(Boolean).join(' '),
    h.accidents === 0 ? (h.checkedAt ? 'По базе ГИБДД ДТП не зарегистрированы.' : 'Без ДТП.') : h.accidents ? `ДТП по базе ГИБДД: ${h.accidents}.` : '',
    h.taxi === false && 'В такси и каршеринге не использовался.',
    h.taxi === true && 'Использовался в такси или каршеринге.',
    h.mileageOk === true && 'Пробег подтверждён по истории.',
    car.serviceHistory && sentence(car.serviceHistory),
    car.lastOwnerYears && `У последнего владельца ${car.lastOwnerYears} ${plural(car.lastOwnerYears, 'год', 'года', 'лет')}.`
  ]);

  const state = section('Состояние', [
    car.paint && sentence(/^кузов/i.test(car.paint) ? car.paint : 'Кузов: ' + lowRu(car.paint)),
    car.description && sentence(car.description)
  ]);

  const equip = section('Комплектация', [
    car.trim && sentence(car.trim),
    list(car.features).length && sentence(list(car.features).map(lowRu).join(', '))
  ]);

  const service = section('Обслуживание', list(car.serviceDone).map(sentence));
  const defects = list(car.defects).length ? section('Известные недостатки', [sentence(list(car.defects).map(lowRu).join(', '))]) : '';
  const kit = section('В комплекте', [
    (car.keys || car.tires) && sentence([car.keys && `${car.keys} ${plural(car.keys, 'ключ', 'ключа', 'ключей')}`, car.tires && lowRu(car.tires)].filter(Boolean).join(', ')),
    car.warranty && sentence('Гарантия: ' + lowRu(car.warranty))
  ]);

  const terms = mode === 'channel'
    ? [`Продаёт компания ${BRAND}, договор купли-продажи. Осмотр в Москве по предварительной записи, возможна проверка в сервисе по выбору покупателя.`,
      PHONE_LABEL, link && `Фото и запись на осмотр: ${link}`].filter(Boolean).join('\n')
    : 'Продаёт компания, договор купли-продажи. Осмотр в Москве по предварительной записи, возможна проверка в сервисе по выбору покупателя. Напишите в чат или позвоните — пришлём дополнительные фото и видео.';

  return [title(car), price, main, docs, state, equip, service, defects, kit, terms].filter(Boolean).join('\n\n');
}

module.exports = { listingText, title };
