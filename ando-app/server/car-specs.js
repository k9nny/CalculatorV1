'use strict';
// Справка о модели: характеристики из открытых источников (каталоги Авто.ру и Дрома, сайты производителей).
// Нейросеть ищет в интернете (если модель и посредник это умеют) или отвечает по своим знаниям.
// Это сведения о модели и модификации, а не о конкретной машине: они хранятся отдельно (car.modelSpecs)
// и показываются в блоке «Характеристики модели», не смешиваясь со словами продавца.
// Правило: если у модели несколько версий и по известным данным нельзя выбрать одну — поле не заполняется.

const FIELDS = {
  power: ['Мощность', 'л.с.', 30, 2000],
  torque: ['Крутящий момент', 'Н·м', 50, 2000],
  acceleration: ['Разгон 0–100 км/ч', 'с', 2, 40],
  maxSpeed: ['Максимальная скорость', 'км/ч', 80, 420],
  consumption: ['Расход, смешанный цикл', 'л/100 км', 2, 30],
  fuelTank: ['Объём бака', 'л', 20, 200],
  clearance: ['Клиренс', 'мм', 80, 400],
  trunk: ['Багажник', 'л', 50, 3000],
  length: ['Длина', 'мм', 2500, 6500],
  width: ['Ширина', 'мм', 1400, 2600],
  height: ['Высота', 'мм', 1000, 2600],
  wheelbase: ['Колёсная база', 'мм', 1800, 4500],
  curbWeight: ['Снаряжённая масса', 'кг', 600, 4500],
  seats: ['Мест', '', 2, 9]
};
const TEXT = { engine: 'Двигатель', gearbox: 'Коробка передач', fuelClass: 'Рекомендуемое топливо' };

const PROMPT = `Ты автомобильный справочник. По описанию модификации найди её характеристики в открытых источниках
(сайт производителя, каталоги auto.ru и drom.ru, обзоры). Если есть поиск в интернете — используй его.
Верни только JSON-объект без пояснений с полями (включай поле, только если уверен):
power (л.с.), torque (Н·м), acceleration (с до 100 км/ч), maxSpeed (км/ч), consumption (л/100 км, смешанный),
fuelTank (л), clearance (мм), trunk (л), length, width, height, wheelbase (мм), curbWeight (кг), seats,
engine (название или код двигателя, например «1.6 MPI G4FC»), gearbox (например «6-ступенчатый автомат»),
fuelClass (например «АИ-92»), sources (массив ссылок, где нашёл).
Правила: это справка о модели, а не о конкретной машине. Если для этой модели, года и мотора есть несколько версий
с разными значениями (например, 1.6 бывает 90 и 110 л.с.) и по описанию нельзя выбрать одну — поле не включай.
Ничего не придумывай и не округляй «на глаз».`;

function describe(car) {
  const e = car.engine || {};
  return [
    `Марка: ${car.make}`, `Модель: ${car.model}`, car.generation && `Поколение: ${car.generation}`, car.year && `Год выпуска: ${car.year}`,
    car.trim && `Комплектация: ${car.trim}`, car.body && `Кузов: ${car.body}`,
    e.volume && `Объём двигателя: ${e.volume} л`, e.power && `Мощность: ${e.power} л.с.`, e.fuel && `Топливо: ${e.fuel}`,
    car.transmission && `Коробка: ${car.transmission}`, car.drive && `Привод: ${car.drive}`, 'Рынок: Россия'
  ].filter(Boolean).join('\n');
}

// Ответ нейросети → проверенные поля. Числа вне разумных пределов и мусор отбрасываются.
function clean(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, [, , min, max]] of Object.entries(FIELDS)) {
    const n = Number(String(raw[k] ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
    if (raw[k] != null && raw[k] !== '' && Number.isFinite(n) && n >= min && n <= max) out[k] = Math.round(n * 10) / 10;
  }
  for (const k of Object.keys(TEXT)) if (typeof raw[k] === 'string' && raw[k].trim()) out[k] = raw[k].trim().slice(0, 80);
  if (Array.isArray(raw.sources)) {
    const s = raw.sources.filter((u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/.test(u)).slice(0, 5);
    if (s.length) out.sources = s;
  }
  return out;
}

function createCarSpecs(parser, { now = () => new Date() } = {}) {
  return {
    // Возвращает дополнение к карточке: { modelSpecs, engine? } или null.
    async lookup(car) {
      if (!parser || !parser.enabled || !parser.complete || !car.make || !car.model) return null;
      const r = await parser.complete([{ role: 'system', content: PROMPT }, { role: 'user', content: describe(car) }], { webSearch: true });
      const m = /\{[\s\S]*\}/.exec(r.content);
      if (!m) return null;
      const spec = clean(JSON.parse(m[0]));
      if (!Object.keys(spec).filter((k) => k !== 'sources').length) return null;
      const patch = { modelSpecs: { ...spec, checkedAt: now().toISOString().slice(0, 10), web: !!r.searched } };
      // Мощность в основные поля — только если продавец её не указал (справка однозначна, иначе нейросеть её не вернула бы).
      if (spec.power && !(car.engine && car.engine.power)) patch.engine = { ...(car.engine || {}), power: spec.power };
      return patch;
    }
  };
}

// Для показа: [['Мощность', '123 л.с.'], …] в постоянном порядке.
function specRows(s) {
  if (!s) return [];
  const rows = [];
  for (const [k, label] of Object.entries(TEXT)) if (s[k]) rows.push([label, s[k]]);
  for (const [k, [label, unit]] of Object.entries(FIELDS)) {
    if (s[k] == null) continue;
    const v = Number(s[k]).toLocaleString('ru-RU').replace(/[  ]/g, ' ');
    rows.push([label, unit ? `${v} ${unit}` : v]);
  }
  return rows;
}

module.exports = { createCarSpecs, specRows, clean, describe, FIELDS, TEXT };
