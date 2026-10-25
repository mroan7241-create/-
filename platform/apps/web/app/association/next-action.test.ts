import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
// @ts-ignore Node test runner requires the explicit source extension.
import { associationNextAction, type AssociationCounts } from './next-action.ts';

test('CSV fallback template cannot accidentally create an example beneficiary', () => {
  const source = readFileSync(new URL('../lib/beneficiary-import.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('const csv = `${headerRow}\\n`;'));
  assert.ok(!source.includes('const exampleRow'));
});
const empty: AssociationCounts = { beneficiariesTotal: 0, beneficiariesPendingReview: 0, beneficiariesApproved: 0, beneficiariesRejected: 0, receiptsAwaitingConfirmation: 0, devicesAllocated: 0, delegates: 0, devicesWithDelegate: 0, devicesDelivered: 0, deliveriesPendingApproval: 0, deliveriesPendingReturnApproval: 0, deliveriesDeferred: 0 };
test('zero beneficiaries requires entry, not a misleading all-clear', () => {
  assert.equal(associationNextAction(empty).href, '/association/beneficiaries');
  assert.match(associationNextAction(empty).title, /إضافة/);
});
test('review belongs to Alzad and does not request another upload', () => {
  assert.equal(associationNextAction({ ...empty, beneficiariesTotal: 50, beneficiariesPendingReview: 50 }).owner, 'جمعية الزاد');
});
test('urgent physical return and receipts take precedence over entry', () => {
  assert.match(associationNextAction({ ...empty, deliveriesPendingReturnApproval: 1, receiptsAwaitingConfirmation: 1 }).href, /PENDING_RETURN_APPROVAL/);
});
test('closed participation never prompts new operational writes', () => {
  assert.equal(associationNextAction(empty, 'CLOSED').href, '/association/participation');
});
test('partial delivery is not called project completion', () => {
  assert.doesNotMatch(associationNextAction({ ...empty, beneficiariesTotal: 5, beneficiariesApproved: 5, devicesDelivered: 1 }).title, /اكتملت|مكتملة/);
});

test('uses the association record name and never infers covenant completion from an empty list', () => {
  const action = associationNextAction(empty, 'ACTIVE', 'جمعية نجباء', true);
  assert.equal(action.owner, 'جمعية نجباء');
  assert.equal(action.completed, 'توقيع الميثاق من الطرفين');
  const unknown = associationNextAction(empty, null, null, false);
  assert.doesNotMatch(unknown.completed, /توقيع الميثاق/);
  assert.doesNotMatch(unknown.detail, /الميثاق مكتمل/);
  assert.notEqual(unknown.owner, 'الجمعية');
});
