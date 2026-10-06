import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24's type-stripping runner needs the explicit TypeScript extension.
// @ts-ignore -- standalone node --test import
import { fetchPagedItems, fetchAffectedItems } from './selection-load.ts';
// @ts-ignore -- standalone node --test import
import { regionApplications, filterApplications, applicationCityKey, groupApplications, selectionGroup } from './selection-groups.ts';
import { readFileSync } from 'node:fs';
import type { ApplicationSummary, GeographicUnit } from '../../lib/api';

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

const regions: GeographicUnit[] = [
  { officialCode: '0001', nameAr: 'منطقة الرياض', unitType: 'REGION', parentOfficialCode: null, category: null, projectScopeGroup: 'RIYADH', hasChildren: true },
  { officialCode: '0002', nameAr: 'منطقة مكة المكرمة', unitType: 'REGION', parentOfficialCode: null, category: null, projectScopeGroup: 'WEST', hasChildren: true },
  { officialCode: '0003', nameAr: 'منطقة المدينة المنورة', unitType: 'REGION', parentOfficialCode: null, category: null, projectScopeGroup: 'WEST', hasChildren: true },
];
function row(id: string, overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return { id, name: `جمعية ${id}`, publicCode: `APP-${id}`, region: 'الرياض', city: 'الرياض', regionOfficialCode: '0001', governorateOfficialCode: '0100', eligibilityStatus: 'PASSED', selectionList: 'NONE', processingStartedAt: null, status: 'UNDER_REVIEW', ...overrides } as ApplicationSummary;
}

test('search, project group, governorate and active tab compose without changing global rank/source', () => {
  const applications = [row('1', { evaluationScore: 99 }), row('2', { region: 'مكة المكرمة', city: 'جدة', regionOfficialCode: '0002', governorateOfficialCode: '0201', selectionList: 'MAIN', evaluationScore: 90 }), row('3', { region: 'المدينة المنورة', city: 'المدينة المنورة', regionOfficialCode: '0003', governorateOfficialCode: '0300', selectionList: 'RESERVE', evaluationScore: 80 })];
  const before = JSON.stringify(applications);
  const west = filterApplications(applications, regions, { search: '', projectGroup: 'WEST', city: '' });
  assert.deepEqual(west.map((item) => item.id), ['2', '3']);
  assert.equal(groupApplications(west, 'MAIN', []).length, 1);
  assert.equal(groupApplications(west, 'RESERVE', []).length, 1);
  const filtered = filterApplications(applications, regions, { search: 'APP-2', projectGroup: 'WEST', city: applicationCityKey(applications[1]) });
  assert.deepEqual(filtered.map((item) => item.id), ['2']);
  assert.equal(applications.indexOf(filtered[0]) + 1, 2);
  assert.equal(filterApplications(applications, regions, { search: 'جمعية 3', projectGroup: 'WEST', city: '' }).length, 1);
  assert.equal(JSON.stringify(applications), before);
});

test('historical location remains in all results; malformed official code is not guessed into a group', () => {
  const history = row('history', { regionOfficialCode: null, governorateOfficialCode: null });
  const invalid = row('invalid', { regionOfficialCode: 'unknown' });
  const unknown = row('other', { regionOfficialCode: null, region: 'غير موثق' });
  assert.equal(filterApplications([history, invalid, unknown], regions, { search: '', projectGroup: '', city: '' }).length, 3);
  assert.deepEqual(filterApplications([history, invalid, unknown], regions, { search: '', projectGroup: 'RIYADH', city: '' }).map((item) => item.id), ['history']);
});

test('final nonacceptance is separate from failed eligibility and waiting selection', () => {
  assert.equal(selectionGroup(row('declined', { status: 'REJECTED', eligibilityStatus: 'PASSED', selectionList: 'NONE' })), 'DECLINED');
  assert.equal(selectionGroup(row('failed', { status: 'REJECTED', eligibilityStatus: 'FAILED' })), 'FAILED');
  assert.equal(selectionGroup(row('waiting')), 'PASSED_UNSELECTED');
});

