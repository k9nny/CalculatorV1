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
  var PHOTO_API = new URL('../app/api/lead-photo', document.currentScript.src);
  var CALL_US = 'Не получилось отправить. Позвоните: +7 (928) 333-95-70';
  function sendLead(data) {
    if (!LEAD_API) return Promise.reject(new Error(CALL_US));
    return fetch(LEAD_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || !body.ok) throw new Error(body.error || CALL_US);
        return body;
      });
    }, function () { throw new Error(CALL_US); });
  }

  async function preparePhoto(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Выберите фото до 20 МБ.');
    var bitmap = await createImageBitmap(file).catch(function () {
      throw new Error('Не удалось открыть фото. Попробуйте JPG, PNG или WebP.');
    });
    var canvas = document.createElement('canvas');
    try {
      var scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      var context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      var jpeg = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.8); });
      if (!jpeg || jpeg.size > 900 * 1024) throw new Error('Не получилось сжать фото. Выберите файл поменьше.');
      return jpeg;
    } finally { bitmap.close(); }
  }

  function addPhotoControl(done, token) {
    var control = document.createElement('div');
    control.className = 'lead-photo';
    control.innerHTML = '<label class="field"><span>Добавить до 3 фото автомобиля · необязательно</span>' +
      '<input type="file" accept="image/*" multiple></label><p class="form-note">Фото будут доступны команде ANDO AUTO в этой заявке.</p>' +
      '<p class="form-note" role="status"></p>';
    var input = control.querySelector('input');
    var status = control.querySelector('[role="status"]');
    var count = 0;
    input.addEventListener('change', async function () {
      var files = Array.from(input.files);
      if (!files.length) return;
      input.disabled = true;
      status.textContent = 'Загружаем фото…';
      try {
        for (var file of files.slice(0, 3 - count)) {
          var res = await fetch(PHOTO_API, {
            method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Ando-Lead-Upload': token },
            body: await preparePhoto(file)
          });
          var result = await res.json();
          if (!res.ok) throw new Error(result.error);
          count = result.count;
        }
        status.textContent = 'Фото в заявке: ' + count + ' из 3.';
      } catch (err) {
        status.textContent = (count ? 'Сохранено фото: ' + count + '. ' : '') + (err.message || 'Не удалось добавить фото.');
      } finally {
        input.value = '';
        input.disabled = count >= 3;
      }
    });
    done.querySelector('[data-reset]').before(control);
  }

  function showDone(form, phone, uploadToken) {
    var card = form.parentElement;
    var done = card.querySelector('.done');
    done.querySelector('[data-done-phone]').textContent = formatPhone(phoneDigits(phone));
    if (uploadToken) addPhotoControl(done, uploadToken);
    form.hidden = true;
    done.hidden = false;
    done.focus();
  }
  document.querySelectorAll('[data-reset]').forEach(function (b) {
    b.addEventListener('click', function () {
      var card = b.closest('.lead-card, .car-lead');
      var form = card.querySelector('form');
      form.reset();
      card.querySelector('.done').hidden = true;
      card.querySelector('.lead-photo')?.remove();
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
      sendLead(data).then(function (result) {
        window.AndoAnalytics?.accepted(data.type);
        showDone(form, data.phone, result.uploadToken);
      }, function (err) {
        btn.disabled = false;
        var phone = form.querySelector('[data-phone]');
        if (phone) { setError(phone, err.message); phone.focus(); }
      });
    });
  }

  var utm = new URLSearchParams(location.search);
  var utmSource = (utm.get('utm_source') || '').toLowerCase();
  if (!['vk', 'telegram', 'instagram', 'threads', 'youtube', 'yandex', 'max'].includes(utmSource)) utmSource = '';
  var utmContent = utm.get('utm_content') || '';
  if (!/^(car|buyout)-[\w-]{1,80}$/i.test(utmContent)) utmContent = '';
  document.querySelectorAll('.lead-form[data-entry]').forEach(function (form) {
    var phone = form.elements.phone;
    var consent = form.elements.consent;
    consent.addEventListener('change', function () { if (consent.checked) setError(consent, ''); });
    submitWith(form, function () {
      if (!checkPhone(phone)) return phone;
      if (!setError(consent, consent.checked ? '' : 'Отметьте согласие на обработку персональных данных')) return consent;
      return null;
    }, function () {
      return {
        type: form.dataset.type || 'sell', platform: 'web', phone: phone.value, consent: true,
        entryPoint: form.dataset.entry, utmSource: utmSource, utmContent: utmContent,
        carId: form.dataset.car, vehicle: form.elements.model ? form.elements.model.value.trim() : undefined
      };
    });
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
    function attributed(href) {
      return utmSource ? href + (href.includes('?') ? '&' : '?') + 'utm_source=' + encodeURIComponent(utmSource) +
        (utmContent ? '&utm_content=' + encodeURIComponent(utmContent) : '') : href;
    }
    // Страница машины на сервере (/cars/101/) видна поисковикам; на GitHub Pages сервера нет — открываем каталог.
    var localCatalog = /github\.io$/.test(location.hostname) || location.protocol === 'file:';
    function PAGE(id) {
      return attributed(localCatalog ? APP + '?car=' + encodeURIComponent(id) : 'cars/' + encodeURIComponent(id) + '/');
    }
    function fail() {
      list.innerHTML = '<p class="stock-note">Каталог сейчас не загрузился. Откройте его по кнопке ниже или позвоните — расскажем, что есть в наличии.</p>';
    }
    if (!list) return;
    var all = document.getElementById('stock-all');
    document.querySelectorAll('[data-catalog-link], #stock-all').forEach(function (link) {
      link.setAttribute('href', attributed(link.getAttribute('href')));
    });
    if (!UI || !window.fetch) { fail(); return; }
    fetch(APP + 'data/cars.json', { cache: 'no-cache' })
      .then(function (res) { if (!res.ok) throw new Error('cars ' + res.status); return res.json(); })
      .then(function (data) {
        var cars = (Array.isArray(data) ? data : data.cars || []).filter(function (c) { return c && c.id != null && !c.demo && c.status !== 'sold'; });
        cars.sort(function (a, b) {
          return (a.status === 'reserved') - (b.status === 'reserved') || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
        });
        if (!cars.length) {
          list.innerHTML = '<p class="stock-note">Сейчас все машины проданы. Новые появляются каждую неделю — загляните позже или позвоните.</p>';
          return;
        }
        if (all && cars.length > 6) all.firstChild.textContent = 'Все ' + cars.length + ' ' + UI.plural(cars.length, 'машина', 'машины', 'машин') + ' ';
        list.innerHTML = cars.slice(0, 6).map(function (car) {
          var href = PAGE(car.id);
          return UI.cardHtml(car, {
            base: APP, href: href,
            actions: '<a class="btn btn-primary" href="' + UI.esc(href) + '">Смотреть машину</a>'
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
