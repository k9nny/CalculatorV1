(function () {
  'use strict';
  var config = new URL('api/public-analytics', document.currentScript.src);
  var ready = fetch(config).then(function (response) {
    return response.ok ? response.json() : {};
  }).then(function (settings) {
    var id = settings.metrikaCounter;
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    if (!window.ym) {
      window.ym = function () { (window.ym.a = window.ym.a || []).push(arguments); };
      window.ym.l = Date.now();
      var tag = document.createElement('script');
      tag.async = true;
      tag.src = 'https://mc.yandex.ru/metrika/tag.js';
      document.head.appendChild(tag);
    }
    window.ym(id, 'init', { webvisor: false });
    return id;
  }).catch(function () { return null; });

  window.AndoAnalytics = {
    accepted: function (type) {
      var goal = { buy: 'inspection_submitted', sell: 'buyout_submitted' }[type];
      if (goal) ready.then(function (id) { if (id) window.ym(id, 'reachGoal', goal); });
    }
  };
})();
