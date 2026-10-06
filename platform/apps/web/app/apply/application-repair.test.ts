import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
// @ts-ignore -- standalone node --test, not a browser import
import { selectionGroup } from '../admin/selection/selection-groups.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { evaluationFacts } from '../admin/selection/evaluation-evidence.ts';
import { applicationRequirementDescription, applicationRequirementLabel } from '@alzad/shared';
// @ts-ignore -- standalone node --test, not a browser import
import { GET as faviconRedirect } from '../favicon.ico/route.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { canAccessAdminPath, canAdmin, isAdminOwner } from '../lib/admin-access.ts';

test('staff page access defaults to deny and owner display compatibility never overrides explicit denial', () => {
  const staff = { role: 'ADMIN' as const, publicCode: 'ADM-000002', adminFullAccess: false, adminPermissions: ['applications.evaluate' as const, 'activities.read' as const] };
  assert.equal(canAdmin(staff, 'applications.read'), true);
  assert.equal(canAdmin(staff, 'applications.evaluate'), true);
  assert.equal(canAdmin(staff, 'applications.select'), false);
  assert.equal(canAccessAdminPath(staff, '/admin/applications?view=review'), true);
  assert.equal(canAccessAdminPath(staff, '/admin/activities'), true);
  for (const path of ['/admin', '/admin/accounts', '/admin/accounts/new', '/admin/associations', '/admin/unknown']) assert.equal(canAccessAdminPath(staff, path), false, path);
  assert.equal(canAccessAdminPath({ ...staff, adminPermissions: [] }, '/admin/applications'), false);
  assert.equal(canAccessAdminPath({ ...staff, role: 'ASSOCIATION' }, '/admin/activities'), false);
  assert.equal(isAdminOwner({ role: 'ADMIN', publicCode: 'ADM-000001' }), true);
  assert.equal(isAdminOwner({ ...staff, publicCode: 'ADM-000001' }), false);
  assert.equal(isAdminOwner({ role: 'ADMIN', publicCode: 'ADM-000002' }), false);
});

test('favicon redirect is relative and cannot leak an internal hosting origin', () => {
  const response = faviconRedirect();
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), '/brand/zadLogo.png');
  for (const origin of ['https://example.org', 'https://greenyellow-hawk-333467.hostingersite.com']) {
    assert.equal(new URL(response.headers.get('location')!, origin).origin, origin);
  }
});

test('selection lists separate failed and needs-info applications from actionable and selected lists', () => {
  assert.equal(selectionGroup({ eligibilityStatus: 'FAILED', selectionList: 'NONE', processingStartedAt: null }), 'FAILED');
  assert.equal(selectionGroup({ eligibilityStatus: 'NEEDS_INFO', selectionList: 'NONE', processingStartedAt: null }), 'NEEDS_INFO');
  assert.equal(selectionGroup({ eligibilityStatus: 'PENDING', selectionList: 'NONE', processingStartedAt: null }), 'NEW');
  assert.equal(selectionGroup({ eligibilityStatus: 'PENDING', selectionList: 'NONE', processingStartedAt: '2026-09-28T00:00:00.000Z' }), 'PROCESSING');
  assert.equal(selectionGroup({ eligibilityStatus: 'PASSED', selectionList: 'NONE', processingStartedAt: null }), 'PASSED_UNSELECTED');
  assert.equal(selectionGroup({ eligibilityStatus: 'PASSED', selectionList: 'MAIN', processingStartedAt: null }), 'MAIN');
  assert.equal(selectionGroup({ eligibilityStatus: 'PASSED', selectionList: 'RESERVE', processingStartedAt: null }), 'RESERVE');
  assert.equal(selectionGroup({ eligibilityStatus: 'PENDING', selectionList: 'NONE', processingStartedAt: null, latestInformationRequest: { id: 'synthetic-request', status: 'SUBMITTED', note: null, deadline: null, items: [] } }), 'RETURNED');
});

test('assessment facts come from the applicant dossier and missing facts are explicit', () => {
  const facts = evaluationFacts({ v2Payload: { finance: { governanceScore: 83 } } }, 'integrityTransparency');
  assert.ok(facts.some((fact) => fact.value.includes(new Intl.NumberFormat('ar-SA').format(83))));
  assert.ok(evaluationFacts({ v2Payload: {} }, 'integrityTransparency').some((fact) => fact.value === 'لم يُقدّم'));
});

