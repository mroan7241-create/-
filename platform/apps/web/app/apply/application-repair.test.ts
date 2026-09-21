import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
// Node's type-stripping runner needs explicit TypeScript extensions.
// @ts-ignore -- standalone node --test, not a browser import
import { createAutosaveQueue } from './autosave-queue.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { CONSENT_VERSION, riyadhRecentYears, validateStep } from './application-form-utils.ts';

test('geolocation allows only self and preserves camera/microphone restrictions', async () => {
  const config = createRequire(import.meta.url)('../../next.config.js');
  const routes = await config.headers();
  const policy = routes.find((route: { source: string }) => route.source === '/:path*').headers.find((header: { key: string }) => header.key === 'Permissions-Policy').value;
  assert.equal(policy, 'camera=(), microphone=(), geolocation=(self)');
});

for (const final of ['A', 'C']) {
  test(`autosave A -> B in flight -> ${final} persists the latest UI without stale success`, async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writes: string[] = [];
    const states: string[] = [];
    let active = 0; let maximum = 0; let server = 'A';
    const queue = createAutosaveQueue<string>('A', 0, async (snapshot: string) => {
      active += 1; maximum = Math.max(maximum, active); writes.push(snapshot);
      if (snapshot === 'B') await gate;
      server = snapshot; active -= 1;
      return writes.length;
    }, (state: string) => { states.push(state); });
    queue.setCurrent('B');
    const pending = queue.flush();
    await Promise.resolve();
    queue.setCurrent(final);
    assert.equal(queue.isSaved(), false);
    assert.equal(queue.flush(), pending);
    assert.deepEqual(states, ['saving']);
    release(); await pending;
    assert.deepEqual(writes, ['B', final]);
    assert.equal(server, final); assert.equal(maximum, 1);
    assert.equal(queue.isSaved(), true); assert.deepEqual(states, ['saving', 'saved']);
  });
}

test('autosave failure is not saved, does not retry itself, and can be explicitly retried', async () => {
  let attempts = 0;
  const queue = createAutosaveQueue<string>('A', 0, async () => { if (++attempts === 1) throw new Error('synthetic'); return 1; }, () => undefined);
  queue.setCurrent('B');
  await assert.rejects(queue.flush()); assert.equal(attempts, 1); assert.equal(queue.isSaved(), false);
  await queue.flush(); assert.equal(attempts, 2); assert.equal(queue.isSaved(), true);
});

type Payload = Record<string, unknown>;
function set(payload: Payload, path: string, value: unknown) {
  const keys = path.split('.'); let cursor = payload;
  for (const key of keys.slice(0, -1)) { cursor[key] ??= {}; cursor = cursor[key] as Payload; }
  cursor[keys[keys.length - 1]] = value;
}
const base: Payload = {
  organization: { name: 'جمعية تجريبية', licenseNumber: 'TEST', licenseExpiryDate: '2030-12-31', category: 'جمعية', sector: 'اجتماعي', officialEmail: 'synthetic@example.org', officialPhone: '512345678' },
  location: { regionCode: '0001', governorateCode: '0100', districtCustom: 'حي تجريبي', serviceScope: 'المدينة' },
  coordinator: { name: 'منسق', title: 'منسق', phone: '512345678', email: 'coordinator@example.org' }, covenantRepresentative: { name: 'ممثل', title: 'رئيس' },
  executive: { name: 'تجريبي', phone: '512345678', education: 'بكالوريوس', experienceYears: 1 },
  team: { fullTime: 1, partTime: 0, activeVolunteers: 0, nonSaudis: 0, universityOrHigher: 1 },
  socialResearcher: { exists: false }, readiness: { fieldTeamCount: 1, weeklyDeliveryCapacity: 1, hasReceiptStorage: false, canDocumentDigitally: false },
  beneficiaries: { registeredFamilies: 1, databaseUpdatedAt: '2026-09-01', hasSystem: false, classifiesNeed: false, hasCaseStudyMechanism: false },
  experience: { hasRecentInKindProject: false, recentProjectsCount: 0, recentBeneficiariesCount: 0, ehsanSupportCount2025: 0, hasPreviousSimilarSupport: false },
  finance: { hasAccountingSystem: false, hasSpendingPolicy: false, revenue: 0, expenses: 0, currentAssets: 0, currentLiabilities: 0 },
  planning: { hasStrategicPlan: false, hasOperationalPlan: false, hasPostAidFollowUp: false, measuresSatisfaction: false, lastYearProgramsCount: 0, lastYearBeneficiariesCount: 0 },
};

