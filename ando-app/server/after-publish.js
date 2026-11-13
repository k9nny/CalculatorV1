'use strict';
// Что делается после публикации машины (из бота или админки), уже в фоне:
// 1) справка о модели — характеристики из открытых источников (server/car-specs.js), если подключена нейросеть;
// 2) пост в группу ВКонтакте, если ВК подключён и включён автопостинг.
// Результаты дописываются в карточку машины в cars.json.
const { readCatalog, writeCatalog } = require('./catalog');

function createAfterPublish({ config, vk = null, specs = null, log = console.log, now = () => new Date() }) {
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

  async function run(car) {
    let current = car;
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
    idle() { return chain; },
    carLink
  };
}

module.exports = { createAfterPublish };
