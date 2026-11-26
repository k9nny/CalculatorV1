(function () {
  'use strict';
  var scriptUrl = document.currentScript.src;
  var choiceKey = 'ando:analytics-choice';
  var lifetime = 180 * 86400000;
  var panel, current, activeCounter = null, choiceRevision = 0;
  var styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = new URL('analytics.css?v=1', scriptUrl);
  document.head.appendChild(styles);

  function storedChoice() {
    try { return JSON.parse(localStorage.getItem(choiceKey)); } catch { return null; }
  }

  function saveChoice(choice) {
    current = choice;
    try { localStorage.setItem(choiceKey, JSON.stringify(choice)); } catch { /* До закрытия страницы. */ }
  }

  function validChoice(choice, settings) {
    return choice && choice.version === settings.consentVersion && choice.expiresAt > Date.now() &&
      (choice.state === 'necessary' || (choice.state === 'accepted' && /^[a-f0-9]{32}$/.test(choice.receipt)));
  }

  function record(settings, decision, receipt) {
    return fetch(new URL('api/analytics-choice', scriptUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: settings.consentVersion, decision: decision, receipt: receipt }),
      keepalive: true
    }).then(function (response) {
      if (!response.ok) throw new Error('Не удалось сохранить выбор.');
      return response.json();
    });
  }

  function start(settings) {
    if (!settings.metrikaCounter || !validChoice(current, settings) || !current.receipt ||
      current.state !== 'accepted' || activeCounter) return;
    var id = settings.metrikaCounter;
    window['disableYaCounter' + id] = false;
    if (!window.ym) {
      window.ym = function () { (window.ym.a = window.ym.a || []).push(arguments); };
      window.ym.l = Date.now();
      var tag = document.createElement('script');
      tag.async = true;
      tag.src = 'https://mc.yandex.ru/metrika/tag.js';
      document.head.appendChild(tag);
    }
    window.ym(id, 'init', { webvisor: false, clickmap: false, trackLinks: false });
    activeCounter = id;
  }

  function stop() {
    if (!activeCounter) return;
    window['disableYaCounter' + activeCounter] = true;
    window.ym(activeCounter, 'destruct');
    activeCounter = null;
    document.cookie.split(';').map(function (cookie) { return cookie.trim().split('=')[0]; })
      .filter(function (key) { return /^_ym_[\w-]+$/.test(key); }).forEach(function (key) {
        document.cookie = key + '=; Max-Age=0; Path=/';
        if (/(^|\.)andoauto\.ru$/.test(location.hostname)) {
          document.cookie = key + '=; Max-Age=0; Path=/; Domain=andoauto.ru';
        }
      });
    try {
      Object.keys(localStorage).filter(function (key) { return /^(?:_ym_|ymex$)/.test(key); })
        .forEach(function (key) { localStorage.removeItem(key); });
    } catch { /* Хранилище может быть недоступно. */ }
  }

  function show(settings, trigger) {
    if (panel) panel.remove();
    panel = document.createElement('section');
    panel.className = 'ando-cookie-panel';
    panel.setAttribute('aria-labelledby', 'ando-cookie-title');
    panel.innerHTML = '<h2 id="ando-cookie-title">Настройки cookies</h2>' +
      '<p></p><p><a>Политика обработки данных</a></p><div class="ando-cookie-actions">' +
      '<button type="button" data-choice="necessary">Только необходимые</button>' +
      '<button type="button" data-choice="accepted">Разрешить аналитику</button></div>' +
      '<p class="ando-cookie-status" role="status"></p>';
    panel.querySelector('p').textContent = settings.metrikaCounter
      ? 'С вашего согласия Яндекс Метрика будет собирать статистику посещений. Каталог и заявки работают при любом выборе.'
      : 'Аналитика сейчас выключена. Браузер может сохранять настройки и избранное.';
    panel.querySelector('a').href = new URL('../privacy.html#analytics', scriptUrl);
    var allow = panel.querySelector('[data-choice="accepted"]');
    var status = panel.querySelector('[role="status"]');
    allow.hidden = !settings.metrikaCounter;
    if (validChoice(current, settings)) status.textContent = current.state === 'accepted' && settings.metrikaCounter
      ? 'Аналитика разрешена.' : 'Аналитика выключена.';
    var view = panel;
    view.addEventListener('click', async function (event) {
      var button = event.target.closest('[data-choice]');
      if (!button) return;
      var state = button.dataset.choice;
      var receipt = current && current.receipt;
      var revision = ++choiceRevision;
      if (state === 'accepted') {
        if (!validChoice(current, settings) || current.state !== 'accepted') {
          var buttons = Array.from(view.querySelectorAll('button'));
          buttons.forEach(function (item) { item.disabled = true; });
          try { receipt = (await record(settings, 'accepted')).receipt; }
          catch {
            status.textContent = 'Выбор пока не сохранён. Аналитика выключена.';
            buttons.forEach(function (item) { item.disabled = false; });
            return;
          }
          if (revision !== choiceRevision) {
            record(settings, 'withdrawn', receipt).catch(function () {});
            return;
          }
          saveChoice({ state: state, version: settings.consentVersion, expiresAt: Date.now() + lifetime, receipt: receipt });
        }
        start(settings);
      } else {
        saveChoice({ state: state, version: settings.consentVersion, expiresAt: Date.now() + lifetime });
        stop();
        if (receipt) record(settings, 'withdrawn', receipt).catch(function () {});
      }
      view.remove();
      if (panel === view) panel = null;
      if (trigger) trigger.focus();
    });
    document.body.appendChild(view);
    if (trigger) view.querySelector('button').focus();
  }

  var ready = fetch(new URL('api/public-analytics', scriptUrl)).then(function (response) {
    return response.ok ? response.json() : {};
  }).catch(function () { return {}; });
  ready.then(function (settings) {
    current = storedChoice();
    if (settings.metrikaCounter) {
      if (validChoice(current, settings)) start(settings);
      else show(settings);
    }
    window.addEventListener('storage', function (event) {
      if (event.key !== choiceKey && event.key !== null) return;
      choiceRevision++;
      current = storedChoice();
      if (validChoice(current, settings) && current.state === 'accepted') start(settings);
      else stop();
      if (panel && validChoice(current, settings)) { panel.remove(); panel = null; }
    });
  });
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-cookie-settings]');
    if (trigger) ready.then(function (settings) { show(settings, trigger); });
  });
  window.AndoAnalytics = {
    accepted: function (type) {
      var goal = { buy: 'inspection_submitted', sell: 'buyout_submitted' }[type];
      if (goal && activeCounter && current?.state === 'accepted' && current.expiresAt > Date.now()) {
        window.ym(activeCounter, 'reachGoal', goal);
      }
    }
  };
})();
