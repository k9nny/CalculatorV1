'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPhotoRenditions } = require('../server/photo-renditions');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-jpeg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { siteUrl: 'https://andoauto.ru/', leadsLog: path.join(dir, 'private', 'leads.jsonl'),
    carsFile: path.join(dir, 'cars.json'), photosDir: path.join(dir, 'photos') };
  fs.mkdirSync(config.photosDir);
  fs.writeFileSync(path.join(config.photosDir, '101-1.webp'), 'actual-photo-data');
  let car = { id: '101', status: 'available', photos: ['img/cars/101-1.webp'] };
  const save = (patch = {}) => {
    car = { ...car, ...patch };
    fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [car] }));
    return car;
  };
  save();
  return { dir, config, save, car: () => car };
}

function request(renditions, pathname, method = 'GET') {
  let resolve;
  const done = new Promise((finish) => { resolve = finish; });
  const response = { headers: {}, headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; },
    end(bytes) { this.body = bytes; resolve(this); },
    destroy() { resolve(this); }
  };
  const handled = renditions.handle({ method }, response, pathname);
  return { handled, done, response };
}

test('JPEG: stable content fingerprint, safe URL and aspect-preserving conversion cache', async (t) => {
  const f = fixture(t);
  const calls = [];
  const renditions = createPhotoRenditions(f.config, { run: async (args, output) => {
    calls.push({ args, output });
    fs.writeFileSync(output, JPEG);
  } });
  const url = renditions.urls(f.car())[0];
  assert.match(url, /^https:\/\/andoauto\.ru\/api\/social\/photo\/101\/0\/[a-f0-9]{16}\.jpg$/);
  assert.equal(renditions.urls(f.car())[0], url);
  const pathname = new URL(url).pathname;
  const first = request(renditions, pathname);
  const parallel = request(renditions, pathname);
  assert.equal(first.handled, true);
  assert.equal((await first.done).status, 200);
  assert.deepEqual(first.response.body, JPEG);
  assert.equal(first.response.headers['Content-Type'], 'image/jpeg');
  assert.equal((await parallel.done).status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[calls[0].args.indexOf('-vf') + 1], /force_original_aspect_ratio=decrease,pad=1080:1350/);
  assert.equal(calls[0].args[calls[0].args.indexOf('-q:v') + 1], '2');
  assert.ok(calls[0].output.startsWith(path.join(f.dir, 'private', 'social-jpeg')));
  const head = request(renditions, pathname, 'HEAD');
  assert.equal((await head.done).status, 200);
  assert.equal(head.response.body, undefined);
  assert.equal(calls.length, 1);
});

test('JPEG: changed source bytes invalidate old URL even when cache exists', async (t) => {
  const f = fixture(t);
  let calls = 0;
  const renditions = createPhotoRenditions(f.config, { run: async (_args, output) => { calls++; fs.writeFileSync(output, JPEG); } });
  const original = renditions.urls(f.car())[0];
  await request(renditions, new URL(original).pathname).done;
  fs.writeFileSync(path.join(f.config.photosDir, '101-1.webp'), 'new-photo-data');
  const current = renditions.urls(f.car())[0];
  assert.notEqual(current, original);
  assert.equal((await request(renditions, new URL(original).pathname).done).status, 404);
  assert.equal((await request(renditions, new URL(current).pathname).done).status, 200);
  assert.equal(calls, 2);
});

test('JPEG: sold, deleted and demo cars cannot expose cached photos', async (t) => {
  const f = fixture(t);
  const renditions = createPhotoRenditions(f.config, { run: async (_args, output) => fs.writeFileSync(output, JPEG) });
  const pathname = new URL(renditions.urls(f.car())[0]).pathname;
  assert.equal((await request(renditions, pathname).done).status, 200);
  for (const patch of [{ status: 'sold' }, { status: 'reserved' }, { status: 'available', demo: true }]) {
    f.save(patch);
    assert.equal((await request(renditions, pathname).done).status, 404);
    assert.throws(() => renditions.urls(f.car()), /доступная/);
  }
  fs.writeFileSync(f.config.carsFile, JSON.stringify({ cars: [] }));
  assert.equal((await request(renditions, pathname).done).status, 404);
});

test('JPEG: public HTTPS JPEG passes through; remotes of other types are rejected without fetching', (t) => {
  const f = fixture(t);
  const renditions = createPhotoRenditions(f.config);
  for (const src of ['https://cdn.example/car.jpg', 'https://cdn.example/car.jpeg?version=2']) {
    assert.deepEqual(renditions.urls({ ...f.car(), photos: [src] }), [src]);
  }
  for (const src of ['https://cdn.example/car.webp', 'https://cdn.example/car.png', 'http://cdn.example/car.jpg', 'https://user:secret@cdn.example/car.jpg']) {
    assert.throws(() => renditions.urls({ ...f.car(), photos: [src] }), /Instagram/);
  }
});

test('JPEG: traversal, missing inputs and malformed public paths cannot launch conversion', async (t) => {
  const f = fixture(t);
  let runs = 0;
  const renditions = createPhotoRenditions(f.config, { run: async () => { runs++; } });
  for (const src of ['img/cars/../private.jpg', 'img/cars/%2e%2e.jpg', 'img/cars/a\\b.jpg', 'img/cars/x.webp?foo=1', 'img/demo/demo.jpg', 'img/cars/absent.jpg']) {
    assert.throws(() => renditions.urls({ ...f.car(), photos: [src] }));
  }
  for (const pathname of ['/api/social/photo/../0/0000000000000000.jpg', '/api/social/photo/101/10/0000000000000000.jpg', '/api/social/photo/101/0/bad.jpg', '/api/social/photo/101/%2e%2e/0000000000000000.jpg']) {
    assert.equal(request(renditions, pathname).handled, false);
  }
  const url = renditions.urls(f.car())[0];
  const post = request(renditions, new URL(url).pathname, 'POST');
  assert.equal((await post.done).status, 405);
  assert.equal(post.response.headers.Allow, 'GET, HEAD');
  assert.equal(runs, 0);
});

test('JPEG: conversion failure leaves no cache and next request can recover', async (t) => {
  const f = fixture(t);
  let runs = 0;
  const renditions = createPhotoRenditions(f.config, { run: async (_args, output) => {
    runs++;
    fs.writeFileSync(output, runs === 1 ? Buffer.from('wrong format') : JPEG);
  } });
  const pathname = new URL(renditions.urls(f.car())[0]).pathname;
  assert.equal((await request(renditions, pathname).done).status, 503);
  assert.deepEqual(fs.readdirSync(path.join(f.dir, 'private', 'social-jpeg')), []);
  assert.equal((await request(renditions, pathname).done).status, 200);
  assert.equal(runs, 2);
});

test('JPEG: car changed while rendering is denied and ten-photo limit is stable', async (t) => {
  const f = fixture(t);
  const renditions = createPhotoRenditions(f.config, { run: async (_args, output) => {
    f.save({ status: 'sold' });
    fs.writeFileSync(output, JPEG);
  } });
  assert.equal(renditions.urls({ ...f.car(), photos: Array(12).fill(f.car().photos[0]) }).length, 10);
  const pathname = new URL(renditions.urls(f.car())[0]).pathname;
  assert.equal((await request(renditions, pathname).done).status, 404);
});
