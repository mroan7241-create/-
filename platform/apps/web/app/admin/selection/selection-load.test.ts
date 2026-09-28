import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24's type-stripping runner needs the explicit TypeScript extension.
// @ts-ignore -- standalone node --test import
import { fetchPagedItems } from './selection-load.ts';

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
