import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { prisma } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { clearLicenseObjects, startTestStorage, stopTestStorage } from './utils/storage-harness';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';

const PREFIX = 'V2-E2E-';
const PDF = Buffer.from('%PDF-1.7\n%application-v2-test\n', 'utf8');

describe('Application V2 launch gate', () => {
  let app: INestApplication; let adminCookie: string; let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>; let fakeEmail: FakeEmailService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => { await startTestStorage(); ({ app, fakeEmail } = await createTestApp()); fixtures = await seedTestFixtures(); }, 60_000);
  beforeEach(async () => { await cleanAuthState(); await cleanup(); await clearLicenseObjects(); fakeEmail.reset(); adminCookie = await loginAs(app, fixtures.adminEmail, fixtures.adminPassword); });
  afterAll(async () => { await cleanup(); await app.close(); await stopTestStorage(); });

  it('supports secure draft, Needs Info on the same application, eligibility, 1–5 evaluation and manual reserve selection', async () => {
    const geography = await http().get('/api/v1/association-applications/geography').expect(200);
    expect(geography.body.items).toHaveLength(11);
    expect(geography.body.items.map((item: { officialCode: string }) => item.officialCode)).toContain('0001');
    expect(geography.body.items.map((item: { nameAr: string }) => item.nameAr).join(' ')).not.toMatch(/الشرقية|الجوف/);

    const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    expect(created.body.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const auth = { 'x-application-resume-token': created.body.resumeToken };
    await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('x-application-resume-token', 'x'.repeat(64)).expect(403);

    const payload = validV2Payload();
    const saved = await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set(auth).send({ revision: 0, payload }).expect(200);
    const genericUnknown = await http().post('/api/v1/association-applications/access/request').send({ email: 'nobody@example.org' }).expect(200);
    const accessRequest = await http().post('/api/v1/association-applications/access/request').send({ email: payload.organization.officialEmail }).expect(200);
    expect(accessRequest.body.message).toBe(genericUnknown.body.message);
    const accessUrl = fakeEmail.lastApplicationAccess?.items[0]?.url;
    expect(accessUrl).toContain('/apply/access?token=');
    const accessToken = new URL(accessUrl!).searchParams.get('token')!;
    const exchanged = await http().post('/api/v1/association-applications/access/exchange').send({ token: accessToken }).expect(200);
    const applicantCookie = exchanged.headers['set-cookie'][0];
    expect(exchanged.body.destination).toBe('/apply');
    await http().post('/api/v1/association-applications/access/exchange').send({ token: accessToken }).expect(403);
    await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('Cookie', applicantCookie).expect(200);
    await http().post('/api/v1/association-applications/access/exchange').send({ token: 'x'.repeat(43) }).expect(403);
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(auth).field('fieldKey', 'licenseFile').attach('file', PDF, { filename: 'license.pdf', contentType: 'application/pdf' }).expect(201);
    const submitted = await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/submit`).set(auth).send({ revision: saved.body.revision });
    if (submitted.status !== 201) throw new Error(`Application V2 submit failed (${submitted.status}): ${JSON.stringify(submitted.body)}`);
    const row = await prisma.associationApplication.findUniqueOrThrow({ where: { publicCode: submitted.body.id } });
    expect(row.schemaVersion).toBe(2); expect(row.currentAssets?.toNumber()).toBe(11_000_000);
    expect(fakeEmail.lastApplicationAccess?.subject).toContain('متابعة طلب المشاركة');

    await http().post('/api/v1/association-applications/processing/start').set('Cookie', adminCookie).send({ applicationIds: [row.id], opId: randomUUID() }).expect(201);
    const requested = await http().post(`/api/v1/association-applications/${row.id}/information-request`).set('Cookie', adminCookie).send({ items: [{ type: 'FIELD', key: 'organization.notes', reason: 'أضف وصفًا مختصرًا' }], note: 'استكمال محدد', opId: randomUUID() }).expect(201);
    expect(fakeEmail.lastApplicationAccess?.subject).toContain('مطلوب استكمال');
    const tracking = await http().get(`/api/v1/association-applications/track/${created.body.draftCode}`).set(auth).expect(200);
    expect(tracking.body.stage).toBe('NEEDS_INFO'); expect(tracking.body.needsInfo.id).toBe(requested.body.requestId);
    await http().post(`/api/v1/association-applications/track/${created.body.draftCode}/information/${requested.body.requestId}`).set(auth).send({ payload: { organization: { notes: 'تم الاستكمال' } }, opId: randomUUID() }).expect(201);

    const evidence = await http().get(`/api/v1/association-applications/${row.id}/eligibility-evidence`).set('Cookie', adminCookie).expect(200);
    expect(evidence.body.checks.length).toBeGreaterThan(10);
    await http().post(`/api/v1/association-applications/${row.id}/eligibility`).set('Cookie', adminCookie).send({ decision: 'PASSED', opId: randomUUID() }).expect(201);
    const evaluation = await http().post(`/api/v1/association-applications/${row.id}/evaluation`).set('Cookie', adminCookie).send({ operationalReadiness: 5, technicalCapability: 4, previousExperience: 3, integrityTransparency: 5, participationCommitment: 4, sustainabilityImpact: 5, opId: randomUUID() }).expect(201);
    expect(evaluation.body.score).toBe(86);
    await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'RESERVE', opId: randomUUID() }).expect(201);
    const final = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id }, include: { participation: true, sourceDraft: true } });
    expect(final.selectionList).toBe('RESERVE'); expect(final.participation).toBeNull(); expect(final.sourceDraft?.resumeTokenHash).not.toBe(created.body.resumeToken);
  });

  it('scopes emailed access to one draft and rejects expired links', async () => {
    const email = `access-${Date.now()}@example.org`;
    const first = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    const second = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    for (const draft of [first.body, second.body]) {
      await http().put(`/api/v1/association-applications/drafts/${draft.draftCode}`).set('x-application-resume-token', draft.resumeToken).send({ revision: 0, payload: { organization: { officialEmail: email } } }).expect(200);
    }
    await http().post('/api/v1/association-applications/access/request').send({ email }).expect(200);
    expect(fakeEmail.lastApplicationAccess?.items).toHaveLength(2);
    const firstRow = await prisma.associationApplicationDraft.findUniqueOrThrow({ where: { publicCode: first.body.draftCode } });
    await prisma.applicationAccessToken.updateMany({ where: { draftId: firstRow.id, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredItem = fakeEmail.lastApplicationAccess!.items.find((item) => item.code === first.body.draftCode)!;
    await http().post('/api/v1/association-applications/access/exchange').send({ token: new URL(expiredItem.url).searchParams.get('token') }).expect(403);

    await http().post('/api/v1/association-applications/access/request').send({ email }).expect(200);
    const renewed = fakeEmail.lastApplicationAccess!.items.find((item) => item.code === first.body.draftCode)!;
    const exchange = await http().post('/api/v1/association-applications/access/exchange').send({ token: new URL(renewed.url).searchParams.get('token') }).expect(200);
    await http().get(`/api/v1/association-applications/drafts/${second.body.draftCode}`).set('Cookie', exchange.headers['set-cookie'][0]).expect(403);
  });
});

function validV2Payload() {
  return {
    organization: { name: `${PREFIX}جمعية`, licenseNumber: `${PREFIX}LICENSE`, licenseExpiryDate: '2030-12-31', category: 'جمعية أهلية', sector: 'خدمات اجتماعية', officialEmail: `${PREFIX.toLowerCase()}${Date.now()}@example.org`, officialPhone: '512345678' },
    location: { regionCode: '0001', governorateCode: '0100', centerCode: '1000', serviceScope: 'المدينة أو المحافظة المختارة' },
    coordinator: { name: 'منسق تجريبي', title: 'منسق مشروع', phone: '512345679', email: `coordinator-${Date.now()}@example.org` }, covenantRepresentative: { name: 'ممثل تجريبي', title: 'رئيس مجلس الإدارة' },
    executive: { name: 'مدير تجريبي', phone: '512345670', education: 'بكالوريوس', experienceYears: 8 }, team: { fullTime: 5, partTime: 2, activeVolunteers: 10, nonSaudis: 0, universityOrHigher: 4 },
    socialResearcher: { exists: false }, readiness: { fieldTeamCount: 3, weeklyDeliveryCapacity: 20, hasReceiptStorage: false, canDocumentDigitally: true },
    beneficiaries: { registeredFamilies: 100, databaseUpdatedAt: '2026-09-01', hasSystem: false, classifiesNeed: false, hasCaseStudyMechanism: false },
    experience: { hasRecentInKindProject: false, recentProjectsCount: 0, recentBeneficiariesCount: 0, ehsanSupportCount2025: 0, hasPreviousSimilarSupport: false },
    finance: { hasAccountingSystem: false, hasSpendingPolicy: false, revenue: 12_000_000, expenses: 10_000_000, currentAssets: 11_000_000, currentLiabilities: 2_000_000 },
    planning: { hasStrategicPlan: false, hasOperationalPlan: false, hasPostAidFollowUp: false, measuresSatisfaction: false, lastYearProgramsCount: 4, lastYearBeneficiariesCount: 300 },
    acknowledgements: { dataAccuracy: true, verificationPermission: true, auditConsent: true, coordinatorCommitment: true, covenantCommitment: true, beneficiaryListPreliminary: true, participationTerms: true },
  };
}

async function cleanup() {
  const apps = await prisma.associationApplication.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.associationApplicationDraft.deleteMany({ where: { OR: [{ contactEmail: { startsWith: PREFIX.toLowerCase() } }, { contactEmail: { startsWith: 'access-' } }, { submittedApplicationId: { in: apps.map((item) => item.id) } }] } });
  await prisma.associationApplication.deleteMany({ where: { id: { in: apps.map((item) => item.id) } } });
}