test('conditional fields are enforced in their own step only when enabled', () => {
  const cases: [number, string, unknown, Record<string, unknown>][] = [
    [1, 'organization.category', 'أخرى', { 'organization.categoryOther': 'تصنيف' }],
    [1, 'organization.sector', 'أخرى', { 'organization.sectorOther': 'مجال' }],
    [2, 'socialResearcher.exists', true, { 'socialResearcher.name': 'باحث', 'socialResearcher.phone': '512345678' }],
    [2, 'readiness.hasReceiptStorage', true, { 'readiness.receiptStorageDescription': 'مكان تجريبي' }],
    [3, 'beneficiaries.hasSystem', true, { 'beneficiaries.systemName': 'نظام', 'beneficiaries.capabilities.search': false, 'beneficiaries.capabilities.update': false, 'beneficiaries.capabilities.reports': false, 'beneficiaries.capabilities.organizedCases': false }],
    [3, 'beneficiaries.classifiesNeed', true, { 'beneficiaries.classifications': 'تصنيف' }],
    [3, 'beneficiaries.hasCaseStudyMechanism', true, { 'beneficiaries.caseStudyDescription': 'آلية' }],
    [4, 'experience.ehsanSupportCount2025', 1, { 'experience.ehsanSupportTypes': 'أجهزة' }],
    [4, 'experience.hasRecentInKindProject', true, { 'experience.projectName': 'مشروع', 'experience.projectYear': riyadhRecentYears()[0], 'experience.supportType': 'أجهزة', 'experience.projectBeneficiaries': 1, 'experience.supporter': 'جهة' }],
    [4, 'experience.hasPreviousSimilarSupport', true, { 'experience.previousSupportDescription': 'دعم', 'experience.previousSupporter': 'جهة', 'experience.previousSupportYear': 2025 }],
    [5, 'finance.hasAccountingSystem', true, { 'finance.accountingSystemName': 'نظام' }],
    [6, 'planning.hasPostAidFollowUp', true, { 'planning.postAidFollowUpDescription': 'آلية' }],
    [6, 'planning.measuresSatisfaction', true, { 'planning.satisfactionTool': 'أخرى', 'planning.satisfactionOther': 'أداة' }],
  ];
  for (const [step, condition, enabled, dependencies] of cases) {
    const payload = structuredClone(base);
    assert.equal(validateStep(step, payload, ['financialStatementsFile']), '', condition);
    set(payload, condition, enabled);
    assert.notEqual(validateStep(step, payload, ['financialStatementsFile']), '', condition);
    for (const [path, value] of Object.entries(dependencies)) set(payload, path, value);
    assert.equal(validateStep(step, payload, ['financialStatementsFile']), '', condition);
    for (const path of Object.keys(dependencies)) {
      const missing = structuredClone(payload); set(missing, path, undefined);
      assert.notEqual(validateStep(step, missing, ['financialStatementsFile']), '', path);
    }
  }
  const staleOther = structuredClone(base); set(staleOther, 'planning.satisfactionTool', 'أخرى');
  assert.equal(validateStep(6, staleOther, []), '');
  const invalidYear = structuredClone(base);
  set(invalidYear, 'experience.hasPreviousSimilarSupport', true);
  set(invalidYear, 'experience.previousSupportDescription', 'دعم'); set(invalidYear, 'experience.previousSupporter', 'جهة');
  set(invalidYear, 'experience.previousSupportYear', 1999);
  assert.notEqual(validateStep(4, invalidYear, []), '');
});

test('conditional files block the owning step and consent requires the current version and timestamp', () => {
  for (const [step, condition, file] of [[5, 'finance.hasSpendingPolicy', 'spendingPolicyFile'], [6, 'planning.hasStrategicPlan', 'strategicPlanFile'], [6, 'planning.hasOperationalPlan', 'operationalPlanFile']] as const) {
    const payload = structuredClone(base);
    assert.equal(validateStep(step, payload, ['financialStatementsFile']), '');
    set(payload, condition, true);
    assert.notEqual(validateStep(step, payload, ['financialStatementsFile']), '');
    assert.equal(validateStep(step, payload, ['financialStatementsFile', file]), '');
  }
  assert.notEqual(validateStep(5, base, []), '');
  const payload = { acknowledgements: { allAccepted: true, consentVersion: CONSENT_VERSION, acceptedAt: new Date().toISOString() } };
  assert.equal(validateStep(7, payload, ['licenseFile', 'financialStatementsFile']), '');
  for (const [path, value] of [['acknowledgements.allAccepted', false], ['acknowledgements.consentVersion', 'old'], ['acknowledgements.acceptedAt', '2026-09-01']] as const) {
    const invalid = structuredClone(payload); set(invalid, path, value);
    assert.notEqual(validateStep(7, invalid, ['licenseFile', 'financialStatementsFile']), '');
  }
});
