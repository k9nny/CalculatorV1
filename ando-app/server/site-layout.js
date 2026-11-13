'use strict';
// Общие куски страниц сайта для поисковиков: шапка, подвал, форма заявки, разметка schema.org.
// Используют страницы машин (server/seo.js, на лету) и страницы услуг (internal/build-pages.js, при сборке).
// root — путь до корня сайта от текущей страницы: '' для главной, '../' для /cars/, '../../' для /cars/101/.

const PHONE = '+79283339570';
const PHONE_LABEL = '+7 (928) 333-95-70';
const CITY = 'Москва';
const REGION = 'Москва и Московская область';
const BRAND = 'ANDO AUTO';
const SELLER = {
  name: 'ИП Семенюк Марк Вячеславович',
  inn: '230914702494',
  ogrnip: '323237500354611',
  registered: 'от 30.08.2023, МИФНС России № 16 по Краснодарскому краю'
};
const VK_URL = 'https://vk.ru/andoauto';
const SAME_AS = ['https://t.me/andoavtobot', 'https://max.ru/join/Ow6AUctKrPUqeZonaOx3PEoVxAVsQgykyW2uXxQHO1E', VK_URL];

// Страницы услуг: адрес, заголовок для меню. Тексты — в internal/build-pages.js.
const PAGES = [
  { slug: 'vykup-avto-posle-dtp', nav: 'После ДТП' },
  { slug: 'vykup-kreditnyh-avto', nav: 'В кредите и залоге' },
  { slug: 'vykup-avto-ne-na-hodu', nav: 'Не на ходу' }
];

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const WORDMARK = '<svg class="wordmark" viewBox="0 0 112 22" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="1,21 12,1 23,21"/><polyline points="32,21 32,1 52,21 52,1"/><path d="M61 1H71A10 10 0 0 1 71 21H61Z"/><g class="logo-wheel"><circle cx="100" cy="11" r="10"/><circle cx="100" cy="11" r="6.3" stroke-width="1"/><path d="M100 4.7V8.6M106 9.05 102.3 10.26M103.7 16.1 101.4 12.94M96.3 16.1 98.6 12.94M94 9.05 97.7 10.26" stroke-width="1.1" stroke-linecap="round"/><circle cx="100" cy="11" r="1.7" fill="currentColor" stroke="none"/></g></svg>';
const I = (d) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  phone: I('<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>'),
  arrow: '<svg class="i arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  check: I('<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>')
};