test('affected refresh reads only unique affected ids, bounded to four, and preserves requested order', async () => {
  let active = 0, peak = 0;
  const calls: string[] = [];
  const changed = await fetchAffectedItems(['1', '2', '1', '3', '4', '5'], async (id) => {
    calls.push(id); active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, id === '1' ? 12 : 2));
    active--; return { id };
  });
  assert.deepEqual(changed.map((item) => item.id), ['1', '2', '3', '4', '5']);
  assert.equal(calls.length, 5); assert.ok(peak <= 4);
});

test('failed affected read is propagated instead of partially refreshing the source', async () => {
  const existing = [row('1'), row('2')];
  const before = JSON.stringify(existing);
  await assert.rejects(fetchAffectedItems(['1', '2'], async (id) => { if (id === '2') throw new Error('read failed'); return row(id); }), /read failed/);
  assert.equal(JSON.stringify(existing), before);
});

test('large batch refresh uses paginated reads and returns only affected records in requested order', async () => {
  const ids = Array.from({ length: 250 }, (_, index) => `${index + 1}`);
  let detailCalls = 0, pageCalls = 0;
  const changed = await fetchAffectedItems(ids, async (id) => { detailCalls++; return { id }; }, () => fetchPagedItems(async (page) => {
    pageCalls++;
    return { items: Array.from({ length: 100 }, (_, index) => ({ id: `${(page - 1) * 100 + index + 1}` })), totalPages: 3 };
  }));
  assert.equal(detailCalls, 0); assert.equal(pageCalls, 3);
  assert.deepEqual(changed.map((item) => item.id), ids);
});

test('paged affected refresh rejects missing records without partial success and keeps small actions targeted', async () => {
  let pageCalls = 0, detailCalls = 0;
  await fetchAffectedItems(Array.from({ length: 8 }, (_, index) => `${index}`), async (id) => { detailCalls++; return { id }; }, async () => { pageCalls++; return []; });
  assert.equal(detailCalls, 8); assert.equal(pageCalls, 0);
  await assert.rejects(fetchAffectedItems(Array.from({ length: 9 }, (_, index) => `${index}`), async (id) => ({ id }), async () => [{ id: '0' }]), /تعذّر تحديث/);
});

test('UI wiring preserves evaluation while showing the existing dossier, clears selection on filters, and does not truncate bulk ids', () => {
  const board = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../applications/page.tsx', import.meta.url), 'utf8');
  assert.match(board, /evaluationTarget && <EvaluationDialog[^>]*hidden=\{!!detailTarget\}/);
  assert.match(board, /closeLabel=\{evaluationTarget \? 'العودة للتقييم'/);
  assert.match(board, /setChecked\(\[\]\); \}, \[search, projectGroup, city, activeFilter, accessKey\]/);
  assert.match(board, /ids\.length > 250/);
  assert.doesNotMatch(board, /ids\.slice\(0,\s*250\)/);
  assert.match(board, /gap: 20, marginTop: 20/);
  assert.match(workspace, /mode=\{currentSection\}/);
  assert.equal((workspace.match(/mode="review"/g) ?? []).length, 0);
});

test('review mutations and manual refresh cannot overlap and invalidate the loading completion sequence', () => {
  const board = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  for (const name of ['run', 'submitInfo', 'saveEligibility', 'retryRejection']) {
    const handler = board.slice(board.indexOf(`async function ${name}(`)).split('\n  async function ')[0];
    assert.match(handler, /if \(busyRef\.current \|\| listLoading\) return/);
  }
  for (const setter of ['setEligibilityTarget', 'setInfoTarget']) assert.match(board, new RegExp(`disabled=\\{busy \\|\\| listLoading\\} onClick=\\{\\(\\) => ${setter}\\(application\\)\\}`));
  for (const dialog of ['EligibilityDialog', 'EvaluationDialog', 'InformationDialog']) assert.match(board, new RegExp(`<${dialog}[^\\n]*busy=\\{busy \\|\\| listLoading\\}`));
  assert.match(board, /disabled=\{busy \|\| listLoading\} onClick=\{\(\) => \{ if \(!busyRef\.current && !listLoading\) void load\(\); \}\}>تحديث القائمة/);
});
