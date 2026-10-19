import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore -- Node's type-stripping runner requires the explicit TypeScript extension.
import { activityOverview, exploreHref, groupActivities, matchesSearch, safeEvidenceUrl } from './portal-model.ts';
const row = (id: string, overrides = {}) => ({ id, phaseOrder: 1, phaseName: 'تهيئة', mainActivityOrder: 1, mainActivityName: 'الرئيسي', subActivityName: null, status: 'NOT_STARTED', startDate: null, ...overrides });
test('detail links never send metrics to reports and escape URL filters', () => { const href = exploreHref('associations', { region: 'الجوف & حائل', search: 'اسم' }); assert.ok(!href.includes('/reports')); assert.equal(new URL(href, 'http://localhost').searchParams.get('region'), 'الجوف & حائل'); });
test('Arabic search handles diacritics and alef forms', () => { assert.ok(matchesSearch('احسان', 'إِحسان')); assert.ok(matchesSearch('APP-0001', 'APP-0001')); });
test('external evidence permits HTTPS only and rejects credentials and scripts', () => { for (const value of ['javascript:alert(1)', 'data:x', '/admin', 'http://example.com', 'https://u:p@example.com']) assert.equal(safeEvidenceUrl(value), null); assert.equal(safeEvidenceUrl('https://example.com/evidence'), 'https://example.com/evidence'); });
test('activity grouping distinguishes phases and keeps main and children together', () => { const groups = groupActivities([row('a'), row('b', { subActivityName: 'فرعي' }), row('c', { phaseOrder: 2 })] as never); assert.equal(groups.length, 2); assert.equal(groups[0].rows.length, 2); });
test('activity overview uses saved states and next scheduled start', () => { const result = activityOverview([row('a', { status: 'COMPLETED' }), row('b', { status: 'LATE' }), row('c', { startDate: '2026-12-01' }), row('d', { startDate: '2026-11-01' })] as never); assert.equal(result.completed.length, 1); assert.equal(result.current.length, 1); assert.equal(result.upcoming[0].id, 'd'); });
test('portal print rules are scoped and keep long tables printable', () => { const css = readFileSync(new URL('./portal.css', import.meta.url), 'utf8'); assert.ok(css.includes('body:has(.ab-portal)')); assert.ok(css.includes('@page abanmi-report')); assert.ok(css.includes('display:table-header-group')); assert.ok(css.includes('overflow-wrap:anywhere')); });
test('dashboard has no accidental report destinations except explicit export entry', () => { const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'); assert.equal((source.match(/href="\/abanmi\/reports"/g) ?? []).length, 1); assert.ok(!source.includes('/reports?')); });

test('release dependency lock retains the reviewed production security patches', () => {
  const lock = JSON.parse(readFileSync(new URL('../../../../package-lock.json', import.meta.url), 'utf8'));
  for (const [name, minimum] of Object.entries({ next: '16.3.8', 'proxy-addr': '2.0.8', sharp: '0.35.5', 'source-map-js': '1.2.2' })) {
    const version = lock.packages[`node_modules/${name}`]?.version;
    assert.ok(version, `${name} must exist in the reproducible lock`);
    assert.ok(!version.includes('-'), `${name} must not use a prerelease`);
    const actual = version.split('.').map(Number), required = minimum.split('.').map(Number);
    const firstDifference = actual.findIndex((value: number, index: number) => value !== required[index]);
    assert.ok(firstDifference < 0 || actual[firstDifference] > required[firstDifference], `${name} ${version} predates reviewed patch ${minimum}`);
  }
});
