'use strict';
// Разбор объявления в свободной форме («Kia Rio 2019, 1.6 АКПП, пробег 74 тыс, цена 1 390 000»)
// в поля каталога. Строки вида «ключ: значение» (например, «цена 1 450 000») имеют приоритет —
// ими же правят черновик в боте.

const MAKES = [
  ['Mercedes-Benz', ['mercedes-benz', 'mercedes', 'мерседес-бенц', 'мерседес', 'мерс']],
  ['Land Rover', ['land rover', 'ленд ровер', 'лэнд ровер']],
  ['Kia', ['kia', 'киа']], ['Toyota', ['toyota', 'тойота']], ['Lada', ['lada', 'лада', 'ваз']],
  ['Hyundai', ['hyundai', 'хендай', 'хендэ', 'хундай', 'хёндай', 'хюндай']],
  ['Volkswagen', ['volkswagen', 'vw', 'фольксваген']], ['BMW', ['bmw', 'бмв']], ['Audi', ['audi', 'ауди']],
  ['Skoda', ['skoda', 'škoda', 'шкода']], ['Renault', ['renault', 'рено']], ['Nissan', ['nissan', 'ниссан']],
  ['Mitsubishi', ['mitsubishi', 'митсубиси', 'мицубиси']], ['Mazda', ['mazda', 'мазда']], ['Honda', ['honda', 'хонда']],
  ['Ford', ['ford', 'форд']], ['Chevrolet', ['chevrolet', 'шевроле']], ['Opel', ['opel', 'опель']],
  ['Peugeot', ['peugeot', 'пежо']], ['Citroen', ['citroen', 'citroën', 'ситроен']], ['Subaru', ['subaru', 'субару']],
  ['Lexus', ['lexus', 'лексус']], ['Infiniti', ['infiniti', 'инфинити']], ['Volvo', ['volvo', 'вольво']],
  ['Porsche', ['porsche', 'порше']], ['Geely', ['geely', 'джили']], ['Chery', ['chery', 'чери']],
  ['Haval', ['haval', 'хавал', 'хавейл']], ['Changan', ['changan', 'чанган']], ['Exeed', ['exeed', 'эксид']],
  ['Omoda', ['omoda', 'омода']], ['Jetour', ['jetour', 'джетур']], ['Suzuki', ['suzuki', 'сузуки']],
  ['Jeep', ['jeep']], ['Daewoo', ['daewoo', 'дэу']], ['SsangYong', ['ssangyong', 'ссангйонг', 'санг йонг']],
  ['Cadillac', ['cadillac', 'кадиллак']], ['UAZ', ['uaz', 'уаз']], ['Datsun', ['datsun', 'датсун']]
];
const COLORS = [
  [/серебрист/, 'Серебристый'], [/(?:^|[^а-яё])бел(?:ый|ая|ого|ом)/, 'Белый'], [/ч[её]рн(?:ый|ая|ого|ом)/, 'Чёрный'],
  [/(?:^|[^а-яё])сер(?:ый|ая|ого|ом)(?![а-яё])/, 'Серый'], [/(?:^|[^а-яё])син(?:ий|яя|его)/, 'Синий'], [/голуб/, 'Голубой'],
  [/красн(?:ый|ая|ого)/, 'Красный'], [/бордов|вишн[её]в/, 'Бордовый'], [/коричнев/, 'Коричневый'], [/бежев/, 'Бежевый'],
  [/з[ео]л[её]н(?:ый|ая|ого)/, 'Зелёный'], [/ж[её]лт(?:ый|ая|ого)/, 'Жёлтый'], [/оранжев/, 'Оранжевый'], [/фиолетов/, 'Фиолетовый']
];
const BODIES = [
  [/седан/, 'Седан'], [/х[эе]тчбек/, 'Хэтчбек'], [/лифтбек/, 'Лифтбек'], [/универсал/, 'Универсал'],
  [/кроссовер/, 'Кроссовер'], [/внедорожник/, 'Внедорожник'], [/минив[эе]н/, 'Минивэн'], [/(?:^|[^а-яё])купе(?![а-яё])/, 'Купе'], [/пикап/, 'Пикап']
];
const NOT_LETTER = '(?<![a-zа-яё0-9])';
const END = '(?![a-zа-яё0-9])';

