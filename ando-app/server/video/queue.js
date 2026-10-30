'use strict';
// Очередь роликов: черновик → одобрен админом → опубликован в слот по расписанию.
// Хранится одним JSON-файлом с атомарной записью.

const fs = require('fs');
const path = require('path');

const MSK_OFFSET_MIN = 180; // Москва без перехода на летнее время

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { items: data.items || [], lastSlot: data.lastSlot || '', seq: data.seq || 0 };
  } catch {
    return { items: [], lastSlot: '', seq: 0 };
  }
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

// «10:30, 15:30,19:30» → ['10:30','15:30','19:30'] по возрастанию.
function parseTimes(s) {
  return String(s || '').split(/[,\s]+/).map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => t.padStart(5, '0')).sort();
}

// Последний наступивший слот сегодняшнего дня по Москве: 'YYYY-MM-DD HH:MM' или ''.
function currentSlot(times, now = new Date()) {
  const msk = new Date(now.getTime() + MSK_OFFSET_MIN * 60000);
  const day = msk.toISOString().slice(0, 10);
  const hm = msk.toISOString().slice(11, 16);
  const passed = times.filter((t) => t <= hm);
  return passed.length ? `${day} ${passed[passed.length - 1]}` : '';
}

function createQueue(file) {
  const read = () => load(file);

  function add(entries) {
    const st = read();
    const added = entries.map((e) => ({ id: String(++st.seq), status: 'pending', createdAt: new Date().toISOString(), ...e }));
    st.items.push(...added);
    save(file, st);
    return added;
  }

  function setStatus(id, status, patch = {}) {
    const st = read();
    const item = st.items.find((i) => i.id === String(id));
    if (!item) return null;
    Object.assign(item, patch, { status });
    save(file, st);
    return item;
  }

  // Следующий ролик: самый ранний одобренный, но не той же машины, что выходила последней,
  // чтобы три ролика одной машины не шли подряд.
  function next(st = read()) {
    const ready = st.items.filter((i) => i.status === 'approved');
    if (!ready.length) return null;
    const posted = st.items.filter((i) => i.status === 'posted').sort((a, b) => String(a.postedAt).localeCompare(String(b.postedAt)));
    const lastCar = posted.length ? posted[posted.length - 1].carId : null;
    return ready.find((i) => i.carId !== lastCar) || ready[0];
  }

  // Вызывается раз в минуту. Возвращает ролик, который пора публиковать, и помечает слот занятым.
  function due(times, now = new Date()) {
    const slot = currentSlot(times, now);
    const st = read();
    if (!slot || slot === st.lastSlot) return null;
    const item = next(st);
    if (!item) return null;
    st.lastSlot = slot;
    save(file, st);
    return item;
  }

  return { read, add, setStatus, next, due };
}

// Планировщик: раз в минуту проверяет слот и публикует во все подключённые соцсети.
function startScheduler({ queue, times, publishers, notify = async () => {}, log = console, intervalMs = 60000 }) {
  let busy = false;
  async function tick(now = new Date()) {
    if (busy || !publishers.length) return null;
    const item = queue.due(times, now);
    if (!item) return null;
    busy = true;
    try {
      const results = {};
      for (const p of publishers) {
        try { await p.post(item); results[p.name] = 'ok'; } catch (e) { results[p.name] = e.message; log.error(`clip ${item.id} → ${p.name}:`, e.message); }
      }
      const ok = Object.values(results).some((r) => r === 'ok');
      queue.setStatus(item.id, ok ? 'posted' : 'approved', { postedAt: ok ? now.toISOString() : undefined, results });
      await notify(item, results).catch(() => {});
      return { item, results };
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => { tick().catch((e) => log.error('clips scheduler:', e.message)); }, intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { createQueue, startScheduler, parseTimes, currentSlot };
