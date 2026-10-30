/* ANDO AUTO — каталог машин с пробегом в мини-приложении Telegram и MAX. */
(function () {
  'use strict';

  var CFG = window.ANDO_CONFIG || {};
  var P = window.AndoPlatform;
  var app = document.getElementById('app');

  // ---------- Справочники ----------
  var OPTIONS = {
    transmission: ['Автомат', 'Робот', 'Вариатор', 'Механика'],
    drive: ['Передний', 'Задний', 'Полный'],
    fuel: ['Бензин', 'Дизель', 'Гибрид', 'Электро', 'Газ/бензин'],
    body: ['Седан', 'Хэтчбек', 'Лифтбек', 'Универсал', 'Кроссовер', 'Внедорожник', 'Минивэн', 'Купе', 'Пикап']
  };
  var GROUP_TITLES = { transmission: 'Коробка', drive: 'Привод', fuel: 'Топливо', body: 'Кузов' };
  var QUICK = [
    ['all', 'Все'],
    ['great', 'Цена ниже рынка'],
    ['under15', 'До 1,5 млн'],
    ['auto', 'Автомат'],
    ['suv', 'Кроссоверы']
  ];
  var SORTS = [
    ['new', 'Сначала новые'],
    ['cheap', 'Сначала дешевле'],
    ['expensive', 'Сначала дороже'],
    ['year', 'По году: новее'],
    ['mileage', 'По пробегу: меньше']
  ];
  var CONDITIONS = ['На ходу, без ДТП', 'После ДТП', 'Требует ремонта', 'Не на ходу'];
  var LEAD_TITLES = {
    buy: 'Записаться на осмотр',
    dealer: 'Оптовая цена для перекупов',
    callback: 'Заказать звонок',
    sell: 'Продать машину'
  };
  var CAR_COLORS = {
    'Белый': '#E9ECEF', 'Чёрный': '#2B2F36', 'Серый': '#80868F', 'Серебристый': '#B9BEC6', 'Синий': '#2F5DA8',
    'Голубой': '#6FA8DC', 'Красный': '#B3262E', 'Бордовый': '#6E1F2A', 'Коричневый': '#7A5639', 'Бежевый': '#CDBA96',
    'Зелёный': '#3D6B4F', 'Жёлтый': '#E0B532', 'Оранжевый': '#D9772B', 'Фиолетовый': '#5E4A8C'
  };

  // ---------- Иконки ----------
  function icon(name) {
    var paths = {
      search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
      phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
      heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1z"/>',
      grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
      tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.5"/>',
      sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
      camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
      back: '<path d="M15 5l-7 7 7 7"/>',
      close: '<path d="M6 6l12 12M18 6L6 18"/>',
      check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
      share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
      chat: '<path d="M20 12a8 8 0 0 1-11.5 7.2L4 20l.9-4.2A8 8 0 1 1 20 12z"/>',
      key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>',
      car: '<path d="M4 16v-3.5L6 8a2 2 0 0 1 1.8-1.2h8.4A2 2 0 0 1 18 8l2 4.5V16"/><path d="M3 16h18v2H3z"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  }

  // ---------- Утилиты ----------
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function num(n) { return Math.round(n).toLocaleString('ru-RU').replace(/[\u00a0\u2009]/g, '\u202f'); } // узкий неразрывный пробел
  function rub(n) { return num(n) + ' ₽'; }
  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').trim(); }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function byId(id) {
    for (var i = 0; i < S.cars.length; i++) if (String(S.cars[i].id) === String(id)) return S.cars[i];
    return null;
  }
  function title(car) { return car.make + ' ' + car.model + ', ' + car.year; }
  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem('ando:' + key) || 'null');
      localStorage.setItem('ando:' + key, JSON.stringify(value));
    } catch (e) { /* хранилище недоступно */ }
    return null;
  }

  function specsLine(car) {
    var e = car.engine || {};
    var parts = [];
    if (e.fuel === 'Электро') parts.push(e.power + ' л.с.', 'электро');
    else {
      if (e.volume) parts.push(Number(e.volume).toFixed(1) + ' л');
      if (e.power) parts.push(e.power + ' л.с.');
      if (e.fuel) parts.push(e.fuel.toLowerCase());
    }
    if (car.transmission) parts.push(car.transmission.toLowerCase());
    if (car.drive) parts.push(car.drive.toLowerCase());
    return parts.join(' · ');
  }

  // Оценка цены относительно рыночной: рыночную цену вносит менеджер (например, по оценке Дрома).
  function rating(car) {
    if (!car.marketPrice || !car.price) return null;
    var r = car.price / car.marketPrice;
    var diff = Math.round((1 - r) * 100);
    if (r <= 0.93) return { cls: 'great', label: 'Отличная цена', note: 'На ' + diff + '% ниже рыночной оценки' };
    if (r <= 1) return { cls: 'good', label: 'Хорошая цена', note: diff >= 1 ? 'На ' + diff + '% ниже рыночной оценки' : 'На уровне рыночной оценки' };
    return null;
  }

  // Заглушка вместо фото: силуэт машины в её цвете.
  function placeholder(car) {
    var body = CAR_COLORS[car.color] || '#80868F';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9DCE1"/><stop offset="1" stop-color="#B7BCC4"/></linearGradient></defs>' +
      '<rect width="400" height="300" fill="url(#g)"/><g transform="translate(0 22)"><ellipse cx="205" cy="192" rx="170" ry="10" fill="#000" opacity=".12"/>' +
      '<path d="M40 170 L62 140 Q72 128 92 126 L142 121 L176 92 Q186 84 202 84 L270 84 Q285 84 296 94 L326 121 L350 126 Q368 130 372 146 L376 170 Q376 178 368 178 L48 178 Q40 178 40 170 Z" fill="' + body + '" stroke="#000" stroke-opacity=".25"/>' +
      '<path d="M152 121 L181 97 Q187 92 197 92 L232 92 L232 121 Z M242 92 L268 92 Q280 92 288 100 L310 121 L242 121 Z" fill="#2B3440" opacity=".82"/>' +
      '<g fill="#1C1F24"><circle cx="110" cy="178" r="25"/><circle cx="300" cy="178" r="25"/></g>' +
      '<g fill="#AEB4BD"><circle cx="110" cy="178" r="11"/><circle cx="300" cy="178" r="11"/></g></g>' +
      '<text x="200" y="252" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#5A606A">фото скоро</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function photos(car) { return car.photos && car.photos.length ? car.photos : [placeholder(car)]; }

  // ---------- Состояние ----------
  function emptyFilters() {
    return { make: '', priceFrom: '', priceTo: '', yearFrom: '', yearTo: '', mileageTo: '', transmission: [], drive: [], fuel: [], body: [] };
  }
  var S = {
    cars: [],
    demo: false,
    tab: 'catalog',
    query: '',
    quick: 'all',
    sort: 'new',
    filters: emptyFilters(),
    favs: store('favs') || []
  };

  function activeFilterCount(f) {
    var n = 0;
    if (f.make) n++;
    if (f.priceFrom || f.priceTo) n++;
    if (f.yearFrom || f.yearTo) n++;
    if (f.mileageTo) n++;
    ['transmission', 'drive', 'fuel', 'body'].forEach(function (k) { if (f[k].length) n++; });
    return n;
  }

  function matches(car) {
    var f = S.filters;
    if (S.query) {
      var hay = norm([car.make, car.model, car.generation, car.trim, car.body, car.color].join(' '));
      var words = norm(S.query).split(/\s+/);
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
    }
    if (f.make && car.make !== f.make) return false;
    if (f.priceFrom && car.price < +f.priceFrom) return false;
    if (f.priceTo && car.price > +f.priceTo) return false;
    if (f.yearFrom && car.year < +f.yearFrom) return false;
    if (f.yearTo && car.year > +f.yearTo) return false;
    if (f.mileageTo && car.mileage > +f.mileageTo) return false;
    if (f.transmission.length && f.transmission.indexOf(car.transmission) === -1) return false;
    if (f.drive.length && f.drive.indexOf(car.drive) === -1) return false;
    if (f.fuel.length && f.fuel.indexOf((car.engine || {}).fuel) === -1) return false;
    if (f.body.length && f.body.indexOf(car.body) === -1) return false;
    switch (S.quick) {
      case 'great': return !!car.marketPrice && car.price < car.marketPrice;
      case 'under15': return car.price <= 1500000;
      case 'auto': return car.transmission && car.transmission !== 'Механика';
      case 'suv': return car.body === 'Кроссовер' || car.body === 'Внедорожник';
    }
    return true;
  }

  function sorted(list) {
    var by = {
      new: function (a, b) { return String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')); },
      cheap: function (a, b) { return a.price - b.price; },
      expensive: function (a, b) { return b.price - a.price; },
      year: function (a, b) { return b.year - a.year; },
      mileage: function (a, b) { return a.mileage - b.mileage; }
    }[S.sort];
    // Забронированные — в конце списка.
    return list.slice().sort(function (a, b) {
      var ra = a.status === 'reserved' ? 1 : 0, rb = b.status === 'reserved' ? 1 : 0;
      return ra - rb || by(a, b);
    });
  }

  function isFav(id) { return S.favs.indexOf(String(id)) !== -1; }
  function toggleFav(id) {
    id = String(id);
    var i = S.favs.indexOf(id);
    if (i === -1) S.favs.push(id); else S.favs.splice(i, 1);
    store('favs', S.favs);
    P.haptic('select');
    document.querySelectorAll('.fav[data-id="' + CSS.escape(id) + '"]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(isFav(id)));
      btn.setAttribute('aria-label', isFav(id) ? 'Убрать из избранного' : 'В избранное');
    });
    renderTabbar();
    if (S.tab === 'favorites') renderTab();
  }

  // ---------- Слои: страница машины и нижние листы ----------
  // Кнопка «Назад» мессенджера закрывает верхний слой; в браузере — история.
  // В браузере в историю пишется только страница машины (адрес ?car=ID): листы открываются
  // и закрываются быстро друг за другом, и асинхронный history.back() закрывал бы не тот слой.
  var layers = [];
  function openLayer(close, carId) {
    var layer = { close: close, detail: carId != null };
    layers.push(layer);
    if (P.client === 'web' && layer.detail) {
      try { history.pushState({ andoCar: String(carId) }, '', '?car=' + encodeURIComponent(carId)); } catch (e) { /* без истории */ }
    }
    syncBack();
  }
  function closeTop() {
    var top = layers[layers.length - 1];
    if (!top) return;
    if (P.client === 'web' && top.detail && history.state && history.state.andoCar) { history.back(); return; } // закроет popstate
    popLayer();
  }
  function popLayer() {
    var layer = layers.pop();
    if (layer) layer.close();
    syncBack();
    return layer;
  }
  function syncBack() {
    P.setBack(layers.length ? closeTop : null);
    document.body.classList.toggle('locked', layers.length > 0);
  }
  // «Назад» в браузере закрывает страницу машины вместе с листами поверх неё.
  window.addEventListener('popstate', function () {
    if (P.client !== 'web') return;
    while (layers.length) { if (popLayer().detail) break; }
  });

  var toastTimer = null;
  function toast(text) {
    var el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // ---------- Каркас ----------
  function shell() {
    app.innerHTML =
      '<main class="screen" id="screen"></main>' +
      '<nav class="tabbar" id="tabbar" aria-label="Разделы"></nav>' +
      '<div class="page" id="page" hidden></div>' +
      '<div id="sheet-root"></div>' +
      '<div class="toast" id="toast" role="status" aria-live="polite"></div>';
  }

  function renderTabbar() {
    var tabs = [['catalog', 'Каталог', 'grid'], ['favorites', 'Избранное', 'heart'], ['sell', 'Продать авто', 'tag']];
    document.getElementById('tabbar').innerHTML = '<div class="tabbar-in">' + tabs.map(function (t) {
      var dot = t[0] === 'favorites' && S.favs.length ? '<span class="dot">' + S.favs.length + '</span>' : '';
      return '<button class="tab" data-action="tab" data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' +
        icon(t[2]) + '<span>' + t[1] + '</span>' + dot + '</button>';
    }).join('') + '</div>';
  }

  function headerHtml() {
    return '<header class="top"><div class="brand"><span class="logo">ANDO<b>AUTO</b></span>' +
      '<span class="tagline">' + esc(CFG.tagline || '') + '</span></div>' +
      (CFG.phone ? '<a class="icon-btn" href="tel:' + esc(CFG.phone) + '" aria-label="Позвонить ' + esc(CFG.phoneLabel || CFG.phone) + '">' + icon('phone') + '</a>' : '') +
      '</header>';
  }

  function renderTab() {
    var screen = document.getElementById('screen');
    if (S.tab === 'catalog') {
      screen.innerHTML = headerHtml() +
        (S.demo ? '<p class="demo-note">Демо-объявления для проверки приложения. Замените их своими машинами в data/cars.json.</p>' : '') +
        '<label class="search">' + icon('search') +
        '<input id="q" type="search" placeholder="Марка или модель" value="' + esc(S.query) + '" enterkeyhint="search" autocomplete="off" aria-label="Поиск по марке и модели"></label>' +
        '<div class="chips" id="chips"></div>' +
        '<div class="list-head"><span class="found" id="found"></span>' +
        '<select class="sort" id="sort" aria-label="Сортировка">' + SORTS.map(function (s) {
          return '<option value="' + s[0] + '"' + (S.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
        }).join('') + '</select></div>' +
        '<div class="cards" id="list"></div>';
      renderChips();
      renderList();
    } else if (S.tab === 'favorites') {
      var favCars = S.cars.filter(function (c) { return isFav(c.id); });
      screen.innerHTML = headerHtml() + '<div class="list-head"><span class="found">Избранное</span></div>' +
        (favCars.length
          ? '<div class="cards">' + favCars.map(cardHtml).join('') + '</div>'
          : '<div class="empty">' + icon('heart') + '<strong>Пока пусто</strong><span>Нажмите на сердечко на карточке, чтобы сохранить машину.</span>' +
            '<button class="btn btn-ghost" data-action="tab" data-tab="catalog">Открыть каталог</button></div>');
    } else {
      screen.innerHTML = headerHtml() + sellHtml();
    }
    renderTabbar();
  }

  function renderChips() {
    var n = activeFilterCount(S.filters);
    document.getElementById('chips').innerHTML =
      '<button class="chip" data-action="filters" aria-haspopup="dialog">' + icon('sliders') + 'Фильтры' +
      (n ? '<span class="count">' + n + '</span>' : '') + '</button>' +
      QUICK.map(function (q) {
        return '<button class="chip" data-action="quick" data-key="' + q[0] + '" aria-pressed="' + (S.quick === q[0]) + '">' + q[1] + '</button>';
      }).join('');
  }

  function renderList() {
    var list = sorted(S.cars.filter(matches));
    document.getElementById('found').textContent = list.length
      ? 'Найдено ' + list.length + ' ' + plural(list.length, 'автомобиль', 'автомобиля', 'автомобилей')
      : 'Ничего не найдено';
    var html = list.map(cardHtml);
    // Предложение продать свою машину — после третьей карточки: выкуп у частных владельцев.
    html.splice(Math.min(3, html.length), 0,
      '<button class="promo" data-action="tab" data-tab="sell">' + icon('key') +
      '<span><strong>Продаёте машину?</strong><span>Оценим и выкупим. Берём в любом состоянии.</span></span></button>');
    if (!list.length) {
      html.unshift('<div class="empty">' + icon('search') + '<strong>Нет машин по этим условиям</strong>' +
        '<button class="btn btn-ghost" data-action="reset-all">Сбросить фильтры</button></div>');
    }
    document.getElementById('list').innerHTML = html.join('');
  }

  function cardHtml(car) {
    var r = rating(car);
    var ph = photos(car);
    var reserved = car.status === 'reserved';
    var tags = [];
    if (car.serviceDone && car.serviceDone.length) tags.push('<span class="tag accent">Проверена в нашем сервисе</span>');
    if (car.owners) tags.push('<span class="tag">' + car.owners + ' ' + plural(car.owners, 'владелец', 'владельца', 'владельцев') + '</span>');
    if (car.pts) tags.push('<span class="tag">ПТС ' + esc(car.pts.toLowerCase()) + '</span>');
    (car.tags || []).forEach(function (t) { tags.push('<span class="tag">' + esc(t) + '</span>'); });
    return '<article class="card' + (reserved ? ' is-reserved' : '') + '">' +
      '<div class="card-media"><img src="' + esc(ph[0]) + '" alt="' + esc(title(car)) + '" loading="lazy" decoding="async">' +
      (ph.length > 1 ? '<span class="media-count">' + icon('camera') + ph.length + '</span>' : '') +
      (reserved ? '<span class="status">Забронирована</span>' : '') + '</div>' +
      '<div class="card-body">' +
      '<div class="price-row"><span class="price">' + rub(car.price) + '</span>' +
      (r ? '<span class="badge ' + r.cls + '">' + r.label + '</span>' : '') + '</div>' +
      '<h3 class="card-title"><a href="?car=' + encodeURIComponent(car.id) + '" data-action="open" data-id="' + esc(car.id) + '">' + esc(title(car)) + '</a></h3>' +
      '<p class="specs">' + esc(specsLine(car)) + '</p>' +
      '<p class="meta">' + num(car.mileage) + '\u00a0км' + (car.city ? ' · ' + esc(car.city) : '') + '</p>' +
      '<div class="tags">' + tags.join('') + '</div></div>' +
      favButton(car.id) + '</article>';
  }

  function favButton(id) {
    var on = isFav(id);
    return '<button class="fav" data-action="fav" data-id="' + esc(id) + '" aria-pressed="' + on + '" aria-label="' +
      (on ? 'Убрать из избранного' : 'В избранное') + '">' + icon('heart') + '</button>';
  }

  // ---------- Страница машины ----------
  function openDetail(id) {
    var car = byId(id);
    if (!car) { toast('Машина уже продана или снята с продажи'); return; }
    var page = document.getElementById('page');
    var r = rating(car);
    var ph = photos(car);
    var e = car.engine || {};
    var engine = e.fuel === 'Электро'
      ? e.power + ' л.с., электро'
      : [e.volume ? Number(e.volume).toFixed(1) + ' л' : '', e.power ? e.power + ' л.с.' : '', (e.fuel || '').toLowerCase()].filter(Boolean).join(', ');
    var rows = [
      ['Год выпуска', car.year],
      ['Пробег', num(car.mileage) + '\u00a0км'],
      ['Двигатель', engine],
      ['Коробка', car.transmission],
      ['Привод', car.drive],
      ['Кузов', car.body],
      ['Цвет', car.color],
      ['Руль', car.wheel],
      ['Владельцев по ПТС', car.owners],
      ['ПТС', car.pts],
      ['Поколение', car.generation],
      ['Комплектация', car.trim],
      ['VIN', car.vin]
    ].filter(function (row) { return row[1] !== undefined && row[1] !== null && row[1] !== ''; });

    page.innerHTML = '<div class="page-in">' +
      '<div class="gallery"><button class="page-back" data-action="back">' + icon('back') + 'Назад</button>' +
      '<div class="gallery-track" id="gtrack">' + ph.map(function (src, i) {
        return '<img src="' + esc(src) + '" alt="' + esc(title(car)) + ', фото ' + (i + 1) + '"' + (i ? ' loading="lazy"' : '') + '>';
      }).join('') + '</div>' +
      (ph.length > 1 ? '<span class="gallery-count" id="gcount">1 / ' + ph.length + '</span>' : '') +
      favButton(car.id) + '</div>' +

      '<section class="block"><h1 class="d-title">' + esc(car.make + ' ' + car.model + (car.generation ? ' ' + car.generation : '')) + ', ' + car.year + '</h1>' +
      (car.trim ? '<p class="d-trim">' + esc(car.trim) + '</p>' : '') +
      '<div class="d-price"><span class="price">' + rub(car.price) + '</span>' + (r ? '<span class="badge ' + r.cls + '">' + r.label + '</span>' : '') + '</div>' +
      (r ? '<p class="d-note">' + esc(r.note) + '</p>' : '') +
      '<p class="d-note">' + esc(specsLine(car)) + ' · ' + num(car.mileage) + '\u00a0км</p>' +
      (car.status === 'reserved' ? '<p class="d-reserved">Машина забронирована. Оставьте заявку — сообщим, если бронь снимут.</p>' : '') +
      '</section>' +

      '<section class="block"><h2>Характеристики</h2><dl class="spec-table">' + rows.map(function (row) {
        return '<dt>' + row[0] + '</dt><dd>' + esc(row[1]) + '</dd>';
      }).join('') + '</dl></section>' +

      (car.serviceDone && car.serviceDone.length
        ? '<section class="block"><h2>Что сделали в нашем сервисе</h2><ul class="checks">' + car.serviceDone.map(function (s) {
            return '<li>' + icon('check') + '<span>' + esc(s) + '</span></li>';
          }).join('') + '</ul></section>'
        : '') +

      (car.description ? '<section class="block"><h2>Описание</h2><p class="d-desc">' + esc(car.description) + '</p></section>' : '') +

      '<section class="block dealer"><h2>Вы перекупщик?</h2><p>Для перекупов — оптовая цена по запросу.</p>' +
      '<button class="btn btn-ghost btn-block" data-action="dealer" data-id="' + esc(car.id) + '">Узнать оптовую цену</button></section>' +

      '<section class="block d-foot"><span>Объявление № ' + esc(car.id) + (car.publishedAt ? ' · ' + esc(formatDate(car.publishedAt)) : '') + '</span>' +
      '<button class="link-btn" data-action="share" data-id="' + esc(car.id) + '">' + icon('share') + 'Поделиться</button></section>' +
      '</div>' +

      '<div class="action-bar"><div class="action-bar-in">' +
      (CFG.phone ? '<a class="btn btn-ghost btn-icon" href="tel:' + esc(CFG.phone) + '" aria-label="Позвонить ' + esc(CFG.phoneLabel || CFG.phone) + '">' + icon('phone') + '</a>' : '') +
      '<button class="btn btn-primary" data-action="lead" data-type="buy" data-id="' + esc(car.id) + '">Записаться на осмотр</button>' +
      '</div></div>';

    page.hidden = false;
    page.scrollTop = 0;
    var track = document.getElementById('gtrack');
    var count = document.getElementById('gcount');
    if (track && count) {
      track.addEventListener('scroll', function () {
        var i = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
        count.textContent = (i + 1) + ' / ' + ph.length;
      }, { passive: true });
    }
    openLayer(function () { page.hidden = true; page.innerHTML = ''; }, car.id);
  }

  function formatDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  // ---------- Нижние листы ----------
  function openSheet(html, onOpen) {
    var root = document.getElementById('sheet-root');
    root.innerHTML = '<div class="sheet-wrap" data-action="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<div class="sheet-grip"></div>' + html + '</div></div>';
    openLayer(function () { root.innerHTML = ''; });
    if (onOpen) onOpen(root.querySelector('.sheet'));
  }
  function sheetHead(text) {
    return '<div class="sheet-head"><h2 id="sheet-title">' + esc(text) + '</h2>' +
      '<button class="sheet-close" data-action="close" aria-label="Закрыть">' + icon('close') + '</button></div>';
  }

  // Черновик фильтров: применяется только по кнопке.
  var draft = null;
  function openFilters() {
    draft = JSON.parse(JSON.stringify(S.filters));
    openSheet(sheetHead('Фильтры') + '<div class="form" id="filters-form">' + filtersBody() + '</div>' +
      '<div class="sheet-actions"><button class="btn btn-ghost" data-action="filters-reset">Сбросить</button>' +
      '<button class="btn btn-primary" data-action="filters-apply" id="apply-btn"></button></div>');
    updateApplyButton();
  }
  function filtersBody() {
    var makes = S.cars.map(function (c) { return c.make; }).filter(function (m, i, a) { return a.indexOf(m) === i; }).sort();
    function range(key1, key2, label, ph1, ph2) {
      return '<div><p class="legend">' + label + '</p><div class="range">' +
        '<label class="field"><input data-filter="' + key1 + '" inputmode="numeric" placeholder="' + ph1 + '" value="' + esc(draft[key1]) + '" aria-label="' + label + ' ' + ph1 + '"></label>' +
        '<label class="field"><input data-filter="' + key2 + '" inputmode="numeric" placeholder="' + ph2 + '" value="' + esc(draft[key2]) + '" aria-label="' + label + ' ' + ph2 + '"></label>' +
        '</div></div>';
    }
    function seg(group) {
      return '<div><p class="legend">' + GROUP_TITLES[group] + '</p><div class="seg">' + OPTIONS[group].map(function (v) {
        return '<button type="button" data-action="seg" data-group="' + group + '" data-value="' + esc(v) + '" aria-pressed="' + (draft[group].indexOf(v) !== -1) + '">' + esc(v) + '</button>';
      }).join('') + '</div></div>';
    }
    return '<label class="field"><span>Марка</span><select data-filter="make"><option value="">Любая</option>' +
      makes.map(function (m) { return '<option' + (draft.make === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></label>' +
      range('priceFrom', 'priceTo', 'Цена, ₽', 'от', 'до') +
      range('yearFrom', 'yearTo', 'Год выпуска', 'с', 'по') +
      '<label class="field"><span>Пробег до, км</span><input data-filter="mileageTo" inputmode="numeric" placeholder="Например, 100000" value="' + esc(draft.mileageTo) + '"></label>' +
      seg('transmission') + seg('drive') + seg('fuel') + seg('body');
  }
  function updateApplyButton() {
    var saved = S.filters;
    S.filters = draft;
    var n = S.cars.filter(matches).length;
    S.filters = saved;
    var btn = document.getElementById('apply-btn');
    if (btn) btn.textContent = n ? 'Показать ' + n + ' ' + plural(n, 'машину', 'машины', 'машин') : 'Нет машин';
  }

  function openLead(type, carId) {
    var car = carId ? byId(carId) : null;
    var user = P.user;
    openSheet(sheetHead(LEAD_TITLES[type] || 'Заявка') +
      (car ? '<div class="sheet-car"><img src="' + esc(photos(car)[0]) + '" alt=""><div><b>' + esc(title(car)) + '</b><span>' + rub(car.price) + '</span></div></div>' : '') +
      (type === 'dealer' ? '<p class="d-note sheet-note">Оставьте контакты — пришлём оптовую цену и условия для перекупов.</p>' : '') +
      '<form class="form" id="lead-form" data-type="' + esc(type) + '" data-car="' + esc(carId || '') + '" novalidate>' +
      '<label class="field"><span>Имя</span><input name="name" autocomplete="given-name" maxlength="80" value="' + esc(user && user.first_name || '') + '"></label>' +
      phoneField() +
      '<label class="field"><span>Комментарий</span><textarea name="comment" rows="2" maxlength="500" placeholder="' +
      (type === 'buy' ? 'Когда удобно приехать на осмотр' : 'Удобное время для звонка') + '"></textarea></label>' +
      consentField() +
      '<p class="form-error" role="alert"></p>' +
      '<button class="btn btn-primary btn-block" type="submit">Отправить заявку</button></form>');
  }

  function phoneField() {
    return '<label class="field"><span>Телефон</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00" maxlength="20" required></label>';
  }
  function consentField() {
    return '<label class="consent"><input type="checkbox" name="consent" required><span>Согласен на <a href="' + esc(CFG.privacyUrl || 'privacy.html') +
      '" data-action="privacy">обработку персональных данных</a></span></label>';
  }

  function sellHtml() {
    return '<section class="sell-hero"><h1>Продать машину</h1>' +
      '<p>Оставьте данные — оценим автомобиль и перезвоним. Берём машины в любом состоянии: ремонтируем в своём автосервисе.</p></section>' +
      '<div class="steps"><div class="step"><b>1</b>Заявка</div><div class="step"><b>2</b>Оценка и осмотр</div><div class="step"><b>3</b>Сделка и деньги</div></div>' +
      '<form class="block form" id="sell-form" data-type="sell" novalidate>' +
      '<div class="grid-2"><label class="field"><span>Марка</span><input name="make" maxlength="40" placeholder="Toyota" required></label>' +
      '<label class="field"><span>Модель</span><input name="model" maxlength="40" placeholder="Camry" required></label></div>' +
      '<div class="grid-2"><label class="field"><span>Год выпуска</span><input name="year" inputmode="numeric" maxlength="4" placeholder="2018" required></label>' +
      '<label class="field"><span>Пробег, км</span><input name="mileage" inputmode="numeric" maxlength="7" placeholder="95000"></label></div>' +
      '<div><p class="legend">Состояние</p><div class="seg" id="condition">' + CONDITIONS.map(function (c, i) {
        return '<button type="button" data-action="condition" data-value="' + esc(c) + '" aria-pressed="' + (i === 0) + '">' + esc(c) + '</button>';
      }).join('') + '</div></div>' +
      '<label class="field"><span>Желаемая цена, ₽</span><input name="desiredPrice" inputmode="numeric" maxlength="11" placeholder="Необязательно"></label>' +
      '<label class="field"><span>Имя</span><input name="name" autocomplete="given-name" maxlength="80" value="' + esc(P.user && P.user.first_name || '') + '"></label>' +
      phoneField() +
      '<label class="field"><span>Комментарий</span><textarea name="comment" rows="2" maxlength="500" placeholder="Комплектация, что требует ремонта"></textarea></label>' +
      consentField() +
      '<p class="form-error" role="alert"></p>' +
      '<button class="btn btn-primary btn-block" type="submit">Узнать цену выкупа</button></form>';
  }

  // ---------- Заявки ----------
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function normalizePhone(s) {
    var d = digits(s);
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
    if (d.length === 10 && d[0] === '9') return '+7' + d;
    return null;
  }

  function readLead(form) {
    var type = form.getAttribute('data-type');
    var get = function (name) { var el = form.elements[name]; return el ? el.value.trim() : ''; };
    var lead = { type: type, name: get('name'), phone: normalizePhone(get('phone')), comment: get('comment'), consent: form.elements.consent.checked };
    var carId = form.getAttribute('data-car');
    if (carId) lead.carId = carId;
    if (type === 'sell') {
      var pressed = form.querySelector('#condition [aria-pressed="true"]');
      lead.car = {
        make: get('make'), model: get('model'),
        year: +digits(get('year')) || null,
        mileage: get('mileage') ? +digits(get('mileage')) : null,
        condition: pressed ? pressed.getAttribute('data-value') : CONDITIONS[0],
        desiredPrice: get('desiredPrice') ? +digits(get('desiredPrice')) : null
      };
    }
    return lead;
  }

  function leadError(form, lead) {
    var thisYear = new Date().getFullYear();
    if (lead.type === 'sell') {
      if (!lead.car.make) return ['make', 'Укажите марку'];
      if (!lead.car.model) return ['model', 'Укажите модель'];
      if (!lead.car.year || lead.car.year < 1960 || lead.car.year > thisYear + 1) return ['year', 'Укажите год выпуска'];
    }
    if (!lead.phone) return ['phone', 'Проверьте номер телефона: нужен российский номер из 11 цифр'];
    if (!lead.consent) return ['consent', 'Нужно согласие на обработку персональных данных'];
    return null;
  }

  function leadText(lead) {
    var car = lead.carId ? byId(lead.carId) : null;
    var lines = ['Здравствуйте! Заявка из приложения ' + (CFG.brand || 'ANDO AUTO') + '.', LEAD_TITLES[lead.type] || 'Заявка'];
    if (car) lines.push(title(car) + ' — ' + rub(car.price) + ' (№ ' + car.id + ')');
    if (lead.car) {
      var c = lead.car;
      lines.push(c.make + ' ' + c.model + ', ' + c.year + (c.mileage ? ', ' + num(c.mileage) + ' км' : '') + ', ' + c.condition +
        (c.desiredPrice ? ', хочу ' + rub(c.desiredPrice) : ''));
    }
    if (lead.name) lines.push('Имя: ' + lead.name);
    lines.push('Телефон: ' + lead.phone);
    if (lead.comment) lines.push('Комментарий: ' + lead.comment);
    return lines.join('\n');
  }

  // Сервер заявок пересылает их менеджеру. Без сервера (например, на GitHub Pages)
  // заявка открывается готовым сообщением в чате менеджера.
  function sendLead(lead) {
    var body = Object.assign({ platform: P.client }, lead);
    return fetch((CFG.apiBase || '') + 'api/lead', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, P.headers()),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.ok) return 'sent';
      if (res.status === 400) return res.json().then(function (j) { throw Object.assign(new Error(j.error || 'bad'), { userFacing: true }); });
      throw new Error('http ' + res.status);
    }).catch(function (err) {
      if (err.userFacing) throw err;
      return fallbackLead(lead);
    });
  }

  function fallbackLead(lead) {
    var text = leadText(lead);
    if (CFG.managerTelegram && P.client !== 'max') {
      P.openLink('https://t.me/' + encodeURIComponent(CFG.managerTelegram) + '?text=' + encodeURIComponent(text));
      return Promise.resolve('chat');
    }
    if (CFG.managerMax && P.client === 'max') {
      return P.copy(text).then(function () { P.openLink(CFG.managerMax); return 'chat-copied'; });
    }
    return Promise.resolve('phone');
  }

  function submitLead(form) {
    var lead = readLead(form);
    var error = form.querySelector('.form-error');
    var problem = leadError(form, lead);
    form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    if (problem) {
      error.textContent = problem[1];
      var field = form.elements[problem[0]];
      if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
      P.haptic('error');
      return;
    }
    error.textContent = '';
    var btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Отправляем…';
    sendLead(lead).then(function (outcome) {
      P.haptic('success');
      if (form.id === 'lead-form') closeTop();
      showDone(outcome);
      if (form.id === 'sell-form') form.reset();
    }, function (err) {
      error.textContent = err.userFacing ? err.message : 'Не получилось отправить. Позвоните нам: ' + (CFG.phoneLabel || CFG.phone || '');
      P.haptic('error');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  }

  function showDone(outcome) {
    var texts = {
      sent: ['Заявка отправлена', 'Менеджер свяжется с вами в ближайшее время.'],
      chat: ['Почти готово', 'Открылся чат с менеджером — отправьте сообщение с заявкой.'],
      'chat-copied': ['Почти готово', 'Текст заявки скопирован. Вставьте его в чат с менеджером и отправьте.'],
      phone: ['Позвоните нам', 'Сейчас заявки принимаем по телефону: ' + (CFG.phoneLabel || CFG.phone || '') + '.']
    }[outcome] || ['Готово', ''];
    openSheet('<div class="done">' + icon('check') + '<h2 id="sheet-title">' + esc(texts[0]) + '</h2><p>' + esc(texts[1]) + '</p>' +
      (outcome === 'phone' && CFG.phone ? '<a class="btn btn-primary btn-block" href="tel:' + esc(CFG.phone) + '">' + icon('phone') + 'Позвонить</a>' : '') +
      '<button class="btn btn-ghost btn-block" data-action="close">Готово</button></div>');
  }

  function shareCar(car) {
    var link = P.client === 'max' ? CFG.maxAppLink : CFG.telegramAppLink;
    var url = link ? link + (link.indexOf('?') === -1 ? '?' : '&') + 'startapp=car_' + encodeURIComponent(car.id)
      : location.origin + location.pathname + '?car=' + encodeURIComponent(car.id);
    P.share(title(car) + ' — ' + rub(car.price), url).then(function (result) {
      if (result === 'copied') toast('Ссылка скопирована');
    });
  }

  // ---------- События ----------
  app.addEventListener('click', function (event) {
    var target = event.target.closest('[data-action]');
    if (!target) return;
    var action = target.getAttribute('data-action');
    var id = target.getAttribute('data-id');
    switch (action) {
      case 'open': event.preventDefault(); openDetail(id); break;
      case 'fav': event.preventDefault(); toggleFav(id); break;
      case 'tab':
        S.tab = target.getAttribute('data-tab');
        renderTab();
        window.scrollTo(0, 0);
        break;
      case 'quick':
        S.quick = target.getAttribute('data-key');
        P.haptic('select');
        renderChips();
        renderList();
        break;
      case 'reset-all':
        S.filters = emptyFilters(); S.quick = 'all'; S.query = '';
        renderTab();
        break;
      case 'filters': openFilters(); break;
      case 'seg':
        var group = target.getAttribute('data-group'), value = target.getAttribute('data-value');
        var at = draft[group].indexOf(value);
        if (at === -1) draft[group].push(value); else draft[group].splice(at, 1);
        target.setAttribute('aria-pressed', String(at === -1));
        P.haptic('select');
        updateApplyButton();
        break;
      case 'filters-reset':
        draft = emptyFilters();
        document.getElementById('filters-form').innerHTML = filtersBody();
        updateApplyButton();
        break;
      case 'filters-apply':
        S.filters = draft;
        closeTop();
        renderChips();
        renderList();
        break;
      case 'condition':
        target.parentNode.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === target)); });
        P.haptic('select');
        break;
      case 'lead': openLead(target.getAttribute('data-type'), id); break;
      case 'dealer':
        if (CFG.dealerChat) P.openLink(CFG.dealerChat);
        else openLead('dealer', id);
        break;
      case 'share': shareCar(byId(id)); break;
      case 'privacy':
        event.preventDefault();
        P.openLink(new URL(CFG.privacyUrl || 'privacy.html', location.href).href);
        break;
      case 'reload': location.reload(); break;
      case 'back':
      case 'close': closeTop(); break;
      case 'sheet-bg': if (event.target === target) closeTop(); break;
    }
  });

  var searchTimer = null;
  app.addEventListener('input', function (event) {
    var el = event.target;
    if (el.id === 'q') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { S.query = el.value; renderList(); }, 120);
    } else if (el.hasAttribute('data-filter')) {
      var key = el.getAttribute('data-filter');
      draft[key] = key === 'make' ? el.value : digits(el.value);
      if (key !== 'make' && el.value !== draft[key]) el.value = draft[key];
      updateApplyButton();
    }
  });
  app.addEventListener('change', function (event) {
    if (event.target.id === 'sort') { S.sort = event.target.value; renderList(); }
    else if (event.target.hasAttribute('data-filter')) { draft[event.target.getAttribute('data-filter')] = event.target.value; updateApplyButton(); }
  });
  app.addEventListener('submit', function (event) {
    event.preventDefault();
    submitLead(event.target);
  });

  // ---------- Запуск ----------
  function handleStart(param) {
    if (!param) return;
    var m = /^car_(.+)$/.exec(param);
    if (m) openDetail(m[1]);
    else if (param === 'sell') { S.tab = 'sell'; renderTab(); }
  }

  function loadCars() {
    return fetch('data/cars.json', { cache: 'no-cache' })
      .then(function (res) { if (!res.ok) throw new Error('cars ' + res.status); return res.json(); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data.cars || []);
        S.cars = list.filter(function (c) { return c && c.id != null && c.status !== 'sold'; });
        S.demo = S.cars.some(function (c) { return c.demo; });
      });
  }

  P.init().then(function () {
    shell();
    return loadCars().then(function () {
      renderTab();
      handleStart(P.startParam);
    }, function () {
      document.getElementById('screen').innerHTML = headerHtml() +
        '<div class="empty">' + icon('car') + '<strong>Каталог не загрузился</strong><span>Проверьте интернет и попробуйте ещё раз.</span>' +
        '<button class="btn btn-ghost" data-action="reload">Обновить</button></div>';
      renderTabbar();
    });
  });
})();
