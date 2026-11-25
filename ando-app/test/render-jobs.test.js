'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRenderJobs } = require('../server/video/render-jobs');

function fixture(t, notify) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-render-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = {
    leadsLog: path.join(dir, 'private', 'leads.jsonl'), carsFile: path.join(dir, 'cars.json'),
    photosDir: path.join(dir, 'photos'), publicDir: path.join(dir, 'public')
  };
  fs.mkdirSync(config.photosDir, { recursive: true });
  fs.mkdirSync(path.join(config.publicDir, 'img', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(config.photosDir, '101-1.jpg'), 'photo');
  fs.writeFileSync(path.join(config.publicDir, 'img', 'demo', 'demo.jpg'), 'demo');
  let car = { id: '101', status: 'available', make: 'Kia', model: 'Rio', price: 1000000, photos: ['img/cars/101-1.jpg'] };
  const catalog = (patch = {}) => {
    car = { ...car, ...patch };
    fs.writeFileSync(config.carsFile, JSON.stringify({ cars: [car] }));
    return car;
  };
  catalog();
  let date = Date.parse('2026-11-19T10:00:00Z');
  const now = () => new Date(date);
  const create = () => createRenderJobs({ config, now, notify });
  const story = () => ({ version: 1, title: 'Kia', sources: car.photos.map((src) => ({ src, kind: 'photo' })), scenes: [{ text: 'Машина', sourceIndex: 0 }] });
  const mp4 = path.join(dir, 'upload.mp4');
  const contents = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom0000test')]);
  fs.writeFileSync(mp4, contents);
  return { dir, config, create, catalog, story, mp4, contents, advance: (ms) => { date += ms; }, car: () => car };
}

test('render jobs: durable dedup, cloned snapshots and path-free public claim', (t) => {
  const f = fixture(t);
  const queue = f.create();
  const car = f.car();
  const storyboard = f.story();
  const job = queue.enqueue(car, storyboard);
  const equivalent = { scenes: storyboard.scenes, sources: storyboard.sources, title: 'Kia', version: 1 };
  assert.equal(queue.enqueue(car, equivalent).id, job.id);
  car.make = 'Changed in memory';
  storyboard.scenes[0].text = 'Changed in memory';
  const restarted = f.create();
  const claimed = restarted.claim('resolve-worker');
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.storyboard.scenes[0].text, 'Машина');
  assert.equal(claimed.status, 'rendering');
  assert.equal(Date.parse(claimed.leaseExpiresAt), Date.parse('2026-11-19T10:05:00Z'));
  assert.deepEqual(claimed.sources, [{ kind: 'photo', index: 0, url: `/api/render/jobs/${job.id}/media/0` }]);
  assert.equal('sources' in claimed.storyboard, false);
  assert.equal('leaseToken' in restarted.get(job.id), false);
  assert.equal('leaseToken' in restarted.list()[0], false);
  assert.ok(!JSON.stringify(claimed).includes(f.dir));
  assert.equal(restarted.mediaFile(job.id, 0, claimed.leaseToken), path.join(f.config.photosDir, '101-1.jpg'));
  const privateState = JSON.parse(fs.readFileSync(path.join(f.dir, 'private', 'render-jobs.json')));
  assert.equal(privateState.jobs[0].car.make, 'Kia');
  assert.equal(queue.claim('another-worker'), null);
});

test('render jobs: lease heartbeat, expiry and reclaim reject old worker', (t) => {
  const f = fixture(t);
  const queue = f.create();
  const job = queue.enqueue(f.car(), f.story());
  const first = queue.claim('first');
  assert.throws(() => queue.heartbeat(job.id, 'wrong'));
  f.advance(60000);
  assert.equal(queue.heartbeat(job.id, first.leaseToken).leaseExpiresAt, '2026-11-19T10:06:00.000Z');
  f.advance(5 * 60000);
  assert.throws(() => queue.mediaFile(job.id, 0, first.leaseToken), /истекла/);
  assert.throws(() => queue.heartbeat(job.id, first.leaseToken), /истекла/);
  const second = f.create().claim('second');
  assert.equal(second.id, job.id);
  assert.notEqual(second.leaseToken, first.leaseToken);
  assert.throws(() => queue.complete(job.id, first.leaseToken, f.mp4), /другому/);
  assert.throws(() => queue.fail(job.id, first.leaseToken, 'late failure'), /другому/);
  const failed = queue.fail(job.id, second.leaseToken, 'render failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.nextAttemptAt, '2026-11-19T10:08:00.000Z');
  assert.equal(queue.claim('too-soon'), null);
  f.advance(2 * 60000);
  assert.equal(queue.claim('retry').attempts, 3);
});

test('render jobs: completion after lease timeout, output copy and idempotency survive restart', async (t) => {
  let notified = 0;
  const f = fixture(t, async () => { notified++; throw new Error('notification unavailable'); });
  const queue = f.create();
  const job = queue.enqueue(f.car(), f.story());
  const claim = queue.claim('first');
  f.advance(6 * 60000);
  const ready = queue.complete(job.id, claim.leaseToken, f.mp4);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.result.bytes, f.contents.length);
  assert.equal(ready.result.sha256, crypto.createHash('sha256').update(f.contents).digest('hex'));
  assert.equal(ready.result.publicUrl, `/api/social/video/${job.id}.mp4`);
  const output = queue.outputFile(job.id);
  assert.notEqual(output, f.mp4);
  assert.deepEqual(fs.readFileSync(output), f.contents);
  assert.equal(f.create().complete(job.id, claim.leaseToken, f.mp4).status, 'ready');
  assert.throws(() => queue.complete(job.id, 'other-lease', f.mp4));
  fs.appendFileSync(f.mp4, 'different');
  assert.throws(() => queue.complete(job.id, claim.leaseToken, f.mp4), /другим файлом/);
  fs.unlinkSync(f.mp4);
  assert.deepEqual(fs.readFileSync(output), f.contents);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notified, 1);
  assert.equal(f.create().get(job.id).status, 'ready');
  assert.throws(() => queue.mediaFile(job.id, 0, claim.leaseToken));
});

