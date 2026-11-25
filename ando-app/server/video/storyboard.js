'use strict';

const crypto = require('node:crypto');
const hooks = require('../data/social-hooks.json');
const say = require('./speech');

function field(context, name) {
  return name.split('.').reduce((value, key) => value?.[key], context);
}

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

const evidenceFields = {
  'editorial.feature': 'features', 'editorial.secondFeature': 'features',
  'editorial.defect': 'defects', 'editorial.serviceOperation': 'serviceDone'
};

function confirmedField(context, name) {
  const value = field(context, name);
  if (name.endsWith('Confirmed')) return value === true;
  if (!present(value)) return false;
  const list = context[evidenceFields[name]];
  if (!evidenceFields[name]) return true;
  const normalize = (item) => String(item).trim().toLocaleLowerCase('ru-RU');
  return Array.isArray(list) && list.some((item) => normalize(item) === normalize(value));
}

function availableHooks(car, { intent = 'sale', service = {} } = {}) {
  const context = { ...car, service };
  const tags = new Set(car.editorial?.mediaTags || []);
  if (car.photos?.length || car.videos?.length) tags.add('photo_or_video');
  return hooks.filter((hook) => hook.intent === intent &&
    hook.requiredFields.every((name) => confirmedField(context, name)) &&
    hook.requiredMedia.every((tag) => tags.has(tag)));
}

function hookText(hook, car, service = {}, spoken = false) {
  return hook.template.replace(/{{([\w.]+)}}/g, (placeholder, name) => {
    const value = field({ ...car, service }, name);
    if (!present(value)) throw new Error(`Для хука ${hook.id} не хватает ${name}`);
    if (spoken && name === 'price') return say.numWords(value);
    if (spoken && name === 'mileage') return say.numWords(value);
    if (name === 'price' || name === 'mileage') return Number(value).toLocaleString('ru-RU');
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }).replace(spoken ? /₽/g : /$^/g, 'рублей');
}

function selectHook(car, options = {}) {
  const eligible = availableHooks(car, options);
  if (!eligible.length) throw new Error('Для ролика не хватает данных или подтверждённых кадров');
  const requested = options.hookId || car.editorial?.hookId;
  let hook;
  if (requested) {
    hook = eligible.find((item) => item.id === requested);
    if (!hook) throw new Error('Выбранный хук требует дополнительных данных или кадров');
  } else {
    const seed = crypto.createHash('sha256').update(String(car.id)).digest().readUInt32BE(0);
    hook = eligible[seed % eligible.length];
  }
  return { ...hook, text: hookText(hook, car, options.service), voice: hookText(hook, car, options.service, true) };
}

function buildStoryboard(car, { link, hookId, service = {}, intent = 'sale' } = {}) {
  if (!/^https:\/\//.test(link || '')) throw new Error('Ролику нужна HTTPS-ссылка на машину или форму выкупа');
  const hook = selectHook(car, { hookId, service, intent });
  const sources = [
    ...(car.videos || []).map((src) => ({ src, kind: 'video' })),
    ...(car.photos || []).map((src) => ({ src, kind: 'photo' }))
  ];
  if (!sources.length) throw new Error('Добавьте реальные фото или видео машины');
  const fmt = (n) => Number(n).toLocaleString('ru-RU');
  const hasMileage = car.mileage != null && car.mileage !== '';
  const specs = [car.engine?.volume && car.engine.volume + ' л', car.transmission, car.city].filter(Boolean);
  const spokenSpecs = [car.engine?.volume && ('Мотор ' + say.litres(car.engine.volume) + '.'), car.transmission && (car.transmission + '.')].filter(Boolean);
  const scenes = intent === 'buyback' ? [
    { text: hook.text, voice: hook.voice },
    { text: 'Данные и фото машины', voice: 'Оставьте данные и фотографии машины в форме.' },
    { text: 'Предварительная оценка', voice: 'Менеджер уточнит состояние и назовёт предварительную оценку.' },
    { text: 'Осмотр по договорённости', voice: 'Если цена подходит, договоримся об осмотре.' },
    { text: 'Оставить заявку', voice: 'Форма оценки по ссылке в профиле.', end: true }
  ] : [
    { text: hook.text, voice: hook.voice },
    { text: `${car.make} ${car.model}\n${car.year} год`, voice: `${say.sayCar(car)}, ${car.year} год.` },
    { text: [fmt(car.price) + ' ₽', hasMileage && (fmt(car.mileage) + ' км')].filter(Boolean).join('\n'),
      voice: ['Цена ' + say.rub(car.price) + '.', hasMileage && ('Пробег ' + say.km(car.mileage) + '.')].filter(Boolean).join(' ') },
    { text: specs.join('\n') || 'Фото в карточке', voice: spokenSpecs.join(' ') || 'Больше фотографий и подробностей в карточке.' },
    { text: `ANDO AUTO\nandoauto.ru\nМашина №${car.id}`, voice: 'Подробнее о машине на сайте Андо Авто. Там же можно записаться на осмотр.', end: true }
  ];
  return {
    version: 1, carId: String(car.id), title: `${car.make} ${car.model}, ${car.year}`,
    link, hook: { id: hook.id, text: hook.text, sourceUrls: hook.sourceUrls, evidenceType: hook.evidenceType },
    width: 1080, height: 1920, fps: 30,
    sources,
    scenes: scenes.map((scene, index) => ({ ...scene, sourceIndex: index % sources.length,
      minSeconds: scene.end ? 3 : index === 0 ? 2.5 : 3, animation: index === 0 ? 'reveal' : index % 2 ? 'push-in' : 'slide',
      voice: say.abbr(scene.voice) }))
  };
}

module.exports = { availableHooks, selectHook, buildStoryboard };
