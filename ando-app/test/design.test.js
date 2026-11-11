'use strict';
// Сайт и приложение выглядят одинаково, пока у них одна дизайн-система и одна карточка машины.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('дизайн: ui.css и шрифты сайта и приложения совпадают', () => {
  assert.equal(read('ando-site/assets/ui.css'), read('ando-app/public/ui.css'));
  assert.equal(read('ando-site/assets/fonts.css'), read('ando-app/public/fonts.css'));
});

test('дизайн: сайт берёт карточку и список машин из приложения', () => {
  const html = read('ando-site/index.html');
  const js = read('ando-site/assets/site.js');
  assert.match(html, /<script src="app\/card\.js"><\/script>/);
  assert.match(js, /APP \+ 'data\/cars\.json'/);
  assert.match(read('deploy/Caddyfile.tmpl'), /handle_path \/app\/\*/);
});

test('дизайн: без сторонних серверов — шрифты, скрипты и стили лежат рядом', () => {
  for (const p of ['ando-site/index.html', 'ando-app/public/index.html']) {
    const html = read(p);
    const external = (html.match(/(?:src|href)="https?:\/\/[^"]+"/g) || []).filter((u) => /\.(js|css|woff2?)"|fonts\.g/.test(u));
    assert.deepEqual(external, [], p);
  }
});
