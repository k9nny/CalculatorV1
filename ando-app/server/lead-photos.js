'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const validKey = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
const limit = 900 * 1024;
const digest = token => createHash('sha256').update(token).digest('hex');

function photosDir(log, key) {
  return path.join(path.dirname(log), 'lead-photos', key);
}

function listLeadPhotos(log, key) {
  if (!validKey(key)) return [];
  try { return fs.readdirSync(photosDir(log, key)).filter(name => /^[1-3]\.jpg$/.test(name)).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function photoPath(log, key, name) {
  return validKey(key) && /^[1-3]\.jpg$/.test(name) ? path.join(photosDir(log, key), name) : null;
}

function savePhoto(log, key, bytes) {
  if (bytes.length < 6 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
      bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return { status: 400, error: 'Нужно фото JPEG.' };
  const saved = listLeadPhotos(log, key);
  const name = ['1.jpg', '2.jpg', '3.jpg'].find(file => !saved.includes(file));
  if (!name) return { status: 409, error: 'К заявке уже добавлено три фото.' };
  fs.mkdirSync(photosDir(log, key), { recursive: true, mode: 0o700 });
  fs.writeFileSync(photoPath(log, key, name), bytes, { mode: 0o600, flag: 'wx' });
  return { status: 200, count: saved.length + 1 };
}

module.exports = { listLeadPhotos, photoPath, savePhoto, limit, digest };
