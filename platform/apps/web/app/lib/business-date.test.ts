import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore -- Node's built-in test runner resolves the TypeScript source directly.
import { riyadhDate } from './business-date.ts';

test('Riyadh calendar day changes at 21:00 UTC, independent of the device timezone', () => {
  assert.equal(riyadhDate(new Date('2026-10-24T20:59:59.999Z')), '2026-10-24');
  assert.equal(riyadhDate(new Date('2026-10-24T21:00:00.000Z')), '2026-10-25');
  assert.equal(riyadhDate(new Date('2026-12-31T21:00:00.000Z')), '2027-01-01');
});
