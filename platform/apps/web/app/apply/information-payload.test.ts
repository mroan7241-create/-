import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore -- standalone node --test needs the explicit extension
import { buildInformationPayload } from './information-payload.ts';

test('requested dotted fields update their nested application values', () => {
  assert.deepEqual(buildInformationPayload([
    { type: 'FIELD', key: 'coordinator.phone' },
    { type: 'FIELD', key: 'organization.name' },
    { type: 'ATTACHMENT', key: 'licenseFile' },
  ], { 'coordinator.phone': '  512345678  ', 'organization.name': ' جمعية اختبار ' }), {
    coordinator: { phone: '512345678' },
    organization: { name: 'جمعية اختبار' },
  });
});

test('unsafe or conflicting requested field paths are rejected', () => {
  assert.throws(() => buildInformationPayload([{ type: 'FIELD', key: '__proto__.admin' }], {}));
  assert.throws(() => buildInformationPayload([{ type: 'FIELD', key: 'coordinator' }, { type: 'FIELD', key: 'coordinator.phone' }], {}));
});

test('requested numeric and yes/no fields preserve their data types', () => {
  assert.deepEqual(buildInformationPayload([
    { type: 'FIELD', key: 'finance.revenue', kind: 'number' },
    { type: 'FIELD', key: 'readiness.canDocumentDigitally', kind: 'boolean' },
  ], { 'finance.revenue': '15000', 'readiness.canDocumentDigitally': 'false' }), {
    finance: { revenue: 15000 }, readiness: { canDocumentDigitally: false },
  });
});

test('requested multi-value fields preserve arrays and reject an empty selection', () => {
  assert.deepEqual(buildInformationPayload([{ type: 'FIELD', key: 'organization.sectors', kind: 'array' }], {
    'organization.sectors': ' خدمات اجتماعية، تنمية مجتمعية\nأخرى ',
  }), { organization: { sectors: ['خدمات اجتماعية', 'تنمية مجتمعية', 'أخرى'] } });
  assert.throws(() => buildInformationPayload([{ type: 'FIELD', key: 'organization.sectors', kind: 'array' }], {
    'organization.sectors': ' ، ,\n ',
  }));
});
