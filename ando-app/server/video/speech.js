'use strict';
// Текст для озвучки: числа словами, латиница кириллицей, сокращения полностью.
// RHVoice читает цифры без согласования («две тысячи рублей» превращается
// в «два тысяча»), поэтому всё, что звучит в ролике, пишем словами.

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
  'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function triad(n, fem) {
  const out = [];
  out.push(HUNDREDS[Math.floor(n / 100)]);
  const t = n % 100;
  if (t >= 10 && t < 20) out.push(TEENS[t - 10]);
  else { out.push(TENS[Math.floor(t / 10)]); out.push((fem ? ONES_F : ONES_M)[t % 10]); }
  return out.filter(Boolean).join(' ');
}

// numWords(52000) → «пятьдесят две тысячи»; fem — для «одна/две» (сила, тысяча).
function numWords(n, fem = false) {
  n = Math.round(Math.abs(Number(n) || 0));
  if (n === 0) return 'ноль';
  const parts = [];
  const mil = Math.floor(n / 1e6), th = Math.floor(n / 1e3) % 1000, rest = n % 1000;
  if (mil) parts.push(triad(mil, false), plural(mil, 'миллион', 'миллиона', 'миллионов'));
  if (th) parts.push(triad(th, true), plural(th, 'тысяча', 'тысячи', 'тысяч'));
  if (rest) parts.push(triad(rest, fem));
  return parts.join(' ');
}

const rub = (n) => `${numWords(n)} ${plural(n, 'рубль', 'рубля', 'рублей')}`;
const km = (n) => `${numWords(n)} ${plural(n, 'километр', 'километра', 'километров')}`;
const hp = (n) => `${numWords(n, true)} ${plural(n, 'лошадиная сила', 'лошадиные силы', 'лошадиных сил')}`;

function litres(v) {
  const x = Number(v);
  if (!x) return '';
  if (Number.isInteger(x)) return `${numWords(x)} ${plural(x, 'литр', 'литра', 'литров')}`;
  const [a, b] = x.toFixed(1).split('.');
  return `${numWords(+a)} и ${numWords(+b)}`;
}

const MAKES = {
  'mercedes-benz': 'Мерседес', mercedes: 'Мерседес', bmw: 'бэ эм вэ', audi: 'Ауди', kia: 'Киа',
  toyota: 'Тойота', lada: 'Лада', hyundai: 'Хёндай', volkswagen: 'Фольксваген', skoda: 'Шкода',
  renault: 'Рено', nissan: 'Ниссан', chery: 'Чери', haval: 'Хавал', geely: 'Джили', ford: 'Форд',
  chevrolet: 'Шевроле', mitsubishi: 'Мицубиси', mazda: 'Мазда', honda: 'Хонда', lexus: 'Лексус',
  volvo: 'Вольво', opel: 'Опель', peugeot: 'Пежо', citroen: 'Ситроен', 'land rover': 'Ленд Ровер',
  porsche: 'Порше', infiniti: 'Инфинити', subaru: 'Субару', suzuki: 'Сузуки', daewoo: 'Дэу',
  uaz: 'УАЗ', gaz: 'ГАЗ', exeed: 'Эксид', omoda: 'Омода', changan: 'Чанган', jetour: 'Джетур',
  tank: 'Танк', datsun: 'Датсун', ravon: 'Равон', jeep: 'Джип', mini: 'Мини', genesis: 'Дженезис',
};

const WORDS = {
  rio: 'Рио', camry: 'Камри', corolla: 'Королла', vesta: 'Веста', granta: 'Гранта', solaris: 'Солярис',
  creta: 'Крета', polo: 'Поло', octavia: 'Октавия', rapid: 'Рапид', duster: 'Дастер', logan: 'Логан',
  sandero: 'Сандеро', qashqai: 'Кашкай', 'x-trail': 'Икс Трейл', tiguan: 'Тигуан', sportage: 'Спортейдж',
  sorento: 'Соренто', ceed: 'Сид', cerato: 'Серато', optima: 'Оптима', tucson: 'Туксон', 'santa': 'Санта',
  fe: 'Фе', focus: 'Фокус', jolly: 'Джолли', largus: 'Ларгус', niva: 'Нива', xray: 'Икс Рей',
  outlander: 'Аутлендер', 'cx-5': 'Си Икс пять', jetta: 'Джетта', passat: 'Пассат', 'класс': 'класс',
  rav: 'Рав', tiggo: 'Тигго', jolion: 'Джолион', coolray: 'Кулрей', monjaro: 'Монжаро', patriot: 'Патриот',
};

const LETTERS = { a: 'а', b: 'бэ', c: 'цэ', d: 'дэ', e: 'е', f: 'эф', g: 'гэ', h: 'аш', i: 'ай', j: 'джей',
  k: 'ка', l: 'эль', m: 'эм', n: 'эн', o: 'о', p: 'пэ', q: 'кью', r: 'эр', s: 'эс', t: 'тэ', u: 'у',
  v: 'вэ', w: 'дабл ю', x: 'икс', y: 'игрек', z: 'зэт' };

const DIGRAPHS = [['sch', 'ш'], ['sh', 'ш'], ['ch', 'ч'], ['kh', 'х'], ['ts', 'ц'], ['ph', 'ф'], ['th', 'т'],
  ['oo', 'у'], ['ee', 'и'], ['ya', 'я'], ['yu', 'ю'], ['ye', 'е'], ['zh', 'ж']];
const SINGLE = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к',
  l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в',
  x: 'кс', y: 'й', z: 'з' };

function translitWord(w) {
  const low = w.toLowerCase();
  if (WORDS[low]) return WORDS[low];
  // Короткие аббревиатуры и одиночные буквы («S», «GLE», «RAV») — побуквенно.
  if (/^[a-z]{1,3}$/i.test(w) && (w === w.toUpperCase() || w.length === 1)) {
    return low.split('').map((ch) => LETTERS[ch]).join(' ');
  }
  let out = '', i = 0;
  while (i < low.length) {
    const d = DIGRAPHS.find(([k]) => low.startsWith(k, i));
    if (d) { out += d[1]; i += d[0].length; continue; }
    out += SINGLE[low[i]] || low[i];
    i++;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// «S-Класс» → «эс класс», «RAV4» → «рав четыре».
function sayLatin(text) {
  return String(text || '')
    .replace(/(\p{L})(\d+)/gu, '$1 $2')
    .replace(/-/g, ' ')
    .replace(/[A-Za-z]+/g, translitWord)
    .replace(/\d+/g, (d) => numWords(+d))
    .replace(/\s+/g, ' ')
    .trim();
}

function sayMake(make) {
  const m = String(make || '').trim();
  return MAKES[m.toLowerCase()] || sayLatin(m);
}

const sayCar = (car) => `${sayMake(car.make)} ${sayLatin(car.model)}`.trim();

// Аббревиатуры, которые синтезатор иначе читает как слово.
const ABBR = { 'ПТС': 'пэтээс', 'ГРМ': 'гэ эр эм', 'АКПП': 'а ка пэ пэ', 'МКПП': 'эм ка пэ пэ', 'ДВС': 'дэ вэ эс',
  'ДТП': 'дэ тэ пэ', 'ГБО': 'гэ бэ о', 'ABS': 'абээс', 'ESP': 'и эс пи', 'VIN': 'вин', 'ТО': 'тэ о' };
const abbr = (text) => String(text).replace(/[A-ZА-ЯЁ]{2,4}/g, (m) => ABBR[m] || m);

module.exports = { abbr, numWords, plural, rub, km, hp, litres, sayLatin, sayMake, sayCar };
