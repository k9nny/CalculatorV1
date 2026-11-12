/* ANDO AUTO — сайт: шапка, появление блоков, форма заявки, машины из каталога приложения. */
(function () {
  var root = document.documentElement;
  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- Плавная прокрутка — Lenis (MIT), https://github.com/darkroomengineering/lenis ---------- */
  if (window.Lenis && !reduced) {
    try { new window.Lenis({ autoRaf: true, anchors: true }); } catch (e) { /* без плавной прокрутки */ }
  }

  /* ---------- Шапка поверх сцены и колесо в логотипе, которое катится при прокрутке ---------- */
  var header = document.getElementById('site-header');
  var wheels = Array.prototype.slice.call(document.querySelectorAll('.logo-wheel'));
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset || 0;
      header.classList.toggle('scrolled', y > 24);
      wheels.forEach(function (w) { w.style.transform = 'rotate(' + (y * .5).toFixed(1) + 'deg)'; });
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Появление блоков ---------- */
  var io = null;
  if (root.classList.contains('js')) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .12 });
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal]'), function (el) { io.observe(el); });
  }

  /* ---------- Сменяющееся слово в заголовке ----------
     Каждые 2 секунды новое слово приходит пружиной (жёсткость 50, затухание 10),
     прежнее уходит вверх, остальные ждут внизу. Сдвиги масштабируются под размер шрифта */
  (function () {
    var rot = document.querySelector('.rotator');
    if (!rot) return;
    var words = Array.prototype.slice.call(rot.querySelectorAll('.rot-word'));
    if (words.length < 2 || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var K = 50, C = 10, cur = 0, raf = 0, last = 0, timer = 0, visible = true;
    var st = words.map(function () { return { y: -100, v: 0, o: 0, vo: 0, ty: 0, to: 0 }; });
    function scale() { return (parseFloat(getComputedStyle(rot).fontSize) || 72) / 72; }
    function step(now) {
      var dt = Math.min(.05, Math.max(0, (now - last) / 1000)), n = Math.max(1, Math.ceil(dt / .004)), h = dt / n, k = scale(), moving = false;
      last = now;
      st.forEach(function (s, i) {
        for (var j = 0; j < n; j++) {
          s.v += (-K * (s.y - s.ty) - C * s.v) * h; s.y += s.v * h;
          s.vo += (-K * (s.o - s.to) - C * s.vo) * h; s.o += s.vo * h;
        }
        if (Math.abs(s.y - s.ty) < .01 && Math.abs(s.v) < .1 && Math.abs(s.o - s.to) < .001 && Math.abs(s.vo) < .01) { s.y = s.ty; s.v = 0; s.o = s.to; s.vo = 0; }
        else moving = true;
        words[i].style.transform = 'translateY(' + (s.y * k).toFixed(2) + 'px)';
        words[i].style.opacity = Math.min(1, Math.max(0, s.o)).toFixed(3);
      });
      raf = moving ? requestAnimationFrame(step) : 0;
    }
    function aim() {
      st.forEach(function (s, i) {
        if (i === cur) { s.ty = 0; s.to = 1; } else { s.ty = cur > i ? -150 : 150; s.to = 0; }
      });
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
    }
    function next() {
      timer = 0;
      if (!visible || document.hidden) return;
      cur = cur === words.length - 1 ? 0 : cur + 1;
      aim();
      timer = setTimeout(next, 2000);
    }
    function start() { if (!timer) timer = setTimeout(next, 2000); }
    words[0].classList.remove('is-first');
    aim();
    start();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); }).observe(rot);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
  })();

  /* ---------- Телефон: +7 (XXX) XXX-XX-XX ---------- */
  function phoneDigits(v) {
    var d = v.replace(/\D/g, '');
    if (d.charAt(0) === '8') d = '7' + d.slice(1);
    if (d && d.charAt(0) !== '7') d = '7' + d;
    return d.slice(0, 11);
  }
  function formatPhone(d) {
    var p = d.slice(1), s = '+7';
    if (p.length) s += ' (' + p.slice(0, 3);
    if (p.length >= 3) s += ')';
    if (p.length > 3) s += ' ' + p.slice(3, 6);
    if (p.length > 6) s += '-' + p.slice(6, 8);
    if (p.length > 8) s += '-' + p.slice(8, 10);
    return s;
  }
  document.querySelectorAll('[data-phone]').forEach(function (el) {
    el.addEventListener('focus', function () { if (!el.value) el.value = '+7 '; });
    el.addEventListener('blur', function () { if (phoneDigits(el.value).length <= 1) el.value = ''; });
    el.addEventListener('input', function (e) {
      if (e.inputType && e.inputType.indexOf('delete') === 0) return;
      el.value = formatPhone(phoneDigits(el.value));
    });
  });

  /* ---------- Отправка ---------- */
  function setError(input, msg) {
    var field = input.closest('.field');
    field.classList.toggle('has-error', !!msg);
    var err = field.querySelector('.err');
    if (err) err.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    return !msg;
  }
  function checkPhone(input) {
    return setError(input, phoneDigits(input.value).length === 11 ? '' : 'Введите номер полностью: +7 и 10 цифр');
  }

  /* Заявка уходит на сервер ANDO AUTO (ando-app): менеджеру в Telegram и в журнал на сервере в России.
     На GitHub Pages сервера нет — тогда просим позвонить. */
  var LEAD_API = window.ANDO_LEAD_API || (/github\.io$/.test(location.hostname) || location.protocol === 'file:' ? '' : '/api/lead');
  var CALL_US = 'Не получилось отправить. Позвоните: +7 (928) 333-95-70';
  function sendLead(data) {
    if (!LEAD_API) return Promise.reject(new Error(CALL_US));
    return fetch(LEAD_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'callback', platform: 'web', phone: data.phone, consent: data.consent,
        comment: data.model ? 'Выкуп. Машина: ' + data.model : 'Выкуп'
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || !body.ok) throw new Error(body.error || CALL_US);
        return body;
      });
    }, function () { throw new Error(CALL_US); });
  }

  function showDone(form, phone) {
    var card = form.parentElement;
    var done = card.querySelector('.done');
    done.querySelector('[data-done-phone]').textContent = formatPhone(phoneDigits(phone));
    form.hidden = true;
    done.hidden = false;
    done.focus();
  }
  document.querySelectorAll('[data-reset]').forEach(function (b) {
    b.addEventListener('click', function () {
      var card = b.closest('.lead-card');
      var form = card.querySelector('form');
      form.reset();
      card.querySelector('.done').hidden = true;
      form.hidden = false;
      form.querySelector('[type="submit"]').disabled = false;
      form.querySelector('input').focus();
    });
  });

  function submitWith(form, validate, collect) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstBad = validate();
      if (firstBad) { firstBad.focus(); return; }
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      var data = collect();
      sendLead(data).then(function () { showDone(form, data.phone); }, function (err) {
        btn.disabled = false;
        var phone = form.querySelector('[data-phone]');
        if (phone) { setError(phone, err.message); phone.focus(); }
      });
    });
  }

  var hModel = document.getElementById('hero-model');
  var hPhone = document.getElementById('hero-phone');
  var hConsent = document.getElementById('hero-consent');
  if (hConsent) hConsent.addEventListener('change', function () { if (hConsent.checked) setError(hConsent, ''); });
  if (hConsent) submitWith(document.getElementById('form-hero'), function () {
    if (!checkPhone(hPhone)) return hPhone;
    // Согласие — отдельной галочкой, которую человек ставит сам (152-ФЗ, ст. 9).
    if (!setError(hConsent, hConsent.checked ? '' : 'Отметьте согласие на обработку персональных данных')) return hConsent;
    return null;
  }, function () {
    return { source: 'hero', model: hModel.value.trim(), phone: hPhone.value, consent: true, consentAt: new Date().toISOString() };
  });

  /* Снимаем ошибку, как только поле исправлено */
  document.querySelectorAll('.lead-form input').forEach(function (el) {
    el.addEventListener('input', function () {
      var field = el.closest('.field');
      if (field && field.classList.contains('has-error')) setError(el, '');
    });
  });

  /* ---------- Машины в продаже: тот же каталог и та же карточка, что в приложении ----------
     Каталог ведёт бот: добавили или сняли машину — она появилась или пропала и здесь, и в приложении. */
  (function () {
    var list = document.getElementById('stock-list');
    var UI = window.AndoCard;
    var APP = 'app/';
    // Страница машины на сервере (/cars/101/) видна поисковикам; на GitHub Pages сервера нет — открываем каталог.
    var PAGE = /github\.io$/.test(location.hostname) || location.protocol === 'file:'
      ? function (id) { return APP + '?car=' + encodeURIComponent(id); }
      : function (id) { return 'cars/' + encodeURIComponent(id) + '/'; };
    function fail() {
      list.innerHTML = '<p class="stock-note">Каталог сейчас не загрузился. Откройте его по кнопке ниже или позвоните — расскажем, что есть в наличии.</p>';
    }
    if (!list) return;
    if (!UI || !window.fetch) { fail(); return; }
    fetch(APP + 'data/cars.json', { cache: 'no-cache' })
      .then(function (res) { if (!res.ok) throw new Error('cars ' + res.status); return res.json(); })
      .then(function (data) {
        var cars = (Array.isArray(data) ? data : data.cars || []).filter(function (c) { return c && c.id != null && c.status !== 'sold'; });
        cars.sort(function (a, b) {
          return (a.status === 'reserved') - (b.status === 'reserved') || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
        });
        if (!cars.length) {
          list.innerHTML = '<p class="stock-note">Сейчас все машины проданы. Новые появляются каждую неделю — загляните позже или позвоните.</p>';
          return;
        }
        var all = document.getElementById('stock-all');
        if (all && cars.length > 6) all.firstChild.textContent = 'Все ' + cars.length + ' ' + UI.plural(cars.length, 'машина', 'машины', 'машин') + ' ';
        list.innerHTML = cars.slice(0, 6).map(function (car) {
          var href = PAGE(car.id);
          return UI.cardHtml(car, {
            base: APP, href: href,
            actions: '<a class="btn btn-primary" href="' + UI.esc(href) + '">Подробнее</a>' +
              '<a class="btn btn-ghost" href="tel:+79283339570">Позвонить</a>'
          });
        }).join('');
        Array.prototype.forEach.call(list.children, function (el, i) {
          el.setAttribute('data-reveal', '');
          el.style.setProperty('--d', (i % 3) * .08 + 's');
          if (io) io.observe(el); else el.classList.add('in');
        });
      })
      .catch(fail);
    UI.bindSlides(list);
    // Фото и заголовок карточки ведут на страницу машины в каталоге.
    list.addEventListener('click', function (event) {
      if (event.target.closest('a, button')) return;
      var zone = event.target.closest('[data-action="open"]');
      if (zone) location.href = PAGE(zone.getAttribute('data-id'));
    });
  })();
})();
