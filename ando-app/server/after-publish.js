'use strict';
// Что делается после публикации машины (из бота или админки), уже в фоне:
// 1) справка о модели — характеристики из открытых источников (server/car-specs.js), если подключена нейросеть;
// 2) пост в группу ВКонтакте, если ВК подключён и включён автопостинг.
// Результаты дописываются в карточку машины в cars.json.
const { readCatalog, writeCatalog } = require('./catalog');
const { applyEstimate } = require('./market-price');

function createAfterPublish({ config, vk = null, specs = null, market = null, log = console.log, now = () => new Date() }) {
  let chain = Promise.resolve(); // по одной машине за раз — не спорить за cars.json

  function update(id, patch) {
    const catalog = readCatalog(config.carsFile);
    const car = catalog.cars.find((c) => String(c.id) === String(id));
    if (!car) return null;
    Object.assign(car, patch);
    writeCatalog(config.carsFile, catalog, now());
    return car;
  }

  function carLink(car) {
    const site = String(config.siteUrl || '').replace(/\/?$/, '/');
    return site.length > 1 ? `${site}cars/${encodeURIComponent(car.id)}/` : '';
  }

  // Оценка рынка для одной машины: дописывает marketEstimate и (если цена ниже) marketPrice.
  async function estimate(car) {
    if (!market || car.demo) return null;
    const patch = await market.estimate(car);
    if (!patch) return null;
    const catalog = readCatalog(config.carsFile);
    const target = catalog.cars.find((c) => String(c.id) === String(car.id));
    if (!target) return null;
    applyEstimate(target, patch);
    writeCatalog(config.carsFile, catalog, now());
    return target;
  }

  async function run(car) {
    let current = car;
    if (market && !car.demo) {
      try { current = (await estimate(current)) || current; } catch (e) { log('Оценка рынка не получена: ' + e.message); }
    }
    if (specs && !car.demo) {
      try {
        const s = await specs.lookup(car);
        if (s) current = update(car.id, s) || current;
      } catch (e) { log('Справка о модели не получена: ' + e.message); }
    }
    if (vk && !car.demo) {
      const st = vk.status();
      if (st.connected && st.auto && !(current.vk && current.vk.postId)) {
        try {
          const post = await vk.postCar(current, carLink(current));
          update(car.id, { vk: post });
          log(`ВКонтакте: опубликовано № ${car.id} — ${post.url}`);
        } catch (e) { log('ВКонтакте: не опубликовано № ' + car.id + ': ' + e.message); }
      }
    }
  }

  return {
    // Не ждём: публикация в каталоге уже прошла, остальное — в фоне.
    publish(car) { chain = chain.then(() => run(car)).catch(() => {}); return chain; },
    // Оценить рынок для уже опубликованных машин — по одной, в фоне.
    estimateAll(cars) {
      for (const car of cars) chain = chain.then(() => estimate(car)).catch((e) => log('Оценка рынка № ' + car.id + ': ' + e.message));
      return chain;
    },
    estimate,
    idle() { return chain; },
    carLink
  };
}

module.exports = { createAfterPublish };
