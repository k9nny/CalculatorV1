'use strict';
// Telegram-бот для администраторов каталога: прислали объявление (фото + текст) —
// бот разобрал его в поля, показал превью, по кнопке «Опубликовать» машина появилась в приложении.
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { parseListing, toCar, missing } = require('./listing-parser');
const { readCatalog, writeCatalog, nextId } = require('./catalog');

const MAX_PHOTOS = 15;
const STATUS_NAMES = { available: 'в продаже', reserved: 'забронирована', sold: 'продана' };

function telegramApi(token) {
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(params || {});
      const req = https.request({
        hostname: 'api.telegram.org', path: `/bot${token}/${method}`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 40000
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (json.ok) resolve(json.result); else reject(new Error(json.description || method));
          } catch (e) { reject(e); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end(body);
    });
  }
  function download(filePath) {
    return new Promise((resolve, reject) => {
      https.get({ hostname: 'api.telegram.org', path: `/file/bot${token}/${filePath}`, timeout: 30000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); reject(new Error('download ' + res.statusCode)); return; }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  }
  return { request, download };
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function money(n) { return Number(n).toLocaleString('ru-RU').replace(/[  ]/g, ' ') + ' ₽'; }
function km(n) { return Number(n).toLocaleString('ru-RU').replace(/[  ]/g, ' ') + ' км'; }

function carSummary(car) {
  const e = car.engine || {};
  const specs = [e.volume && `${Number(e.volume).toFixed(1)} л`, e.power && `${e.power} л.с.`, e.fuel && e.fuel.toLowerCase(),
    car.transmission && car.transmission.toLowerCase(), car.drive && car.drive.toLowerCase()].filter(Boolean).join(' · ');
  const extra = [car.body, car.color, car.owners && `владельцев: ${car.owners}`, car.pts && `ПТС ${car.pts.toLowerCase()}`,
    car.wheel === 'Правый' && 'правый руль', car.city].filter(Boolean).join(' · ');
  return [
    `<b>${esc([car.make, car.model, car.generation].filter(Boolean).join(' ') || 'Без названия')}${car.year ? ', ' + car.year : ''}</b>`,
    car.price ? `Цена ${money(car.price)}${car.marketPrice ? ` (рынок ${money(car.marketPrice)})` : ''}` : '',
    car.mileage != null ? `Пробег ${km(car.mileage)}` : '',
    specs ? esc(specs) : '',
    extra ? esc(extra) : '',
    car.vin ? `VIN ${esc(car.vin)}` : '',
    car.serviceDone && car.serviceDone.length ? 'Сделали в сервисе:\n' + car.serviceDone.map((s) => '• ' + esc(s)).join('\n') : '',
    car.tags && car.tags.length ? esc(car.tags.join(', ')) : '',
    car.description ? esc(car.description) : ''
  ].filter(Boolean).join('\n');
}

const HELP = [
  '<b>Как добавить машину</b>',
  'Пришлите фото (можно альбомом, до 15) и текст объявления одним сообщением или следом. Можно переслать готовый пост.',
  'Я разберу текст, покажу превью — нажмите «Опубликовать».',
  '',
  'Пример текста:',
  '<code>Kia Rio 2019, 1.6 АКПП 123 л.с.\nПробег 74 000 км\nЦена 1 390 000\n2 владельца, ПТС оригинал, белый седан\n- Замена масла и фильтров\n- Новые колодки\nТорг</code>',
  '',
  'Исправить превью — отправьте строку «поле значение»: <code>цена 1 350 000</code>, <code>пробег 80 тыс</code>, <code>модель Rio X</code>, <code>рынок 1 480 000</code>, <code>описание …</code>. Ещё фото — просто пришлите.',
  '',
  '<b>Команды</b>',
  '/list — машины в каталоге',
  '/reserve 101 — забронирована · /sold 101 — продана (скрыть) · /available 101 — снова в продаже',
  '/price 101 1350000 — новая цена',
  '/cleardemo — убрать демо-объявления',
  '/cancel — удалить черновик'
].join('\n');

function createBot(options) {
  const { api, adminIds, carsFile, photosDir, photosUrlPrefix = 'img/cars/', appLink = '', debounceMs = 2500, now = () => new Date() } = options;
  const drafts = new Map(); // chatId → { fields, photos: [file_id], timer, previewId }
  const admins = new Set(adminIds.map(String));

  const send = (chatId, text, extra = {}) => api.request('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

  function mergeFields(target, add) {
    for (const [k, v] of Object.entries(add)) {
      if (v === undefined || v === '' || v === null) continue;
      if (k === 'tags') target.tags = Array.from(new Set([...(target.tags || []), ...v]));
      else if (k === 'serviceDone' && target.serviceDone && !add._replaceService) target.serviceDone = Array.from(new Set([...target.serviceDone, ...v]));
      else target[k] = v;
    }
  }

  function draftCar(draft) { return toCar(draft.fields); }

  async function showPreview(chatId) {
    const draft = drafts.get(chatId);
    if (!draft) return;
    draft.timer = null;
    const car = draftCar(draft);
    const lack = missing(draft.fields);
    const lines = [
      '<b>Черновик объявления</b>', '',
      carSummary(car), '',
      `Фото: ${draft.photos.length}${draft.photos.length ? '' : ' — пришлите хотя бы одно'}`,
      lack.length ? `Не хватает: ${lack.join(', ')}. Допишите строкой, например «${lack[0]} …».` : 'Всё нужное есть.'
    ];
    const buttons = [[{ text: 'Опубликовать', callback_data: 'pub' }, { text: 'Отменить', callback_data: 'cancel' }]];
    await send(chatId, lines.join('\n'), { reply_markup: { inline_keyboard: buttons } });
  }

  function schedulePreview(chatId) {
    const draft = drafts.get(chatId);
    if (draft.timer) clearTimeout(draft.timer);
    if (debounceMs <= 0) return showPreview(chatId);
    // Альбом приходит несколькими сообщениями — ждём, пока придут все.
    draft.timer = setTimeout(() => { showPreview(chatId).catch(() => {}); }, debounceMs);
    return Promise.resolve();
  }

  async function publish(chatId) {
    const draft = drafts.get(chatId);
    if (!draft) return send(chatId, 'Черновика нет. Пришлите фото и текст объявления.');
    const lack = missing(draft.fields);
    if (lack.length) return send(chatId, `Не могу опубликовать: не хватает — ${lack.join(', ')}.`);
    const catalog = readCatalog(carsFile);
    const id = nextId(catalog.cars);
    const photos = [];
    fs.mkdirSync(photosDir, { recursive: true });
    for (let i = 0; i < draft.photos.length; i++) {
      try {
        const file = await api.request('getFile', { file_id: draft.photos[i] });
        const ext = (path.extname(file.file_path || '') || '.jpg').toLowerCase().replace('.jpeg', '.jpg');
        const name = `${id}-${i + 1}${['.jpg', '.png', '.webp'].includes(ext) ? ext : '.jpg'}`;
        fs.writeFileSync(path.join(photosDir, name), await api.download(file.file_path));
        photos.push(photosUrlPrefix + name);
      } catch {
        // фото не скачалось — публикуем без него, сообщим ниже
      }
    }
    const car = { id, status: 'available', publishedAt: now().toISOString().slice(0, 10), ...draftCar(draft), photos };
    if (!car.status || !STATUS_NAMES[car.status]) car.status = 'available';
    catalog.cars.unshift(car);
    writeCatalog(carsFile, catalog, now());
    drafts.delete(chatId);
    const link = appLink ? `${appLink}${appLink.includes('?') ? '&' : '?'}startapp=car_${id}` : '';
    const lostPhotos = draft.photos.length - photos.length;
    let report = `Опубликовано: объявление № ${id}. Машина уже в приложении.`;
    if (lostPhotos) report += `\nНе удалось сохранить фото: ${lostPhotos}.`;
    if (link) report += `\nСсылка на машину: ${link}`;
    report += '\n\nТекст для канала:\n\n' + channelPost(car, link);
    await send(chatId, report);
    return car;
  }

  // Готовый пост для каналов Telegram, MAX, VK.
  function channelPost(car, link) {
    const e = car.engine || {};
    const specs = [e.volume && `${Number(e.volume).toFixed(1)} л`, e.power && `${e.power} л.с.`, car.transmission, car.drive && `${car.drive.toLowerCase()} привод`]
      .filter(Boolean).join(', ');
    return [
      `${esc(car.make)} ${esc(car.model)}, ${car.year}`,
      money(car.price),
      `Пробег ${km(car.mileage)}`,
      specs ? esc(specs) : '',
      car.serviceDone && car.serviceDone.length ? `Подготовили в нашем сервисе: ${esc(car.serviceDone.join(', ').toLowerCase())}` : '',
      link ? `\nФото и запись на осмотр: ${link}` : ''
    ].filter(Boolean).join('\n');
  }

  async function setStatus(chatId, id, status) {
    const catalog = readCatalog(carsFile);
    const car = catalog.cars.find((c) => String(c.id) === String(id));
    if (!car) return send(chatId, `Машины № ${esc(id)} нет в каталоге. /list — список.`);
    car.status = status;
    writeCatalog(carsFile, catalog, now());
    return send(chatId, `№ ${esc(id)} ${esc(car.make)} ${esc(car.model)} — теперь ${STATUS_NAMES[status]}.`);
  }

  async function command(chatId, text) {
    const [cmd, ...args] = text.trim().split(/\s+/);
    const name = cmd.split('@')[0].toLowerCase();
    if (name === '/start' || name === '/help') return send(chatId, HELP);
    if (name === '/cancel') { drafts.delete(chatId); return send(chatId, 'Черновик удалён.'); }
    if (name === '/list') {
      const cars = readCatalog(carsFile).cars.filter((c) => c.status !== 'sold');
      if (!cars.length) return send(chatId, 'В каталоге пока нет машин.');
      return send(chatId, cars.map((c) => `№ ${esc(c.id)} · ${esc(c.make)} ${esc(c.model)}, ${c.year} · ${money(c.price)}` +
        (c.status === 'reserved' ? ' · бронь' : '') + (c.demo ? ' · демо' : '')).join('\n'));
    }
    if (['/sold', '/reserve', '/available'].includes(name)) {
      if (!args[0]) return send(chatId, `Укажите номер: ${name} 101`);
      return setStatus(chatId, args[0], { '/sold': 'sold', '/reserve': 'reserved', '/available': 'available' }[name]);
    }
    if (name === '/price') {
      const price = Number(String(args.slice(1).join('')).replace(/\D/g, ''));
      if (!args[0] || !price) return send(chatId, 'Пример: /price 101 1350000');
      const catalog = readCatalog(carsFile);
      const car = catalog.cars.find((c) => String(c.id) === args[0]);
      if (!car) return send(chatId, `Машины № ${esc(args[0])} нет.`);
      car.price = price;
      writeCatalog(carsFile, catalog, now());
      return send(chatId, `№ ${esc(car.id)}: новая цена ${money(price)}.`);
    }
    if (name === '/cleardemo') {
      const catalog = readCatalog(carsFile);
      const before = catalog.cars.length;
      catalog.cars = catalog.cars.filter((c) => !c.demo);
      writeCatalog(carsFile, catalog, now());
      return send(chatId, `Убрано демо-объявлений: ${before - catalog.cars.length}.`);
    }
    return send(chatId, 'Не знаю такой команды. /help — подсказка.');
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const fromId = String(msg.from && msg.from.id);
    if (!admins.has(fromId)) {
      if (msg.chat.type === 'private') {
        return send(chatId, 'Здравствуйте! Это бот ANDO AUTO. Каталог машин — по кнопке меню внизу.' +
          (appLink ? `\n${appLink}` : ''));
      }
      return null;
    }
    const text = msg.text || msg.caption || '';
    if (msg.text && text.startsWith('/')) return command(chatId, text);

    let draft = drafts.get(chatId);
    if (!draft) { draft = { fields: {}, photos: [], timer: null }; drafts.set(chatId, draft); }
    const photo = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id
      : msg.document && /^image\//.test(msg.document.mime_type || '') ? msg.document.file_id : null;
    if (photo && draft.photos.length < MAX_PHOTOS && !draft.photos.includes(photo)) draft.photos.push(photo);
    if (text) mergeFields(draft.fields, parseListing(text));
    return schedulePreview(chatId);
  }

  async function handleCallback(q) {
    const chatId = q.message && q.message.chat.id;
    await api.request('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    if (!admins.has(String(q.from.id)) || chatId == null) return null;
    if (q.data === 'pub') return publish(chatId);
    if (q.data === 'cancel') { drafts.delete(chatId); return send(chatId, 'Черновик удалён.'); }
    return null;
  }

  async function handleUpdate(update) {
    if (update.message) return handleMessage(update.message);
    if (update.callback_query) return handleCallback(update.callback_query);
    return null;
  }

  // Long polling: боту не нужен отдельный адрес для вебхука.
  async function start(log = console) {
    let offset = 0;
    await api.request('deleteWebhook', {}).catch(() => {});
    await api.request('setMyCommands', {
      commands: [
        { command: 'list', description: 'Машины в каталоге' }, { command: 'help', description: 'Как добавить машину' },
        { command: 'cancel', description: 'Удалить черновик' }
      ],
      scope: { type: 'all_private_chats' }
    }).catch(() => {});
    for (;;) {
      try {
        const updates = await api.request('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((e) => log.error('bot update:', e.message));
        }
      } catch (e) {
        log.error('bot polling:', e.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  return { handleUpdate, start, drafts, publish };
}

module.exports = { createBot, telegramApi, carSummary };
