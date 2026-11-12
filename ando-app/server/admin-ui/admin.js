(function () {
  'use strict';
  var UI = window.AndoCard;
  var esc = UI.esc;
  var $ = function (id) { return document.getElementById(id); };
  var STATUS = { available: 'В продаже', reserved: 'Бронь', sold: 'Продана' };
  var LEAD_TYPES = {
    buy: 'Осмотр машины', dealer: 'Оптовая цена', callback: 'Обратный звонок',
    sell: 'Выкуп', credit: 'Рассрочка'
  };

  /* ---------- запросы ---------- */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    if (opts.blob) { init.headers['Content-Type'] = opts.blob.type; init.body = opts.blob; }
    return fetch('api/' + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { showLogin(); throw new Error(data.error || 'Войдите заново'); }
        if (!res.ok) { var e = new Error(data.error || 'Ошибка ' + res.status); e.details = data.details; throw e; }
        return data;
      });
    });
  }

  var toastTimer;
  function toast(text, bad) {
    var t = $('toast');
    t.textContent = text;
    t.classList.toggle('bad', !!bad);
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3200);
  }

  /* ---------- вход ---------- */
  function showLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
    $('login-password').focus();
  }
  function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    loadLeads();
  }
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button');
    btn.disabled = true;
    $('login-err').textContent = '';
    api('login', { method: 'POST', json: { password: $('login-password').value } })
      .then(function () { $('login-password').value = ''; showApp(); })
      .catch(function (err) { $('login-err').textContent = err.message; })
      .then(function () { btn.disabled = false; });
  });
  $('logout').addEventListener('click', function () {
    api('logout', { method: 'POST' }).catch(function () {}).then(showLogin);
  });

  /* ---------- вкладки ---------- */
  var tabs = document.querySelectorAll('[data-tab]');
  function openTab(name) {
    tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    document.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== name; });
    if (name === 'cars') loadCars();
    if (name === 'leads') loadLeads();
    if (name === 'settings') loadLlm();
    window.scrollTo(0, 0);
  }
  tabs.forEach(function (b) { b.addEventListener('click', function () { openTab(b.dataset.tab); }); });

  /* ---------- фото ---------- */
  // Каждое фото уменьшается в браузере до 1600 px по длинной стороне и пересохраняется в JPEG:
  // быстрее грузится с телефона и не уносит на сервер геометку из файла.
  var photos = []; // { key, url, name, state: 'loading' | 'ok' | 'failed' }
  var MAX = 15;

  function shrink(file) {
    var load = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : Promise.reject(new Error('old browser'));
    return load.then(function (img) {
      var k = Math.min(1, 1600 / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return new Promise(function (resolve) { c.toBlob(resolve, 'image/jpeg', 0.85); });
    }).catch(function () { return file; });
  }

  function renderPhotos() {
    $('photos').innerHTML = photos.map(function (p, i) {
      return '<div class="ph' + (i === 0 ? ' first' : '') + (p.state !== 'ok' ? ' ' + p.state : '') + '" data-key="' + p.key + '" title="Сделать обложкой">' +
        '<img src="' + p.url + '" alt="">' +
        '<button type="button" data-remove="' + p.key + '" aria-label="Убрать фото">✕</button></div>';
    }).join('');
    refreshPublish();
    renderPreview();
  }

  $('photo-input').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    var room = MAX - photos.length;
    if (files.length > room) toast('Можно не больше ' + MAX + ' фото', true);
    files.slice(0, Math.max(room, 0)).forEach(function (file) {
      var p = { key: Math.random().toString(36).slice(2), url: URL.createObjectURL(file), name: '', state: 'loading' };
      photos.push(p);
      shrink(file)
        .then(function (blob) {
          var type = /^image\/(jpeg|png|webp)$/.test(blob.type) ? blob.type : 'image/jpeg';
          return api('photo', { method: 'POST', blob: new Blob([blob], { type: type }) });
        })
        .then(function (data) { p.name = data.name; p.state = 'ok'; })
        .catch(function (err) { p.state = 'failed'; toast('Фото не загрузилось: ' + err.message, true); })
        .then(function () {
          renderPhotos();
          // Первое фото готово — нейросеть может дополнить марку, модель, кузов и цвет.
          if (photos[0] === p && $('text').value.trim()) parseText();
        });
    });
    renderPhotos();
  });

  $('photos').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove]');
    if (rm) {
      photos = photos.filter(function (p) {
        if (p.key !== rm.dataset.remove) return true;
        URL.revokeObjectURL(p.url);
        return false;
      });
      return renderPhotos();
    }
    var ph = e.target.closest('.ph');
    if (!ph) return;
    var i = photos.findIndex(function (p) { return p.key === ph.dataset.key; });
    if (i > 0) { photos.unshift(photos.splice(i, 1)[0]); renderPhotos(); }
  });

  /* ---------- текст и превью ---------- */
  var parsed = null;
  var parseTimer;
  var parseSeq = 0;
  $('text').addEventListener('input', function () {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(parseText, 1200);
  });

  function parseText() {
    var text = $('text').value.trim();
    var seq = ++parseSeq;
    if (!text) { parsed = null; $('lack').textContent = ''; renderPreview(); refreshPublish(); return; }
    $('lack').classList.remove('ok');
    $('lack').textContent = 'Разбираю объявление…';
    var names = photos.filter(function (p) { return p.state === 'ok'; }).map(function (p) { return p.name; });
    api('parse', { method: 'POST', json: { text: text, photos: names } }).then(function (data) {
      if (seq !== parseSeq) return;
      parsed = data;
      var lack = $('lack');
      lack.classList.toggle('ok', !data.missing.length);
      var seen = (data.fromPhoto || []).map(function (k) { return { make: 'марка', model: 'модель', generation: 'поколение', body: 'кузов', color: 'цвет' }[k]; });
      lack.textContent = (data.missing.length ? 'Не хватает: ' + data.missing.join(', ') : 'Всё нужное есть') +
        (seen.length ? '. По фото определено: ' + seen.join(', ') + ' — проверьте в превью' : '');
      renderPreview();
      refreshPublish();
    }).catch(function (err) { toast(err.message, true); });
  }

  function renderPreview() {
    var box = $('preview');
    if (!parsed || parsed.missing.length) {
      box.innerHTML = '<p class="hint">' + (parsed ? 'Карточка появится, когда в тексте будут марка, модель, год, цена и пробег.' : 'Начните писать текст — здесь появится карточка.') + '</p>';
      return;
    }
    var car = Object.assign({ id: 'new', status: 'available', publishedAt: new Date().toISOString().slice(0, 10) }, parsed.car);
    car.photos = photos.map(function (p) { return p.url; });
    if (!car.photos.length) delete car.photos;
    box.innerHTML = '<div class="cards">' + UI.cardHtml(car, { base: '../', href: '#' }) + '</div>';
  }

  function refreshPublish() {
    var busy = photos.some(function (p) { return p.state === 'loading'; });
    $('publish').disabled = busy || !parsed || parsed.missing.length > 0;
    $('publish').textContent = busy ? 'Загружаю фото…' : 'Опубликовать';
  }

  $('publish').addEventListener('click', function () {
    var btn = $('publish');
    if (!photos.length && !confirm('Опубликовать без фото?')) return;
    btn.disabled = true;
    $('add-err').textContent = '';
    var names = photos.filter(function (p) { return p.state === 'ok'; }).map(function (p) { return p.name; });
    api('cars', { method: 'POST', json: { text: $('text').value, photos: names } })
      .then(function (data) {
        photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
        photos = [];
        parsed = null;
        $('text').value = '';
        $('lack').textContent = '';
        renderPhotos();
        toast('Опубликовано: ' + UI.title(data.car) + '. Уже на сайте и в приложении.');
        openTab('cars');
      })
      .catch(function (err) { $('add-err').textContent = err.message; refreshPublish(); });
  });

  /* ---------- машины ---------- */
  function loadCars() {
    $('cars').innerHTML = '<p class="empty">Загружаю…</p>';
    api('cars').then(function (data) {
      var cars = data.cars || [];
      $('cleardemo').hidden = !cars.some(function (c) { return c.demo; });
      if (!cars.length) { $('cars').innerHTML = '<p class="empty">Машин пока нет. Добавьте первую на вкладке «Добавить».</p>'; return; }
      $('cars').innerHTML = cars.map(function (c) {
        var src = UI.photos(c, '../')[0];
        return '<div class="row' + (c.status === 'sold' ? ' is-sold' : '') + '" data-id="' + esc(c.id) + '">' +
          '<img src="' + esc(src) + '" alt="" loading="lazy">' +
          '<div class="row-main"><span class="row-title">' + esc(UI.title(c)) + '</span>' +
          '<span class="row-sub">№ ' + esc(c.id) + ' · ' + UI.num(c.mileage || 0) + ' км' +
          (c.demo ? ' · <span class="tag red">демо</span>' : '') + '</span></div>' +
          '<div class="row-tools">' +
          '<select data-status aria-label="Статус">' + Object.keys(STATUS).map(function (k) {
            return '<option value="' + k + '"' + (c.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>';
          }).join('') + '</select>' +
          '<input data-price inputmode="numeric" aria-label="Цена, ₽" value="' + esc(UI.num(c.price || 0)) + '">' +
          '<button class="btn btn-ghost" type="button" data-delete>Удалить</button>' +
          '<button class="btn btn-ghost row-text" type="button" data-text>Текст объявления</button>' +
          '</div></div>';
      }).join('');
    }).catch(function (err) { $('cars').innerHTML = '<p class="empty">' + esc(err.message) + '</p>'; });
  }

  function patchCar(id, body, okText) {
    return api('cars/' + encodeURIComponent(id), { method: 'PATCH', json: body })
      .then(function () { toast(okText); })
      .catch(function (err) { toast(err.message, true); loadCars(); });
  }

  $('cars').addEventListener('change', function (e) {
    var row = e.target.closest('.row');
    if (!row) return;
    var id = row.dataset.id;
    if (e.target.matches('[data-status]')) {
      row.classList.toggle('is-sold', e.target.value === 'sold');
      patchCar(id, { status: e.target.value }, 'Статус: ' + STATUS[e.target.value]);
    }
    if (e.target.matches('[data-price]')) {
      var price = Number(e.target.value.replace(/\D/g, ''));
      if (!price) { toast('Проверьте цену', true); return; }
      e.target.value = UI.num(price);
      patchCar(id, { price: price }, 'Цена: ' + UI.rub(price));
    }
  });
  $('cars').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches('[data-price]')) e.target.blur();
  });
  $('cars').addEventListener('click', function (e) {
    if (e.target.matches('[data-text]')) {
      var id = e.target.closest('.row').dataset.id;
      api('cars/' + encodeURIComponent(id) + '/text').then(function (data) {
        var done = function () { toast('Текст объявления скопирован'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(data.text).then(done, function () { prompt('Скопируйте текст:', data.text); });
        else prompt('Скопируйте текст:', data.text);
      }).catch(function (err) { toast(err.message, true); });
      return;
    }
    if (!e.target.matches('[data-delete]')) return;
    var row = e.target.closest('.row');
    var title = row.querySelector('.row-title').textContent;
    if (!confirm('Удалить «' + title + '» совсем, вместе с фото?\nЕсли машину продали, лучше поставить статус «Продана».')) return;
    api('cars/' + encodeURIComponent(row.dataset.id), { method: 'DELETE' })
      .then(function () { row.remove(); toast('Удалено'); })
      .catch(function (err) { toast(err.message, true); });
  });
  $('cleardemo').addEventListener('click', function () {
    if (!confirm('Убрать все демо-объявления? Настоящие машины останутся.')) return;
    api('cleardemo', { method: 'POST' })
      .then(function (data) { toast('Убрано демо-объявлений: ' + data.removed); loadCars(); })
      .catch(function (err) { toast(err.message, true); });
  });

  /* ---------- заявки ---------- */
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function leadBody(l) {
    var lines = [];
    if (l.car) lines.push(l.car.title + ' — ' + UI.rub(l.car.price) + ' (№ ' + l.car.id + ')');
    if (l.sellCar) {
      var c = l.sellCar;
      lines.push(c.make + ' ' + c.model + ', ' + c.year + (c.mileage != null ? ', ' + UI.num(c.mileage) + ' км' : '') +
        (c.condition ? '\nСостояние: ' + c.condition : '') + (c.desiredPrice ? '\nХочет: ' + UI.rub(c.desiredPrice) : ''));
    }
    if (l.credit && l.credit.downPayment) lines.push('Первый взнос: ' + UI.rub(l.credit.downPayment));
    if (l.name) lines.push('Имя: ' + l.name);
    if (l.comment) lines.push('Комментарий: ' + l.comment);
    return lines.join('\n');
  }

  function setBadge(n) {
    var tab = document.querySelector('[data-tab="leads"]');
    tab.innerHTML = 'Заявки' + (n ? '<span class="badge">' + n + '</span>' : '');
  }

  function loadLeads() {
    api('leads').then(function (data) {
      var leads = data.leads || [];
      setBadge(leads.filter(function (l) { return !l.done; }).length);
      if (!leads.length) { $('leads').innerHTML = '<p class="empty">Заявок пока нет. Они появятся здесь сразу, как кто-то оставит телефон на сайте или в приложении.</p>'; return; }
      $('leads').innerHTML = leads.map(function (l) {
        var where = { telegram: 'Telegram', max: 'MAX', web: 'сайт' }[l.platform] || 'сайт';
        return '<div class="lead' + (l.done ? ' is-done' : '') + '" data-id="' + esc(l.id) + '">' +
          '<div class="lead-head"><span>' + esc(when(l.at)) + ' · ' + where + '</span><span>' + (l.done ? 'обработана' : '') + '</span></div>' +
          '<span class="lead-what">' + esc(LEAD_TYPES[l.type] || 'Заявка') + ' · ' + esc(l.phone) + '</span>' +
          '<div class="lead-body">' + esc(leadBody(l)) + '</div>' +
          '<div class="lead-tools">' +
          '<a class="btn btn-primary" href="tel:' + esc(l.phone) + '">Позвонить</a>' +
          '<button class="btn btn-ghost" type="button" data-done="' + (l.done ? '0' : '1') + '">' + (l.done ? 'Вернуть' : 'Обработана') + '</button>' +
          '</div></div>';
      }).join('');
    }).catch(function (err) { $('leads').innerHTML = '<p class="empty">' + esc(err.message) + '</p>'; });
  }

  $('leads').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-done]');
    if (!btn) return;
    var id = btn.closest('.lead').dataset.id;
    api('leads/' + id, { method: 'PATCH', json: { done: btn.dataset.done === '1' } })
      .then(loadLeads)
      .catch(function (err) { toast(err.message, true); });
  });

  // Новые заявки подтягиваются сами, пока вкладка открыта.
  setInterval(function () {
    if (!$('app').hidden && document.visibilityState === 'visible') loadLeads();
  }, 60000);

  /* ---------- нейросеть ---------- */
  function showLlm(data) {
    $('llm-status').classList.toggle('ok', !!data.enabled);
    $('llm-status').classList.toggle('off', !data.enabled);
    $('llm-status').textContent = data.enabled
      ? 'Включена: ' + data.model + ' · ключ ' + data.keyEnd + (data.vision ? ' · понимает фото' : ' · фото не принимает')
      : 'Выключена: объявления разбираются обычным способом.';
    $('llm-off').hidden = !data.enabled;
  }
  function loadLlm() { api('llm').then(showLlm).catch(function (err) { $('llm-status').textContent = err.message; }); }
  $('llm-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Проверяю ключ…';
    $('llm-err').textContent = '';
    $('llm-result').textContent = '';
    api('llm', { method: 'POST', json: { key: $('llm-key').value, base: $('llm-base').value } })
      .then(function (data) {
        $('llm-key').value = '';
        showLlm(data);
        var s = data.sample || {};
        $('llm-result').textContent = 'Проверка: «мерс ешка 2017, 98т.км, 2 млн 650» → ' +
          [s.make, s.model, s.year, s.mileage != null ? UI.num(s.mileage) + ' км' : '', s.price ? UI.rub(s.price) : ''].filter(Boolean).join(', ');
        toast('Нейросеть подключена');
      })
      .catch(function (err) { $('llm-err').textContent = err.message + (err.details && err.details.length ? '\n' + err.details.join('\n') : ''); })
      .then(function () { btn.disabled = false; btn.textContent = 'Сохранить и проверить'; });
  });
  $('llm-off').addEventListener('click', function () {
    if (!confirm('Выключить нейросеть? Объявления будут разбираться обычным способом.')) return;
    api('llm', { method: 'DELETE' }).then(function (data) { showLlm(data); $('llm-result').textContent = ''; }).catch(function (err) { toast(err.message, true); });
  });

  /* ---------- старт ---------- */
  UI.bindSlides($('preview'));
  api('status').then(function (data) { if (data.authed) showApp(); else showLogin(); }).catch(showLogin);
})();