// <head>: заголовок, описание, канонический адрес, превью для соцсетей, разметка.
// image — полный адрес или путь от корня сайта (siteUrl).
function head({ root, siteUrl, title, description, canonical, image, jsonLd = [], robots = '', extraCss = [] }) {
  const img = image || 'assets/og.jpg';
  const imgUrl = /^https?:/.test(img) ? img : siteUrl + img;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${robots ? `<meta name="robots" content="${esc(robots)}">\n` : ''}<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(imgUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0B0B0C">
<link rel="icon" href="${root}app/favicon.svg" type="image/svg+xml">
<script>(function(){var d=document.documentElement;if('IntersectionObserver' in window&&!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches))d.classList.add('js')})()</script>
<link rel="stylesheet" href="${root}assets/fonts.css">
<link rel="stylesheet" href="${root}assets/ui.css">
<link rel="stylesheet" href="${root}assets/site.css">
<link rel="stylesheet" href="${root}assets/pages.css">
${extraCss.map((c) => `<link rel="stylesheet" href="${root}${c}">`).join('\n')}
${jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>`;
}

function header(root) {
  const home = root || './';
  return `
<header class="site-header" id="site-header">
  <div class="wrap">
    <a class="brand" href="${home}" aria-label="${BRAND}, на главную">
      ${WORDMARK}
      <span class="brand-sub">AUTO<small>выкуп и продажа</small></span>
    </a>
    <nav class="nav" aria-label="Разделы">
      <a href="${home}#process">Выкуп</a>
      <a href="${root}cars/" class="keep">Машины в продаже</a>
      <a href="${home}#faq">Вопросы</a>
    </nav>
    <a class="header-phone" href="tel:${PHONE}">${PHONE_LABEL}</a>
    <a class="icon-btn call-btn" href="tel:${PHONE}" aria-label="Позвонить: ${PHONE_LABEL}">${ICON.phone}</a>
    <a class="btn btn-primary header-cta" href="#sell">Продать авто</a>
  </div>
</header>`;
}

// Форма заявки на выкуп. id те же, что на главной: её обрабатывает assets/site.js.
function leadForm(title = 'Продать автомобиль') {
  return `
      <div class="lead-card light" id="sell">
        <form class="lead-form" id="form-hero" novalidate>
          <h2>${esc(title)}</h2>
          <label class="field"><span>Марка и модель</span>
            <input id="hero-model" name="model" autocomplete="off" placeholder="Например, Kia Rio, 2019">
            <span class="err" aria-live="polite"></span>
          </label>
          <label class="field"><span>Телефон</span>
            <input id="hero-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__" data-phone>
            <span class="err" aria-live="polite"></span>
          </label>
          <div class="field consent-field">
            <label class="consent">
              <input type="checkbox" id="hero-consent" name="consent" required>
              <span>Даю <a href="ROOT_consent.html" target="_blank">согласие на обработку персональных данных</a> на условиях <a href="ROOT_privacy.html" target="_blank">политики</a></span>
            </label>
            <span class="err" aria-live="polite"></span>
          </div>
          <button class="btn btn-primary btn-block" type="submit">Заказать звонок</button>
        </form>
        <div class="done" hidden tabindex="-1">
          <span class="done-mark">${ICON.check}</span>
          <h3>Заявка принята</h3>
          <p>Перезвоним на <span data-done-phone></span>.</p>
          <button class="linkish" type="button" data-reset>Отправить другую заявку</button>
        </div>
      </div>`;
}

function crumbs(root, items) {
  return `<nav class="crumbs" aria-label="Навигация"><a href="${root || './'}">Главная</a>${items.map((it) =>
    it.href ? `<span aria-hidden="true">/</span><a href="${esc(it.href)}">${esc(it.name)}</a>` : `<span aria-hidden="true">/</span><span aria-current="page">${esc(it.name)}</span>`).join('')}</nav>`;
}

function faq(items, title = 'Вопросы и ответы') {
  return `
  <section class="section" id="faq" aria-labelledby="faq-title">
    <div class="wrap faq-grid">
      <div class="section-titles" data-reveal>
        <p class="eyebrow">Вопросы</p>
        <h2 class="display" id="faq-title">${esc(title)}</h2>
      </div>
      <div class="faq" data-reveal style="--d:.1s">
${items.map(([q, a]) => `        <details>
          <summary>${esc(q)}<span class="plus" aria-hidden="true"></span></summary>
          <p class="answer">${esc(a)}</p>
        </details>`).join('\n')}
      </div>
    </div>
  </section>`;
}

function band(title = 'Продаёте машину?', text = 'Оставьте номер — перезвоним и назовём предварительную цену.') {
  return `
  <section class="band dark" aria-labelledby="band-title">
    <div class="wrap">
      <div data-reveal>
        <h2 id="band-title">${esc(title)}</h2>
        <p>${esc(text)}</p>
      </div>
      <div class="band-actions" data-reveal style="--d:.1s">
        <a class="btn btn-primary" href="#sell">Продать авто</a>
        <a class="band-phone" href="tel:${PHONE}">${PHONE_LABEL}</a>
      </div>
    </div>
  </section>`;
}

function footer(root, { scripts = true } = {}) {
  const home = root || './';
  return `
<footer class="site-footer dark">
  <div class="wrap">
    <div class="footer-top">
      <a class="brand" href="${home}" aria-label="${BRAND}, на главную">
      ${WORDMARK}
      <span class="brand-sub">AUTO<small>выкуп и продажа</small></span>
      </a>
      <nav class="footer-nav" aria-label="Разделы в подвале">
        <a href="${home}#process">Выкуп авто</a>
${PAGES.map((p) => `        <a href="${root}${p.slug}/">${esc(p.nav)}</a>`).join('\n')}
        <a href="${root}cars/">Машины в продаже</a>
        <a href="${VK_URL}" target="_blank" rel="noopener">ВКонтакте</a>
        <a href="tel:${PHONE}">${PHONE_LABEL}</a>
      </nav>
    </div>
    <div class="footer-bottom">
      <!-- Реквизиты продавца обязательны (Закон о защите прав потребителей, ст. 9). -->
      <address class="requisites">
        <span>${esc(SELLER.name)}</span>
        <span>ИНН ${SELLER.inn} · ОГРНИП ${SELLER.ogrnip} ${esc(SELLER.registered)}</span>
      </address>
      <div class="footer-links">
        <a href="${root}privacy.html">Политика обработки персональных данных</a>
        <a href="${root}consent.html">Согласие на обработку данных</a>
      </div>
    </div>
  </div>
</footer>
${scripts ? `<script src="${root}assets/vendor/lenis.min.js"></script>
<script src="${root}app/card.js"></script>
<script src="${root}assets/site.js"></script>` : ''}
</body>
</html>
`;
}

// Организация для поисковиков. Адрес не указываем: работаем с выездом, офиса для клиентов нет.
function orgJsonLd(siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    '@id': siteUrl + '#org',
    name: BRAND,
    url: siteUrl,
    logo: siteUrl + 'assets/logo.png',
    image: siteUrl + 'assets/og.jpg',
    telephone: PHONE,
    priceRange: '₽₽',
    areaServed: [{ '@type': 'City', name: 'Москва' }, { '@type': 'AdministrativeArea', name: 'Московская область' }],
    sameAs: SAME_AS,
    legalName: SELLER.name,
    taxID: SELLER.inn
  };
}

function faqJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
  };
}

function breadcrumbsJsonLd(siteUrl, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Главная', url: siteUrl }, ...items].map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url }))
  };
}

// Подставить путь до корня в ссылки формы.
function withRoot(html, root) { return html.replace(/ROOT_/g, root); }

module.exports = {
  PHONE, PHONE_LABEL, CITY, REGION, BRAND, SELLER, SAME_AS, PAGES, ICON, WORDMARK,
  esc, head, header, leadForm, crumbs, faq, band, footer, orgJsonLd, faqJsonLd, breadcrumbsJsonLd, withRoot
};