test('completion item labels retain both the chosen field and the written reason', () => {
  assert.equal(applicationRequirementLabel('ATTACHMENT', 'governanceReportFile'), 'تقرير درجة الحوكمة');
  assert.equal(applicationRequirementLabel('ATTACHMENT', 'previousProjectEvidence'), 'شاهد مشروع سابق');
  assert.equal(applicationRequirementLabel('FIELD', 'finance.governanceScore'), 'درجة الحوكمة (%)');
  assert.equal(applicationRequirementDescription('ATTACHMENT', 'previousProjectEvidence', '  الشاهد خاطئ  '), 'شاهد مشروع سابق — الشاهد خاطئ');
});
// Node's type-stripping runner needs explicit TypeScript extensions.
// @ts-ignore -- standalone node --test, not a browser import
import { createAutosaveQueue } from './autosave-queue.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { DRAFT_KEY, isInvalidDraftAccess, readDraftSession, rememberDraftSession, restoreDraftSession } from './draft-session.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { CONSENT_VERSION, riyadhRecentYears, validateStep, withDisplayedNumericDefaults } from './application-form-utils.ts';

test('displayed zero values are present in new and resumed drafts without changing entered numbers', () => {
  const original = { team: { fullTime: 4 }, finance: { revenue: 1000000 } };
  const restored = withDisplayedNumericDefaults(original);
  assert.equal((restored.team as Record<string, unknown>).fullTime, 4);
  assert.equal((restored.team as Record<string, unknown>).nonSaudis, 0);
  assert.equal((restored.finance as Record<string, unknown>).revenue, 1000000);
  assert.equal((restored.finance as Record<string, unknown>).expenses, 0);
  assert.equal((original.team as Record<string, unknown>).nonSaudis, undefined);
  assert.deepEqual(withDisplayedNumericDefaults(restored), restored);
  assert.equal((withDisplayedNumericDefaults({ team: { nonSaudis: null } }).team as Record<string, unknown>).nonSaudis, 0);
});

test('public draft persistence keeps only its code and a session marker, never the long-lived bearer token', () => {
  let stored = '';
  const metadata = rememberDraftSession({ setItem: (key: string, value: string) => {
    assert.equal(key, DRAFT_KEY);
    stored = value;
  } }, 'DRF-TEST-001');
  assert.deepEqual(metadata, { draftCode: 'DRF-TEST-001', viaSession: true });
  assert.deepEqual(JSON.parse(stored), metadata);
  assert.doesNotMatch(stored, /resumeToken/);
});

test('blocked browser storage does not prevent opening a newly created or restored server draft', async () => {
  const storage = {
    setItem: () => { throw new Error('synthetic blocked storage'); },
    getItem: () => { throw new Error('synthetic blocked storage'); },
    removeItem: () => { throw new Error('synthetic blocked storage'); },
  };
  const credentials = rememberDraftSession(storage, 'DRF-NEW');
  assert.deepEqual(credentials, { draftCode: 'DRF-NEW', viaSession: true });
  const restored = await restoreDraftSession(storage, credentials, async () => assert.fail('unexpected token upgrade'), async () => ({ payload: { organization: { name: 'جمعية تجريبية' } }, revision: 1 }));
  assert.deepEqual(restored.metadata, credentials);
  assert.equal(restored.draft.revision, 1);
  const access = readFileSync(new URL('./access/page.tsx', import.meta.url), 'utf8');
  assert.match(access, /rememberDraftSession\(localStorage, result\.draftCode\)/);
});

function draftStorage(initial: string | null) {
  let value = initial;
  return {
    getItem: (key: string) => { assert.equal(key, DRAFT_KEY); return value; },
    setItem: (key: string, next: string) => { assert.equal(key, DRAFT_KEY); value = next; },
    removeItem: (key: string) => { assert.equal(key, DRAFT_KEY); value = null; },
  };
}

