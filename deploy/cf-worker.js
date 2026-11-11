// Бесплатный посредник для Telegram Bot API на Cloudflare Workers — когда сервер в России не видит api.telegram.org.
// Вставить целиком в Cloudflare → Workers → Create → Edit code → Deploy.
// Пропускает только запросы ботов (/bot…, /file/bot…); на любой другой адрес отвечает 404.
// Токен бота здесь не хранится: его присылает сам сервер в адресе запроса, как и самому Telegram.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!/^\/(file\/)?bot\d+:[\w-]+\//.test(url.pathname)) {
      return new Response('Not found', { status: 404 });
    }
    const target = 'https://api.telegram.org' + url.pathname + url.search;
    const headers = new Headers();
    const type = request.headers.get('content-type');
    if (type) headers.set('content-type', type);
    return fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body
    });
  }
};
