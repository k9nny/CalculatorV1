'use strict';
// Вертикальные ролики 1080×1920 по карточке машины: три разных сценария
// (обзор, цена, сервис), озвучка RHVoice, сборка ffmpeg. Внешних npm-пакетов нет.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const say = require('./speech');

const W = 1080, H = 1920, FPS = 30;
const PHOTO = { y: 250, w: 1080, h: 810 };
const FONTS = path.join(__dirname, 'fonts');
const C = { bg: '0x050505', text: '0xFAFAFA', text2: '0xA3A3A3', hot: '0xFF1F3D', line: '0x2E2E2E' };
const F = {
  head: { file: 'Unbounded-Medium.ttf', k: 0.78 },
  bold: { file: 'Onest-Bold.ttf', k: 0.56 },
  body: { file: 'Onest-Medium.ttf', k: 0.53 },
};

const num = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const title = (car) => `${car.make} ${car.model}`.trim();

// Перенос по словам под ширину кадра; k — средняя ширина символа в долях кегля.
function wrap(text, font, size, max = W - 160) {
  const per = Math.max(6, Math.floor(max / (size * F[font].k)));
  const lines = [];
  for (const word of String(text).split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= per) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

const T = {
  label: (text) => ({ text: text.toUpperCase(), font: 'bold', size: 34, color: C.hot, gap: 22 }),
  head: (text, size = 60) => ({ text, font: 'head', size, color: C.text, gap: 22 }),
  big: (text) => ({ text, font: 'bold', size: 96, color: C.text, gap: 26 }),
  sub: (text) => ({ text, font: 'body', size: 46, color: C.text2, gap: 16 }),
};

function specLine(car) {
  const e = car.engine || {};
  const parts = [];
  if (e.volume) parts.push(`${Number(e.volume).toFixed(1)} л`);
  if (e.power) parts.push(`${e.power} л.с.`);
  if (e.fuel && e.fuel !== 'Бензин') parts.push(e.fuel);
  return parts.join(' · ');
}

function ownersText(n) {
  return n ? `${n} ${say.plural(n, 'владелец', 'владельца', 'владельцев')} по ПТС` : '';
}

function endCard(phoneLabel) {
  return {
    end: true,
    lines: [
      T.head('ANDO AUTO', 84),
      T.sub('Каталог и запись на осмотр —'),
      T.sub('ссылка в описании'),
      ...(phoneLabel ? [{ ...T.big(phoneLabel), size: 64 }] : []),
    ],
    voice: 'Каталог и запись на осмотр — по ссылке в описании.',
  };
}

// Три сценария на машину. Каждый — свой порядок, свои кадры, свой текст и голос,
// а не копия с перестановкой: это три разных повода посмотреть одну машину.
function scripts(car, opts = {}) {
  const name = title(car);
  const sayName = say.sayCar(car);
  const photos = (car.photos || []).filter(Boolean);
  const pick = (i) => (photos.length ? photos[i % photos.length] : null);
  const e = car.engine || {};
  const below = car.marketPrice && car.marketPrice > car.price ? car.marketPrice - car.price : 0;
  const service = (car.serviceDone || []).slice(0, 3);
  const end = endCard(opts.phoneLabel);
  const yearMil = [car.year, car.mileage ? `${num(car.mileage)} км` : ''].filter(Boolean).join(' · ');
  const drive = [car.transmission, car.drive ? `${car.drive} привод` : ''].filter(Boolean).join(' · ');

  const overview = {
    key: 'obzor',
    name: 'Обзор',
    voice: opts.voices?.[0] || 'aleksandr-hq',
    scenes: [
      {
        photo: pick(0),
        lines: [T.label('В продаже'), T.head(name), T.big(`${num(car.price)} ₽`), T.sub(yearMil)],
        voice: `${sayName}, год выпуска — ${say.numWords(car.year)}. Цена — ${say.rub(car.price)}.`,
      },
      {
        photo: pick(1),
        lines: [T.label('Характеристики'), T.head(specLine(car) || name), T.sub(drive), T.sub([car.body, car.color].filter(Boolean).join(' · '))],
        voice: [
          e.volume || e.power ? `Двигатель ${[say.litres(e.volume), e.power ? say.hp(e.power) : ''].filter(Boolean).join(', ')}.` : '',
          car.transmission ? `Коробка — ${car.transmission.toLowerCase()}.` : '',
          car.drive ? `${car.drive} привод.` : '',
        ].filter(Boolean).join(' '),
      },
      {
        photo: pick(2),
        lines: [T.label('История'), T.big(`${num(car.mileage)} км`), T.sub(ownersText(car.owners)), T.sub(car.pts ? `ПТС: ${car.pts.toLowerCase()}` : '')],
        voice: [
          `Пробег — ${say.km(car.mileage)}.`,
          car.owners ? `${cap(say.numWords(car.owners))} ${say.plural(car.owners, 'владелец', 'владельца', 'владельцев')}.` : '',
          car.pts === 'Оригинал' ? 'Оригинальный ПТС.' : '',
        ].filter(Boolean).join(' '),
      },
      end,
    ],
  };

  const price = {
    key: 'cena',
    name: 'Цена',
    voice: opts.voices?.[1] || 'anna',
    scenes: [
      below ? {
        photo: pick(1),
        lines: [T.label('Ниже рынка'), T.big(`−${num(below)} ₽`), T.sub('от средней цены'), T.sub('на такие машины')],
        voice: `${sayName} дешевле рынка на ${say.rub(below)}.`,
      } : {
        photo: pick(1),
        lines: [T.label('Цена'), T.head(name), T.big(`${num(car.price)} ₽`)],
        voice: `${sayName} за ${say.rub(car.price)}.`,
      },
      {
        photo: pick(0),
        lines: [T.label(`${car.year} · ${num(car.mileage)} км`), T.head(name), T.big(`${num(car.price)} ₽`),
          T.sub(car.marketPrice ? `Рынок: ${num(car.marketPrice)} ₽` : '')],
        voice: `Наша цена — ${say.rub(car.price)}.` + (car.marketPrice ? ` В среднем такие продают за ${say.rub(car.marketPrice)}.` : ''),
      },
      {
        photo: pick(2),
        lines: [T.label('Проверена в сервисе'), ...(service.length ? service : ['Диагностика перед продажей']).map((s) => T.sub(s))],
        voice: 'Перед продажей машину проверили в нашем автосервисе.',
      },
      end,
    ],
  };

  const serviceClip = service.length ? {
    key: 'servis',
    name: 'Сервис',
    voice: opts.voices?.[2] || 'aleksandr-hq',
    scenes: [
      {
        photo: pick(2),
        lines: [T.label('После сервиса'), T.head(name), T.sub('Что сделали перед продажей')],
        voice: `${sayName}. Вот что мы сделали с машиной перед продажей.`,
      },
      {
        photo: pick(0),
        lines: [T.label('В нашем сервисе'), ...service.map((s) => T.sub(s))],
        voice: service.map((s) => s.replace(/\.$/, '')).join('. ') + '.',
      },
      {
        photo: pick(1),
        lines: [T.label(String(car.year)), T.big(`${num(car.price)} ₽`), T.sub(`${num(car.mileage)} км`)],
        voice: `Цена — ${say.rub(car.price)}, пробег — ${say.km(car.mileage)}.`,
      },
      end,
    ],
  } : {
    key: 'detali',
    name: 'Детали',
    voice: opts.voices?.[2] || 'aleksandr-hq',
    scenes: [
      {
        photo: pick(2),
        lines: [T.label(String(car.year)), T.head(name), T.sub(specLine(car))],
        voice: `${sayName}. Подробности за полминуты.`,
      },
      {
        photo: pick(0),
        lines: [T.label('Комплектация'), T.head(car.trim || car.body || name, 52), T.sub(drive)],
        voice: [car.transmission ? `${car.transmission}.` : '', car.drive ? `${car.drive} привод.` : ''].filter(Boolean).join(' ') || 'Смотрите фото и характеристики в каталоге.',
      },
      {
        photo: pick(1),
        lines: [T.label('Цена'), T.big(`${num(car.price)} ₽`), T.sub(`${num(car.mileage)} км`)],
        voice: `Цена — ${say.rub(car.price)}, пробег — ${say.km(car.mileage)}.`,
      },
      end,
    ],
  };

  return [overview, price, serviceClip];
}

// Подпись к публикации: одна на ролик, без хэштег-простыни.
function caption(car, clip, appLink) {
  const lines = [
    `${title(car)}, ${car.year}`,
    `${num(car.price)} ₽ · ${num(car.mileage)} км`,
  ];
  if (clip.key === 'cena' && car.marketPrice > car.price) lines.push(`Ниже средней цены на ${num(car.marketPrice - car.price)} ₽`);
  if (clip.key === 'servis') lines.push(`Сделали: ${(car.serviceDone || []).slice(0, 3).join(', ').toLowerCase()}`);
  if (appLink) lines.push('', `Фото, характеристики и запись на осмотр: ${appLink}`);
  return lines.join('\n');
}

// ---------- сборка ----------

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} завершился с кодом ${code}: ${err}`))));
    p.stdin.end(input || '');
  });
}

function probeDuration(file, ffprobe = 'ffprobe') {
  return new Promise((resolve, reject) => {
    const p = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(parseFloat(out) || 0) : reject(new Error('ffprobe: ' + file))));
  });
}

// Озвучка через сервис Qwen3-TTS (tts/qwen_tts_server.py): POST /speak → WAV.
function speakHttp(url, text, outFile, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text });
    const u = new URL('/speak', url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        if (res.statusCode !== 200) return reject(new Error(`озвучка Qwen: ${res.statusCode} ${data.toString('utf8').slice(0, 200)}`));
        fs.writeFileSync(outFile, data);
        resolve();
      });
    });
    req.on('timeout', () => req.destroy(new Error('озвучка Qwen: нет ответа')));
    req.on('error', (e) => reject(new Error(`озвучка Qwen недоступна (${url}): ${e.message}`)));
    req.end(body);
  });
}

const esc = (p) => p.replace(/\\/g, '/').replace(/[:']/g, (m) => '\\' + m);

// drawtext для одной строки: проявляется и чуть поднимается, со сдвигом по времени.
function drawLine({ textFile, font, size, color, y, delay }) {
  const a = `if(lt(t,${delay}),0,min(1,(t-${delay})/0.35))`;
  return `drawtext=fontfile='${esc(path.join(FONTS, F[font].file))}':textfile='${esc(textFile)}':expansion=none:` +
    `fontsize=${size}:fontcolor=${color}:x=80:y='${y}+24*(1-${a})':alpha='${a}'`;
}

function layout(scene, hasPhoto) {
  const lines = [];
  for (const l of scene.lines) {
    if (!l.text) continue;
    wrap(l.text, l.font, l.size).forEach((t, i) => lines.push({ ...l, text: t, first: i === 0 }));
  }
  const lh = (l) => Math.round(l.size * 1.22);
  const total = lines.reduce((s, l) => s + lh(l) + (l.first ? l.gap : 0), 0);
  let y = scene.end || !hasPhoto ? Math.round((H - total) / 2) - 80 : PHOTO.y + PHOTO.h + 70;
  return lines.map((l, i) => {
    if (l.first && i) y += l.gap;
    const out = { ...l, y };
    y += lh(l);
    return out;
  });
}

async function renderScene(scene, i, ctx) {
  const dir = ctx.tmp;
  const wav = path.join(dir, `s${i}.wav`);
  if (ctx.ttsUrl) await speakHttp(ctx.ttsUrl, say.abbr(scene.voice), wav);
  else await run(ctx.rhvoice, ['-p', ctx.voice, '-o', wav], say.abbr(scene.voice));
  const dur = Math.max(2.4, (await probeDuration(wav, ctx.ffprobe)) + 0.6);
  const frames = Math.ceil(dur * FPS);
  const photo = scene.end ? null : scene.photo && (ctx.photosDir && scene.photo.startsWith('img/cars/')
    ? path.join(ctx.photosDir, scene.photo.slice('img/cars/'.length)) : path.join(ctx.publicDir, scene.photo));
  const hasPhoto = Boolean(photo && fs.existsSync(photo));

  const placed = layout(scene, hasPhoto);
  const texts = placed.map((l, j) => {
    const textFile = path.join(dir, `s${i}-t${j}.txt`);
    fs.writeFileSync(textFile, l.text);
    return drawLine({ ...l, textFile, delay: (0.15 + j * 0.12).toFixed(2) });
  });

  const chain = [];
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${C.bg}:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(2)}`];
  let base = '[0:v]';
  if (hasPhoto) {
    args.push('-i', photo);
    // Медленный наезд камеры: рендер в 2× и zoompan, чтобы не было дрожания.
    chain.push(`[1:v]scale=${PHOTO.w * 2}:${PHOTO.h * 2}:force_original_aspect_ratio=increase,crop=${PHOTO.w * 2}:${PHOTO.h * 2},` +
      `zoompan=z='1+0.0009*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${PHOTO.w}x${PHOTO.h}:fps=${FPS},setsar=1[ph]`);
    chain.push(`[0:v][ph]overlay=0:${PHOTO.y}[b]`);
    base = '[b]';
  }
  const headFile = path.join(dir, `s${i}-head.txt`);
  fs.writeFileSync(headFile, 'ANDO AUTO');
  const top = [`drawtext=fontfile='${esc(path.join(FONTS, F.head.file))}':textfile='${esc(headFile)}':expansion=none:fontsize=36:fontcolor=${C.text}:x=80:y=150`];
  if (ctx.demo) {
    const demoFile = path.join(dir, `s${i}-demo.txt`);
    fs.writeFileSync(demoFile, 'ДЕМО');
    top.push(`drawtext=fontfile='${esc(path.join(FONTS, F.bold.file))}':textfile='${esc(demoFile)}':expansion=none:fontsize=34:fontcolor=${C.hot}:x=w-tw-80:y=152`);
  }
  if (!scene.end) top.push(`drawbox=x=80:y=${hasPhoto ? PHOTO.y + PHOTO.h + 36 : (placed[0] ? placed[0].y : 900) - 34}:w=120:h=4:color=${C.hot}:t=fill`);
  chain.push(`${base}${[...top, ...texts].join(',')},fade=t=in:st=0:d=0.25,fade=t=out:st=${(dur - 0.25).toFixed(2)}:d=0.25,format=yuv420p[v]`);
  const audioIdx = hasPhoto ? 2 : 1;
  args.push('-i', wav, '-filter_complex', chain.join(';'), '-map', '[v]', '-map', `${audioIdx}:a`,
    '-af', `apad,afade=t=out:st=${(dur - 0.2).toFixed(2)}:d=0.2`, '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    path.join(dir, `s${i}.mp4`));
  await run(ctx.ffmpeg, args);
  return path.join(dir, `s${i}.mp4`);
}

