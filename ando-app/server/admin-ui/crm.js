'use strict';
/* CRM reads the catalogue and delivery journal without changing either on page load. */
window.AndoCRM = function ({ api, openBatch }) {

  const $ = id => document.getElementById('crm-' + id);
  const { esc, rub, photos } = window.AndoCard;
  const clock = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  const date = value => value && Number.isFinite(Date.parse(value)) ? clock.format(new Date(value)) : '';
  const active = ['scheduled', 'queued', 'retry', 'sending'];
  const attention = ['review', 'failed', 'blocked'];
  const labels = { posted: 'Опубликовано', uploaded: 'Доступ ограничен', draft: 'Черновик', scheduled: 'В расписании', queued: 'В очереди', retry: 'Повтор', sending: 'Отправляется', review: 'Сверить с площадкой', failed: 'Ошибка отправки', blocked: 'Требует проверки' };
  const inventory = { sold: 'Продана', reserved: 'Бронь', available: 'В продаже' };
  const carName = car => [car.make, car.model].filter(Boolean).join(' ') || car.title || 'Машина №' + car.id;
  const format = job => data.destinations.find(destination => destination.id === job.destination)?.format || (job.kind === 'video' ? 'Видео' : 'Пост');
  let detailDestination = '';
  const due = job => job.status === 'retry' ? job.nextAt : job.scheduledAt;
  const byDue = (a,b) => (Date.parse(due(a)) || Infinity) - (Date.parse(due(b)) || Infinity);
  let data, request = 0;
  function related(job) {
    return (!$('format').value || job.kind === $('format').value) && (!$('platform').value || job.destination === $('platform').value);
  }
  function matches(car) {
    const needle = $('query').value.trim().toLocaleLowerCase('ru');
    if (![carName(car), car.year, car.id, car.city].join(' ').toLocaleLowerCase('ru').includes(needle)) return false;
    const jobs = car.publications.filter(related);
    switch ($('filter').value) {
      case 'none': return !jobs.some(j => j.status === 'posted');
      case 'active': return jobs.some(j => active.includes(j.status));
      case 'attention': return jobs.some(j => attention.includes(j.status));
      case 'all': return !$('format').value || jobs.length > 0;
      default: return jobs.some(j => j.status === $('filter').value);
    }
  }
  function cell(car, destination) {
    const jobs = car.publications.filter(job => job.destination === destination.id);
    const published = jobs.filter(job => job.status === 'posted');
    const next = jobs.filter(job => active.includes(job.status)).sort(byDue)[0];
    const issue = jobs.some(job => attention.includes(job.status));
    const items = [];
    if (published.length) items.push('<span class="crm-state" data-state="posted">' +
      (published.length > 1 ? 'Вышло · ' + published.length : 'Вышло') + '</span>');
    if (next) items.push('<span class="crm-state" data-state="' + esc(next.status) + '">' +
      esc(date(due(next)) || labels[next.status]) + '</span>');
    if (issue) items.push('<span class="crm-state" data-state="failed">Проверить</span>');
    if (!items.length) {
      const state = jobs.some(job => job.status === 'uploaded') ? 'uploaded'
        : jobs.some(job => job.status === 'draft') ? 'draft' : '';
      items.push(state ? '<span class="crm-state">' + labels[state] + '</span>' : '<span class="crm-muted">Нет записи</span>');
    }
    const label = [carName(car), destination.name, destination.format].filter(Boolean).join(' · ');
    return '<td><button type="button" class="crm-cell" data-car="' + esc(car.id) +
      '" data-destination="' + esc(destination.id) + '" aria-label="' + esc(label) + '">' + items.join('') + '</button></td>';
  }
  function shownDestinations() {
    return data.destinations.filter(destination => !$('platform').value || destination.id === $('platform').value);
  }
  function headers() {
    $('columns').innerHTML = '<tr><th scope="col">Автомобиль</th>' + shownDestinations().map(destination =>
      '<th scope="col"><span>' + esc(destination.name) + '</span>' +
      (destination.format ? '<small>' + esc(destination.format) + '</small>' : '') + '</th>'
    ).join('') + '<th scope="col">Заявки</th></tr>';
  }
  function options() {
    const selected = $('platform').value;
    $('platform').innerHTML = '<option value="">Все площадки и форматы</option>' +
      data.destinations.map(destination => '<option value="' + esc(destination.id) + '">' +
        esc([destination.name, destination.format].filter(Boolean).join(' · ')) + '</option>').join('');
    if (data.destinations.some(destination => destination.id === selected)) $('platform').value = selected;
  }
  function rows() {
    if (!data) return;
    headers();
    const destinations = shownDestinations();
    const cars = data.cars.filter(matches);
    $('count').textContent = cars.length + ' из ' + data.cars.length;
    $('rows').innerHTML = cars.map(car => {
      const img = photos({ ...car, photos: car.photo ? [car.photo] : [] }, '../')[0];
      return '<tr><td><button class="crm-car" data-car="' + esc(car.id) + '"><img alt="" loading="lazy" width="58" height="42" src="' + esc(img) + '"><span><b>' + esc(carName(car)) + '</b><small>' + esc([car.year, car.price ? rub(car.price) : '', '№' + car.id].filter(Boolean).join(' · ')) + '</small></span></button></td>' + destinations.map(destination => cell(car, destination)).join('') + '<td>' + esc(car.leads) + (car.openLeads ? '<small>Открытые · ' + esc(car.openLeads) + '</small>' : '') + '</td></tr>';
    }).join('');
    $('empty').hidden = cars.length > 0;
    $('empty').textContent = data.cars.length ? 'По этим фильтрам машин нет.' : 'После добавления первой машины здесь появится история публикаций.';
  }
  function detail(car, destinationId = '') {
    detailDestination = destinationId;
    const target = data.destinations.find(destination => destination.id === destinationId);
    $('car-title').textContent = [carName(car), target?.name, target?.format].filter(Boolean).join(' · ');
    const jobs = car.publications.filter(job => !target || job.destination === target.id).sort((a,b) => Date.parse(b.postedAt || b.createdAt) - Date.parse(a.postedAt || a.createdAt));
    $('history').innerHTML = '<p class="crm-detail-meta">' + esc(['№' + car.id,car.year,car.city,car.inCatalog ? inventory[car.status] : 'В архиве', 'Заявки · ' + car.leads].filter(Boolean).join('  /  ')) + '</p>' +
      (target ? '<button type="button" class="btn" data-car="' + esc(car.id) + '">Вся история машины</button>' : '') +
      (jobs.length ? jobs.map(j => {
        const link = /^https:\/\//.test(j.url || '') ? '<a href="' + esc(j.url) + '" target="_blank" rel="noopener noreferrer">Открыть на площадке ↗</a>' : '';
        const completed = j.status === 'posted' || j.status === 'uploaded';
        const stamp = date(completed ? j.postedAt : due(j) || j.createdAt);
        return '<article class="crm-event"><div><b>' + esc(j.name) + '</b><small>' + format(j) + '</small></div><div><span class="crm-state" data-state="' + esc(j.status) + '">' + esc(j.privacyStatus === 'private' ? 'Только владелец' : j.privacyStatus === 'unlisted' ? 'По ссылке' : labels[j.status] || j.status) + '</span><small>' + esc(stamp ? stamp + ' МСК' : 'Дата неизвестна') + '</small></div><div>' + link + (j.batchId ? '<button class="crm-link" data-batch="' + esc(j.batchId) + '">Предпросмотр</button>' : '') + '</div>' + (j.error ? '<p class="err">' + esc(j.error) + '</p>' : '') + '</article>';
      }).join('') : '<p class="empty">Здесь пока нет записей о публикациях.</p>') +
      (!target && car.inCatalog && car.status === 'available' ? '<button type="button" class="btn" data-prepare="' + esc(car.id) + '">Подготовить пост</button>' : '') +
      (car.inCatalog ? '<details class="crm-manual"><summary>Добавить ссылку на вышедшую публикацию</summary>' +
        '<form data-manual-car="' + esc(car.id) + '">' +
        '<label class="field">Прямая ссылка на публикацию<input name="url" type="url" required></label>' +
        '<label class="field">Формат<select name="kind"><option value="listing">Пост</option><option value="video">Видео</option></select></label>' +
        '<label class="field">Дата и время по Москве<input name="date" type="datetime-local" required></label>' +
        '<button class="btn" type="submit">Сохранить в истории</button><p class="err" role="alert"></p></form></details>' : '');
    if (!$('detail').open) $('detail').showModal();
  }
  function summary() {
    const t = data.totals;
    const metrics = [['Машины в каталоге', t.cars, 'Без публикаций', t.unpublishedCars], ['Опубликовано постов', t.postedListings, 'Вышло видео', t.postedVideos], ['По расписанию', t.scheduled, 'Сейчас в очереди', t.queued], ['Получено заявок', t.leads, 'Открытые', t.openLeads]];
    $('metrics').innerHTML = metrics.map(([title,n,sub,count]) => '<article><span>' + title + '</span><strong>' + esc(n) + '</strong><small>' + sub + ' <b>' + esc(count) + '</b></small></article>').join('');
    const days = Number($('period').value);
    const since = days ? Date.parse(data.generatedAt) - days * 86400000 : -Infinity;
    const channels = new Map(data.destinations.map(d => [d.id, { ...d, posted: 0 }]));
    const queue = [];
    for (const car of data.cars) for (const job of car.publications) {
      if (job.status === 'posted' && (!days || Date.parse(job.postedAt) >= since)) channels.get(job.destination).posted++;
      if (active.includes(job.status)) queue.push({car, job});
    }
    const max = Math.max(1, ...[...channels.values()].map(channel => channel.posted));
    $('channels').innerHTML = [...channels.values()].map(channel => {
      const name = [channel.name, channel.format].filter(Boolean).join(' · ');
      const connection = channel.configured ? 'Автопостинг настроен' : 'Ручной учёт';
      return '<div class="crm-channel"><div><b>' + esc(name) + '</b><small>' + connection + '</small></div>' +
        '<strong aria-label="Число публикаций">' + channel.posted + '</strong>' +
        '<progress aria-label="' + esc(name) + '" max="' + max + '" value="' + channel.posted + '"></progress></div>';
    }).join('');
    $('schedule').innerHTML = queue.sort((a,b) => byDue(a.job,b.job)).slice(0,5).map(({car,job}) => '<button class="crm-upcoming" data-car="' + esc(car.id) + '"><span><b>' + esc(carName(car)) + '</b><small>' + esc(job.name) + ' · ' + format(job) + '</small></span><strong>' + esc(date(due(job)) || labels[job.status]) + '</strong></button>').join('') || '<p class="empty">В очереди нет отправок.</p>';
  }
  async function load() {
    const serial = ++request;
    try {
      const result = await api('crm');
      if (serial !== request) return;
      data = result;
      $('error').textContent = '';
      $('asof').textContent = 'Обновлено ' + date(result.generatedAt) + ' МСК';
      options(); summary(); rows();
    } catch (err) { if (serial === request) { $('error').textContent = err.message; $('asof').textContent = data ? 'Показаны последние загруженные данные' : 'Не удалось загрузить данные'; } }
  }
  for (const id of ['filter','platform','format']) $(id).addEventListener('change',rows);
  $('query').addEventListener('input',rows);
  $('period').addEventListener('change',() => { if (data) summary(); });
  $('history').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const fields = new FormData(form);
    const carId = form.dataset.manualCar;
    const button = form.querySelector('button');
    const error = form.querySelector('.err');
    error.textContent = '';
    button.disabled = true;
    try {
      await api('crm/publications', { method:'POST', json:{ carId, url:fields.get('url'),
        kind:fields.get('kind'), postedAt:fields.get('date') + ':00+03:00' } });
      await load();
      if ($('detail').open) detail(data.cars.find(car => String(car.id) === carId), detailDestination);
    } catch (err) { error.textContent = err.message; }
    finally { button.disabled = false; }
  });
  $('refresh').addEventListener('click',load);
  $('close').addEventListener('click',() => $('detail').close());
  document.querySelector('[data-pane="crm"]').addEventListener('click',async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.car) return detail(data.cars.find(c => String(c.id) === button.dataset.car), button.dataset.destination);
    if (!button.dataset.batch && !button.dataset.prepare) return;
    button.disabled = true;
    try {
      const result = button.dataset.batch ? await api('social/' + encodeURIComponent(button.dataset.batch)) : await api('cars/' + encodeURIComponent(button.dataset.prepare) + '/social', {method:'POST',json:{}});
      $('detail').close(); openBatch(result.batch);
    } catch (err) { const error = document.createElement('p'); error.className='err'; error.setAttribute('role','alert'); error.textContent=err.message; button.after(error); }
    finally { button.disabled = false; }
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && !document.getElementById('app').hidden && !document.querySelector('[data-pane="crm"]').hidden && !$('detail').open) load();
  }, 60000);
  return {load};
};
