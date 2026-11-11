'use strict';
// Настройка админки на сервере (запускает deploy/admin.sh):
//   echo 'пароль' | LEADS_LOG=… node server/admin-cli.js            — задать пароль; секретный адрес создаётся, если его нет
//   LEADS_LOG=… node server/admin-cli.js --new-link                — новый секретный адрес, все входы сбрасываются
//   LEADS_LOG=… node server/admin-cli.js --show                    — показать адрес
// Печатает SLUG=<адрес>. Сам адрес хранится только на сервере, рядом с журналом заявок.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newSlug(len = 24) {
  let out = '';
  while (out.length < len) {
    const b = crypto.randomBytes(1)[0];
    if (b < 252) out += ALPHABET[b % 36]; // 252 = 36·7: без перекоса в сторону первых символов
  }
  return out;
}

function stateFile(env = process.env) {
  const leads = path.resolve(env.LEADS_LOG || path.join(__dirname, '..', 'data-private', 'leads.jsonl'));
  return path.join(path.dirname(leads), 'admin.json');
}

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
function write(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(st), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

function setPassword(file, password) {
  if (String(password).length < 10) throw new Error('Пароль — не короче 10 символов.');
  const st = read(file);
  const salt = crypto.randomBytes(16).toString('hex');
  st.salt = salt;
  st.hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  st.secret = crypto.randomBytes(32).toString('hex');
  if (!st.slug) st.slug = newSlug();
  write(file, st);
  return st.slug;
}

function rotateLink(file) {
  const st = read(file);
  st.slug = newSlug();
  st.secret = crypto.randomBytes(32).toString('hex');
  write(file, st);
  return st.slug;
}

if (require.main === module) {
  const file = stateFile();
  const mode = process.argv[2] || '';
  try {
    if (mode === '--show') {
      const st = read(file);
      if (!st.slug) throw new Error('Админка ещё не настроена.');
      console.log('SLUG=' + st.slug);
    } else if (mode === '--new-link') {
      console.log('SLUG=' + rotateLink(file));
    } else {
      const input = fs.readFileSync(0, 'utf8').split('\n')[0];
      console.log('SLUG=' + setPassword(file, input));
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { newSlug, stateFile, setPassword, rotateLink };