function lower(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }

// «1 390 000», «1,39 млн», «1390 тыс», «1390к» → число.
function parseAmount(s) {
  const t = lower(s).replace(/[   ]/g, ' ');
  // Миллион: «млн», «кк», «лям», «лимон», 🍋.
  let m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:млн|миллион|кк(?![а-яa-z])|kk(?![a-z])|лям|лимон|🍋)/);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1e6);
  m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:тыс|т\.?\s?р|к(?![а-яa-z])|k(?![a-z]))/);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000);
  m = t.match(/\d{1,3}(?:[ .]\d{3})+|\d+/);
  return m ? Number(m[0].replace(/\D/g, '')) : null;
}

// Цена машины: «500» или «500 рублей» в объявлении — это 500 000 ₽, «1.5» — 1 500 000 ₽.
// Меньше 20 — миллионы, от 20 до 10 000 — тысячи, дальше — как написано.
function normalizePrice(n) {
  if (!(n > 0)) return null;
  if (n < 20) return Math.round(n * 1e6);
  if (n < 10000) return Math.round(n * 1000);
  return Math.round(n);
}
// Пробег: «пробег 120» — это 120 000 км.
function normalizeMileage(n) {
  if (n == null || !(n >= 0)) return null;
  return n > 0 && n < 1000 ? Math.round(n * 1000) : Math.round(n);
}
// Цена из строки: явные «млн», «тыс», «к» — как написано; голое число — по правилу выше.
function priceOf(s) {
  const t = lower(s).replace(/[\u00a0\u202f]/g, ' ');
  if (/\d\s*(?:млн|миллион|кк|kk|лям|лимон|🍋|тыс|т\.?\s?р|к(?![а-яa-z])|k(?![a-z]))/.test(t)) return parseAmount(s);
  const m = t.match(/\d{1,3}(?:[ .]\d{3})+(?![.,]?\d)|\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const grouped = /^\d{1,3}(?:[ .]\d{3})+$/.test(m[0]);
  const n = grouped ? Number(m[0].replace(/\D/g, '')) : parseFloat(m[0].replace(',', '.'));
  return normalizePrice(n);
}

function maskVin(vin) {
  const v = vin.toUpperCase();
  return v.slice(0, 5) + '****' + v[9] + '*****' + v.slice(15);
}

function findMake(text) {
  const t = lower(text);
  let best = null;
  for (const [name, aliases] of MAKES) {
    for (const alias of aliases) {
      const re = new RegExp(NOT_LETTER + alias.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + END, 'i');
      const m = re.exec(t);
      if (m && (!best || m.index < best.index)) best = { name, index: m.index, length: alias.length };
    }
  }
  return best;
}

const YEAR_RE = /(?<!\d)(19[6-9]\d|20[0-4]\d)(?!\d)(?![\s.]?\d{3})/;

// Значение для поля по ключу «ключ: значение».
const KEYS = [
  [/^(марка)$/, (v, f) => { const m = findMake(v); f.make = m ? m.name : v.trim(); }],
  [/^(модель)$/, (v, f) => { f.model = v.trim(); }],
  [/^(поколение)$/, (v, f) => { f.generation = v.trim(); }],
  [/^(комплектация)$/, (v, f) => { f.trim = v.trim(); }],
  [/^(год|год выпуска)$/, (v, f) => { const m = YEAR_RE.exec(v); if (m) f.year = +m[1]; }],
  [/^(цена|стоимость)$/, (v, f) => { const n = priceOf(v); if (n) f.price = n; }],
  [/^(рынок|рыночная цена|рыночная|оценка)$/, (v, f) => { const n = priceOf(v); if (n) f.marketPrice = n; }],
  [/^(пробег)$/, (v, f) => { const n = normalizeMileage(parseAmount(v)); if (n != null) f.mileage = n; }],
  [/^(двигатель|мотор)$/, (v, f) => { Object.assign(f, engineOf(v)); }],
  [/^(коробка|кпп|трансмиссия)$/, (v, f) => { const x = transmissionOf(v); if (x) f.transmission = x; }],
  [/^(привод)$/, (v, f) => { const x = driveOf(v); if (x) f.drive = x; }],
  [/^(кузов)$/, (v, f) => { const x = pick(BODIES, v); if (x) f.body = x; }],
  [/^(цвет)$/, (v, f) => { f.color = pick(COLORS, v) || cap(v.trim()); }],
  [/^(руль)$/, (v, f) => { f.wheel = /прав/.test(lower(v)) ? 'Правый' : 'Левый'; }],
  [/^(владельцев|владельцы|владелец|хозяев)$/, (v, f) => { const n = parseInt(v, 10); if (n) f.owners = n; }],
  [/^(птс)$/, (v, f) => { const x = ptsOf(v); if (x) f.pts = x; }],
  [/^(vin|вин)$/, (v, f) => { const m = /[a-hj-npr-z0-9]{17}/i.exec(v); if (m) f.vin = maskVin(m[0]); }],
  [/^(город)$/, (v, f) => { f.city = cap(v.trim()); }],
  [/^(сделали|сделано|сервис|работы|выполнено)$/, (v, f) => { f.serviceDone = v.split(/[;,]\s*/).map((s) => cap(s.trim())).filter(Boolean); }],
  [/^(описание)$/, (v, f) => { f.description = v.trim(); }],
  [/^(опции|оснащение)$/, (v, f) => { f.features = list(v); }],
  [/^(недостатки|дефекты|минусы)$/, (v, f) => { f.defects = /^(нет|без)(?![а-яё])/.test(lower(v)) ? [] : list(v); }],
  [/^(окрасы|окрас|крашено|окрашено|толщиномер|лкп)$/, (v, f) => { f.paint = cap(v.trim()); }],
  [/^(таможня|растаможен|растаможка)$/, (v, f) => { f.customs = !/^(не|нет)(?![а-яё])/.test(lower(v)); }],
  [/^(ключи|ключей)$/, (v, f) => { const n = parseInt(v, 10); if (n) f.keys = n; }],
  [/^(резина|шины|колеса|колёса)$/, (v, f) => { f.tires = cap(v.trim()); }],
  [/^(гарантия)$/, (v, f) => { f.warranty = cap(v.trim()); }],
  [/^(сервисная история|история обслуживания|обслуживание)$/, (v, f) => { f.serviceHistory = cap(v.trim()); }],
  [/^(владеет|срок владения)$/, (v, f) => { const n = parseInt(v, 10); if (n) f.lastOwnerYears = n; }],
  [/^(дтп)$/, (v, f) => { hist(f).accidents = /^(нет|без|0)(?![а-яё])/.test(lower(v)) ? 0 : parseInt(v, 10) || 1; }],
  [/^(залог)$/, (v, f) => { hist(f).pledge = !/^(нет|не)(?![а-яё])/.test(lower(v)); }],
  [/^(ограничения|запреты)$/, (v, f) => { hist(f).restrictions = !/^(нет|без)(?![а-яё])/.test(lower(v)); }],
  [/^(розыск)$/, (v, f) => { hist(f).wanted = !/^(нет|не)(?![а-яё])/.test(lower(v)); }],
  [/^(такси|каршеринг)$/, (v, f) => { hist(f).taxi = !/^(нет|не)(?![а-яё])/.test(lower(v)); }],
  [/^(скрутка|скрутки)$/, (v, f) => { hist(f).mileageOk = /^(нет|не|без)(?![а-яё])/.test(lower(v)); }],
  [/^(статус)$/, (v, f) => { const t = lower(v); f.status = /брон/.test(t) ? 'reserved' : /прод/.test(t) ? 'sold' : 'available'; }]
];

function list(v) { return v.split(/[;,]\s*/).map((x) => cap(x.trim())).filter(Boolean); }
function hist(f) { f.history = f.history || {}; return f.history; }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function pick(list, text) { const t = lower(text); for (const [re, value] of list) if (re.test(t)) return value; return null; }

function engineOf(text) {
  const t = lower(text);
  const out = {};
  const vol = /(?<![\d.,])([0-8][.,]\d)(?!\d)\s*(?:л|l|литр|tsi|tfsi|tdi|mpi|t?gdi|turbo|$|[\s,/;)])/.exec(t);
  if (vol) out.volume = parseFloat(vol[1].replace(',', '.'));
  const pw = /(\d{2,4})\s*(?:л\.?\s?с|лс|л\/с|hp|лош)/.exec(t);
  if (pw) out.power = +pw[1];
  if (/электр/.test(t)) out.fuel = 'Электро';
  else if (/гибрид|hybrid/.test(t)) out.fuel = 'Гибрид';
  else if (/дизел|tdi|crdi/.test(t)) out.fuel = 'Дизель';
  else if (/гбо|газ\s*[/-]\s*бензин|бензин\s*[/-]\s*газ/.test(t)) out.fuel = 'Газ/бензин';
  else if (/бензин/.test(t)) out.fuel = 'Бензин';
  return out;
}
function transmissionOf(text) {
  const t = lower(text);
  if (/вариатор|cvt/.test(t)) return 'Вариатор';
  if (/робот|dsg|amt|ркпп/.test(t)) return 'Робот';
  if (/мкпп|механик|механ\.?(?![а-я])|(?<![a-z])mt(?![a-z])/.test(t)) return 'Механика';
  if (/акпп|автомат|(?<![a-z])at(?![a-z])/.test(t)) return 'Автомат';
  return null;
}
function driveOf(text) {
  const t = lower(text);
  // «Полная комплектация» — не привод.
  if (/полн\S*\s+привод|полный(?!\s*(?:комплект|фарш|пакет|бак|электропакет))|4wd|4x4|4х4|awd|4matic|quattro|xdrive/.test(t)) return 'Полный';
  if (/задн|rwd/.test(t)) return 'Задний';
  if (/передн|fwd/.test(t)) return 'Передний';
  return null;
}
function ptsOf(text) {
  const t = lower(text);
  if (/дубликат/.test(t)) return 'Дубликат';
  if (/эптс|электронн/.test(t)) return 'Электронный';
  if (/оригинал/.test(t)) return 'Оригинал';
  return null;
}

