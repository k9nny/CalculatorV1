// Builds dist/2. ULTIMATE SHOP СКЛАД.html: the app with pdf.js, SheetJS and the fonts inside,
// so the file opens from a disk and works without internet.
// Run: cd Sklad/tools && npm install && npm run build   (or NODE_MODULES=/path/to/node_modules node build-offline.mjs)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const nm = process.env.NODE_MODULES || path.join(here, 'node_modules');
const read = p => fs.readFileSync(path.join(nm, p), 'utf8');
const b64 = p => fs.readFileSync(path.join(nm, p)).toString('base64');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error('Not found in index.html: ' + from.slice(0, 80));
  html = html.replace(from, () => to);
};
const safe = (js, name) => {
  if (/<\/script/i.test(js)) throw new Error(name + ' contains </script');
  return js;
};

// fonts: the Cyrillic and Latin faces the page uses, as data URLs
const FONTS = [['golos-text', [400, 500, 600, 700]], ['jetbrains-mono', [400, 500, 700]], ['tenor-sans', [400]]];
const faces = [];
for (const [fam, weights] of FONTS) for (const w of weights) {
  for (const block of read(`@fontsource/${fam}/${w}.css`).split('}')) {
    if (!/@font-face/.test(block) || !/-(cyrillic|cyrillic-ext|latin|latin-ext)-\d+-normal/.test(block)) continue;
    const file = block.match(/files\/([^)]+?\.woff2)/)[1];
    faces.push(block.replace(/src:[^;]+;/, `src: url(data:font/woff2;base64,${b64(`@fontsource/${fam}/files/${file}`)}) format('woff2');`).trim() + '\n}');
  }
}
swap('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n', '');
html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, () => `<style>\n${faces.join('\n')}\n</style>`);

// Excel reader
swap('<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" id="xlsxLib" async></script>',
  `<script id="xlsxLib">/*! SheetJS Community Edition 0.18.5, Apache-2.0, https://sheetjs.com */\n${safe(read('xlsx/dist/xlsx.full.min.js'), 'xlsx')}</script>`);

// PDF reader; its worker runs from a blob made of the text below
const appStart = '<script>\n(() => {\n\'use strict\';';
swap(appStart, `<script>/*! pdf.js 3.11.174, Apache-2.0, https://mozilla.github.io/pdf.js */\n${safe(read('pdfjs-dist/build/pdf.min.js'), 'pdf.js')}</script>
<script type="text/plain" id="pdfWorkerSrc">${safe(read('pdfjs-dist/build/pdf.worker.min.js'), 'pdf.worker')}</script>
<script>
try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([document.getElementById('pdfWorkerSrc').textContent], {type: 'text/javascript'})); } catch (e) {}
</script>
${appStart}`);

// what a person sees if the file is shown as text or without scripts
swap('<!doctype html>\n', `<!doctype html>
<!--
  ULTIMATE SHOP СКЛАД — программа для склада.
  КАК ОТКРЫТЬ: скачайте этот файл и откройте его двойным щелчком.
  Он откроется в браузере: Google Chrome, Яндекс Браузер или Microsoft Edge. Интернет не нужен.
  Если вы видите этот текст, файл открылся как текст. Закройте его, нажмите на файл правой кнопкой мыши,
  выберите «Открыть с помощью» и Google Chrome или Яндекс Браузер.

  Внутри: pdf.js (Apache-2.0), SheetJS (Apache-2.0), шрифты Golos Text, Tenor Sans, JetBrains Mono (SIL OFL 1.1).
-->
`);
swap('<body>\n', `<body>
<noscript><div style="position:fixed;inset:0;z-index:999;background:#F1F2F4;color:#121317;font:18px/1.5 Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;text-align:left">
<div style="max-width:560px;background:#fff;border-radius:18px;padding:28px 30px;box-shadow:0 20px 60px -30px rgba(0,0,0,.4)">
<div style="font-size:13px;letter-spacing:.2em;color:#B08A3E;font-weight:bold">ULTIMATE SHOP СКЛАД</div>
<h1 style="font-size:26px;margin:10px 0 16px">Это программа. Её нужно скачать</h1>
<p style="margin:0 0 10px"><b>1.</b> Нажмите «Скачать».</p>
<p style="margin:0 0 10px"><b>2.</b> Откройте скачанный файл двойным щелчком.</p>
<p style="margin:0">Он откроется в браузере: Google Chrome, Яндекс Браузер или Edge. Интернет не нужен.</p>
</div></div></noscript>
`);

const out = path.join(root, 'dist', '2. ULTIMATE SHOP СКЛАД.html');
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, html);
console.log(`${out}: ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB, ${faces.length} font faces`);
