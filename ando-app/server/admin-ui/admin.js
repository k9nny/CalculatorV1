(function () {
  'use strict';
  var UI = window.AndoCard;
  var esc = UI.esc;
  var $ = function (id) { return document.getElementById(id); };
  var STATUS = { available: 'В продаже', reserved: 'Бронь', sold: 'Продана' };
  var LEAD_TYPES = {
    buy: 'Осмотр машины', dealer: 'Оптовая цена', callback: 'Обратный звонок',
    sell: 'Выкуп', credit: 'Анкета на кредит', listing: 'Партнёрство с селлером'
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
    openTab(location.hash === '#settings' ? 'settings' : 'crm');
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
    if (name === 'crm') crm.load();
    if (name === 'cars') { loadCars(); loadRenderJobs(); }
    if (name === 'publications') loadPublications();
    if (name === 'leads') loadLeads();
    if (name === 'settings') { loadLlm(); loadTg(); loadVk(); loadMetaAccount('instagram'); loadMetaAccount('threads'); loadYouTube(); }
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

  /* ---------- видео ---------- */
  // Загрузка с полосой прогресса: видео большие, а интернет на телефоне бывает медленным.
  var videos = []; // { key, file, name, state: 'loading' | 'ok' | 'failed', pct }
  var MAX_VIDEOS = 3;
  function uploadVideo(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'api/video');
      xhr.setRequestHeader('Content-Type', /^video\//.test(file.type) ? file.type : 'video/mp4');
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* не JSON */ }
        if (xhr.status === 401) { showLogin(); reject(new Error('Войдите заново')); return; }
        if (xhr.status >= 400) { reject(new Error(data.error || (xhr.status === 413 ? 'Видео больше 300 МБ' : 'Ошибка ' + xhr.status))); return; }
        resolve(data);
      };
      xhr.onerror = function () { reject(new Error('Нет связи с сервером')); };
      xhr.send(file);
    });
  }
  function renderVideos() {
    $('videos').innerHTML = videos.map(function (v) {
      var status = v.state === 'ok' ? 'загружено' : v.state === 'failed' ? 'не загрузилось' : (v.pct || 0) + '%';
      return '<div class="vitem ' + v.state + '"><span class="vname">' + esc(v.file.name) + ' · ' + (v.file.size < 1048576 ? 'меньше 1' : Math.round(v.file.size / 1048576)) + ' МБ</span>' +
        '<span class="vstat">' + status + '</span>' +
        '<span class="vbar"><i style="width:' + (v.state === 'ok' ? 100 : v.pct || 0) + '%"></i></span>' +
        '<button type="button" data-vremove="' + v.key + '" aria-label="Убрать видео">✕</button></div>';
    }).join('');
    refreshPublish();
  }
  $('video-input').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    var room = MAX_VIDEOS - videos.length;
    if (files.length > room) toast('Можно не больше ' + MAX_VIDEOS + ' видео', true);
    files.slice(0, Math.max(room, 0)).forEach(function (file) {
      var v = { key: Math.random().toString(36).slice(2), file: file, name: '', state: 'loading', pct: 0 };
      videos.push(v);
      uploadVideo(file, function (pct) { v.pct = pct; renderVideos(); })
        .then(function (data) { v.name = data.name; v.state = 'ok'; })
        .catch(function (err) { v.state = 'failed'; toast('Видео не загрузилось: ' + err.message, true); })
        .then(renderVideos);
    });
    renderVideos();
  });
  $('videos').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-vremove]');
    if (!rm) return;
    videos = videos.filter(function (v) { return v.key !== rm.dataset.vremove; });
    renderVideos();
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
        (seen.length ? '. По фото определено: ' + seen.join(', ') + ' — проверьте в превью' : '') +
        (data.via === 'llm' ? '. Разобрала нейросеть' : data.via === 'rules' ? '. Нейросеть не ответила' + (data.llmError ? ' (' + data.llmError + ')' : '') + ' — разобрано обычным способом' : '');
      renderPreview();
      refreshPublish();
    }).catch(function (err) { toast(err.message, true); });
  }

  function renderPreview() {
    var box = $('preview');
    if (!parsed || parsed.missing.length) {
      box.innerHTML = '<p class="hint">' + (parsed ? 'Карточка появится, когда в тексте будут марка, модель, год и цена.' : 'Начните писать текст — здесь появится карточка.') + '</p>';
      return;
    }
    var car = Object.assign({ id: 'new', status: 'available', publishedAt: new Date().toISOString().slice(0, 10) }, parsed.car);
    car.photos = photos.map(function (p) { return p.url; });
    if (!car.photos.length) delete car.photos;
    box.innerHTML = '<div class="cards">' + UI.cardHtml(car, { base: '../', href: '#' }) + '</div>';
  }

  function refreshPublish() {
    var busy = photos.some(function (p) { return p.state === 'loading'; }) || videos.some(function (v) { return v.state === 'loading'; });
    $('publish').disabled = busy || !parsed || parsed.missing.length > 0;
    $('publish').textContent = busy ? 'Загружаю фото и видео…' : 'Добавить в каталог';
  }

  $('publish').addEventListener('click', function () {
    var btn = $('publish');
    if (!photos.length && !confirm('Добавить в каталог без фото?')) return;
    btn.disabled = true;
    $('add-err').textContent = '';
    var names = photos.filter(function (p) { return p.state === 'ok'; }).map(function (p) { return p.name; });
    var vnames = videos.filter(function (v) { return v.state === 'ok'; }).map(function (v) { return v.name; });
    api('cars', { method: 'POST', json: { text: $('text').value, photos: names, videos: vnames } })
      .then(function (data) {
        photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
        photos = [];
        videos = [];
        renderVideos();
        parsed = null;
        $('text').value = '';
        $('lack').textContent = '';
        renderPhotos();
        toast(UI.title(data.car) + ' · уже в каталоге. Можно добавлять следующую машину.');
        openTab('add');
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
          '<span class="row-sub">№ ' + esc(c.id) + (c.mileage != null ? ' · ' + UI.num(c.mileage) + ' км' : '') +
          (c.videos && c.videos.length ? ' · видео: ' + c.videos.length : '') +
          (c.demo ? ' · <span class="tag red">демо</span>' : '') + '</span>' + ratingTag(c) + '</div>' +
          '<div class="row-tools">' +
          '<select data-status aria-label="Статус">' + Object.keys(STATUS).map(function (k) {
            return '<option value="' + k + '"' + (c.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>';
          }).join('') + '</select>' +
          '<input data-price inputmode="numeric" aria-label="Цена, ₽" value="' + esc(UI.num(c.price || 0)) + '">' +
          '<button class="btn btn-ghost" type="button" data-delete>Удалить</button>' +
          '<button class="btn btn-ghost row-market-btn" type="button" data-act="market">' + (c.marketEstimate ? 'Оценить рынок заново' : 'Оценить рынок') + '</button>' +
          '<a class="btn btn-ghost row-compare" target="_blank" rel="noopener noreferrer" href="' + esc(compareUrl(c)) + '">Похожие объявления</a>' +
          '<button class="btn btn-ghost row-text" type="button" data-text="channel">Текст для канала</button>' +
          '<button class="btn btn-ghost row-text" type="button" data-text="market">Текст для Авито</button>' +
          '<button class="btn btn-ghost row-video" type="button" data-addvideo>Добавить видео</button>' +
          '<button class="btn btn-ghost" type="button" data-autoteka="' + esc(c.autotekaUrl || '') + '">' + (c.autotekaUrl ? 'Изменить Автотеку' : 'Добавить Автотеку') + '</button>' +
          '<button class="btn btn-ghost" type="button" data-social>Посты в соцсети</button>' +
          (c.status === 'available' && !c.demo ? '<button class="btn btn-ghost" type="button" data-prepare-video>Видео для публикации</button><button class="btn btn-ghost" type="button" data-instagram-post>Пост Instagram</button><button class="btn btn-ghost" type="button" data-threads-post>Пост Threads</button>' +
            (c.videos || []).map(function (src, index) {
              return /[.]mp4$/i.test(src) ? '<button class="btn btn-ghost" type="button" data-instagram-reel="' + index +
                '">Reels · видео ' + (index + 1) + '</button><button class="btn btn-ghost" type="button" data-youtube-short="' +
                index + '">Shorts · видео ' + (index + 1) + '</button>' : '';
            }).join('') : '') +
          '<button class="btn btn-ghost row-specs" type="button" data-act="specs">' + (c.modelSpecs ? 'Справка о модели ✓' : 'Справка о модели') + '</button>' +
          (c.videos && c.videos.length ? '<button class="btn btn-ghost row-video-off" type="button" data-delvideos>Убрать видео</button>' : '') +
          '</div></div>';
      }).join('');
    }).catch(function (err) { $('cars').innerHTML = '<p class="empty">' + esc(err.message) + '</p>'; });
  }

  // Отметка как в карточке на сайте: «Отличная цена», «Хорошая цена», «Цена по рынку».
  function ratingTag(c) {
    var r = UI.rating(c);
    if (r) return '<span class="tag ok">' + esc(r.label) + '</span>';
    var est = c.marketEstimate;
    if (est) return '<span class="tag">Рынок оценён</span>';
    return c.demo ? '' : '<span class="tag">Рынок ещё не оценён</span>';
  }
  // Похожие объявления в поиске — чтобы быстро прикинуть рыночную цену.
  function compareUrl(c) {
    return 'https://yandex.ru/search/?text=' + encodeURIComponent([c.make, c.model, c.year, 'с пробегом купить Москва цена'].filter(Boolean).join(' '));
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
      patchCar(id, { price: price }, 'Цена: ' + UI.rub(price)).then(loadCars);
    }
  });
  $('cars').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches('[data-price]')) e.target.blur();
  });
  // Видео к уже опубликованной машине.
  var videoFor = null;
  $('row-video-input').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !videoFor) return;
    var row = videoFor, id = row.dataset.id, btn = row.querySelector('[data-addvideo]');
    btn.disabled = true;
    uploadVideo(file, function (pct) { btn.textContent = 'Загрузка ' + pct + '%'; })
      .then(function (data) { return api('cars/' + encodeURIComponent(id) + '/videos', { method: 'POST', json: { name: data.name } }); })
      .then(function () { toast('Видео добавлено'); loadCars(); })
      .catch(function (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Добавить видео'; });
  });
  $('cars').addEventListener('click', function (e) {
    const prepare = e.target.closest('[data-prepare-video]');
    if (prepare) {
      prepare.disabled = true;
      api('cars/' + encodeURIComponent(prepare.closest('.row').dataset.id) + '/render', { method: 'POST', json: {} })
        .then(loadRenderJobs)
        .then(() => { $('render-board').scrollIntoView({ block: 'start' }); })
        .catch(err => toast(err.message, true))
        .finally(() => { prepare.disabled = false; });
      return;
    }
    var socialButton = e.target.closest('[data-social], [data-instagram-post], [data-instagram-reel], [data-threads-post], [data-youtube-short]');
    if (socialButton) {
      var options = socialButton.hasAttribute('data-social') ? {} : { platform: socialButton.hasAttribute('data-threads-post') ? 'threads' : 'instagram' };
      if (socialButton.hasAttribute('data-instagram-reel')) options.reelIndex = Number(socialButton.dataset.instagramReel);
      if (socialButton.hasAttribute('data-youtube-short')) options = { platform: 'youtube', reelIndex: Number(socialButton.dataset.youtubeShort) };
      api('cars/' + encodeURIComponent(socialButton.closest('.row').dataset.id) + '/social', { method: 'POST', json: options })
        .then(function (d) { showSocial(d.batch); $('social-dialog').showModal(); })
        .catch(function (err) { toast(err.message, true); });
      return;
    }
    var act = e.target.closest('[data-act]');
    if (act) {
      var rowEl = act.closest('.row'), what = act.dataset.act;
      act.disabled = true;
      act.textContent = what === 'vk' ? 'Публикую…' : what === 'market' ? 'Смотрю рынок…' : 'Ищу данные…';
      api('cars/' + encodeURIComponent(rowEl.dataset.id) + '/' + what, { method: 'POST', json: {} })
        .then(function (d) {
          var r = d && d.car ? UI.rating(d.car) : null;
          toast(what === 'vk' ? 'Опубликовано в ВК' : what === 'market' ? (r ? r.label : 'Рынок оценён, цена не ниже — отметки нет') : 'Справка о модели добавлена');
          loadCars();
        })
        .catch(function (err) { toast(err.message, true); loadCars(); });
      return;
    }
    if (e.target.matches('[data-addvideo]')) { videoFor = e.target.closest('.row'); $('row-video-input').click(); return; }
    var report = e.target.closest('[data-autoteka]');
    if (report) {
      var link = prompt('Прямая ссылка на отчёт Автотеки. Пустое поле уберёт ссылку из карточки.', report.dataset.autoteka);
      if (link === null) return;
      api('cars/' + encodeURIComponent(report.closest('.row').dataset.id), { method: 'PATCH', json: { autotekaUrl: link } })
        .then(loadCars).catch(function (err) { toast(err.message, true); });
      return;
    }
    if (e.target.matches('[data-delvideos]')) {
      if (!confirm('Убрать все видео у этой машины?')) return;
      api('cars/' + encodeURIComponent(e.target.closest('.row').dataset.id) + '/videos', { method: 'DELETE' })
        .then(function () { toast('Видео убраны'); loadCars(); }).catch(function (err) { toast(err.message, true); });
      return;
    }
    if (e.target.matches('[data-text]')) {
      var id = e.target.closest('.row').dataset.id;
      var mode = e.target.dataset.text;
      api('cars/' + encodeURIComponent(id) + '/text?mode=' + mode).then(function (data) {
        var done = function () { toast(mode === 'market' ? 'Текст для Авито скопирован. Цену укажите в поле цены' : 'Текст для канала скопирован'); };
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
  $('market-all').addEventListener('click', function () {
    var btn = $('market-all');
    btn.disabled = true;
    api('market/all', { method: 'POST', json: {} })
      .then(function (d) { toast('Оцениваю рынок для ' + d.queued + ' ' + UI.plural(d.queued, 'машины', 'машин', 'машин') + ' — по минуте на машину. Обновите список позже.'); })
      .catch(function (err) { toast(err.message, true); })
      .then(function () { btn.disabled = false; });
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
    if (l.car && l.car.status === 'reserved') lines.push('Сообщить, если снимут бронь');
    if (l.sellVehicle) lines.push('Машина со слов владельца: ' + l.sellVehicle);
    if (l.sellCar) {
      var c = l.sellCar;
      lines.push(c.make + ' ' + c.model + ', ' + c.year + (c.mileage != null ? ', ' + UI.num(c.mileage) + ' км' : '') +
        (c.condition ? '\nСостояние: ' + c.condition : '') + (c.desiredPrice ? '\nХочет: ' + UI.rub(c.desiredPrice) : ''));
    }
    if (l.credit) {
      var c2 = l.credit;
      var emp = { hired: 'работает по найму', business: 'ИП или свой бизнес', self: 'самозанятый', pension: 'пенсионер', other: 'другое' };
      if (!l.car) lines.push('Машину ещё не выбрал — подобрать');
      lines.push('Первый взнос: ' + (c2.downPayment ? UI.rub(c2.downPayment) : 'нет или не указан'));
      if (c2.termMonths) lines.push('Срок: ' + c2.termMonths + ' мес.');
      if (c2.income) lines.push('Доход в месяц: ' + UI.rub(c2.income));
      if (c2.employment) lines.push('Занятость: ' + (emp[c2.employment] || c2.employment));
      if (c2.birthDate) lines.push('Дата рождения: ' + c2.birthDate.split('-').reverse().join('.'));
    }
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
      var type = $('lead-type-filter').value;
      if (type) leads = leads.filter(function (l) { return l.type === type; });
      var wins = leads.filter(function (l) { return l.stage === 'won'; });
      var withMargin = wins.filter(function (l) { return Number.isSafeInteger(l.margin); });
      $('lead-summary').textContent = 'Заявок ' + leads.length + ' · Осмотры назначены ' +
        leads.filter(function (l) { return l.stage === 'booked'; }).length + ' · Сделок ' + wins.length +
        (withMargin.length ? ' · Маржа по ' + withMargin.length + ' ' + UI.plural(withMargin.length, 'сделке', 'сделкам', 'сделкам') + ' ' +
          UI.num(withMargin.reduce(function (sum, lead) { return sum + lead.margin; }, 0)) + ' ₽' : '');
      if (!leads.length) { $('leads').innerHTML = '<p class="empty">По этому фильтру заявок пока нет.</p>'; return; }
      $('leads').innerHTML = leads.map(function (l) {
        var where = { telegram: 'Telegram', max: 'MAX', web: 'сайт' }[l.platform] || 'сайт';
        var entry = { 'homepage-buyout': 'Главная', 'service-buyout': 'Страница выкупа', 'web-car': 'Карточка на сайте',
          'app-car': 'Карточка в каталоге', 'app-buyout': 'Выкуп в каталоге' }[l.entryPoint];
        return '<div class="lead' + (l.done ? ' is-done' : '') + '" data-id="' + esc(l.id) + '">' +
          '<div class="lead-head"><span>' + esc([when(l.at), where, entry, l.utmSource, l.utmContent].filter(Boolean).join(' · ')) + '</span></div>' +
          '<span class="lead-what">' + esc(LEAD_TYPES[l.type] || 'Заявка') + ' · ' + esc(l.phone) + '</span>' +
          '<div class="lead-body">' + esc(leadBody(l)) + '</div>' +
          (l.photos || []).map(function (name, i) {
            return '<a target="_blank" rel="noopener" href="api/leads/' + esc(l.id) + '/photos/' + esc(name) + '">Фото ' + (i + 1) + '</a>';
          }).join('') +
          '<form class="lead-stage">' +
          '<label class="field"><span>Этап</span><select name="stage">' + Object.entries(data.stages).map(function ([value, label]) {
            return '<option value="' + esc(value) + '"' + (value === l.stage ? ' selected' : '') + '>' + esc(label) + '</option>';
          }).join('') + '</select></label>' +
          (l.type === 'sell' ? '<label class="field"><span>Предложение, ₽</span><input name="offer" type="number" min="0" step="1" value="' + esc(l.offer ?? '') + '"></label>' : '') +
          (l.type === 'sell' || l.type === 'buy' ? '<label class="field"><span>Маржа сделки, ₽</span><input name="margin" type="number" step="1" value="' + esc(l.margin ?? '') + '"></label>' : '') +
          '<div class="lead-tools">' +
          '<a class="btn btn-primary" href="tel:' + esc(l.phone) + '">Позвонить</a>' +
          '<button class="btn btn-ghost" type="submit">Сохранить</button>' +
          '</div></form></div>';
      }).join('');
    }).catch(function (err) { $('leads').innerHTML = '<p class="empty">' + esc(err.message) + '</p>'; });
  }

  $('lead-type-filter').addEventListener('change', loadLeads);
  $('leads').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var id = form.closest('.lead').dataset.id;
    var fields = new FormData(form);
    var amount = function (key) { return fields.get(key) ? Number(fields.get(key)) : null; };
    var btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    api('leads/' + id, { method: 'PATCH', json: { stage: fields.get('stage'), offer: amount('offer'), margin: amount('margin') } })
      .then(function () { toast('Заявка обновлена'); loadLeads(); })
      .catch(function (err) { toast(err.message, true); })
      .finally(function () { btn.disabled = false; });
  });

  // Новые заявки подтягиваются сами, пока вкладка открыта.
  setInterval(function () {
    if (!$('app').hidden && document.visibilityState === 'visible' && !$('leads').contains(document.activeElement)) loadLeads();
  }, 60000);

  var socialLabels = { draft: 'Ждёт подтверждения', queued: 'В очереди', sending: 'Отправляется', posted: 'Опубликовано', retry: 'Повтор запланирован', failed: 'Ошибка', blocked: 'Нужна проверка', review: 'Сверить с площадкой' };
  var publicationGroups = { queue: ['queued', 'sending', 'retry'], draft: ['draft'], posted: ['posted'], attention: ['failed', 'blocked', 'review'] };
  var moscowDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' });
  var publicationBatches = [];

  function canCancelSchedule(batch) {
    return batch.scheduledAt && Date.parse(batch.scheduledAt) > Date.now() && batch.jobs.some(function (job) { return job.status === 'queued'; });
  }

  function publicationState(batch, job) {
    if (job.status === 'queued' && canCancelSchedule(batch)) return 'Запланировано · ' + moscowDate.format(new Date(batch.scheduledAt)) + ' МСК';
    var date = job.status === 'posted' ? job.postedAt : job.status === 'retry' ? job.nextAt : null;
    var label = job.status === 'posted' && (job.privacyStatus || job.receipt?.privacyStatus) === 'private'
      ? 'Загружено приватно' : socialLabels[job.status] || job.status;
    return label + (date ? ' · ' + moscowDate.format(new Date(date)) + ' МСК' : '');
  }

  function renderPublications() {
    var group = publicationGroups[$('publication-filter').value];
    var visible = publicationBatches.filter(function (batch) {
      return !group || batch.jobs.some(function (job) { return group.includes(job.status); });
    }).sort(function (a, b) {
      var aDue = canCancelSchedule(a) ? Date.parse(a.scheduledAt) : Infinity;
      var bDue = canCancelSchedule(b) ? Date.parse(b.scheduledAt) : Infinity;
      return aDue === bDue ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : aDue - bDue;
    });
    $('publication-list').innerHTML = visible.length ? visible.map(function (batch) {
      return '<article class="publication-card"><div class="publication-heading"><div><span class="hint">' +
        (batch.kind === 'video' ? 'Ролик' : 'Объявление') + ' · №' + esc(batch.carId) + '</span><h3>' +
        esc(batch.title || 'Машина №' + batch.carId) + '</h3></div><button class="btn" type="button" data-publication="' +
        esc(batch.id) + '">Подробнее</button></div><ul>' + batch.jobs.map(function (job) {
          var url = /^https:\/\//.test(job.url || '') ? '<a href="' + esc(job.url) + '" target="_blank" rel="noopener noreferrer">Открыть пост</a>' : '';
          return '<li><strong>' + esc(job.name) + '</strong><span class="publication-state" data-state="' + esc(job.status) + '">' +
            esc(publicationState(batch, job)) + '</span>' + url + (job.error ? '<span class="err">' + esc(job.error) + '</span>' : '') + '</li>';
        }).join('') + '</ul></article>';
    }).join('') : '<p class="hint publication-empty">' + (group ? 'Нет публикаций с этим статусом.' : 'Откройте «Машины» и создайте предпросмотр поста.') + '</p>';
  }

  function loadPublications() {
    return api('social').then(function (data) {
      publicationBatches = data.batches;
      $('publication-error').textContent = '';
      $('publication-channels').textContent = data.channels.length ? 'Подключены: ' + data.channels.map(function (channel) { return channel.name; }).join(', ') : 'Подключите площадки в настройках.';
      renderPublications();
    }).catch(function (err) { $('publication-error').textContent = err.message; });
  }

  $('publication-filter').addEventListener('change', renderPublications);
  $('publication-refresh').addEventListener('click', loadPublications);
  $('publication-list').addEventListener('click', function (event) {
    var button = event.target.closest('[data-publication]');
    if (!button) return;
    api('social/' + button.dataset.publication).then(function (data) {
      showSocial(data.batch);
      if (!$('social-dialog').open) $('social-dialog').showModal();
    }).catch(function (err) { $('publication-error').textContent = err.message; });
  });
  setInterval(function () {
    if (!$('app').hidden && !document.querySelector('[data-pane="publications"]').hidden && document.visibilityState === 'visible') loadPublications();
  }, 15000);

  var socialBatch = null;
  function socialText(payload) {
    if (!payload.entities) return esc(payload.text);
    var cursor = 0;
    var html = payload.entities.map(function (entity) {
      var before = esc(payload.text.slice(cursor, entity.offset));
      cursor = entity.offset + entity.length;
      var text = esc(payload.text.slice(entity.offset, cursor));
      if (entity.type === 'bold') return before + '<strong>' + text + '</strong>';
      if (entity.type === 'text_link' && /^https:\/\//.test(entity.url)) {
        return before + '<a href="' + esc(entity.url) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
      }
      return before + text;
    }).join('');
    return html + esc(payload.text.slice(cursor));
  }
  function showSocial(batch) {
    if (!socialBatch || socialBatch.id !== batch.id || batch.approved) $('social-date').value = '';
    socialBatch = batch;
    $('social-error').textContent = '';
    $('social-preview').innerHTML = batch.jobs.map(function (job) {
      var photos = job.payload.photos || (job.payload.photo ? [job.payload.photo] : []);
      return '<section><h3>' + esc(job.name) + '</h3><p>' + esc(publicationState(batch, job)) +
        (job.payload.privacyStatus ? ' · видимость: ' + esc({ public: 'публично', unlisted: 'по ссылке', private: 'только владелец' }[job.payload.privacyStatus] || job.payload.privacyStatus) : '') + '</p>' +
        (job.payload.video && /^https:\/\//.test(job.payload.video.url || '') ? '<video controls preload="metadata" src="' + esc(job.payload.video.url) + '"></video>' : '') +
        (job.key.startsWith('youtube:') ? '<p class="hint">Для Shorts нужен вертикальный или квадратный ролик до 3 минут.</p><strong>' + esc(job.payload.title) + '</strong>' : '') +
        '<p class="social-text">' + socialText(job.payload) + '</p>' +
        '<div class="social-photos">' + photos.map(function (src) {
          var url = /^https:\/\//.test(src) ? src : '../' + src;
          return '<img src="' + esc(url) + '" alt="Фото машины">';
        }).join('') + '</div>' +
        (job.error ? '<p class="err">' + esc(job.error) + '</p>' : '') +
        (job.receipt && /^https:\/\//.test(job.receipt.url || '') ? '<a href="' + esc(job.receipt.url) + '" target="_blank" rel="noopener noreferrer">Открыть публикацию</a>' : '') + '</section>';
    }).join('');
    var canApprove = !batch.approved && batch.jobs.some(function (job) { return job.status === 'draft'; });
    $('social-approve').hidden = !canApprove;
    $('social-approve').textContent = batch.jobs.length === 1
      ? (batch.jobs[0].key.startsWith('youtube:') ? 'Загрузить приватно на YouTube' : 'Опубликовать в ' + batch.jobs[0].name)
      : 'Опубликовать во всех каналах';
    $('social-schedule').hidden = !canApprove;
    $('social-cancel-schedule').hidden = !canCancelSchedule(batch);
    $('social-retry').hidden = !batch.jobs.some(function (j) { return !j.preparationFailed && ['retry', 'failed', 'blocked'].includes(j.status); });
  }
  function socialRequest(action, options) {
    if (!socialBatch) return;
    var buttons = ['social-approve', 'social-retry', 'social-schedule-submit', 'social-cancel-schedule', 'social-refresh'];
    buttons.forEach(function (id) { $(id).disabled = true; });
    api('social/' + socialBatch.id + (action ? '/' + action : ''), action ? { method: 'POST', json: options || {} } : {})
      .then(function (d) {
        showSocial(d.batch);
        if (!document.querySelector('[data-pane="publications"]').hidden) loadPublications();
      })
      .catch(function (err) { $('social-error').textContent = err.message; })
      .then(function () { buttons.forEach(function (id) { $(id).disabled = false; }); });
  }
  $('social-approve').addEventListener('click', function () { socialRequest('approve'); });
  $('social-schedule-submit').addEventListener('click', function () {
    var date = $('social-date').value;
    if (!date) { $('social-error').textContent = 'Выберите дату и время по Москве.'; return; }
    socialRequest('approve', { scheduledAt: date + ':00+03:00' });
  });
  $('social-cancel-schedule').addEventListener('click', function () { socialRequest('cancel-schedule'); });
  $('social-retry').addEventListener('click', function () { socialRequest('retry'); });
  $('social-refresh').addEventListener('click', function () { socialRequest(''); });
  $('social-close').addEventListener('click', function () { $('social-dialog').close(); });

  /* ---------- ВКонтакте ---------- */
  function showVk(d) {
    if (!d.available) { $('vk-block').hidden = true; return; }
    $('vk-status').classList.toggle('ok', !!d.connected);
    $('vk-status').classList.toggle('off', !d.connected);
    $('vk-status').textContent = d.connected
      ? 'Подключено: ' + (d.groupName || 'группа ' + d.groupId) + (d.renewable ? ' · ключ обновляется сам' : '')
      : 'Не подключено.';
    $('vk-auto-row').hidden = true;
    $('vk-auto').checked = !!d.auto;
    $('vk-off').hidden = !d.connected;
    if (d.redirectUri) $('vk-redirect').textContent = d.redirectUri;
    if (d.clientId && !$('vk-client').value) $('vk-client').value = d.clientId;
  }
  function loadVk() { api('vk').then(showVk).catch(function (err) { $('vk-status').textContent = err.message; }); }
  $('vk-form').addEventListener('submit', function (e) {
    e.preventDefault();
    $('vk-err').textContent = '';
    api('vk/connect', { method: 'POST', json: { clientId: $('vk-client').value, group: $('vk-group').value } })
      .then(function (d) { location.href = d.url; })
      .catch(function (err) { $('vk-err').textContent = err.message; });
  });
  $('vk-token-save').addEventListener('click', function () {
    $('vk-err').textContent = '';
    api('vk/token', { method: 'POST', json: { token: $('vk-token').value, group: $('vk-group').value } })
      .then(function (d) { $('vk-token').value = ''; showVk(Object.assign({ available: true }, d)); toast('ВКонтакте подключён'); })
      .catch(function (err) { $('vk-err').textContent = err.message; });
  });
  $('vk-auto').addEventListener('change', function () {
    api('vk/auto', { method: 'POST', json: { on: $('vk-auto').checked } })
      .then(function () { toast($('vk-auto').checked ? 'Новые машины будут публиковаться в ВК' : 'Автопостинг в ВК выключен'); })
      .catch(function (err) { toast(err.message, true); });
  });
  $('vk-off').addEventListener('click', function () {
    if (!confirm('Отключить ВКонтакте? Ключ доступа будет удалён с сервера.')) return;
    api('vk', { method: 'DELETE' }).then(function (d) { showVk(Object.assign({ available: true }, d)); }).catch(function (err) { toast(err.message, true); });
  });

  /* ---------- Telegram ---------- */
  function loadTg() {
    api('telegram').then(function (d) {
      $('tg-status').classList.toggle('ok', !!d.bot);
      $('tg-status').classList.toggle('off', !d.bot);
      $('tg-status').textContent = d.bot ? 'Подключён: @' + d.bot + ' · токен ' + d.tokenEnd : 'Бот ещё не подключён через админку.';
      if (!$('tg-base').value) $('tg-base').value = d.apiBase || '';
      if (!$('tg-ids').value) $('tg-ids').value = d.ids || '';
      $('tg-channel').value = d.postTelegramChannel || '';
      $('tg-token').placeholder = d.tokenEnd ? 'Токен уже есть (' + d.tokenEnd + ') — можно не вставлять' : '123456789:AA…';
    }).catch(function (err) { $('tg-status').textContent = err.message; });
  }
  $('tg-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Проверяю связь с Telegram…';
    $('tg-err').textContent = '';
    api('telegram', { method: 'POST', json: { apiBase: $('tg-base').value, token: $('tg-token').value, ids: $('tg-ids').value, postTelegramChannel: $('tg-channel').value } })
      .then(function (d) {
        $('tg-token').value = '';
        toast('Бот @' + d.bot + ' подключён. Сервер перезапускается — 10 секунд.');
        $('tg-status').classList.add('ok'); $('tg-status').classList.remove('off');
        $('tg-status').textContent = 'Подключён: @' + d.bot + '. Напишите боту /list — он должен ответить.';
      })
      .catch(function (err) { $('tg-err').textContent = err.message; })
      .then(function () { btn.disabled = false; btn.textContent = 'Подключить бота'; });
  });

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
    api('llm', { method: 'POST', json: { key: $('llm-key').value, base: $('llm-base').value, model: $('llm-model').value } })
      .then(function (data) {
        $('llm-key').value = '';
        showLlm(data);
        var s = data.sample || {};
        $('llm-result').textContent = 'Проверка: «мерс ешка 2017, 98т.км, 2 млн 650» → ' +
          [s.make, s.model, s.year, s.mileage != null ? UI.num(s.mileage) + ' км' : '', s.price ? UI.rub(s.price) : ''].filter(Boolean).join(', ') +
          (data.vision ? '. Фото: понимает.' : '. Фото: модель не приняла фото' + (data.visionError ? ' (' + data.visionError + ')' : '') + ' — марку и модель придётся писать в тексте.');
        toast('Нейросеть подключена');
      })
      .catch(function (err) { $('llm-err').textContent = err.message + (err.details && err.details.length ? '\n' + err.details.join('\n') : ''); })
      .then(function () { btn.disabled = false; btn.textContent = 'Сохранить и проверить'; });
  });
  $('llm-off').addEventListener('click', function () {
    if (!confirm('Выключить нейросеть? Объявления будут разбираться обычным способом.')) return;
    api('llm', { method: 'DELETE' }).then(function (data) { showLlm(data); $('llm-result').textContent = ''; }).catch(function (err) { toast(err.message, true); });
  });

  function showMetaAccount(platform, data) {
    const name = platform === 'instagram' ? 'Instagram' : 'Threads';
    $(platform + '-status').textContent = data.connected ? 'Подключён @' + data.username : name + ' не подключён';
  }
  function loadMetaAccount(platform) {
    api(platform).then(data => showMetaAccount(platform, data))
      .catch(err => { $(platform + '-error').textContent = err.message; });
  }
  ['instagram', 'threads'].forEach(platform => {
    $(platform + '-connect').addEventListener('submit', function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button');
      const date = $(platform + '-expiry').value;
      button.disabled = true;
      $(platform + '-error').textContent = '';
      api(platform, { method: 'POST', json: { accessToken: $(platform + '-token').value, expiresAt: date || undefined } })
        .then(data => { form.reset(); showMetaAccount(platform, data); })
        .catch(err => { $(platform + '-error').textContent = err.message; })
        .finally(() => { button.disabled = false; });
    });
  });

  let renderTimer;
  function loadRenderJobs() {
    clearTimeout(renderTimer);
    return api('render').then(data => {
      $('render-board').hidden = !data.jobs.length;
      const labels = { queued: 'Ждёт компьютер с DaVinci', rendering: 'Монтируется', failed: 'Ошибка, запланирован повтор', blocked: 'Нужна проверка', ready: 'Готов' };
      $('render-jobs').innerHTML = data.jobs.slice(-20).reverse().map(job => {
        const actions = job.status === 'ready' && /^\/api\/social\/video\/[a-f0-9]{32}\.mp4$/.test(job.result?.publicUrl)
          ? '<a class="btn" target="_blank" rel="noopener noreferrer" href="' + esc(job.result.publicUrl) + '">Открыть MP4</a> ' +
            '<button class="btn" type="button" data-render-platform="instagram">Предпросмотр Reels</button> ' +
            '<button class="btn" type="button" data-render-platform="youtube">Предпросмотр Shorts</button>'
          : ['failed', 'blocked'].includes(job.status) ? '<button class="btn" type="button" data-render-retry>Повторить</button>' : '';
        return '<section data-render-id="' + esc(job.id) + '"><h3>' + esc(job.storyboard.title) + '</h3><p>' +
          esc(labels[job.status] || job.status) + (job.error ? ' · ' + esc(job.error) : '') + '</p>' + actions + '</section>';
      }).join('');
      if (!document.querySelector('[data-pane="cars"]').hidden && data.jobs.some(job => ['queued', 'rendering', 'failed'].includes(job.status))) {
        renderTimer = setTimeout(loadRenderJobs, 8000);
      }
    }).catch(err => toast(err.message, true));
  }
  $('render-refresh').addEventListener('click', loadRenderJobs);
  $('render-jobs').addEventListener('click', event => {
    const button = event.target.closest('[data-render-platform], [data-render-retry]');
    if (!button) return;
    const id = button.closest('[data-render-id]').dataset.renderId;
    const platform = button.dataset.renderPlatform;
    button.disabled = true;
    api('render/' + id + (platform ? '/social' : '/retry'), { method: 'POST', json: { platform } })
      .then(data => {
        if (platform) { showSocial(data.batch); $('social-dialog').showModal(); }
        else loadRenderJobs();
      })
      .catch(err => toast(err.message, true))
      .finally(() => { button.disabled = false; });
  });
  $('render-worker-copy').addEventListener('click', event => {
    const button = event.currentTarget;
    button.disabled = true;
    api('render/worker', { method: 'POST', json: {} })
      .then(data => navigator.clipboard.writeText(data.token))
      .then(() => { $('render-worker-status').textContent = 'Ключ скопирован. Вставьте его в окно запуска DaVinci.'; })
      .catch(err => { $('render-worker-status').textContent = err.message; })
      .finally(() => { button.disabled = false; });
  });
  function loadYouTube() {
    api('youtube').then(data => {
      $('youtube-status').textContent = data.connected ? 'Подключён ' + data.title + ' · ' + data.channelId : 'Канал YouTube не подключён';
    }).catch(err => { $('youtube-error').textContent = err.message; });
  }
  $('youtube-diagnose').addEventListener('click', function (event) {
    const button = event.currentTarget;
    const result = $('youtube-diagnose-result');
    button.disabled = true;
    result.textContent = 'Проверяем связь с сервера…';
    api('youtube/diagnose', { method: 'POST', json: {} })
      .then(data => { result.textContent = data.checks.map(check => check.name + ' — ' + check.result).join(' '); })
      .catch(err => { result.textContent = err.message; })
      .finally(() => { button.disabled = false; });
  });
  $('youtube-connect').addEventListener('submit', function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    $('youtube-error').textContent = '';
    api('youtube', { method: 'POST', json: {
      clientId: $('youtube-client').value, clientSecret: $('youtube-secret').value, channelId: $('youtube-channel').value
    } }).then(data => { form.reset(); location.assign(data.url); })
      .catch(err => { $('youtube-error').textContent = err.message; })
      .finally(() => { button.disabled = false; });
  });

  var crm = window.AndoCRM({ api: api, openBatch: function (batch) {
    showSocial(batch);
    $('social-dialog').showModal();
  } });
  $('social-dialog').addEventListener('close', function () {
    if (!document.querySelector('[data-pane="crm"]').hidden) crm.load();
  });
  /* ---------- старт ---------- */
  UI.bindSlides($('preview'));
  api('status').then(function (data) { if (data.authed) showApp(); else showLogin(); }).catch(showLogin);
})();
