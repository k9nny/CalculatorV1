'use strict';
// Разбор объявления нейросетью (Kimi или любая модель с API как у OpenAI: /v1/chat/completions).
// Нейросеть только раскладывает текст по полям. Ответ проверяется: числа в разумных пределах,
// коробка, привод и т. п. — только из списка. Нет ключа, нет связи или плохой ответ — обычный разбор.
// Телефоны, почта и ссылки вырезаются из текста до отправки.
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const { parseListing, maskVin } = require('./listing-parser');

const ENUMS = {
  transmission: ['Автомат', 'Механика', 'Вариатор', 'Робот'],
  drive: ['Передний', 'Задний', 'Полный'],
  body: ['Седан', 'Хэтчбек', 'Лифтбек', 'Универсал', 'Кроссовер', 'Внедорожник', 'Минивэн', 'Купе', 'Пикап'],
  wheel: ['Левый', 'Правый'],
  pts: ['Оригинал', 'Дубликат', 'Электронный'],
  fuel: ['Бензин', 'Дизель', 'Гибрид', 'Электро', 'Газ/бензин']
};

const PROMPT = `Ты разбираешь объявления о продаже подержанных автомобилей в России и заполняешь карточку.
Текст может быть разговорным, со сленгом, сокращениями и опечатками. Верни только JSON-объект, без пояснений.
Правила:
- Расшифровывать очевидное можно: сленг и сокращения («мерс ешка» → Mercedes-Benz E-Class, «бэха» → BMW, «солярис» → Hyundai Solaris, «бенз» → Бензин, «дизель/соляра» → Дизель, «98т.км» → 98000, «2 млн 650» → 2650000, «2 хоз» → 2 владельца, «не бита не крашена» → accidents 0 и paint «Без окрасов»).
- Додумывать нельзя: если чего-то нет в тексте, поле не включай. Не угадывай мощность, комплектацию, поколение, цвет, число владельцев, историю ДТП по году или модели.
- Если сомневаешься — не включай поле.
Поля:
- make: марка латиницей, как пишет производитель (Kia, Hyundai, Mercedes-Benz, Lada, Haval, Geely, Chery, BMW…); «Мерс» → Mercedes-Benz, «Ваз» → Lada
- model: модель латиницей или как принято (Rio, Solaris, Camry, Vesta, E-Class, X5, Jolion); без года и комплектации
- generation: поколение или кузов, если указаны (IV, W213, F30, рестайлинг)
- trim: комплектация (Comfort, Prestige…)
- year: год выпуска, число
- price: цена продажи в рублях, число («1,39 млн» → 1390000, «1390к» → 1390000)
- marketPrice: рыночная цена или оценка, если указана отдельно, число
- mileage: пробег в км, число («74 тыс» → 74000)
- volume: объём двигателя в литрах, число (1.6)
- power: мощность в л.с., число
- fuel: одно из ${ENUMS.fuel.join(', ')}
- transmission: одно из ${ENUMS.transmission.join(', ')} (АКПП, AT → Автомат; МКПП → Механика; DSG, AMT → Робот; CVT → Вариатор)
- drive: одно из ${ENUMS.drive.join(', ')} (4WD, AWD, 4x4, quattro, xDrive → Полный)
- body: одно из ${ENUMS.body.join(', ')}
- color: цвет одним словом с большой буквы (Белый, Чёрный, Серый, Серебристый, Синий…)
- wheel: одно из ${ENUMS.wheel.join(', ')}
- owners: число владельцев по ПТС
- pts: одно из ${ENUMS.pts.join(', ')}
- vin: VIN из 17 символов, если есть
- features: массив опций (Подогрев сидений, Камера заднего вида, Круиз-контроль…)
- serviceDone: массив работ, сделанных перед продажей (Замена масла, Новые колодки…)
- defects: массив недостатков; если сказано, что недостатков нет, — пустой массив
- paint: окрасы кузова одной строкой («Без окрасов», «Окрашено заднее крыло»)
- keys: число ключей
- tires: резина одной строкой
- warranty: гарантия одной строкой
- lastOwnerYears: сколько лет у последнего владельца, число
- accidents: число ДТП по базам; 0, если сказано «без ДТП» или «не битая»
- pledge, restrictions, taxi: true или false, если прямо сказано (залог, ограничения или запреты ГИБДД, работала в такси)
- description: 1–2 нейтральных предложения деловым языком только о фактах из текста, которые не попали в поля выше (например, где обслуживалась, сколько лет у владельца, что меняли). Без сленга, эмодзи, восклицаний и оценок («идеал», «пушка», «срочно», «вложений не требует»). Без цены, пробега, торга и контактов. Нет таких фактов — пустая строка
- tags: массив из «Торг», «Обмен», если упомянуты`;