// Рендер одного сценария в mp4. Возвращает путь к файлу.
// ttsUrl — адрес сервиса Qwen3-TTS; без него озвучивает RHVoice.
async function renderClip(clip, { car, publicDir, photosDir = '', outFile, tmpDir, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', rhvoice = 'RHVoice-test', ttsUrl = process.env.TTS_URL || '' }) {
  const tmp = fs.mkdtempSync(path.join(tmpDir, `clip-${car.id}-${clip.key}-`));
  try {
    const ctx = { tmp, publicDir, photosDir, ffmpeg, ffprobe, rhvoice, ttsUrl, voice: clip.voice, demo: Boolean(car.demo) };
    const parts = [];
    for (let i = 0; i < clip.scenes.length; i++) parts.push(await renderScene(clip.scenes[i], i, ctx));
    const list = path.join(tmp, 'list.txt');
    fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await run(ffmpeg, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outFile]);
    return outFile;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Все три ролика по машине: [{ key, name, file, caption }].
async function renderCar(car, { publicDir, outDir, tmpDir = outDir, appLink = '', phoneLabel = '', ...tools }) {
  const out = [];
  for (const clip of scripts(car, { phoneLabel })) {
    const file = path.join(outDir, `${car.id}-${clip.key}.mp4`);
    await renderClip(clip, { car, publicDir, outFile: file, tmpDir, ...tools });
    out.push({ key: clip.key, name: clip.name, file, caption: caption(car, clip, appLink) });
  }
  return out;
}

module.exports = { scripts, caption, renderClip, renderCar, wrap, layout };

// node server/video/clips.js <id> [outDir] — ролики по машине из каталога.
if (require.main === module) {
  const root = path.join(__dirname, '..', '..');
  const [id, outDir = path.join(root, 'data-private', 'clips')] = process.argv.slice(2);
  const cars = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'cars.json'), 'utf8')).cars;
  const car = cars.find((c) => c.id === id);
  if (!car) { console.error('Нет машины с id', id); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  renderCar(car, { publicDir: path.join(root, 'public'), outDir, phoneLabel: '+7 989 085-31-77', appLink: process.env.APP_LINK || '' })
    .then((r) => r.forEach((c) => console.log(c.file + '\n' + c.caption + '\n')))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
