'use strict';
// Оценка рыночной цены: нейросеть ищет похожие объявления (Авито, Авто.ру, Дром — Москва, тот же год ±1,
// похожий пробег, тот же мотор и коробка) и называет медианную цену предложения.
// Нашу цену в запрос не передаём — чтобы оценка не подстраивалась под неё.
// Отметка «Ниже рынка» / «Сильно ниже рынка» ставится, только если наша цена действительно ниже оценки:
// marketPrice (её видят покупатели) записывается только в этом случае, сама оценка хранится в marketEstimate.

const PROMPT = `Ты оцениваешь рыночную цену подержанного автомобиля в Москве.
Если есть поиск в интернете — найди 5–15 похожих объявлений о продаже на auto.ru, avito.ru и drom.ru:
та же марка, модель и поколение, год ±1, пробег ±30 000 км, тот же объём двигателя и тип коробки.
Посчитай медиану цен этих объявлений. Если поиска нет — оцени по своим знаниям о ценах на вторичном рынке России в 2026 году.
Верни только JSON-объект без пояснений:
{"median": число в рублях, "low": число, "high": число, "count": сколько объявлений учтено (0, если оценка по знаниям), "sources": [ссылки]}
Если данных для оценки недостаточно — верни {}.`;

function describe(car) {
  const e = car.engine || {};
  return [
    `${car.make} ${car.model}${car.generation ? ' ' + car.generation : ''}, ${car.year} год`,
    car.mileage != null && `Пробег: ${car.mileage} км`,
    (e.volume || e.power || e.fuel) && `Двигатель: ${[e.volume && e.volume + ' л', e.power && e.power + ' л.с.', e.fuel].filter(Boolean).join(', ')}`,
    car.transmission && `Коробка: ${car.transmission}`, car.drive && `Привод: ${car.drive}`, car.body && `Кузов: ${car.body}`,
    car.trim && `Комплектация: ${car.trim}`, 'Город: Москва'
  ].filter(Boolean).join('\n');
}

const money = (v) => {
  const n = Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')));
  return Number.isFinite(n) && n >= 30000 && n <= 3e8 ? n : null;
};

function createMarketPrice(parser, { now = () => new Date() } = {}) {
  return {
    // Возвращает дополнение к карточке { marketEstimate, marketPrice? } или null, если оценки нет.
    async estimate(car) {
      if (!parser || !parser.enabled || !parser.complete || !car.make || !car.model || !car.year || !car.price) return null;
      const r = await parser.complete([{ role: 'system', content: PROMPT }, { role: 'user', content: describe(car) }], { webSearch: true });
      const m = /\{[\s\S]*\}/.exec(r.content);
      if (!m) return null;
      const raw = JSON.parse(m[0]);
      const median = money(raw.median);
      // Явно неправдоподобная оценка (в разы от нашей цены) — скорее ошибка поиска, не используем.
      if (!median || median < car.price * 0.5 || median > car.price * 3) return null;
      const estimate = {
        price: median,
        low: money(raw.low) || undefined,
        high: money(raw.high) || undefined,
        count: Number.isInteger(raw.count) && raw.count >= 0 ? raw.count : undefined,
        sources: Array.isArray(raw.sources) ? raw.sources.filter((u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u)).slice(0, 5) : undefined,
        web: !!r.searched,
        at: now().toISOString().slice(0, 10)
      };
      Object.keys(estimate).forEach((k) => estimate[k] === undefined && delete estimate[k]);
      return { marketEstimate: estimate, marketPrice: car.price < median ? median : null };
    }
  };
}

// Применить результат к машине: marketPrice — только когда наша цена ниже оценки.
function applyEstimate(car, patch) {
  if (!patch) return car;
  car.marketEstimate = patch.marketEstimate;
  if (patch.marketPrice) car.marketPrice = patch.marketPrice; else delete car.marketPrice;
  return car;
}

module.exports = { createMarketPrice, applyEstimate, describe };
