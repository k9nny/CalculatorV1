'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCrm } = require('../server/crm');

test('CRM объединяет старую квитанцию VK и копии в предпросмотрах, различает видео, закрытый доступ и план', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const vk = { postId: 124, url: 'https://vk.ru/wall-32_124' };
  const cars = [{ id: 1, vk }, { id: '2' }, { id: 3, demo: true }];
  const channels = [{ key: 'vk:32', name: 'VK ANDO' }];
  const listing = { id: 'batch1', kind: 'listing', carId: '1', jobs: [
    { ...channels[0], status: 'posted', url: vk.url, receiptId: vk.postId }
  ] };
  const future = '2026-11-25T17:00:00Z';
  const batches = [
    listing, { ...listing, id: 'batch2' },
    { id: 'batch3', carId: '1', kind: 'video', scheduledAt: future, jobs: [
      { key: 'telegram:@ando', status: 'queued' },
      { key: 'youtube:channel', status: 'posted', privacyStatus: 'private', receiptId: 'video1' }
    ] },
    { id: 'batch4', carId: '4', title: 'Lada Vesta', kind: 'video', jobs: [
      { key: 'telegram:@ando', status: 'posted', postedAt: now.toISOString() }
    ] },
    { id: 'batch5', carId: '3', kind: 'listing', jobs: [{ key: 'test', status: 'posted' }] }
  ];
  const result = buildCrm(cars, batches, channels, [
    { car: { id: 1 }, done: true }, { car: { id: 1 } }, { car: { id: 3 } }
  ], now);
  assert.deepEqual(result.totals, { cars: 2, publishedCars: 1, unpublishedCars: 1, postedListings: 1, postedVideos: 1,
    scheduled: 1, queued: 0, attention: 0, uploaded: 1, leads: 2, openLeads: 1, unassignedLeads: 0 });
  assert.equal(result.cars[0].publications.length, 3);
  assert.equal(result.cars[0].publications[1].scheduledAt, future);
  assert.equal(result.cars[2].title, 'Lada Vesta');
  assert.equal(result.cars[2].inCatalog, false);
});