test('a new session draft resumes the saved three fields after reopening without a bearer token', async () => {
  const storage = draftStorage(null);
  rememberDraftSession(storage, 'DRF-NEW');
  const existing = readDraftSession(storage)!;
  const payload = { organization: { name: 'جمعية تجريبية', licenseNumber: 'TEST-001', licenseExpiryDate: '2027-01-01' } };
  const restored = await restoreDraftSession(storage, existing, async () => assert.fail('session drafts do not upgrade'), async (code, token) => {
    assert.equal(code, 'DRF-NEW'); assert.equal(token, '');
    return { payload, revision: 3, attachments: [] };
  });
  assert.deepEqual(restored.draft.payload, payload);
  assert.deepEqual(restored.metadata, existing);
});

test('legacy token migration is awaited only when restoring the selected draft', async () => {
  const token = 'synthetic-token-'.repeat(3);
  const storage = draftStorage(JSON.stringify({ draftCode: 'DRF-LEGACY', resumeToken: token }));
  const existing = readDraftSession(storage)!;
  const calls: string[] = [];
  await restoreDraftSession(storage, existing, async (code, bearer) => {
    assert.equal(code, existing.draftCode); assert.equal(bearer, token);
    await Promise.resolve(); calls.push('upgrade');
  }, async (_code, bearer) => { assert.deepEqual(calls, ['upgrade']); assert.equal(bearer, ''); calls.push('load'); return {}; });
  assert.deepEqual(calls, ['upgrade', 'load']);
  assert.deepEqual(readDraftSession(storage), { draftCode: existing.draftCode, viaSession: true });
});

test('expired or deleted drafts clear only the matching browser shortcut and allow email recovery', async () => {
  for (const code of ['APPLICATION_RESUME_INVALID', 'APPLICATION_ACCESS_INVALID']) {
    const storage = draftStorage(null);
    const existing = rememberDraftSession(storage, 'DRF-OLD');
    const reason = new ApiClientError(code, 'synthetic invalid session');
    await assert.rejects(restoreDraftSession(storage, existing, async () => undefined, async () => { throw reason; }), reason);
    assert.equal(readDraftSession(storage), null);
    assert.equal(isInvalidDraftAccess(reason), true);
  }
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(page, /if \(isInvalidDraftAccess\(reason\)\) \{[\s\S]*?setMode\('resume'\)/);
});

test('a transient restore failure retains the shortcut and a stale failure preserves a newer draft', async () => {
  const storage = draftStorage(null);
  const existing = rememberDraftSession(storage, 'DRF-OLD');
  await assert.rejects(restoreDraftSession(storage, existing, async () => undefined, async () => { throw new ApiClientError('NETWORK_ERROR', 'synthetic'); }));
  assert.deepEqual(readDraftSession(storage), existing);
  await assert.rejects(restoreDraftSession(storage, existing, async () => undefined, async () => {
    rememberDraftSession(storage, 'DRF-NEW');
    throw new ApiClientError('APPLICATION_RESUME_INVALID', 'synthetic');
  }));
  assert.equal(readDraftSession(storage)?.draftCode, 'DRF-NEW');
});

test('malformed browser metadata is not presented as a saved draft', () => {
  for (const raw of ['{', 'null', '[]', '{}', '{"draftCode":"DRF-TEST"}', '{"draftCode":4,"viaSession":true}', '{"draftCode":"DRF-TEST","resumeToken":42}']) {
    const storage = draftStorage(raw);
    assert.equal(readDraftSession(storage), null);
    assert.equal(storage.getItem(DRAFT_KEY), null);
  }
});

test('status and expired access pages provide a path to request a fresh email link', () => {
  const status = readFileSync(new URL('./status/page.tsx', import.meta.url), 'utf8');
  const access = readFileSync(new URL('./access/page.tsx', import.meta.url), 'utf8');
  assert.match(status, /readDraftSession\(localStorage\)/);
  assert.match(status, /restoreDraftSession\(localStorage,[\s\S]*?upgradeApplicationDraftSession, trackApplicationV2\)/);
  assert.match(status, /isInvalidDraftAccess\(reason\)[\s\S]*?setDraftCode\(''\)/);
  assert.match(status, /!draftCode && <Link href="\/apply"/);
  assert.match(access, /\(error \|\| !token\) && <Link[^>]*href="\/apply"/);
});
// @ts-ignore -- standalone node --test, not a browser import
import { financialSummary } from '../lib/financial-summary.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { workflowLabel } from '../lib/workflow-label.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { createAgreement, sendOwnCovenantCompletionEmail, signAssociationCovenant, uploadApplicationAttachment, ApiClientError } from '../lib/api.ts';

test('oversize applicant upload is rejected in Arabic before any network request', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('unexpected network request'); };
    const file = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'too-big.pdf');
    await assert.rejects(uploadApplicationAttachment('DRF-TEST', 'synthetic', 'governanceReportFile', file), (error: unknown) => error instanceof ApiClientError && error.code === 'APPLICATION_ATTACHMENT_TOO_LARGE' && /8 ميجابايت/.test(error.message));
  } finally { globalThis.fetch = originalFetch; }
});
// @ts-ignore -- standalone node --test, not a browser import
import { licensePreviewKind } from '../lib/license-preview.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { covenantSigningError } from '../lib/covenant-signing.ts';
// @ts-ignore -- standalone node --test, not a browser import
import { canPrepareCovenant } from '../lib/covenant-selection.ts';

