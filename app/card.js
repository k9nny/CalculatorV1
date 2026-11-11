/* ANDO AUTO — карточка машины и общие мелочи. Один файл для приложения и для сайта:
   сайт подключает его из каталога приложения, поэтому карточки везде одинаковые. */
(function () {
  'use strict';

  // Иконки Lucide (ISC), https://github.com/lucide-icons/lucide
  var ICONS = {
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
    heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    sliders: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
    camera: '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
    chat: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
    key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    gear: '<path d="M11 10.27 7 3.34"/><path d="m11 13.73-4 6.93"/><path d="M12 22v-2"/><path d="M12 2v2"/><path d="M14 12h8"/><path d="m17 20.66-1-1.73"/><path d="m17 3.34-1 1.73"/><path d="M2 12h2"/><path d="m20.66 17-1.73-1"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m3.34 7 1.73 1"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    spark: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    zoom: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    landmark: '<path d="M10 18v-7"/><path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    route: '<path d="M9 5h8.5a1 1 0 010 7h-11a1 1 0 000 7H15"/><circle cx="18" cy="19" r="3"/><circle cx="6" cy="5" r="3"/>',
    file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m9 15 2 2 4-4"/>'
  };
  function icon(name) {
    return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') + '</svg>';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function num(n) { return Math.round(n).toLocaleString('ru-RU').replace(/[  ]/g, ' '); } // узкий неразрывный пробел
  function rub(n) { return num(n) + ' ₽'; }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }
  function title(car) { return car.make + ' ' + car.model + ', ' + car.year; }

  // Оценка цены относительно рыночной: рыночную цену вносит менеджер.
  function rating(car) {
    if (!car.marketPrice || !car.price) return null;
    var r = car.price / car.marketPrice;
    var diff = Math.round((1 - r) * 100);
    var below = car.marketPrice - car.price;
    var vs = below > 0 ? rub(below) + ' ниже рынка' : below < 0 ? rub(-below) + ' выше рынка' : 'по рынку';
    if (r <= 0.93) return { cls: 'great', label: 'Отличная цена', vs: vs, note: 'На ' + diff + '% ниже рыночной оценки' };
    if (r <= 1) return { cls: 'good', label: 'Хорошая цена', vs: vs, note: diff >= 1 ? 'На ' + diff + '% ниже рыночной оценки' : 'На уровне рыночной оценки' };
    if (r <= 1.05) return { cls: 'fair', label: 'Цена по рынку', vs: vs, note: 'Немного выше средней рыночной оценки' };
    return null;
  }

  function historyShort(car) {
    var h = car.history || {};
    var out = [];
    if (h.accidents === 0) out.push('Без ДТП');
    if (car.owners) out.push(car.owners + ' ' + plural(car.owners, 'владелец', 'владельца', 'владельцев'));
    if (h.pledge === false && h.restrictions === false) out.push('Без залогов и ограничений');
    return out.join(' · ');
  }
  function isNew(car) {
    if (!car.publishedAt) return false;
    return (Date.now() - new Date(car.publishedAt).getTime()) / 864e5 < 3;
  }

  var CAR_COLORS = {
    'Белый': '#E9ECEF', 'Чёрный': '#2B2F36', 'Серый': '#80868F', 'Серебристый': '#B9BEC6', 'Синий': '#2F5DA8',
    'Голубой': '#6FA8DC', 'Красный': '#B3262E', 'Бордовый': '#6E1F2A', 'Коричневый': '#7A5639', 'Бежевый': '#CDBA96',
    'Зелёный': '#3D6B4F', 'Жёлтый': '#E0B532', 'Оранжевый': '#D9772B', 'Фиолетовый': '#5E4A8C'
  };
  // Заглушка вместо фото: силуэт машины в её цвете.
  function placeholder(car) {
    var body = CAR_COLORS[car.color] || '#80868F';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<rect width="400" height="300" fill="#ECECE9"/><g transform="translate(0 22)"><ellipse cx="205" cy="192" rx="170" ry="8" fill="#000" opacity=".08"/>' +
      '<path d="M40 170 L62 140 Q72 128 92 126 L142 121 L176 92 Q186 84 202 84 L270 84 Q285 84 296 94 L326 121 L350 126 Q368 130 372 146 L376 170 Q376 178 368 178 L48 178 Q40 178 40 170 Z" fill="' + body + '" stroke="#000" stroke-opacity=".2"/>' +
      '<path d="M152 121 L181 97 Q187 92 197 92 L232 92 L232 121 Z M242 92 L268 92 Q280 92 288 100 L310 121 L242 121 Z" fill="#2B3440" opacity=".82"/>' +
      '<g fill="#1C1F24"><circle cx="110" cy="178" r="25"/><circle cx="300" cy="178" r="25"/></g>' +
      '<g fill="#AEB4BD"><circle cx="110" cy="178" r="11"/><circle cx="300" cy="178" r="11"/></g></g>' +
      '<text x="200" y="252" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" letter-spacing="2" fill="#7C7C83">ФОТО СКОРО</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  // base — где лежит приложение относительно страницы ('' в приложении, 'app/' на сайте).
  function photos(car, base) {
    if (!car.photos || !car.photos.length) return [placeholder(car)];
    return car.photos.map(function (src) { return /^(https?:|data:|\/)/.test(src) ? src : (base || '') + src; });
  }
  function vtName(id) { return 'car-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_'); }

  /* Карточка: листаемые фото; слева название, справа цена и оценка рынка; факты; опции; кнопки.
     o.base — префикс путей к фото, o.href — адрес страницы машины, o.fav и o.actions — готовая разметка. */
  function cardHtml(car, o) {
    o = o || {};
    var r = rating(car);
    var ph = photos(car, o.base).slice(0, 8);
    var reserved = car.status === 'reserved';
    var e = car.engine || {};
    var facts = [
      ['gauge', num(car.mileage) + ' км'],
      ['gear', [e.volume ? Number(e.volume).toFixed(1) + ' л' : '', e.power ? e.power + ' л.с.' : '', car.transmission, car.drive ? car.drive.toLowerCase() + ' привод' : '']
        .filter(Boolean).join(' · ')],
      ['shield', historyShort(car)],
      ['pin', car.city]
    ].filter(function (f) { return f[1]; });
    var chips = (car.features && car.features.length ? car.features : (car.serviceDone || [])).slice(0, 4);
    var open = ' data-action="open" data-id="' + esc(car.id) + '"';
    return '<article class="card' + (reserved ? ' is-reserved' : '') + '" style="view-transition-name:' + vtName(car.id) + '">' +
      '<div class="card-media"' + open + '>' +
      '<div class="card-track">' + ph.map(function (src, i) {
        return '<img src="' + esc(src) + '" alt="' + esc(title(car)) + (i ? ', фото ' + (i + 1) : '') + '" loading="lazy" decoding="async">';
      }).join('') + '</div>' +
      (ph.length > 1
        ? '<button class="media-arrow prev" type="button" data-action="slide" data-dir="-1" aria-label="Предыдущее фото">' + icon('left') + '</button>' +
          '<button class="media-arrow next" type="button" data-action="slide" data-dir="1" aria-label="Следующее фото">' + icon('right') + '</button>' +
          '<div class="card-dots">' + ph.map(function (_, i) { return '<i' + (i ? '' : ' class="on"') + '></i>'; }).join('') + '</div>'
        : '') +
      (reserved ? '<span class="status reserved">Забронирована</span>' : isNew(car) ? '<span class="status">' + icon('spark') + 'Новое</span>' : '') +
      '</div>' + (o.fav || '') +
      '<div class="card-body">' +
      '<div class="card-head"' + open + '>' +
      '<div><h3 class="card-title"><a href="' + esc(o.href || ('?car=' + encodeURIComponent(car.id))) + '">' + car.year + ' ' + esc(car.make + ' ' + car.model) + '</a></h3>' +
      '<p class="card-trim">' + esc([car.generation, car.trim, car.body].filter(Boolean).join(' · ')) + '</p></div>' +
      '<div class="card-price"><span class="price">' + rub(car.price) + '</span>' +
      (r ? '<span class="deal ' + r.cls + '">' + icon('check') + r.label + '</span><span class="vs">' + esc(r.vs) + '</span>' : '') +
      '</div></div>' +
      '<ul class="facts">' + facts.map(function (f) { return '<li>' + icon(f[0]) + '<span>' + esc(f[1]) + '</span></li>'; }).join('') + '</ul>' +
      (chips.length ? '<div class="opts">' + chips.map(function (c) { return '<span class="opt">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
      (o.actions ? '<div class="card-actions">' + o.actions + '</div>' : '') +
      '</div></article>';
  }

  // Листание фото в карточке: стрелки и точки. Вешается один раз на контейнер со списком.
  function bindSlides(root) {
    root.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-action="slide"]');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      var tr = btn.parentNode.querySelector('.card-track');
      tr.scrollBy({ left: tr.clientWidth * +btn.getAttribute('data-dir'), behavior: 'smooth' });
    }, true);
    root.addEventListener('scroll', function (event) {
      var tr = event.target;
      if (!tr.classList || !tr.classList.contains('card-track')) return;
      var dots = tr.parentNode.querySelector('.card-dots');
      if (!dots) return;
      var i = Math.round(tr.scrollLeft / Math.max(tr.clientWidth, 1));
      Array.prototype.forEach.call(dots.children, function (d, k) { d.classList.toggle('on', k === i); });
    }, true);
  }

  window.AndoCard = {
    icon: icon, esc: esc, num: num, rub: rub, plural: plural, title: title, rating: rating,
    historyShort: historyShort, isNew: isNew, photos: photos, vtName: vtName, cardHtml: cardHtml, bindSlides: bindSlides
  };
})();
