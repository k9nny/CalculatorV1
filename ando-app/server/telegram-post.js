'use strict';

const SITE_LABEL = 'ПОДРОБНЕЕ НА САЙТЕ';
const BOT_LABEL = 'ПОДРОБНЕЕ В БОТЕ';

function textOf(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function officialFacts(car) {
  const facts = [];
  const description = [car.description, car.paint].map(textOf).join(' ').toLowerCase().replace(/ё/g, 'е');
  if (/(?:^|[.!?]\s+)(?:двигатель|мотор)\s+работает ровно(?=[.!?,;]|$)/.test(description)) {
    facts.push({ section: 'Техника', text: 'Двигатель работает стабильно.' });
  }
  if (/(?:^|[.!?]\s+)(?:коробка(?: передач)?|кпп)\s+(?:работает (?:отлично|без (?:нареканий|проблем))|без (?:заявленных проблем|замечаний|нареканий))(?=[.!?,;]|$)/.test(description)) {
    facts.push({ section: 'Техника', text: 'По коробке передач замечаний не заявлено.' });
  }
  if (/(?:^|[.!?]\s+)(?:ходовая|подвеска)(?:\s+[—–-])?\s+без (?:нареканий|замечаний)(?=[.!?,;]|$)/.test(description)) {
    facts.push({ section: 'Ходовая', text: 'По ходовой части замечаний не заявлено.' });
  }
  if (/крыша и (?:дверные )?проемы\s*(?:[—–-]\s*|в\s+)?родн(?:ая|ой) краск[ае](?=[.!?,;]|$)/.test(description)) {
    facts.push({ section: 'Кузов и салон', text: 'Крыша и дверные проёмы в родной краске.' });
  }
  const features = [...new Set((Array.isArray(car.features) ? car.features : []).map(textOf))]
    .filter(feature => /^[а-яёa-z0-9][а-яёa-z0-9 .–-]{1,45}$/i.test(feature)
      && /климат|кондиционер|круиз|камер[аы]|парктроник|подогрев|обогрев|кожан|электропривод|датчик|люк|carplay|android auto|мультируль|навигац/i.test(feature)
      && !/(сня[тл]|проблем|требуе|ошиб|неисправ|недостат|ремонт|скол|царап|вмят|корроз|ржав|тресн|слом|отказ|порван|не работает|не исправ|нет |без )/i.test(feature));
  for (const feature of features.slice(0, 8)) facts.push({ section: 'Оснащение', text: feature });
  return facts;
}

async function selectFacts(facts, model) {
  const fallback = facts.slice(0, 5);
  if (!model?.enabled || !facts.length) return fallback;
  try {
    const result = await model.complete([
      { role: 'system', content: 'Ты редактор объявлений ANDO AUTO. Для поста в Telegram отбирай до пяти фактов. Сначала техника, затем кузов и самое полезное оснащение. Без лозунгов, оценок и новых сведений. Ответь только JSON-массивом номеров от 1 до числа фактов, в нужном порядке.' },
      { role: 'user', content: JSON.stringify(facts.map((fact, i) => ({ number: i + 1, ...fact }))) }
    ], { maxTokens: 180, requestTimeoutMs: 8000 });
    const numbers = JSON.parse(result.content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
    if (!Array.isArray(numbers)) return fallback;
    const selected = [...new Set(numbers)].filter(n => Number.isInteger(n) && n >= 1 && n <= facts.length).slice(0, 5);
    return selected.length ? selected.map(number => facts[number - 1]) : fallback;
  } catch { return fallback; }
}

function telegramBotLink(config, id) {
  const app = config.appLink || 'https://t.me/andoavtobot/cars';
  try {
    let url = new URL(app);
    if (url.protocol !== 'https:' || url.hostname !== 't.me') url = new URL('https://t.me/andoavtobot/cars');
    url.searchParams.set('startapp', 'car_' + id);
    return url.href;
  } catch { return 'https://t.me/andoavtobot/cars?startapp=' + encodeURIComponent('car_' + id); }
}

const fmt = (value) => Number(value).toLocaleString('ru-RU');

function telegramDraft(car, siteLink, config, facts = officialFacts(car).slice(0, 5)) {
  let text = '';
  const entities = [];
  function add(fragment, type, url) {
    if (type) entities.push({ type, offset: text.length, length: fragment.length, ...(url && { url }) });
    text += fragment;
  }
  const model = [car.make, car.model].map(textOf).filter(Boolean).join(' ').slice(0, 96);
  add('🔥 В продаже ' + model + (car.year ? ', ' + car.year + ' год' : ''), 'bold');
  add('\n\n');
  if (car.mileage != null) add('🛣 Пробег ' + fmt(car.mileage) + ' км');
  const specs = [car.engine?.volume ? 'Двигатель ' + fmt(car.engine.volume) + ' л' : '', textOf(car.transmission), textOf(car.drive)].filter(Boolean);
  if (specs.length) add((car.mileage != null ? '\n' : '') + '⚙️ ' + specs.join(' · ').slice(0, 100));

  const groups = new Map();
  for (const { section, text } of facts) {
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(text);
  }
  if (groups.size) add('\n\nПо описанию продавца:');
  const icons = { Техника: '🔧', Ходовая: '🔧', 'Кузов и салон': '🚘', Оснащение: '📋' };
  for (const [section, details] of groups) {
    add('\n\n');
    add(icons[section] + ' ' + section, 'bold');
    for (const detail of details) add('\n✅ ' + detail);
  }
  add('\n\n');
  add('💵 Цена ' + fmt(car.price) + ' ₽', 'bold');
  if (car.city) add('\n📍 ' + textOf(car.city).slice(0, 70));
  add('\n\n👇 Фото и запись на осмотр\n\n');
  add(SITE_LABEL, 'text_link', siteLink);
  add('\n');
  add(BOT_LABEL, 'text_link', telegramBotLink(config, car.id));
  return { text, entities };
}

function threadsDraft(car) {
  const model = [car.make, car.model].map(textOf).filter(Boolean).join(' ').slice(0, 85);
  const price = fmt(car.price) + ' ₽';
  const hooks = [
    '👀 Что бы вы взяли за ' + price + '?',
    '🔥 ' + model + ' за ' + price + '. Поехали бы смотреть?',
    '🚗 ' + price + ' на машину. Как вам этот вариант?'
  ];
  const index = Array.from(String(car.id || model)).reduce((sum, char) => sum + char.codePointAt(0), 0) % hooks.length;
  const power = car.engine?.power;
  const engine = [car.engine?.volume && fmt(car.engine.volume) + ' л', power && fmt(power) + ' л.с.'].filter(Boolean).join(' · ');
  const specs = [engine, textOf(car.transmission).slice(0, 40), car.mileage != null && fmt(car.mileage) + ' км',
    textOf(car.drive).slice(0, 25)].filter(Boolean);
  const name = '🚘 ' + model + (car.year ? ' · ' + car.year : '');
  const placement = ['💵 ' + price, car.city && '📍 ' + textOf(car.city).slice(0, 36)].filter(Boolean).join(' · ');
  const footer = 'Все машины в профиле';
  const fromSeller = 'По описанию продавца:';
  const trim = textOf(car.trim).slice(0, 45);
  const header = [hooks[index], [name, specs.join(' · '), trim && 'Комплектация ' + trim].filter(Boolean).join('\n')];
  const lines = [];
  const units = text => Array.from(text).reduce((sum, ch) => sum + (/\p{Extended_Pictographic}/u.test(ch) ? Buffer.byteLength(ch) : 1), 0);
  const render = () => [...header, lines.length && [fromSeller, ...lines].join('\n'), placement, footer].filter(Boolean).join('\n\n');
  for (const fact of officialFacts(car).slice(0, 5)) {
    lines.push('✅ ' + fact.text);
    if (units(render()) > 500) lines.pop();
  }
  return render();
}

module.exports = { officialFacts, selectFacts, telegramDraft, threadsDraft };