test('shared link description identifies the platform without obsolete migration wording', () => {
  const layout = readFileSync(new URL('../layout.tsx', import.meta.url), 'utf8');
  const description = layout.match(/description:\s*'([^']+)'/)?.[1];
  assert.equal(description, 'منصة جمعية الزاد لمشروع الأجهزة الكهربائية.');
  assert.doesNotMatch(description!, /Google Apps Script|قيد الهجرة/);
});

test('public application heading remains readable on the dark hero', () => {
  const styles = readFileSync(new URL('./application-v2.module.css', import.meta.url), 'utf8');
  assert.match(styles, /\.hero h1\s*\{[^}]*color:\s*#fff\s*;/);
});

test('Covenant validation identifies each missing requirement and does not accept an unconfirmed drawing', () => {
  const ready = { representativeName: 'ممثل', representativeTitle: 'مدير', authorized: true, accepted: true, completionAcknowledged: true, signatureReady: true, password: 'synthetic-only' };
  assert.equal(covenantSigningError(ready), '');
  for (const key of ['authorized', 'accepted', 'completionAcknowledged', 'signatureReady'] as const) assert.notEqual(covenantSigningError({ ...ready, [key]: false }), '');
  for (const key of ['representativeName', 'representativeTitle', 'password'] as const) assert.notEqual(covenantSigningError({ ...ready, [key]: '' }), '');
  assert.match(covenantSigningError({ ...ready, signatureReady: false }), /اعتماد التوقيع/);
  assert.match(covenantSigningError({ ...ready, password: '' }), /الحالية/);
});

test('PDF licenses open as documents while validated image uploads keep their preview', () => {
  assert.equal(licensePreviewKind('https://storage.example.org/private/license.pdf?signature=synthetic'), 'file');
  assert.equal(licensePreviewKind('https://storage.example.org/private/license.PNG?signature=synthetic'), 'image');
  assert.equal(licensePreviewKind('https://storage.example.org/private/license.jpg'), 'image');
  assert.equal(licensePreviewKind('https://storage.example.org/private/license.pdf?name=fake.png'), 'file');
  assert.equal(licensePreviewKind('invalid'), 'file');
});

test('Covenant signing explicitly transmits the two-month commitment', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.match(String(input), /\/participations\/covenant\/sign$/);
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get('completionAcknowledgement'), 'true');
      assert.equal(init.body.get('authorizedAcknowledgement'), 'true');
      assert.equal(init.body.get('acceptanceAcknowledgement'), 'true');
      return Response.json({ ok: true, status: 'SIGNED_BY_ORG' });
    };
    await signAssociationCovenant({ representativeName: 'ممثل تجريبي', representativeTitle: 'مدير', currentPassword: 'synthetic-only', signature: new File(['synthetic'], 'test.png', { type: 'image/png' }), completionAcknowledgement: true });
  } finally { globalThis.fetch = originalFetch; }
});

test('completed Covenant email uses authenticated own-account route without recipient or file input', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.match(String(input), /\/participations\/covenant\/completion-email$/);
      assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'include');
      assert.deepEqual(JSON.parse(String(init?.body)), {});
      return Response.json({ ok: true, alreadySent: false }, { status: 201 });
    };
    assert.deepEqual(await sendOwnCovenantCompletionEmail(), { ok: true, alreadySent: false });
  } finally { globalThis.fetch = originalFetch; }
});

