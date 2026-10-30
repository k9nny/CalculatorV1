'use strict';
// Каталог машин в cars.json: чтение и атомарная запись (временный файл + переименование).
const fs = require('node:fs');
const path = require('node:path');

function readCatalog(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? { cars: data } : { ...data, cars: data.cars || [] };
  } catch {
    return { cars: [] };
  }
}

function writeCatalog(file, catalog, now = new Date()) {
  const data = { ...catalog, updated: now.toISOString().slice(0, 10) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function nextId(cars) {
  const max = cars.reduce((m, c) => Math.max(m, parseInt(c.id, 10) || 0), 100);
  return String(max + 1);
}

module.exports = { readCatalog, writeCatalog, nextId };
