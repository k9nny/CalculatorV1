'use strict';
// Заявки: проверка полей и текст сообщения менеджеру.

const TYPES = {
  buy: 'Осмотр машины',
  dealer: 'Оптовая цена — перекуп',
  callback: 'Обратный звонок',
  sell: 'Выкуп — продать машину'
};
const CONDITIONS = ['На ходу, без ДТП', 'После ДТП', 'Требует ремонта', 'Не на ходу'];

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizePhone(value) {
  const d = String(value == null ? '' : value).replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
  if (d.length === 10 && d[0] === '9') return '+7' + d;
  return null;
}

function intIn(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

// Возвращает { ok: true, lead } или { ok: false, error } — текст ошибки показывается пользователю.
function validateLead(body, cars, { now = new Date() } = {}) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Пустая заявка' };
  const type = body.type;
  if (!Object.prototype.hasOwnProperty.call(TYPES, type)) return { ok: false, error: 'Неизвестный тип заявки' };
  if (body.consent !== true) return { ok: false, error: 'Нужно согласие на обработку персональных данных' };
  const phone = normalizePhone(body.phone);
  if (!phone) return { ok: false, error: 'Проверьте номер телефона: нужен российский номер из 11 цифр' };

  const lead = {
    type,
    phone,
    name: clean(body.name, 80),
    comment: clean(body.comment, 500),
    platform: ['telegram', 'max', 'web'].includes(body.platform) ? body.platform : 'web'
  };

  if (body.carId != null && body.carId !== '') {
    // Название и цену берём из каталога на сервере, а не из запроса.
    const car = (cars || []).find((c) => String(c.id) === String(body.carId));
    if (!car) return { ok: false, error: 'Машина не найдена — обновите каталог' };
    lead.car = { id: String(car.id), title: `${car.make} ${car.model}, ${car.year}`, price: car.price };
  }

  if (type === 'sell') {
    const c = body.car || {};
    const year = intIn(c.year, 1960, now.getFullYear() + 1);
    const mileage = intIn(c.mileage, 0, 3000000);
    const desiredPrice = intIn(c.desiredPrice, 0, 1000000000);
    const make = clean(c.make, 40);
    const model = clean(c.model, 40);
    if (!make || !model) return { ok: false, error: 'Укажите марку и модель' };
    if (year === null || Number.isNaN(year)) return { ok: false, error: 'Укажите год выпуска' };
    if (Number.isNaN(mileage) || Number.isNaN(desiredPrice)) return { ok: false, error: 'Проверьте пробег и цену' };
    lead.sellCar = {
      make,
      model,
      year,
      mileage,
      condition: CONDITIONS.includes(c.condition) ? c.condition : CONDITIONS[0],
      desiredPrice
    };
  }
  return { ok: true, lead };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function money(n) {
  return Number(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';
}

const PLATFORM_NAMES = { telegram: 'Telegram', max: 'MAX', web: 'сайт' };

// Сообщение менеджеру в Telegram (parse_mode: HTML).
function formatLeadMessage(lead, source) {
  const lines = [`<b>Заявка: ${escapeHtml(TYPES[lead.type])}</b>`];
  if (lead.car) lines.push(`${escapeHtml(lead.car.title)} — ${money(lead.car.price)} (№ ${escapeHtml(lead.car.id)})`);
  if (lead.sellCar) {
    const c = lead.sellCar;
    lines.push(
      `${escapeHtml(c.make)} ${escapeHtml(c.model)}, ${c.year}` +
        (c.mileage != null ? `, ${c.mileage.toLocaleString('ru-RU').replace(/ /g, ' ')} км` : '') +
        `\nСостояние: ${escapeHtml(c.condition)}` +
        (c.desiredPrice ? `\nХочет: ${money(c.desiredPrice)}` : '')
    );
  }
  lines.push('');
  if (lead.name) lines.push(`Имя: ${escapeHtml(lead.name)}`);
  lines.push(`Телефон: ${escapeHtml(lead.phone)}`);
  if (lead.comment) lines.push(`Комментарий: ${escapeHtml(lead.comment)}`);
  const who = source.user
    ? [source.user.first_name, source.user.last_name].filter(Boolean).join(' ') + (source.user.username ? ` @${source.user.username}` : '')
    : '';
  lines.push(
    `Источник: ${PLATFORM_NAMES[source.platform] || 'сайт'}` +
      (source.verified ? '' : source.platform === 'web' ? '' : ' (подпись не проверена)') +
      (who ? ` · ${escapeHtml(who)}` : '')
  );
  return lines.join('\n');
}

module.exports = { validateLead, formatLeadMessage, normalizePhone, TYPES };