test('create Covenant button sends only the fields accepted by CreateAgreementDto', async () => {
  const originalFetch = globalThis.fetch;
  let sent: Record<string, unknown> | undefined;
  let url = '';
  try {
    globalThis.fetch = async (input, init) => {
      url = String(input);
      sent = JSON.parse(String(init?.body));
      assert.equal(init?.credentials, 'include');
      return Response.json({ id: 'synthetic-agreement' }, { status: 201 });
    };
    await createAgreement('synthetic-participation', 1, '1.0', '  COV-TEST  ');
    assert.match(url, /\/participations\/synthetic-participation\/agreements$/);
    assert.deepEqual(sent, { version: 1, templateVersion: '1.0', reference: 'COV-TEST' });
    await createAgreement('synthetic-participation', 1, '1.0');
    assert.deepEqual(sent, { version: 1, templateVersion: '1.0' });
  } finally { globalThis.fetch = originalFetch; }
});

test('pending participation actions identify the actual application instead of indistinguishable records', () => {
  assert.equal(workflowLabel({ application: { name: 'جمعية تجريبية', publicCode: 'APP-TEST' } }, 'participations'), 'جمعية تجريبية — APP-TEST');
  assert.equal(workflowLabel({ association: { name: 'جمعية مفعلة' }, application: { name: 'طلب سابق', publicCode: 'APP-OLD' } }, 'participations'), 'جمعية مفعلة — APP-OLD');
  assert.equal(workflowLabel({ publicCode: 'DEL-TEST' }, 'deliveries'), 'DEL-TEST');
});

test('financial indicators distinguish surplus, deficit and current liabilities without deciding eligibility', () => {
  assert.match(financialSummary({ revenue: 100, expenses: 120, currentAssets: 80, currentLiabilities: 90 }).join(' '), /عجز.*٢٠.*الخصوم المتداولة تتجاوز/);
  assert.match(financialSummary({ revenue: 100, expenses: 50, currentAssets: 100, currentLiabilities: 10 }).join(' '), /فائض.*٥٠.*٥٠.*تغطي/);
  assert.match(financialSummary({ revenue: 0, expenses: 0, currentAssets: 0, currentLiabilities: 0 }).join(' '), /متوازنة.*لا توجد خصوم/);
  assert.deepEqual(financialSummary({}), []);
  assert.deepEqual(financialSummary({ revenue: -1, expenses: 1, currentAssets: NaN, currentLiabilities: 1 }), []);
  assert.deepEqual(financialSummary({ revenue: '100', expenses: 1 }), []);
});

test('financial analysis is visible to admin assessors, not to applicants', () => {
  const applicant = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../admin/applications/page.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../admin/applications/application-detail.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(applicant, /FinancialSummary/);
  assert.match(admin, /import \{ ApplicationDetail[^}]*\} from '\.\/application-detail'/);
  assert.match(admin, /<ApplicationDetail\s/);
  assert.match(detail, /<FinancialSummary finance=\{application\.v2Payload\?\.finance\}/);
});

test('Covenant preparation actions appear only for MAIN selections with no sent agreement', () => {
  assert.equal(canPrepareCovenant('MAIN', null), true);
  assert.equal(canPrepareCovenant('MAIN', 'DRAFT'), true);
  for (const selection of ['RESERVE', 'NONE', null]) assert.equal(canPrepareCovenant(selection, 'DRAFT'), false);
  assert.equal(canPrepareCovenant('MAIN', 'SENT'), false);
});

test('geolocation allows only self and preserves camera/microphone restrictions', async () => {
  const config = createRequire(import.meta.url)('../../next.config.js');
  const routes = await config.headers();
  const policy = routes.find((route: { source: string }) => route.source === '/:path*').headers.find((header: { key: string }) => header.key === 'Permissions-Policy').value;
  assert.equal(policy, 'camera=(), microphone=(), geolocation=(self)');
});

