import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore -- standalone Node type-stripping runner.
import { applicationSectors, fileCityKey, fileRegionKey, fileFilterOptions, filterFileApplications, loadFileApplications, savedEvaluationRows } from './file-filters.ts';
import type { ApplicationSummary } from '../../lib/api';
import { readFileSync } from 'node:fs';

const app = (patch: Partial<ApplicationSummary> = {}) => ({ id: 'a', publicCode: 'APP-000001', name: 'جمعية', sector: null, city: 'المركز', region: 'الرياض', regionOfficialCode: '01', governorateOfficialCode: '011', status: 'ACCEPTED', eligibilityStatus: 'PASSED', selectionList: 'RESERVE', processingStartedAt: '2026-10-10', ...patch } as ApplicationSummary);
const empty = { search: '', status: '', workflow: '', city: '', sector: '' };

test('reference dropdown names only; free text grouped as Other at the end without losing applications', () => {
  const allowed=['رعاية الأيتام','التنمية المجتمعية','أخرى'];
  const list=[app({sector:'رعاية الأيتام'}),app({id:'b',sector:'وصف حر طويل'}),app({id:'c',v2Payload:{organization:{sectors:['التنمية المجتمعية','أخرى'],sectorOther:'علمية'}}})];
  assert.deepEqual(fileFilterOptions(list,'',allowed).sectors,['التنمية المجتمعية','رعاية الأيتام','أخرى']);
  assert.deepEqual(filterFileApplications(list,{...empty,sector:'أخرى'},allowed).map(a=>a.id),['b','c']);
  assert.equal(filterFileApplications(list,empty,allowed).length,3);
});

test('region includes all its cities, city is optional, and city options follow the region', () => {
  const a=app({city:'الرياض'}), b=app({id:'b',city:'الخرج',governorateOfficialCode:'012'}), c=app({id:'c',city:'بريدة',region:'القصيم',regionOfficialCode:'04'});
  const list=[a,b,c];
  assert.deepEqual(filterFileApplications(list,{...empty,region:fileRegionKey(a)}),[a,b]);
  assert.deepEqual(filterFileApplications(list,{...empty,region:fileRegionKey(a),city:fileCityKey(b)}),[b]);
  assert.equal(fileFilterOptions(list,fileRegionKey(a)).cities.length,2);
  assert.equal(fileFilterOptions(list,fileRegionKey(a)).regions.length,2);
  assert.equal(filterFileApplications(list,{...empty,region:''}).length,3);
});
test('field filter includes every named sector and legacy multiple fields without mutating data', () => {
  const modern = app({ v2Payload: { organization: { sectors: ['التعليم', 'البحث العلمي'], sectorOther: 'خدمة العلماء' } } });
  assert.deepEqual(applicationSectors(modern), ['التعليم','البحث العلمي','خدمة العلماء']);
  assert.deepEqual(applicationSectors(app({ sector: 'التعليم، التنمية المجتمعية' })), ['التعليم','التنمية المجتمعية']);
  const list = Object.freeze([modern, app({ id:'b' })]);
  assert.deepEqual(filterFileApplications(list, { ...empty, sector:'البحث العلمي' }).map(a=>a.id), ['a']);
  assert.equal(filterFileApplications(list, empty).length, 2);
});
test('same city name in two regions remains distinct and all conditions intersect', () => {
  const a = app({ name: 'ثمرات', sector:'التعليم' });
  const b = app({ id:'b', region:'القصيم', regionOfficialCode:'04', governorateOfficialCode:'041', sector:'التعليم' });
  assert.equal(fileFilterOptions([a,b]).cities.length, 2);
  assert.deepEqual(filterFileApplications([a,b], { ...empty, city:fileCityKey(a), sector:'التعليم', search:'ثمرات', status:'ACCEPTED', workflow:'processing' }), [a]);
  assert.equal(filterFileApplications([a,b], { ...empty, city:fileCityKey(b), search:'ثمرات' }).length, 0);
});
test('filter works beyond the first page; missing fields survive All', async () => {
  const source = Array.from({length:319},(_,i)=>app({id:String(i),sector:i===318?'البحث العلمي':null}));
  const requested:number[]=[];
  const all = await loadFileApplications(async page => { requested.push(page);return {items:source.slice((page-1)*100,page*100),total:319,totalPages:4}; });
  assert.deepEqual(requested.sort(),[1,2,3,4]);
  assert.equal(filterFileApplications(all,{...empty,sector:'البحث العلمي'})[0].id,'318');
  assert.equal(filterFileApplications(all,empty).length,319);
});
test('incomplete or changing paged reads are never presented as complete results', async () => {
  await assert.rejects(loadFileApplications(async()=>({items:[app()],total:2,totalPages:1})),/لم تكتمل/);
  await assert.rejects(loadFileApplications(async page=>({items:[app({id:String(page)})],total:page===1?2:3,totalPages:2})),/تغيرت/);
});
test('saved scores never default to 1 and missing contributions remain missing', () => {
  const criteria=[{key:'operationalReadiness',label:'التشغيل',weight:30}];
  assert.equal(savedEvaluationRows(app(),criteria)[0].score,null);
  const saved=app({evaluationBreakdown:{raw:{operationalReadiness:3},weighted:{operationalReadiness:18}}});
  assert.equal(savedEvaluationRows(saved,criteria)[0].score,3);
  assert.equal(savedEvaluationRows(saved,criteria)[0].points,18);
  assert.equal(savedEvaluationRows(app({evaluationBreakdown:{raw:{operationalReadiness:0}}}),criteria)[0].score,null);
});

test('metadata sector projection preserves filters without the full v2 dossier', () => {
  const full = app({ v2Payload: { organization: { sectors: ['التعليم', 'أخرى'], sectorOther: 'علمية' } } });
  const metadata = { ...app(), sectorValues: ['التعليم', 'أخرى', 'علمية'] };
  assert.deepEqual(applicationSectors(metadata), applicationSectors(full));
  assert.deepEqual(fileFilterOptions([metadata], '', ['التعليم', 'أخرى']), fileFilterOptions([full], '', ['التعليم', 'أخرى']));
  assert.equal(filterFileApplications([metadata], { ...empty, sector: 'أخرى' }, ['التعليم', 'أخرى']).length, 1);
});

test('file list reads a complete metadata index but hydrates a fresh matching dossier before display', () => {
  const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState<ApplicationFileItem\[\]>/);
  assert.match(source, /index\?kind=files/);
  assert.doesNotMatch(source, /loadFileApplications\(/);
  assert.match(source, /resolveCurrentRead\(apiFetch<ApplicationSummary>/);
  assert.match(source, /sequence === fileSequence.current/);
  assert.match(source, /full.id !== row.id/);
  assert.match(source, /event.stopPropagation\(\); void openFile\(row\)/);
  assert.doesNotMatch(source, /setSelected\(row\)|setSelected\(match\)/);
});
