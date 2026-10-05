import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24's type-stripping runner needs the explicit TypeScript extension.
// @ts-ignore -- standalone node --test import
import { fetchPagedItems } from './selection-load.ts';
// @ts-ignore -- standalone node --test import
import { regionApplications } from './selection-groups.ts';

test('region filter hides only other regions, counts all pages and preserves order/source', async () => {
  const all = await fetchPagedItems(async (page) => ({ items: [{ id: page, region: page === 2 ? 'القصيم' : 'الرياض' }], totalPages: 3 }));
  const before = JSON.stringify(all);
  assert.deepEqual(regionApplications(all, 'الرياض').map((row) => row.id), [1, 3]);
  assert.equal(regionApplications(all, 'القصيم').length, 1);
  assert.deepEqual(regionApplications(all, ''), all);
  assert.deepEqual(regionApplications(all, 'غير موجودة'), []);
  assert.equal(JSON.stringify(all), before);
});

test('selection board fetches pages concurrently with a bound and preserves order', async () => {
  let active = 0;
  let peak = 0;
  const calls: number[] = [];
  const rows = await fetchPagedItems(async (page) => {
    calls.push(page);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, page === 2 ? 12 : 2));
    active--;
    return { items: [page], totalPages: 8 };
  }, 3);
  assert.deepEqual(rows, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(calls.length, 8);
  assert.ok(peak > 1 && peak <= 3);
});

test('selection board propagates page failure instead of showing an incomplete list', async () => {
  await assert.rejects(fetchPagedItems(async (page) => {
    if (page === 2) throw new Error('page failed');
    return { items: [page], totalPages: 3 };
  }), /page failed/);
});