test('security headers keep local development usable and enforce production HTTPS', async () => {
  const requireConfig = createRequire(import.meta.url);
  const modulePath = requireConfig.resolve('../../next.config.js');
  const previous = process.env.NODE_ENV;
  try {
    Reflect.set(process.env, 'NODE_ENV', 'development');
    delete requireConfig.cache[modulePath];
    const devHeaders = (await requireConfig(modulePath).headers())[0].headers as { key: string; value: string }[];
    const devCsp = devHeaders.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
    assert.match(devCsp, /'unsafe-eval'/);
    assert.match(devCsp, /http:\/\/localhost/);
    assert.equal(devHeaders.some((header) => header.key === 'Strict-Transport-Security'), false);

    Reflect.set(process.env, 'NODE_ENV', 'production');
    delete requireConfig.cache[modulePath];
    const prodHeaders = (await requireConfig(modulePath).headers())[0].headers as { key: string; value: string }[];
    const prodCsp = prodHeaders.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
    assert.doesNotMatch(prodCsp, /'unsafe-eval'|http:\/\/localhost/);
    assert.match(prodCsp, /frame-ancestors 'none'/);
    assert.match(prodCsp, /upgrade-insecure-requests/);
    for (const key of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security']) {
      assert.equal(prodHeaders.some((header) => header.key === key), true, key);
    }
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', previous);
    delete requireConfig.cache[modulePath];
  }
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

test('switching drafts while an old save completes keeps each queue on its own revision', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const writes: { draft: string; revision: number; payload: string }[] = [];
  const old = createAutosaveQueue('old-initial', 6, async (payload, revision) => {
    writes.push({ draft: 'old', revision, payload });
    if (payload === 'old-first') await gate;
    return revision + 1;
  }, () => undefined);
  old.setCurrent('old-first'); const pending = old.flush();
  await Promise.resolve(); old.setCurrent('old-last');
  const fresh = createAutosaveQueue('new-initial', 0, async (payload, revision) => {
    writes.push({ draft: 'new', revision, payload }); return revision + 1;
  }, () => undefined);
  fresh.setCurrent('new-first'); assert.equal(await fresh.flush(), 1);
  release(); assert.equal(await pending, 8);
  fresh.setCurrent('new-last'); assert.equal(await fresh.flush(), 2);
  assert.deepEqual(writes, [
    { draft: 'old', revision: 6, payload: 'old-first' },
    { draft: 'new', revision: 0, payload: 'new-first' },
    { draft: 'old', revision: 7, payload: 'old-last' },
    { draft: 'new', revision: 1, payload: 'new-last' },
  ]);
});

type Payload = Record<string, unknown>;
function set(payload: Payload, path: string, value: unknown) {
  const keys = path.split('.'); let cursor = payload;
  for (const key of keys.slice(0, -1)) { cursor[key] ??= {}; cursor = cursor[key] as Payload; }
  cursor[keys[keys.length - 1]] = value;
}
const base: Payload = {
  organization: { name: 'جمعية تجريبية', licenseNumber: 'TEST', licenseExpiryDate: '2030-12-31', category: 'متوسطة', sector: 'رعاية الأيتام', sectors: ['رعاية الأيتام'], hasWebsite: false, officialEmail: 'synthetic@example.org', officialPhone: '512345678' },
  location: { regionCode: '0001', governorateCode: '0100', districtCustom: 'حي تجريبي', serviceScope: 'المدينة' },
  coordinator: { name: 'منسق', title: 'منسق', phone: '512345678', email: 'coordinator@example.org' }, covenantRepresentative: { name: 'ممثل', title: 'رئيس' },
  executive: { name: 'تجريبي', phone: '512345678', education: 'بكالوريوس', experienceYears: 1 },
  team: { fullTime: 1, partTime: 0, activeVolunteers: 0, nonSaudis: 0, universityOrHigher: 1 },
  socialResearcher: { exists: false }, readiness: { fieldTeamCount: 1, weeklyDeliveryCapacity: 1, hasReceiptStorage: false, canDocumentDigitally: false },
  beneficiaries: { registeredFamilies: 1, databaseUpdatedAt: '2026-09-01', hasSystem: false, classifiesNeed: false, hasCaseStudyMechanism: false },
  experience: { hasRecentInKindProject: false, recentProjectsCount: 0, recentBeneficiariesCount: 0, ehsanSupportCount2025: 0, hasPreviousSimilarSupport: false },
  finance: { hasAccountingSystem: false, hasSpendingPolicy: false, governanceScore: 87.5, revenue: 0, expenses: 0, currentAssets: 0, currentLiabilities: 0 },
  planning: { hasStrategicPlan: false, hasOperationalPlan: false, hasPostAidFollowUp: false, measuresSatisfaction: false, lastYearProgramsCount: 0, lastYearBeneficiariesCount: 0 },
};

test('a visually displayed zero no longer blocks application steps', () => {
  const draft = structuredClone(base);
  delete (draft.team as Payload).nonSaudis;
  delete (draft.experience as Payload).ehsanSupportCount2025;
  assert.notEqual(validateStep(2, draft, []), '');
  assert.notEqual(validateStep(4, draft, []), '');
  const normalized = withDisplayedNumericDefaults(draft);
  assert.equal(validateStep(2, normalized, []), '');
  assert.equal(validateStep(4, normalized, []), '');
});

test('conditional fields are enforced in their own step only when enabled', () => {
  const cases: [number, string, unknown, Record<string, unknown>][] = [
    [1, 'organization.hasWebsite', true, { 'organization.websiteUrl': 'https://example.org' }],
    [1, 'organization.sectors', ['رعاية الأيتام', 'أخرى'], { 'organization.sectorOther': 'مجال' }],
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
    assert.equal(validateStep(step, payload, ['financialStatementsFile', 'governanceReportFile']), '', condition);
    set(payload, condition, enabled);
    assert.notEqual(validateStep(step, payload, ['financialStatementsFile', 'governanceReportFile']), '', condition);
    for (const [path, value] of Object.entries(dependencies)) set(payload, path, value);
    assert.equal(validateStep(step, payload, ['financialStatementsFile', 'governanceReportFile']), '', condition);
    for (const path of Object.keys(dependencies)) {
      const missing = structuredClone(payload); set(missing, path, undefined);
      assert.notEqual(validateStep(step, missing, ['financialStatementsFile', 'governanceReportFile']), '', path);
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
    assert.equal(validateStep(step, payload, ['financialStatementsFile', 'governanceReportFile']), '');
    set(payload, condition, true);
    assert.notEqual(validateStep(step, payload, ['financialStatementsFile', 'governanceReportFile']), '');
    assert.equal(validateStep(step, payload, ['financialStatementsFile', 'governanceReportFile', file]), '');
  }
  assert.notEqual(validateStep(5, base, []), '');
  const payload = { acknowledgements: { allAccepted: true, consentVersion: CONSENT_VERSION, acceptedAt: new Date().toISOString() } };
  assert.equal(validateStep(7, payload, ['licenseFile', 'financialStatementsFile', 'governanceReportFile']), '');
  for (const [path, value] of [['acknowledgements.allAccepted', false], ['acknowledgements.consentVersion', 'old'], ['acknowledgements.acceptedAt', '2026-09-01']] as const) {
    const invalid = structuredClone(payload); set(invalid, path, value);
    assert.notEqual(validateStep(7, invalid, ['licenseFile', 'financialStatementsFile', 'governanceReportFile']), '');
  }
});

test('financial size, multiple sectors, website URL and governance evidence are validated before progression', () => {
  const payload = structuredClone(base);
  assert.equal(validateStep(1, payload, []), '');
  set(payload, 'organization.category', 'جمعية خيرية');
  assert.match(validateStep(1, payload, []), /تصنيف/);
  set(payload, 'organization.category', 'متوسطة');
  set(payload, 'organization.sectors', []);
  assert.match(validateStep(1, payload, []), /مجال/);
  set(payload, 'organization.sectors', ['رعاية الأيتام', 'التنمية المجتمعية']);
  set(payload, 'organization.hasWebsite', true);
  set(payload, 'organization.websiteUrl', 'javascript:alert(1)');
  assert.match(validateStep(1, payload, []), /رابط/);
  set(payload, 'organization.websiteUrl', 'https://example.org');
  assert.equal(validateStep(1, payload, []), '');
  set(payload, 'finance.governanceScore', 101);
  assert.match(validateStep(5, payload, ['financialStatementsFile', 'governanceReportFile']), /الحوكمة/);
  set(payload, 'finance.governanceScore', 87.5);
  assert.match(validateStep(5, payload, ['financialStatementsFile']), /تقرير درجة الحوكمة/);
  assert.equal(validateStep(5, payload, ['financialStatementsFile', 'governanceReportFile']), '');
});
