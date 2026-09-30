import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AbanmiReport } from './api';
// @ts-ignore -- Node's type-stripping runner uses the explicit TypeScript extension.
import { analyzeAbanmi, applicationStage } from './abanmi-analytics.ts';

function fixture(): AbanmiReport {
  return {
    generatedAt: '2026-09-30T00:00:00.000Z',
    overall: { associations: 2, beneficiaries: 2, approvedNeeds: 3, devices: 2, deliveries: 1 },
    applications: [
      { id: 'app-1', publicCode: 'APP-1', name: 'جمعية أ', region: 'القصيم', status: 'UNDER_REVIEW', eligibilityStatus: 'PENDING', selectionList: 'NONE', processingStarted: false, submittedAt: '2026-09-30T00:00:00.000Z' },
      { id: 'app-2', publicCode: 'APP-2', name: 'جمعية ب', region: 'الرياض', status: 'ACCEPTED', eligibilityStatus: 'PASSED', selectionList: 'MAIN', processingStarted: true, submittedAt: '2026-09-30T00:00:00.000Z' },
    ],
    associations: [
      { id: 'a', publicCode: 'ASC-1', name: 'جمعية أ', region: 'القصيم', city: 'بريدة', status: 'ACTIVE' },
      { id: 'b', publicCode: 'ASC-2', name: 'جمعية ب', region: 'الرياض', city: 'الرياض', status: 'ACTIVE' },
    ],
    byRegion: [{ region: 'القصيم', associations: 1 }, { region: 'الرياض', associations: 1 }],
    beneficiariesAndNeeds: {
      beneficiaries: [{ associationId: 'a', reviewStatus: 'APPROVED', _count: { _all: 1 } }, { associationId: 'b', reviewStatus: 'REJECTED', _count: { _all: 1 } }],
      needs: [{ associationId: 'a', deviceType: 'OVEN', decisionStatus: 'APPROVED', fulfillmentStatus: null, _count: { _all: 3 } }],
    },
    devicesAndInventory: [{ associationId: 'a', deviceType: 'OVEN', status: 'DELIVERED', _count: { _all: 1 } }, { associationId: 'a', deviceType: 'OVEN', status: 'WAREHOUSE', _count: { _all: 1 } }],
    deliveryAndExecution: [{ associationId: 'a', status: 'DELIVERY_CLOSED', _count: { _all: 1 } }],
    participation: [], associationClosure: [], projectClosure: null, activities: [],
    procurement: { purchaseOrders: [], shipments: [], receipts: [] }, allocations: [], privacy: { beneficiaryPiiIncluded: false },
  };
}

test('application stages are disjoint and the application total differs from participating associations', () => {
  const report = fixture();
  const result = analyzeAbanmi(report);
  assert.equal(result.applications.length, 2);
  assert.equal(result.stages.new, 1);
  assert.equal(result.stages.main, 1);
  assert.equal(Object.values(result.stages).reduce((sum, count) => sum + count, 0), result.applications.length);
  assert.equal(applicationStage({ ...report.applications[0], eligibilityStatus: 'NEEDS_INFO' }), 'needsInfo');
  assert.equal(applicationStage({ ...report.applications[0], status: 'ACCEPTED' }), 'unclassified');
  assert.equal(applicationStage({ ...report.applications[0], status: 'REJECTED', selectionList: 'MAIN' }), 'rejected');
});

test('progress uses approved needs, not stocked devices, and separates regions and associations', () => {
  const result = analyzeAbanmi(fixture());
  assert.equal(result.approvedNeeds, 3);
  assert.equal(result.deliveredDevices, 1);
  assert.equal(result.progressPercent, 33);
  assert.equal(result.associations.find((row) => row.id === 'a')?.progressPercent, 33);
  assert.equal(result.associations.find((row) => row.id === 'b')?.progressPercent, null);
  assert.equal(result.regions.find((row) => row.region === 'الرياض')?.delivered, 0);
  assert.equal(result.regions.find((row) => row.region === 'القصيم')?.delivered, 1);
});

test('no approved needs means no fabricated completion percentage', () => {
  const report = fixture();
  report.beneficiariesAndNeeds.needs = [];
  const result = analyzeAbanmi(report);
  assert.equal(result.progressPercent, null);
  assert.match(result.insights[1], /لا يمكن احتساب/);
});

test('date-filtered needs are not compared with all-time delivered devices', () => {
  for (const period of [{ from: '2026-09-01', to: null }, { from: null, to: '2026-09-30' }]) {
    const report = fixture();
    report.filters = { ...period, associationId: null, region: null };
    report.devicesAndInventory[0]._count._all = 10;
    const result = analyzeAbanmi(report);
    assert.equal(result.progressPercent, null);
    assert.ok(result.associations.every((row) => row.progressPercent === null));
    assert.ok(result.regions.every((row) => row.progressPercent === null));
    assert.match(result.insights[1], /لا تُحسب نسبة التغطية/);
    assert.doesNotMatch(result.insights[1], /100٪|null/);
  }
});

test('region-only filters preserve comparable coverage', () => {
  const report = fixture();
  report.filters = { from: null, to: null, associationId: null, region: 'القصيم' };
  assert.equal(analyzeAbanmi(report).progressPercent, 33);
});
