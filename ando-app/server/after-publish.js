'use strict';
// После добавления машины в каталог обновляет данные карточки в фоне.
const { readCatalog, writeCatalog } = require('./catalog');
const { applyEstimate } = require('./market-price');

function createAfterPublish({ config, specs = null, market = null, log = console.log, now = () => new Date() }) {
  let chain = Promise.resolve(); // по одной машине за раз — не спорить за cars.json

  function update(id, patch) {
    const catalog = readCatalog(config.carsFile);
    const car = catalog.cars.find((c) => String(c.id) === String(id));
    if (!car) return null;
    Object.assign(car, patch);
    writeCatalog(config.carsFile, catalog, now());
    return car;
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
    if (car.demo) return;
    if (market) {
      try { await estimate(car); } catch (e) { log('Оценка рынка не получена: ' + e.message); }
    }
    if (specs) {
      try {
        const s = await specs.lookup(car);
        if (s) update(car.id, s);
      } catch (e) { log('Справка о модели не получена: ' + e.message); }
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
    idle() { return chain; }
  };
}

module.exports = { createAfterPublish };