const PHOTO_PROMPT = `На фото автомобиль. Определи только то, в чём уверен, и верни JSON-объект без пояснений:
make (марка латиницей), model (модель), generation (поколение или кузов, только если точно видно), body (одно из ${ENUMS.body.join(', ')}), color (цвет одним словом).
Не уверен — не включай поле. Номера, людей и надписи не описывай.`;
// По фото берём только главное — и только то, чего нет в тексте.
const PHOTO_KEYS = ['make', 'model', 'generation', 'body', 'color'];

function redact(text) {
  return String(text)
    .replace(/(?:\+7|(?<!\d)8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)/g, '[телефон]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[почта]')
    .replace(/https?:\/\/\S+|(?:t\.me|wa\.me|vk\.com)\/\S+/gi, '[ссылка]')
    .replace(/(?<![\w])@[a-z0-9_]{4,}/gi, '[ник]')
    .slice(0, 6000);
}

const isInt = (v, min, max) => Number.isFinite(+v) && +v >= min && +v <= max;
const str = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const strList = (v, n = 30) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, n) : undefined);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const oneOf = (v, list) => list.find((x) => x.toLowerCase() === String(v || '').trim().toLowerCase());

// Ответ нейросети → поля в том же виде, что у parseListing. Всё сомнительное отбрасывается.
function clean(raw, text) {
  if (!raw || typeof raw !== 'object') return {};
  const f = {};
  const year = new Date().getFullYear() + 1;
  if (str(raw.make, 40)) f.make = str(raw.make, 40);
  if (str(raw.model, 60)) f.model = str(raw.model, 60);
  if (str(raw.generation, 40)) f.generation = str(raw.generation, 40);
  if (str(raw.trim, 60)) f.trim = str(raw.trim, 60);
  if (isInt(raw.year, 1960, year)) f.year = Math.round(+raw.year);
  if (isInt(raw.price, 10000, 5e8)) f.price = Math.round(+raw.price);
  if (isInt(raw.marketPrice, 10000, 5e8)) f.marketPrice = Math.round(+raw.marketPrice);
  if (isInt(raw.mileage, 0, 3e6)) f.mileage = Math.round(+raw.mileage);
  if (isInt(raw.volume, 0.5, 9)) f.volume = Math.round(+raw.volume * 10) / 10;
  if (isInt(raw.power, 30, 2000)) f.power = Math.round(+raw.power);
  for (const k of ['fuel', 'transmission', 'drive', 'body', 'wheel', 'pts']) { const x = oneOf(raw[k], ENUMS[k]); if (x) f[k] = x; }
  if (str(raw.color, 30)) f.color = cap(str(raw.color, 30).toLowerCase());
  if (isInt(raw.owners, 1, 30)) f.owners = Math.round(+raw.owners);
  if (isInt(raw.keys, 1, 10)) f.keys = Math.round(+raw.keys);
  if (isInt(raw.lastOwnerYears, 0, 60)) f.lastOwnerYears = Math.round(+raw.lastOwnerYears);
  // VIN берём, только если он действительно есть в тексте.
  const vin = str(raw.vin, 20);
  if (vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin) && String(text).toUpperCase().includes(vin.toUpperCase())) f.vin = maskVin(vin);
  for (const k of ['features', 'serviceDone', 'defects']) { const l = strList(raw[k]); if (l) f[k] = l.map(cap); }
  for (const k of ['paint', 'tires', 'warranty']) if (str(raw[k])) f[k] = cap(str(raw[k]));
  const desc = str(raw.description, 600);
  if (desc && !/\[(телефон|почта|ссылка|ник)\]/.test(desc)) f.description = desc;
  const tags = strList(raw.tags, 2);
  if (tags) { const t = tags.map((x) => oneOf(x, ['Торг', 'Обмен'])).filter(Boolean); if (t.length) f.tags = t; }
  const h = {};
  if (isInt(raw.accidents, 0, 20)) h.accidents = Math.round(+raw.accidents);
  for (const k of ['pledge', 'restrictions', 'taxi']) if (typeof raw[k] === 'boolean') h[k] = raw[k];
  if (Object.keys(h).length) f.history = h;
  return f;
}

