'use strict';
// Марка и модель по сленгу продавцов: «ешка» → Mercedes-Benz E-Класс, «каптюр» → Renault Kaptur, «крузак 200» → Toyota Land Cruiser 200.
// Словарь — data/car-slang.json (59 марок, 400+ моделей). Двусмысленные слова («семёрка»: ВАЗ-2107 или BMW 7)
// и коды из цифр («2107», «e200») сами по себе не срабатывают — только рядом с маркой.
const DICT = require('./data/car-slang.json');

// Как называем марку в карточке (единообразно для всех объявлений).
const MAKE_NAME = { 'LADA (ВАЗ)': 'Lada' };
const makeName = (m) => MAKE_NAME[m] || m;

function norm(s) {
  return ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[-_.,"'«»/()!?:;]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

// Двусмысленные слова, у которых есть очевидный вариант по умолчанию (по правилам словаря).
const DEFAULTS = {
  'солярис': ['Hyundai', 'Solaris'], 'соларис': ['Hyundai', 'Solaris'],
  'кукурузер': ['Toyota', 'Land Cruiser'], 'крузер': ['Toyota', 'Land Cruiser'], 'двухсотый': ['Toyota', 'Land Cruiser', '200']
};
const AMBIGUOUS = new Set(DICT.ambiguous.flatMap((a) => String(a.alias).split('|')).map((a) => norm(a).trim()).filter((a) => !DEFAULTS[a]));
const hasDigit = (a) => /\d/.test(a);

// Все алиасы: длинные раньше коротких, чтобы «веста кросс» побеждало «веста».
const MAKE_ALIASES = [];
const MODEL_ALIASES = [];
for (const mk of DICT.makes) {
  for (const a of mk.aliases || []) MAKE_ALIASES.push({ alias: norm(a).trim(), make: makeName(mk.make) });
  MAKE_ALIASES.push({ alias: norm(mk.make).trim(), make: makeName(mk.make) });
  for (const md of mk.models || []) {
    const extra = Object.entries(DEFAULTS).filter(([, v]) => makeName(mk.make) === v[0] && md.model === v[1]).map(([k]) => k);
    for (const a of [md.model, ...(md.aliases || []), ...extra]) {
      const n = norm(a).trim();
      if (!n || AMBIGUOUS.has(n)) continue;
      MODEL_ALIASES.push({ alias: n, make: makeName(mk.make), model: md.model, gens: md.gens || [], genAliases: md.genAliases || {}, code: hasDigit(n) && !/[а-яa-z]{3}/.test(n) });
    }
  }
}
MAKE_ALIASES.sort((a, b) => b.alias.length - a.alias.length);
MODEL_ALIASES.sort((a, b) => b.alias.length - a.alias.length);

function find(text, alias) {
  const i = text.indexOf(' ' + alias + ' ');
  return i;
}

// Марка, модель и поколение по тексту. Поколение — только если названо или год попадает ровно в одно.
function detectCar(text, year) {
  const t = norm(text);
  let make = null;
  let makeAt = Infinity;
  for (const m of MAKE_ALIASES) {
    if (m.alias.length < 2 || AMBIGUOUS.has(m.alias)) continue;
    const i = find(t, m.alias);
    if (i !== -1 && i < makeAt) { make = m.make; makeAt = i; }
  }
  let best = null;
  for (const m of MODEL_ALIASES) {
    if (m.alias.length < 2) continue;
    // Код из цифр («2107», «e200», «x5») — только если марка этой модели названа в тексте.
    if (m.code && make !== m.make) continue;
    if (make && m.make !== make) continue;
    const i = find(t, m.alias);
    if (i === -1) continue;
    if (!best || i < best.at || (i === best.at && m.alias.length > best.alias.length)) best = { ...m, at: i };
  }
  if (!best) return make ? { make } : {};
  const out = { make: best.make, model: best.model };
  // Поколение: явный код после модели («камри 50», «w213») или однозначно по году.
  const after = t.slice(best.at + best.alias.length + 2); // текст сразу после названия модели
  for (const [gen, aliases] of Object.entries(best.genAliases)) {
    if (aliases.some((a) => { const n = norm(a).trim(); return /^\d+$/.test(n) ? after.startsWith(n + ' ') : t.includes(' ' + n + ' '); })) { out.generation = gen; break; }
  }
  if (!out.generation && year && best.gens.length) {
    const fit = best.gens.filter(([, from, to]) => year >= from && year <= to);
    if (fit.length === 1) out.generation = fit[0][0];
  }
  const def = DEFAULTS[best.alias];
  if (def && def[2] && !out.generation) out.generation = def[2];
  // «V (седан)» → «V»: кузов пишется отдельным полем.
  if (out.generation) out.generation = out.generation.replace(/\s*\(.*\)\s*$/, '');
  return out;
}

// Привести марку и модель (например, из ответа нейросети) к написанию словаря: «E-Class» → «E-Класс».
// Меняем, только если модель целиком совпадает с вариантом из словаря — «Rio X-Line» не превратится в «Rio».
function canonical(make, model) {
  const mk = make ? (detectCar(make).make || make) : make;
  if (!model) return { make: mk, model };
  const n = norm(model).trim();
  const hit = MODEL_ALIASES.find((m) => m.alias === n && (!mk || m.make.toLowerCase() === String(mk).toLowerCase()));
  return hit ? { make: hit.make, model: hit.model } : { make: mk, model };
}

module.exports = { detectCar, canonical, norm };
