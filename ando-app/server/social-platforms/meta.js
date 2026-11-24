'use strict';

const { failure, approved, secureUrl, textWithLink, store, transport, check, numericId, accountPayload } = require('./common');
const { createMetaToken } = require('./tokens');

const inflight = new Map();

function createMetaPublisher(config, platform, opts = {}) {
  const request = opts.transport || transport;
  const now = opts.now || (() => new Date());
  const userId = numericId(config[platform + 'UserId'], platform);
  const key = `${platform}:${userId}`;
  const instagram = platform === 'instagram';
  const name = instagram ? 'Instagram' : 'Threads';
  const version = config[platform + 'ApiVersion'] || (instagram ? 'v27.0' : 'v1.0');
  if (!/^v\d+\.\d+$/.test(version)) throw failure(`${name}: неверная версия API`);
  const origin = instagram ? 'https://graph.instagram.com' : 'https://graph.threads.com';
  const token = createMetaToken(config, platform, opts);
  const createEndpoint = `${userId}/${instagram ? 'media' : 'threads'}`;
  const publishEndpoint = `${userId}/${instagram ? 'media_publish' : 'threads_publish'}`;

  async function call(endpoint, fields, method = 'GET', beforeRequest) {
    const accessToken = await token.get();
    const url = new URL(`/${version}/${endpoint}`, origin);
    const params = new URLSearchParams();
    for (const [field, value] of Object.entries(fields || {})) params.set(field, String(value));
    const headers = { Authorization: `Bearer ${accessToken}` };
    let body;
    if (method === 'GET') url.search = params.toString();
    else { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = params.toString(); }
    if (beforeRequest) beforeRequest();
    return check(await request({ url: url.href, method, headers, body }), name).body;
  }

  function prepare(media) {
    const video = media.video?.url ? { url: secureUrl(media.video.url) } : undefined;
    const photos = video ? [] : ((instagram ? media.jpegPhotos : null) || media.photos || []).map(secureUrl).slice(0, 10);
    if (instagram && !video && !photos.length) throw failure('Instagram: добавьте фото JPEG или публичный MP4');
    if (instagram && photos.some((url) => /\.(?:png|webp|gif|heic|avif)$/i.test(new URL(url).pathname))) {
      throw failure('Instagram принимает JPEG. Подготовьте JPEG-копии фотографий.');
    }
    return {
      account: key, text: instagram ? textWithLink(media.text, media.link, 2200)
        : textWithLink(media.text, media.link, 500, (char) => /\p{Extended_Pictographic}/u.test(char) ? Buffer.byteLength(char, 'utf8') : 1),
      photos, ...(video ? { video } : {}), link: media.link || '',
      kind: video ? (instagram ? 'REELS' : 'VIDEO') : photos.length > 1 ? 'CAROUSEL' : photos.length ? 'IMAGE' : 'TEXT',
    };
  }

  function waiting(message, retryAfter = 60) {
    return failure(`${name}: ${message}`, { retryable: true, retryAfter });
  }

  async function containerStatus(id) {
    const result = await call(id, { fields: instagram ? 'status_code,status' : 'status,error_message' });
    return instagram ? result?.status_code : result?.status;
  }

  function checkStatus(status) {
    if (status === 'IN_PROGRESS') throw waiting('материал обрабатывается');
    if (status === 'EXPIRED') throw failure(`${name}: контейнер истёк. Создайте новый предпросмотр.`, { expired: true });
    if (status === 'ERROR') throw failure(`${name}: площадка не смогла обработать медиа. Проверьте формат файла и его публичный URL.`);
    if (status !== 'FINISHED' && status !== 'PUBLISHED') throw waiting('статус контейнера ещё недоступен');
  }

  async function postSnapshot(payload) {
    const checkpoint = store(config, platform + '-post', payload);
    const state = checkpoint.read();
    if (state.receipt) return state.receipt;
    if (!state.createdAt) state.createdAt = now().toISOString();
    state.children ||= [];
    const save = () => checkpoint.write(state);

    async function create(fields) {
      const result = await call(createEndpoint, fields, 'POST');
      if (!/^\d+$/.test(String(result?.id || ''))) throw waiting('API не вернул ID контейнера');
      return String(result.id);
    }

    if (!state.containerId) {
      if (payload.kind === 'CAROUSEL') {
        for (let i = 0; i < payload.photos.length; i++) {
          if (!state.children[i]) {
            state.children[i] = await create({ image_url: payload.photos[i], is_carousel_item: true,
              ...(!instagram ? { media_type: 'IMAGE' } : {}) });
            save();
          }
          const childStatus = await containerStatus(state.children[i]);
          if (childStatus === 'EXPIRED') {
            state.children[i] = null;
            save();
            throw waiting('срок загрузки фото истёк, подготовлю его заново');
          }
          checkStatus(childStatus);
        }
        state.containerId = await create({ media_type: 'CAROUSEL', children: state.children.join(','),
          [instagram ? 'caption' : 'text']: payload.text });
      } else {
        const fields = { [instagram ? 'caption' : 'text']: payload.text };
        if (payload.video) { fields.video_url = payload.video.url; fields.media_type = instagram ? 'REELS' : 'VIDEO'; }
        else if (payload.photos.length) { fields.image_url = payload.photos[0]; if (!instagram) fields.media_type = 'IMAGE'; }
        else fields.media_type = 'TEXT';
        state.containerId = await create(fields);
      }
      state.containerCreatedAt = now().toISOString();
      save();
    }

    const status = await containerStatus(state.containerId);
    if (status === 'PUBLISHED') {
      // A publish response can be lost. The same container is authoritative proof
      // of publication, even when Meta can no longer return its public media ID.
      state.receipt = { containerId: state.containerId, confirmedPublished: true, url: null };
      save();
      return state.receipt;
    }
    if (status === 'EXPIRED') {
      // EXPIRED confirms that this container was never published.
      delete state.containerId;
      delete state.publishAttemptedAt;
      state.children = [];
      save();
      throw waiting('неопубликованный контейнер истёк, подготовлю материал заново');
    }
    checkStatus(status);
    if (state.publishAttemptedAt) {
      // Do not submit the same publish request again after an ambiguous response.
      // Poll until Meta confirms PUBLISHED, then require a human if it stays unclear.
      if (now().getTime() - Date.parse(state.publishAttemptedAt) < 5 * 60000) throw waiting('проверяю результат предыдущей отправки');
      throw failure(`${name}: ответ на публикацию потерян. Проверьте аккаунт перед повтором.`, { uncertain: true });
    }
    if (!instagram && now().getTime() - Date.parse(state.containerCreatedAt) < 30000) {
      throw waiting('контейнер готовится к публикации', 30);
    }
    let result;
    let publishStarted = false;
    try {
      result = await call(publishEndpoint, { creation_id: state.containerId }, 'POST', () => {
        state.publishAttemptedAt = now().toISOString();
        save();
        publishStarted = true;
      });
    }
    catch (error) {
      if (!publishStarted) throw error;
      if (error.status && error.status < 500) {
        delete state.publishAttemptedAt;
        save();
        throw error;
      }
      throw waiting('проверяю, приняла ли площадка публикацию');
    }
    if (!/^\d+$/.test(String(result?.id || ''))) throw waiting('проверяю ID опубликованного материала');
    state.receipt = { id: String(result.id), containerId: state.containerId, url: null };
    save();
    // Receipt is durable before this optional read. Failed permalink lookup must
    // never repeat publication on a retry.
    try {
      const media = await call(String(result.id), { fields: 'permalink' });
      if (media?.permalink) { state.receipt.url = secureUrl(media.permalink); save(); }
    } catch { /* published ID is already recorded */ }
    return state.receipt;
  }

  return {
    key, name, prepare, reconciles: true,
    supports: (media) => !instagram || Boolean(media.video?.url || media.photos?.length),
    refresh: () => token.get(),
    async post(payload, context) {
      approved(context);
      accountPayload(payload, key);
      const lock = store(config, platform + '-post', payload).file;
      if (!inflight.has(lock)) inflight.set(lock, postSnapshot(payload).finally(() => inflight.delete(lock)));
      return inflight.get(lock);
    },
  };
}

const createInstagramPublisher = (config, opts) => createMetaPublisher(config, 'instagram', opts);
const createThreadsPublisher = (config, opts) => createMetaPublisher(config, 'threads', opts);

module.exports = { createInstagramPublisher, createThreadsPublisher };
