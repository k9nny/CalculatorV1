'use strict';
// Заявки: проверка полей и текст сообщения менеджеру.

const TYPES = {
  buy: 'Осмотр машины',
  dealer: 'Оптовая цена — перекуп',
  callback: 'Обратный звонок',
  sell: 'Выкуп — продать машину',
  credit: 'Покупка в кредит — анкета'
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

const CREDIT_TERMS = [12, 24, 36, 48, 60, 72, 84];
const EMPLOYMENT = { hired: 'работает по найму', business: 'ИП или свой бизнес', self: 'самозанятый', pension: 'пенсионер', other: 'другое' };

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

  // Анкета на кредит: машина из каталога (или без машины — подобрать), ФИО, срок, доход, занятость.
  if (type === 'credit') {
    const c = body.credit || {};
    const downPayment = intIn(c.downPayment, 0, lead.car ? lead.car.price : 1e9);
    if (Number.isNaN(downPayment)) return { ok: false, error: 'Проверьте первоначальный взнос' };
    if (lead.name.split(/\s+/).filter(Boolean).length < 2) return { ok: false, error: 'Укажите фамилию и имя' };
    const termMonths = CREDIT_TERMS.includes(Number(c.termMonths)) ? Number(c.termMonths) : null;
    const income = intIn(c.income, 0, 100000000);
    let birthDate = null;
    if (c.birthDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(c.birthDate));
      const age = m ? (now - new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)) / (365.25 * 864e5) : NaN;
      if (!(age >= 18 && age < 100)) return { ok: false, error: 'Проверьте дату рождения: кредит дают с 18 лет' };
      birthDate = m[0];
    }
    lead.credit = {
      downPayment,
      termMonths,
      income: Number.isNaN(income) ? null : income,
      employment: Object.prototype.hasOwnProperty.call(EMPLOYMENT, c.employment) ? c.employment : null,
      birthDate
    };
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
  if (lead.credit) {
    const c = lead.credit;
    if (!lead.car) lines.push('Машину ещё не выбрал — подобрать');
    lines.push(`Первоначальный взнос: ${c.downPayment ? money(c.downPayment) : 'без взноса или не указан'}`);
    if (c.termMonths) lines.push(`Срок: ${c.termMonths} мес.`);
    if (c.income) lines.push(`Доход в месяц: ${money(c.income)}`);
    if (c.employment) lines.push(`Занятость: ${EMPLOYMENT[c.employment]}`);
    if (c.birthDate) lines.push(`Дата рождения: ${c.birthDate.split('-').reverse().join('.')}`);
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

module.exports = { validateLead, formatLeadMessage, normalizePhone, TYPES, EMPLOYMENT };