test('render jobs: changed, sold and deleted cars block claim or completion', (t) => {
  for (const patch of [{ price: 900000 }, { status: 'sold' }]) {
    const f = fixture(t);
    const queue = f.create();
    const job = queue.enqueue(f.car(), f.story());
    f.catalog(patch);
    assert.equal(queue.claim('first'), null);
    assert.equal(queue.get(job.id).status, 'blocked');
  }
  const f = fixture(t);
  const queue = f.create();
  const job = queue.enqueue(f.car(), f.story());
  const claim = queue.claim('first');
  f.catalog({ price: 800000 });
  assert.throws(() => queue.complete(job.id, claim.leaseToken, f.mp4), /изменилась/);
  assert.equal(queue.get(job.id).status, 'blocked');
  assert.throws(() => queue.outputFile(job.id));
  const next = queue.enqueue(f.car(), f.story());
  assert.notEqual(next.id, job.id);
  fs.writeFileSync(f.config.carsFile, JSON.stringify({ cars: [] }));
  assert.equal(queue.claim('first'), null);
  assert.equal(queue.get(next.id).status, 'blocked');
});

test('render jobs: model specs and external publication receipts do not invalidate revision', (t) => {
  const f = fixture(t);
  const queue = f.create();
  const first = queue.enqueue(f.car(), f.story());
  const car = f.catalog({ modelSpecs: { acceleration: 10 }, marketEstimate: { price: 2000000 }, vk: { postId: 1 } });
  assert.equal(queue.enqueue(car, f.story()).id, first.id);
  assert.equal(queue.claim('first').id, first.id);
});

test('render jobs: sources reject remotes, traversal and unapproved demo paths', (t) => {
  const f = fixture(t);
  const queue = f.create();
  for (const src of ['https://example.com/car.jpg', 'img/cars/../secret', 'img/cars/..', 'img/cars/%2e%2e', 'img/cars/a\\b.jpg', 'img/cars/a.jpg?x=1', 'img/demo/demo.jpg']) {
    const car = f.catalog({ photos: [src] });
    assert.throws(() => queue.enqueue(car, { scenes: [] }));
  }
  const demo = f.catalog({ demo: true, photos: ['img/demo/demo.jpg'] });
  const job = queue.enqueue(demo, f.story());
  const claim = queue.claim('first');
  assert.equal(queue.mediaFile(job.id, 0, claim.leaseToken), path.join(f.config.publicDir, 'img', 'demo', 'demo.jpg'));
  assert.throws(() => queue.mediaFile(job.id, -1, claim.leaseToken));
  assert.throws(() => queue.mediaFile(job.id, 9, claim.leaseToken));
});

test('render jobs: invalid MP4 and storyboard sources cannot become ready', (t) => {
  const f = fixture(t);
  const queue = f.create();
  assert.throws(() => queue.enqueue(f.car(), { sources: [{ src: 'https://example.com/car.jpg' }] }), /не совпадают/);
  const job = queue.enqueue(f.car(), f.story());
  const claim = queue.claim('first');
  fs.writeFileSync(f.mp4, 'ordinary text without mp4 header');
  assert.throws(() => queue.complete(job.id, claim.leaseToken, f.mp4), /ftyp/);
  assert.equal(queue.get(job.id).status, 'rendering');
  assert.throws(() => queue.complete(job.id, claim.leaseToken, 'https://example.com/video.mp4'), /локальный/);
  assert.throws(() => queue.complete(job.id, claim.leaseToken, f.dir));
});
