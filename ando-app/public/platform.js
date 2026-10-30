/* Слой над Telegram WebApp и MAX Bridge: одно API для приложения.
   Скрипт мессенджера грузится только внутри него; в браузере приложение работает как сайт. */
(function () {
  'use strict';

  var SDK_URL = {
    telegram: 'https://telegram.org/js/telegram-web-app.js',
    max: 'https://st.max.ru/js/max-web-app.js'
  };
  // Параметры запуска, которые мессенджер кладёт в хеш адреса.
  var HASH = {
    telegram: { data: 'tgWebAppData', start: 'tgWebAppStartParam' },
    max: { data: 'WebAppData', start: 'WebAppStartParam' }
  };
  var MAX_SERVICE_KEYS = ['WebAppData', 'WebAppPlatform', 'WebAppVersion', 'WebAppDeviceName', 'WebAppStartParam'];
  var LINK_HOSTS = { telegram: ['t.me', 'telegram.me'], max: ['max.ru'] };

  function session(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem('ando:' + key);
      sessionStorage.setItem('ando:' + key, value);
    } catch (e) { /* хранилище недоступно — работаем без него */ }
    return null;
  }

  function currentHash() { return location.hash.replace(/^#/, ''); }

  function clientOfHash(hash) {
    if (/(?:^|&)tgWebApp(?:Data|Platform)=/.test(hash)) return 'telegram';
    if (/(?:^|&)WebAppData=/.test(hash)) return 'max';
    return null;
  }

  function isComplete(raw) {
    if (!raw) return false;
    var params = new URLSearchParams(raw);
    return !!(params.get('hash') && params.get('auth_date'));
  }

  function initDataFromHash(hash, client) {
    if (!hash) return '';
    var params = new URLSearchParams(hash);
    if (client === 'telegram') {
      var tg = params.get(HASH.telegram.data);
      return isComplete(tg) ? tg : '';
    }
    var nested = params.get(HASH.max.data);
    if (isComplete(nested)) return nested;
    // MAX может положить поля initData в хеш без вложенного кодирования.
    var marker = HASH.max.data + '=';
    var start = hash.indexOf(marker);
    var flat = new URLSearchParams(start === -1 ? hash : hash.slice(start + marker.length));
    var fields = new URLSearchParams();
    flat.forEach(function (value, key) {
      if (key && MAX_SERVICE_KEYS.indexOf(key) === -1) fields.append(key, value);
    });
    var raw = fields.toString();
    return isComplete(raw) ? raw : '';
  }

  // Вызов метода SDK: синхронная ошибка или отклонённый промис (MAX в браузере) не роняют приложение.
  function call(fn) {
    try {
      var result = fn();
      if (result && typeof result.catch === 'function') result.catch(function () {});
      return result;
    } catch (e) {
      return undefined;
    }
  }

  function loadScript(url, timeoutMs) {
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      var timer = setTimeout(function () { resolve(false); }, timeoutMs);
      script.src = url;
      script.async = true;
      script.onload = function () { clearTimeout(timer); resolve(true); };
      script.onerror = function () { clearTimeout(timer); resolve(false); };
      document.head.appendChild(script);
    });
  }

  function hostOf(url) {
    try { return new URL(url, location.href).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // ---------- Определение клиента: до первой отрисовки ----------
  var launchHash = currentHash();
  if (clientOfHash(launchHash)) session('hash', launchHash);
  else launchHash = session('hash') || '';

  var client = clientOfHash(launchHash) || 'web';
  var root = document.documentElement;
  root.classList.add('in-' + client);

  var sdk = null;
  var initData = '';
  var startParam = null;
  var backHandler = null;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  // Тема системы — сразу, до загрузки SDK: тёмная тема не мигает светлым фоном.
  if (client !== 'telegram') root.setAttribute('data-scheme', media && media.matches ? 'dark' : 'light');

  function applySystemScheme() {
    root.setAttribute('data-scheme', media && media.matches ? 'dark' : 'light');
  }

  function applyTelegramTheme() {
    root.setAttribute('data-scheme', sdk.colorScheme === 'dark' ? 'dark' : 'light');
    call(function () { return sdk.setHeaderColor('secondary_bg_color'); });
    call(function () { return sdk.setBackgroundColor('secondary_bg_color'); });
  }

  function claimStartParam(value, launchId) {
    if (!value) return null;
    var claim = launchId + '|' + value;
    if (session('start-claimed') === claim) return null; // перезагрузка не уводит обратно на страницу ссылки
    session('start-claimed', claim);
    return value;
  }

  function init() {
    if (client === 'web') {
      applySystemScheme();
      if (media && media.addEventListener) media.addEventListener('change', applySystemScheme);
      var car = new URLSearchParams(location.search).get('car');
      startParam = car ? 'car_' + car : null;
      return Promise.resolve(api);
    }
    return loadScript(SDK_URL[client], 5000).then(function () {
      sdk = client === 'telegram' ? (window.Telegram && window.Telegram.WebApp) : window.WebApp;
      var candidates = [
        sdk && sdk.initData,
        initDataFromHash(currentHash(), client),
        initDataFromHash(launchHash, client),
        session('init:' + client)
      ];
      for (var i = 0; i < candidates.length; i++) {
        if (isComplete(candidates[i])) { initData = candidates[i]; break; }
      }
      if (initData) session('init:' + client, initData);

      var unsafe = (sdk && sdk.initDataUnsafe) || {};
      var rawStart = unsafe.start_param || new URLSearchParams(launchHash).get(HASH[client].start);
      startParam = claimStartParam(rawStart, new URLSearchParams(initData).get('auth_date') || launchHash.length);

      if (client === 'telegram' && sdk) {
        applyTelegramTheme();
        call(function () { return sdk.onEvent('themeChanged', applyTelegramTheme); });
        call(function () { return sdk.expand(); });
        // Свайп вниз по длинному списку не должен сворачивать приложение (Telegram 7.7+).
        call(function () { if (sdk.isVersionAtLeast && sdk.isVersionAtLeast('7.7')) sdk.disableVerticalSwipes(); });
      } else {
        // У MAX нет своей темы: вебвью следует системной.
        applySystemScheme();
        if (media && media.addEventListener) media.addEventListener('change', applySystemScheme);
      }
      if (sdk) call(function () { return sdk.ready(); });
      return api;
    });
  }

  var api = {
    init: init,
    get client() { return client; },
    get isMiniApp() { return client !== 'web'; },
    get initData() { return initData; },
    get startParam() { return startParam; },
    get user() {
      var unsafe = sdk && sdk.initDataUnsafe;
      if (unsafe && unsafe.user) return unsafe.user;
      try { return JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch (e) { return null; }
    },

    headers: function () {
      if (!initData) return {};
      return client === 'telegram' ? { 'X-Telegram-Init-Data': initData } : { 'X-Max-Init-Data': initData };
    },

    haptic: function (kind) {
      var h = sdk && sdk.HapticFeedback;
      if (!h) return;
      if (kind === 'success' || kind === 'error') call(function () { return h.notificationOccurred(kind); });
      else if (kind === 'select') call(function () { return h.selectionChanged(); });
      else call(function () { return h.impactOccurred('light'); });
    },

    // Кнопка «Назад» мессенджера; null — скрыть.
    setBack: function (handler) {
      var bb = sdk && sdk.BackButton;
      if (bb && backHandler) {
        var previous = backHandler;
        call(function () { return bb.offClick(previous); });
      }
      backHandler = handler || null;
      if (!bb) return;
      if (handler) {
        call(function () { return bb.onClick(handler); });
        call(function () { return bb.show(); });
      } else {
        call(function () { return bb.hide(); });
      }
    },

    openLink: function (url) {
      var host = hostOf(url);
      if (client === 'telegram' && sdk) {
        if (LINK_HOSTS.telegram.indexOf(host) !== -1 && sdk.openTelegramLink) return call(function () { return sdk.openTelegramLink(url); });
        return call(function () { return sdk.openLink(url); });
      }
      if (client === 'max' && sdk) {
        if (LINK_HOSTS.max.indexOf(host) !== -1 && sdk.openMaxLink) return call(function () { return sdk.openMaxLink(url); });
        return call(function () { return sdk.openLink(url); });
      }
      window.open(url, '_blank', 'noopener');
    },

    // Поделиться ссылкой: в Telegram — родной выбор чата, иначе системное меню или буфер обмена.
    share: function (text, url) {
      if (client === 'telegram' && sdk && sdk.openTelegramLink) {
        call(function () {
          sdk.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text));
        });
        return Promise.resolve('shared');
      }
      if (navigator.share) {
        return navigator.share({ title: text, text: text, url: url }).then(function () { return 'shared'; }, function () { return 'cancelled'; });
      }
      return api.copy(text + '\n' + url).then(function (ok) { return ok ? 'copied' : 'failed'; });
    },

    copy: function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
      }
      return Promise.resolve(false);
    }
  };

  window.AndoPlatform = api;
})();