function postJson(url, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
        try { resolve(JSON.parse(text)); } catch { reject(new Error('ответ не JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

// Короткая правка («цена 1 350 000», «пробег 80 тыс») — нейросеть не нужна.
const EDIT_KEY = /^\s*(марка|модель|поколение|комплектация|год|цена|стоимость|рынок|пробег|двигатель|коробка|кпп|привод|кузов|цвет|руль|владельц\S*|птс|vin|вин|описание|опции|недостатки|окрасы|ключи|резина|гарантия|дтп|залог|ограничения|такси|статус)(?![а-яёa-z])/i;
function isEdit(text) {
  const lines = String(text).trim().split('\n').filter((l) => l.trim());
  return lines.length > 0 && lines.length <= 2 && lines.every((l) => EDIT_KEY.test(l));
}

function createSmartParser({ baseUrl = '', apiKey = '', model = '', vision = true, timeoutMs = 40000 } = {}, { post = postJson, log = console.log } = {}) {
  const enabled = !!(baseUrl && apiKey && model);
  let noTemperature = false;
  const cache = new Map();
  async function ask(text) {
    const body = {
      model,
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: redact(text) }],
      response_format: { type: 'json_object' },
      max_tokens: 2000
    };
    if (!noTemperature) body.temperature = 0; // одинаковый текст — одинаковый результат
    let res;
    try {
      res = await post(baseUrl.replace(/\/+$/, '') + '/chat/completions', body, { Authorization: 'Bearer ' + apiKey }, timeoutMs);
    } catch (e) {
      // Некоторые модели не принимают temperature — повторяем без неё.
      if (!noTemperature && /temperature/i.test(e.message)) { noTemperature = true; return ask(text); }
      throw e;
    }
    const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    const m = /\{[\s\S]*\}/.exec(String(content || ''));
    if (!m) throw new Error('в ответе нет JSON');
    return JSON.parse(m[0]);
  }
  // По фото: марка, модель, поколение, кузов, цвет. Нейросеть без зрения или ошибка — пустой ответ.
  async function photo(buffer, mime = 'image/jpeg') {
    if (!enabled || !vision || !buffer || !buffer.length || buffer.length > 8 * 1024 * 1024) return {};
    try {
      const res = await post(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        model,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
          { type: 'text', text: PHOTO_PROMPT }
        ] }],
        response_format: { type: 'json_object' },
        max_tokens: 600
      }, { Authorization: 'Bearer ' + apiKey }, timeoutMs);
      const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
      const m = /\{[\s\S]*\}/.exec(String(content || ''));
      if (!m) return {};
      const f = clean(JSON.parse(m[0]), '');
      const out = {};
      for (const k of PHOTO_KEYS) if (f[k] != null) out[k] = f[k];
      return out;
    } catch (e) {
      log('Нейросеть не разобрала фото: ' + e.message);
      return {};
    }
  }
  // Дополнить поля тем, что видно на фото, не трогая написанное в тексте.
  async function fillFromPhoto(fields, buffer, mime) {
    if (PHOTO_KEYS.every((k) => fields[k] != null && fields[k] !== '')) return fields;
    // Модель с фото без марки с фото не берём: «Rio» к чужой марке — ошибка.
    const seen = await photo(buffer, mime);
    const out = { ...fields };
    const sameMake = !fields.make || (seen.make && seen.make.toLowerCase() === String(fields.make).toLowerCase());
    for (const k of PHOTO_KEYS) {
      if (out[k] != null && out[k] !== '') continue;
      if ((k === 'model' || k === 'generation') && !sameMake) continue;
      if (seen[k] != null) out[k] = seen[k];
    }
    return out;
  }
  // Поля объявления: нейросеть + обычный разбор (он заполняет то, что нейросеть пропустила).
  async function parse(text) {
    const rules = parseListing(text);
    if (!enabled || isEdit(text)) return rules;
    const key = crypto.createHash('sha256').update(String(text)).digest('hex');
    if (cache.has(key)) return { ...cache.get(key) };
    try {
      const ai = clean(await ask(text), text);
      // Описание и список работ пишет только нейросеть: обычный разбор кладёт туда сырые строки продавца
      // («продаю срочно…»), а из сленга это превращается в мусор.
      const { description: _raw, serviceDone: _rawService, ...base } = rules;
      const merged = { ...base, ...ai };
      if (rules.history || ai.history) merged.history = { ...(rules.history || {}), ...(ai.history || {}) };
      // Строки «ключ: значение», которые написал человек, важнее догадок нейросети.
      for (const line of String(text).split('\n')) {
        if (/^\s*(цена|стоимость|пробег|год)\s*[:—–-]/i.test(line)) {
          const own = parseListing(line);
          for (const k of ['price', 'mileage', 'year']) if (own[k] != null) merged[k] = own[k];
        }
      }
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      cache.set(key, merged);
      return { ...merged };
    } catch (e) {
      log('Нейросеть не разобрала объявление, обычный разбор: ' + e.message);
      return rules;
    }
  }
  return { parse, photo, fillFromPhoto, enabled, ask };
}

module.exports = { createSmartParser, clean, redact, isEdit, PROMPT };