const BULLET = /^\s*(?:[-–—•*+]|✅|✔️?|☑️?|🔧|▪️?)\s*/u;
const SERVICE_WORDS = /замен|нов(?:ые|ый|ая)|диагност|ремонт|полировк|химчист|обслуж|то\s|масл/;

function parseListing(text) {
  const fields = {};
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const used = new Set();
  const service = [];

  lines.forEach((line, i) => {
    // «ключ: значение» или «ключ значение»
    const m = /^([a-zа-яё ]{2,22}?)\s*[:—–-]?\s+(.+)$/i.exec(line) || /^([a-zа-яё ]{2,22}?)\s*:\s*(.+)$/i.exec(line);
    if (!m) return;
    const key = lower(m[1]).trim();
    const rule = KEYS.find(([re]) => re.test(key));
    if (rule) { rule[1](m[2], fields); used.add(i); }
  });

  lines.forEach((line, i) => {
    if (used.has(i)) return;
    const t = lower(line);
    if (!BULLET.test(line) && SERVICE_WORDS.test(t + ' ') && !/\d[.,]\d|л\.?\s?с|пробег|цена/.test(t)) {
      service.push(cap(line)); used.add(i); return;
    }
    if (BULLET.test(line)) {
      const item = cap(line.replace(BULLET, '').trim());
      if (item && !/^(торг|обмен)/i.test(item)) { service.push(item); used.add(i); return; }
    }
    if (fields.marketPrice == null && /рынок|рыночн|оценк/.test(t)) {
      const n = priceOf(t.replace(/^[^\d]*/, '')); if (n) { fields.marketPrice = n; used.add(i); return; }
    }
    // Строка, где только цена: «900к», «1🍋», «550₽», «1.2кк», «1 390 000».
    if (fields.price == null && /^\s*\d[\d\s.,]*\s*(?:к|кк|kk|k|т\.?\s?р\.?|тыс\S*|₽|р\.?|руб\S*|🍋|лимон\S*|лям\S*|млн)?\s*$/i.test(line) &&
        (/[^\d\s.,]/.test(t) || Number(t.replace(/\D/g, '')) >= 10000)) {
      const n = priceOf(t);
      if (n && n >= 10000) { fields.price = n; used.add(i); return; }
    }
    if (fields.price == null && /цена|стоимость|₽|руб|(?<![а-я])р\.|млн/.test(t)) {
      // Со словом «цена» («цена 500 рублей») голое число — тысячи; без него берём только полные суммы,
      // чтобы «налог 5000 руб» не стал ценой.
      const said = /цена|стоимость|отдам|прошу|продам за|продаю за/.test(t);
      const n = said ? priceOf(t.replace(/^[^\d]*/, '')) : parseAmount(t.replace(/^[^\d]*/, ''));
      if (n && n >= 10000) { fields.price = n; used.add(i); return; }
    }
    if (fields.mileage == null && /пробег|км(?![а-я])/.test(t)) {
      // Число после слова «пробег», иначе первое число в строке.
      const after = t.indexOf('пробег');
      const rel = after === -1 ? -1 : t.slice(after).search(/\d/);
      const at = rel !== -1 ? after + rel : t.search(/\d/);
      const raw = at === -1 ? null : parseAmount(t.slice(at).replace(/км.*$/, ''));
      const n = after !== -1 ? normalizeMileage(raw) : raw;
      // Строка вида «Kia Rio 2019, пробег 74 000» — пробег берём, но марку и год из неё тоже разбираем ниже.
      if (n != null) { fields.mileage = n; if (!findMake(line)) used.add(i); }
    }
  });

  const free = lines.filter((_, i) => !used.has(i)).join('\n');
  const all = lower(free);

  const make = findMake(free);
  if (make && !fields.make) {
    fields.make = make.name;
    if (!fields.model) {
      const rest = free.slice(make.index + make.length).split('\n')[0].replace(/^[\s,.:-]+/, '');
      const tokens = rest.split(/[\s,]+/).filter(Boolean);
      const model = [];
      for (const tok of tokens) {
        if (/^\d{4}/.test(tok) || /^\d[.,]\d/.test(tok) || /^(год|г\.?|,)$/i.test(tok)) break;
        model.push(tok);
        if (model.length === 1 && tok.length > 1 && !/^[a-zа-я]$/i.test(tok)) break;
      }
      if (model.length) fields.model = model.join(' ');
      const gen = /^(?:[IVX]{1,4}|[A-Z]{1,3}\d{2,3}[A-Z]?|рестайлинг)$/.exec(tokens[model.length] || '');
      if (gen && !fields.generation) fields.generation = gen[0];
    }
  }
  if (!fields.year) { const y = YEAR_RE.exec(free); if (y) fields.year = +y[1]; }
  const eng = engineOf(free);
  if (eng.volume && !fields.volume) fields.volume = eng.volume;
  if (eng.power && !fields.power) fields.power = eng.power;
  if (eng.fuel && !fields.fuel) fields.fuel = eng.fuel;
  if (!fields.transmission) { const x = transmissionOf(free); if (x) fields.transmission = x; }
  if (!fields.drive) { const x = driveOf(free); if (x) fields.drive = x; }
  if (!fields.body) { const x = pick(BODIES, free); if (x) fields.body = x; }
  if (!fields.color) { const x = pick(COLORS, free); if (x) fields.color = x; }
  if (!fields.wheel && /правый руль|праворул/.test(all)) fields.wheel = 'Правый';
  if (!fields.owners) {
    const o = /(\d)\s*(?:-?[хй]|-?го)?\s*(?:влад|хоз|собств)/.exec(all);
    if (o) fields.owners = +o[1];
    else if (/(один|первый|1-й)\s+(влад|хоз|собств)/.test(all)) fields.owners = 1;
  }
  if (!fields.pts && /птс|оригинал|дубликат/.test(all)) { const p = ptsOf(all); if (p) fields.pts = p; }
  if (!fields.keys) { const k = /(\d|два|две|один|одна|три)\s+(?:комплекта\s+)?ключ/.exec(all); if (k) fields.keys = { 'один': 1, 'одна': 1, 'два': 2, 'две': 2, 'три': 3 }[k[1]] || +k[1]; }
  if (!fields.vin) { const v = /(?<![a-z0-9])[a-hj-npr-z0-9]{17}(?![a-z0-9])/i.exec(free); if (v && /\d/.test(v[0])) fields.vin = maskVin(v[0]); }
  if (!fields.city) { const c = /(?:г\.|город)\s*([А-ЯЁ][а-яё-]+)/.exec(free); if (c) fields.city = c[1]; }
  const tags = [];
  if (/(?<![а-я])торг/.test(all)) tags.push('Торг');
  if (/(?<![а-я])обмен/.test(all)) tags.push('Обмен');
  if (tags.length) fields.tags = tags;

  if (service.length && !fields.serviceDone) fields.serviceDone = service;
  // Описание — строки, которые не разобрались в поля (кроме первой строки с маркой и моделью).
  const desc = lines.filter((line, i) => {
    if (used.has(i)) return false;
    if (findMake(line) || /(?:г\.|город)\s*[А-ЯЁ]/.test(line)) return false;
    const t = lower(line);
    const technical = /(?:\d[.,]\d|л\.?\s?с|акпп|мкпп|автомат|механ|вариатор|робот|привод|седан|кроссовер|хэтчбек|лифтбек|универсал|внедорожник|владел|птс)/.test(t);
    return !technical && !/^(торг|обмен)[.!]?$/.test(t);
  });
  if (desc.length && !fields.description) fields.description = desc.join('\n');
  return fields;
}

// Поля разбора → объект машины для cars.json.
function toCar(f) {
  const car = {};
  for (const k of ['make', 'model', 'generation', 'trim', 'year', 'price', 'marketPrice', 'mileage', 'transmission', 'drive', 'body',
    'color', 'wheel', 'owners', 'pts', 'vin', 'city', 'serviceDone', 'description', 'tags', 'status',
    'features', 'defects', 'paint', 'customs', 'keys', 'tires', 'warranty', 'serviceHistory', 'lastOwnerYears', 'history']) {
    if (f[k] !== undefined && f[k] !== '') car[k] = f[k];
  }
  const engine = {};
  if (f.volume) engine.volume = f.volume;
  if (f.power) engine.power = f.power;
  if (f.fuel) engine.fuel = f.fuel;
  if (Object.keys(engine).length) car.engine = engine;
  return car;
}

const REQUIRED = { make: 'марка', model: 'модель', year: 'год', price: 'цена', mileage: 'пробег' };
function missing(f) { return Object.keys(REQUIRED).filter((k) => f[k] == null || f[k] === '').map((k) => REQUIRED[k]); }

module.exports = { parseListing, toCar, missing, parseAmount, priceOf, normalizePrice, normalizeMileage, maskVin };
