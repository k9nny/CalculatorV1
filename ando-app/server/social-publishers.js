'use strict';

const path = require('node:path');
const { telegramDraft } = require('./telegram-post');
const { postMultipart } = require('./video/publish');

function telegramPublisher(config, request = postMultipart) {
  const channel = config.postTelegramChannel;
  return {
    key: `telegram:${channel}`, name: `Telegram ${channel}`,
    template: 'telegram-listing-3',
    prepare(media) {
      if (media.telegramListing) {
        const draft = telegramDraft(media.car, media.link, config, media.telegramFacts);
        return { ...draft, photo: media.car.photos?.[0] || null, photoUrl: media.photos[0] || null, link: media.link };
      }
      const text = media.text.length <= 1024 ? media.text : media.text.slice(0, 850) + `…\nПодробнее в карточке\n${media.link}`;
      return { text, photo: media.car.photos?.[0] || null, photoUrl: media.photos[0] || null, link: media.link };
    },
    async post(payload) {
      const base = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
      let photo;
      const fields = { chat_id: channel };
      if (payload.photo && /^img\/cars\/[^/\\]+\.(jpg|jpeg|png|webp)$/i.test(payload.photo)) {
        const file = path.join(config.photosDir, path.basename(payload.photo));
        photo = { field: 'photo', path: file, type: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg' };
      } else if (payload.photo && /^https:\/\//.test(payload.photo)) fields.photo = payload.photo;
      const method = photo || fields.photo ? 'sendPhoto' : 'sendMessage';
      const hasPhoto = method === 'sendPhoto';
      fields[hasPhoto ? 'caption' : 'text'] = payload.text;
      if (payload.entities) fields[hasPhoto ? 'caption_entities' : 'entities'] = JSON.stringify(payload.entities);
      if (!hasPhoto && payload.entities) fields.link_preview_options = JSON.stringify({ is_disabled: true });
      let result;
      try { result = await request(`${base}/bot${config.telegramToken}/${method}`, fields, photo); }
      catch (error) {
        // Локальная ошибка файла произошла до обращения к площадке.
        error.uncertain = !['ENOENT', 'EACCES'].includes(error.code);
        throw error;
      }
      if (!result.ok) {
        const error = new Error(`Telegram: ${result.description || 'публикация отклонена'}`);
        error.retryable = result.error_code === 429;
        error.retryAfter = result.parameters?.retry_after;
        error.uncertain = result.error_code >= 500;
        throw error;
      }
      const message = result.result;
      if (!message?.message_id) throw Object.assign(new Error('Telegram не вернул ID сообщения'), { uncertain: true });
      return { id: message.message_id, url: String(channel).startsWith('@') ? `https://t.me/${channel.slice(1)}/${message.message_id}` : null };
    }
  };
}

function createPostPublishers(config, vk) {
  const list = [];
  if (config.telegramToken && config.postTelegramChannel) list.push(telegramPublisher(config));
  const status = vk?.status();
  if (status?.connected && status.groupId) list.push({
    key: `vk:${status.groupId}`, name: `VK ${status.groupName || status.groupId}`,
    prepare(media) {
      if (media.text.length > 4000) throw new Error('Сократите описание для VK до 4000 символов');
      return { text: media.text, photos: media.photos, car: media.car, link: media.link };
    },
    async post(payload) {
      // postCar использует актуальный сохранённый OAuth-токен и обновляет его.
      try { return await vk.postCar(payload.car, payload.link, { text: payload.text, strictPhotos: true }); }
      catch (error) { error.uncertain = error.uncertain || error instanceof SyntaxError || /timeout|ECONN|EPIPE|ответ не JSON/i.test(error.message); throw error; }
    }
  });
  return list;
}

module.exports = { createPostPublishers, telegramPublisher };
