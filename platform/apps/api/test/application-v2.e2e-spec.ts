import request from 'supertest';
import { jest } from '@jest/globals';
import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Prisma, prisma } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { clearLicenseObjects, startTestStorage, stopTestStorage } from './utils/storage-harness';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ApplicationAccessService } from '../src/modules/applications/application-access.service';

const PREFIX = 'V2-E2E-';
const PDF = Buffer.from('%PDF-1.7\n%application-v2-test\n', 'utf8');

describe('Application V2 launch gate', () => {
  let app: INestApplication; let adminCookie: string; let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>; let fakeEmail: FakeEmailService;
  const http = () => request(app.getHttpServer());
  const flushEmail = () => app.get(NotificationsService).processOutbox();
  async function requestAccess(email: string) {
    const result = await http().post('/api/v1/association-applications/access/request').send({ email }).expect(200);
    await flushEmail();
    return result;
  }

  it('failed eligibility sends its real outcome once, after commit, without creating an account', async () => {
    const suffix = randomUUID();
    const application = await prisma.associationApplication.create({ data: { schemaVersion: 2, publicCode: `${PREFIX}${suffix}`, clientRequestId: suffix, name: `${PREFIX}عدم اجتياز اصطناعي`, region: 'الرياض', city: 'الرياض', email: `ineligible-${suffix}@example.org`, phone: '0550000000', contactName: 'ممثل تجريبي', v2Payload: {}, pledgeAccepted: true } });
    const opId = randomUUID();
    const route = `/api/v1/association-applications/${application.id}/eligibility`;
    const input = { decision: 'FAILED', notes: 'متطلبات أهلية غير مكتملة', opId };
    await http().post(route).set('Cookie', adminCookie).send(input).expect(201);
    await flushEmail();
    const persisted = await prisma.associationApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(persisted.eligibilityStatus).toBe('FAILED');
    expect(persisted.resultingAssociationId).toBeNull();
    expect(fakeEmail.lastSecurityAlert?.to).toBe(application.email);
    expect(fakeEmail.lastSecurityAlert?.body).toContain('متطلبات أهلية غير مكتملة');
    fakeEmail.lastSecurityAlert = null;
    await http().post(route).set('Cookie', adminCookie).send(input).expect(201);
    await flushEmail();
    expect(fakeEmail.lastSecurityAlert).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: application.id, action: 'APPLICATION_REJECTION_EMAIL_SENT' } })).toBe(1);
  });

  beforeAll(async () => { await startTestStorage(); ({ app, fakeEmail } = await createTestApp()); fixtures = await seedTestFixtures(); }, 60_000);
  beforeEach(async () => { await cleanAuthState(); await cleanup(); await clearLicenseObjects(); fakeEmail.reset(); adminCookie = await loginAs(app, fixtures.adminEmail, fixtures.adminPassword); });
  afterAll(async () => { await cleanup(); await app.close(); await stopTestStorage(); });

  it('supports secure draft, Needs Info on the same application, eligibility, 1–5 evaluation and manual reserve selection', async () => {
    const geography = await http().get('/api/v1/association-applications/geography').expect(200);
    expect(geography.body.items).toHaveLength(12);
    expect(geography.body.items.map((item: { officialCode: string }) => item.officialCode)).toContain('0001');
    expect(geography.body.items.map((item: { nameAr: string }) => item.nameAr).join(' ')).not.toMatch(/الشرقية/);
    expect(geography.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ officialCode: '0013', nameAr: 'منطقة الجوف' })]));
    const jouf = await http().get('/api/v1/association-applications/geography?parent=0013').expect(200);
    expect(jouf.body.items.map((item: { officialCode: string }) => item.officialCode)).toEqual(['0247', '0248', '0249', '0250', '0252']);
    expect(jouf.body.items.every((item: { parentOfficialCode: string }) => item.parentOfficialCode === '0013')).toBe(true);

    const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    expect(created.body.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body.sessionToken).toBeUndefined();
    const newDraftCookie = created.headers['set-cookie'][0];
    expect(newDraftCookie).toContain('alzad_applicant_session=');
    expect(newDraftCookie).toContain('HttpOnly');
    expect(newDraftCookie).toMatch(/Expires=/i);
    const initialDraft = await prisma.associationApplicationDraft.findUniqueOrThrow({ where: { publicCode: created.body.draftCode }, include: { applicantSessions: true } });
    expect(initialDraft.applicantSessions[0]!.expiresAt).toEqual(initialDraft.expiresAt);
    expect(new Date(/Expires=([^;]+)/i.exec(newDraftCookie)![1]).getTime()).toBe(Math.floor(initialDraft.expiresAt.getTime() / 1000) * 1000);
    await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('Cookie', newDraftCookie).expect(200);
    const partialPayload = { organization: { name: 'ثلاثة حقول محفوظة', licenseNumber: 'partial-license', category: 'متوسطة' } };
    const partialSave = await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('Cookie', newDraftCookie)
      .send({ revision: 0, payload: partialPayload }).expect(200);
    const restoredPartial = await request(app.getHttpServer()).get(`/api/v1/association-applications/drafts/${created.body.draftCode}`)
      .set('Cookie', newDraftCookie.split(';')[0]).expect(200);
    expect(restoredPartial.body.payload).toEqual(partialPayload);
    expect(restoredPartial.body.revision).toBe(partialSave.body.revision);
    const auth = { 'x-application-resume-token': created.body.resumeToken };
    const applicantAccess = { Cookie: newDraftCookie };
    await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('x-application-resume-token', 'x'.repeat(64)).expect(403);
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/session`).set('x-application-resume-token', 'x'.repeat(64)).expect(403);
    const upgraded = await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/session`).set(auth).expect(200);
    expect(upgraded.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(upgraded.body.sessionToken).toBeUndefined();
    await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('Cookie', upgraded.headers['set-cookie'][0]).expect(200);

    const payload = validV2Payload();
    payload.location.regionCode = '0013';
    payload.location.governorateCode = '0247';
    const saved = await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set(applicantAccess).send({ revision: partialSave.body.revision, payload }).expect(200);
    const genericUnknown = await requestAccess('nobody@example.org');
    const accessRequest = await requestAccess(payload.organization.officialEmail);
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
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(applicantAccess).field('fieldKey', 'licenseFile').attach('file', PDF, { filename: 'license.pdf', contentType: 'application/pdf' }).expect(201);
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(applicantAccess).field('fieldKey', 'financialStatementsFile').attach('file', PDF, { filename: 'statements.pdf', contentType: 'application/pdf' }).expect(201);
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/submit`).set(applicantAccess).send({ revision: saved.body.revision }).expect(400).expect(({ body }) => expect(body.error.code).toBe('APPLICATION_ATTACHMENT_REQUIRED'));
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(applicantAccess).field('fieldKey', 'governanceReportFile').attach('file', PDF, { filename: 'governance.pdf', contentType: 'application/pdf' }).expect(201);
    const submitted = await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/submit`).set(applicantAccess).send({ revision: saved.body.revision });
    if (submitted.status !== 201) throw new Error(`Application V2 submit failed (${submitted.status}): ${JSON.stringify(submitted.body)}`);
    expect(submitted.body.emailQueued).toBe(true); expect(submitted.body.emailSent).toBeNull();
    await flushEmail();
    const row = await prisma.associationApplication.findUniqueOrThrow({ where: { publicCode: submitted.body.id } });
    expect(row.region).toBe('الجوف');
    expect(row.city).toBe('سكاكا');
    expect(row.schemaVersion).toBe(2); expect(row.currentAssets?.toNumber()).toBe(11_000_000);
    expect(row.category).toBe('متوسطة');
    expect(row.sector).toBe('رعاية الأيتام، التنمية المجتمعية');
    expect(row.v2Payload).toMatchObject({ organization: { sectors: ['رعاية الأيتام', 'التنمية المجتمعية'], websiteUrl: 'https://example.org' }, finance: { governanceScore: 87.5 } });
    expect(fakeEmail.lastApplicationAccess?.subject).toContain('متابعة طلب المشاركة');
    expect(fakeEmail.lastApplicationAccess?.items[0]?.code).toBe(submitted.body.id);

    await http().post('/api/v1/association-applications/processing/start').set('Cookie', adminCookie).send({ applicationIds: [row.id], opId: randomUUID() }).expect(201);
    const requested = await http().post(`/api/v1/association-applications/${row.id}/information-request`).set('Cookie', adminCookie).send({ items: [{ type: 'FIELD', key: 'organization.notes', reason: 'أضف وصفًا مختصرًا' }, { type: 'FIELD', key: 'coordinator.phone', reason: 'صحح رقم جوال المنسق' }], note: 'استكمال محدد', opId: randomUUID() }).expect(201);
    expect(requested.body.emailQueued).toBe(true); expect(requested.body.emailSent).toBeNull();
    await flushEmail();
    expect(fakeEmail.lastApplicationAccess?.subject).toContain('مطلوب استكمال');
    expect(fakeEmail.lastApplicationAccess?.intro).toContain('أضف وصفًا مختصرًا');
    const tracking = await http().get(`/api/v1/association-applications/track/${created.body.draftCode}`).set(applicantAccess).expect(200);
    expect(tracking.body.stage).toBe('NEEDS_INFO'); expect(tracking.body.needsInfo.id).toBe(requested.body.requestId);
    await http().post(`/api/v1/association-applications/track/${created.body.draftCode}/information/${requested.body.requestId}`).set(applicantAccess).send({ payload: { organization: { notes: 'تم الاستكمال' }, coordinator: { phone: '512345679' } }, opId: randomUUID() }).expect(201);
    const corrected = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } });
    expect(corrected.coordinatorPhone).toBe('0512345679');
    expect((corrected.v2Payload as { coordinator: { phone: string } }).coordinator.phone).toBe('512345679');

    const evidence = await http().get(`/api/v1/association-applications/${row.id}/eligibility-evidence`).set('Cookie', adminCookie).expect(200);
    expect(evidence.body.checks.length).toBeGreaterThan(10);
    await http().post(`/api/v1/association-applications/${row.id}/eligibility`).set('Cookie', adminCookie).send({ decision: 'PASSED', opId: randomUUID() }).expect(201);
    const evaluation = await http().post(`/api/v1/association-applications/${row.id}/evaluation`).set('Cookie', adminCookie).send({ operationalReadiness: 5, technicalCapability: 4, previousExperience: 3, integrityTransparency: 5, participationCommitment: 4, sustainabilityImpact: 5, opId: randomUUID() }).expect(201);
    expect(evaluation.body.score).toBe(86);
    const reevaluationRequest = await http().post(`/api/v1/association-applications/${row.id}/information-request`).set('Cookie', adminCookie).send({ items: [{ type: 'FIELD', key: 'organization.notes', reason: 'صحح وصف الجمعية قبل الاختيار' }], opId: randomUUID() }).expect(201);
    const invalidated = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } });
    expect(invalidated).toMatchObject({ eligibilityStatus: 'NEEDS_INFO', evaluationScore: null, evaluationRank: null, evaluatedAt: null, evaluatedById: null });
    expect(invalidated.evaluationBreakdown).toBeNull();
    expect(invalidated.evaluationEvidence).toBeNull();
    await http().post(`/api/v1/association-applications/track/${created.body.draftCode}/information/${reevaluationRequest.body.requestId}`).set(applicantAccess).send({ payload: { organization: { notes: 'وصف مصحح بعد التقييم' } }, opId: randomUUID() }).expect(201);
    await http().post(`/api/v1/association-applications/${row.id}/eligibility`).set('Cookie', adminCookie).send({ decision: 'PASSED', opId: randomUUID() }).expect(201);
    await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'RESERVE', opId: randomUUID() }).expect(409).expect(({ body }) => expect(body.error.code).toBe('APPLICATION_SELECTION_NOT_READY'));
    await http().post(`/api/v1/association-applications/${row.id}/evaluation`).set('Cookie', adminCookie).send({ operationalReadiness: 5, technicalCapability: 4, previousExperience: 3, integrityTransparency: 5, participationCommitment: 4, sustainabilityImpact: 5, opId: randomUUID() }).expect(201);
    await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'RESERVE', opId: randomUUID() }).expect(201);
    await flushEmail();
    expect(fakeEmail.lastApplicationAccess?.subject).toContain('قرار اختيار الجمعية');
    expect(fakeEmail.lastApplicationAccess?.intro).toContain('قائمة الاحتياط');
    expect(fakeEmail.lastApplicationAccess?.items[0]?.code).toBe(submitted.body.id);
    expect(fakeEmail.lastApplicationAccess?.items[0]?.url).toContain('/apply/access?token=');
    const final = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id }, include: { participation: true, sourceDraft: true } });
    expect(final.selectionList).toBe('RESERVE'); expect(final.participation).toBeNull(); expect(final.sourceDraft?.resumeTokenHash).not.toBe(created.body.resumeToken);
    const capacityKey = 'selection.mainTargetCount';
    const previousCapacity = await prisma.systemSetting.findUnique({ where: { key: capacityKey } });
    try {
      await prisma.systemSetting.deleteMany({ where: { key: capacityKey } });
      const reserveEmail = fakeEmail.lastApplicationAccess;
      await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'MAIN', opId: randomUUID() }).expect(201);
      const beforeSend = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id }, include: { participation: true, sourceDraft: true } });
      expect(beforeSend.selectionList).toBe('MAIN'); expect(beforeSend.participation).not.toBeNull();
      expect(fakeEmail.lastApplicationAccess).toEqual(reserveEmail);
      const queuedMain = await prisma.auditLog.findFirstOrThrow({ where: { action: 'APPLICATION_ACCESS_EMAIL_QUEUED', entityId: final.sourceDraft!.id, metadata: { path: ['selectionList'], equals: 'MAIN' } }, orderBy: { createdAt: 'desc' } });
      const mainEventId = (queuedMain.metadata as { eventId: string }).eventId;
      const mainEvent = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: mainEventId } });
      const queueFailure = jest.spyOn(app.get(ApplicationAccessService), 'sendSelectionDecision').mockRejectedValueOnce(new Error('synthetic queue unavailable'));
      try {
        await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'RESERVE', opId: randomUUID() }).expect(500);
      } finally { queueFailure.mockRestore(); }
      expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } })).selectionList).toBe('MAIN');
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: mainEventId } })).toEqual(mainEvent);
      await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'RESERVE', opId: randomUUID() }).expect(201);
      const downgraded = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id }, include: { participation: true } });
      expect(downgraded.selectionList).toBe('RESERVE'); expect(downgraded.participation?.id).toBe(beforeSend.participation?.id);
      await flushEmail();
      expect(fakeEmail.lastApplicationAccess?.intro).toContain('قائمة الاحتياط');
      const capacity = await prisma.associationApplication.count({ where: { selectionList: 'MAIN' } }) + 1;
      await prisma.systemSetting.create({ data: { key: capacityKey, value: capacity } });
      await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'MAIN', opId: randomUUID() }).expect(201);
      let release!: () => void, started!: () => void;
      const smtpBlocked = new Promise<void>(resolve => { release = resolve; });
      const smtpStarted = new Promise<void>(resolve => { started = resolve; });
      const originalSend = fakeEmail.sendApplicationAccess.bind(fakeEmail);
      const sending = jest.spyOn(fakeEmail, 'sendApplicationAccess').mockImplementationOnce(async params => { started(); await smtpBlocked; await originalSend(params); });
      const worker = flushEmail();
      try {
        await smtpStarted;
        await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'RESERVE', opId: randomUUID() }).expect(409);
        expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } })).selectionList).toBe('MAIN');
      } finally { release(); await worker; sending.mockRestore(); }
      expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id }, include: { participation: true } })).participation).not.toBeNull();
      const previousSelectionUrl = fakeEmail.lastApplicationAccess?.items[0]?.url;
      await http().post(`/api/v1/association-applications/${row.id}/selection-decision/resend`).set('Cookie', adminCookie).expect(201);
      await flushEmail();
      expect(fakeEmail.lastApplicationAccess?.intro).toContain('القائمة الأساسية');
      expect(fakeEmail.lastApplicationAccess?.items[0]?.url).not.toBe(previousSelectionUrl);
      await http().post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'RESERVE', opId: randomUUID() }).expect(409);
    } finally {
      if (previousCapacity) {
        const value = previousCapacity.value === null ? Prisma.JsonNull : previousCapacity.value as Prisma.InputJsonValue;
        await prisma.systemSetting.upsert({ where: { key: capacityKey }, create: { key: capacityKey, value }, update: { value } });
      } else {
        await prisma.systemSetting.deleteMany({ where: { key: capacityKey } });
      }
    }
  });

  it('rejects unknown financial sizes/sectors, unsafe website URLs and invalid governance scores before submission', async () => {
    const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    const auth = { Cookie: created.headers['set-cookie'][0] };
    const route = `/api/v1/association-applications/drafts/${created.body.draftCode}`;
    const payload = validV2Payload();
    let revision = 0;
    async function rejected(code: string) {
      const saved = await http().put(route).set(auth).send({ revision, payload }).expect(200);
      revision = saved.body.revision;
      await http().post(`${route}/submit`).set(auth).send({ revision }).expect(400).expect(({ body }) => expect(body.error.code).toBe(code));
    }
    payload.organization.category = 'تصنيف غير معروف';
    await rejected('APPLICATION_INVALID_REFERENCE');
    payload.organization.category = 'متوسطة';
    payload.organization.sectors = ['رعاية الأيتام', 'قطاع غير معروف'];
    await rejected('APPLICATION_INVALID_REFERENCE');
    payload.organization.sectors = ['رعاية الأيتام', 'التنمية المجتمعية'];
    payload.organization.websiteUrl = 'javascript:alert(1)';
    await rejected('APPLICATION_WEBSITE_INVALID');
    payload.organization.websiteUrl = 'https://example.org';
    payload.finance.governanceScore = 101;
    await rejected('APPLICATION_VALIDATION_FAILED');
  });

  it('rejects an expired applicant session and recovers the same draft through its official email', async () => {
    const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    const oldCookie = created.headers['set-cookie'][0];
    const email = `recovery-${randomUUID()}@example.org`;
    await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('Cookie', oldCookie).send({ revision: 0, payload: { organization: { officialEmail: email } } }).expect(200);
    const draft = await prisma.associationApplicationDraft.findUniqueOrThrow({ where: { publicCode: created.body.draftCode } });
    await prisma.applicationApplicantSession.updateMany({ where: { draftId: draft.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('Cookie', oldCookie).expect(403);
    await requestAccess(email);
    const accessUrl = fakeEmail.lastApplicationAccess?.items[0]?.url;
    expect(accessUrl).toContain('/apply/access?token=');
    const recovered = await http().post('/api/v1/association-applications/access/exchange').send({ token: new URL(accessUrl!).searchParams.get('token') }).expect(200);
    expect(recovered.body.draftCode).toBe(created.body.draftCode);
    await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('Cookie', recovered.headers['set-cookie'][0]).expect(200);
    await prisma.applicationApplicantSession.updateMany({ where: { draftId: draft.id, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set('Cookie', recovered.headers['set-cookie'][0]).expect(403);
  });

  it('keeps an earlier applicant access link usable when sending its replacement fails', async () => {
    const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    const email = `access-failure-${randomUUID()}@example.org`;
    await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`)
      .set('Cookie', created.headers['set-cookie'][0]).send({ revision: 0, payload: { organization: { officialEmail: email } } }).expect(200);
    await requestAccess(email);
    const priorUrl = fakeEmail.lastApplicationAccess?.items[0]?.url;
    expect(priorUrl).toContain('/apply/access?token=');
    jest.spyOn(fakeEmail, 'sendApplicationAccess').mockRejectedValueOnce(new Error('synthetic SMTP failure'));
    await requestAccess(email);
    const draft = await prisma.associationApplicationDraft.findUniqueOrThrow({ where: { publicCode: created.body.draftCode } });
    expect(await prisma.applicationAccessToken.count({ where: { draftId: draft.id, consumedAt: null } })).toBe(2);
    await http().post('/api/v1/association-applications/access/exchange')
      .send({ token: new URL(priorUrl!).searchParams.get('token') }).expect(200);
    jest.restoreAllMocks();
  });

  it('enforces the administrator intake deadline before a new draft is created', async () => {
    const key = 'application.intakeClosesAt';
    const previous = await prisma.systemSetting.findUnique({ where: { key } });
    try {
      await http().put('/api/v1/settings').set('Cookie', adminCookie).send({ key, value: '2026-01-01T00:00:00.000Z' }).expect(200);
      const status = await http().get('/api/v1/association-applications/intake').expect(200);
      expect(status.body.open).toBe(false);
      await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(409);
      await http().put('/api/v1/settings').set('Cookie', adminCookie).send({ key, value: null }).expect(200);
      expect((await http().get('/api/v1/association-applications/intake').expect(200)).body.open).toBe(true);
    } finally {
      const previousValue = previous?.value == null ? Prisma.JsonNull : previous.value as Prisma.InputJsonValue;
      await prisma.systemSetting.upsert({ where: { key }, create: { key, value: previousValue }, update: { value: previousValue } });
    }
  });

  it('scopes emailed access to one draft and rejects expired links', async () => {
    const email = `access-${Date.now()}@example.org`;
    const first = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    const second = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    for (const draft of [first.body, second.body]) {
      await http().put(`/api/v1/association-applications/drafts/${draft.draftCode}`).set('x-application-resume-token', draft.resumeToken).send({ revision: 0, payload: { organization: { officialEmail: email } } }).expect(200);
    }
    await requestAccess(email);
    expect(fakeEmail.lastApplicationAccess?.items).toHaveLength(2);
    const firstRow = await prisma.associationApplicationDraft.findUniqueOrThrow({ where: { publicCode: first.body.draftCode } });
    await prisma.applicationAccessToken.updateMany({ where: { draftId: firstRow.id, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredItem = fakeEmail.lastApplicationAccess!.items.find((item) => item.code === first.body.draftCode)!;
    await http().post('/api/v1/association-applications/access/exchange').send({ token: new URL(expiredItem.url).searchParams.get('token') }).expect(403);

    await requestAccess(email);
    const renewed = fakeEmail.lastApplicationAccess!.items.find((item) => item.code === first.body.draftCode)!;
    const exchange = await http().post('/api/v1/association-applications/access/exchange').send({ token: new URL(renewed.url).searchParams.get('token') }).expect(200);
    await http().get(`/api/v1/association-applications/drafts/${second.body.draftCode}`).set('Cookie', exchange.headers['set-cookie'][0]).expect(403);
    await http().post(`/api/v1/association-applications/drafts/${second.body.draftCode}/attachments`).set('Cookie', exchange.headers['set-cookie'][0]).field('fieldKey', 'licenseFile').attach('file', PDF, { filename: 'license.pdf', contentType: 'application/pdf' }).expect(403);
  });

  it('restricts attachment mutation to draft or explicitly requested resubmission and preserves the license reference', async () => {
    const draft = (await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201)).body;
    const auth = { 'x-application-resume-token': draft.resumeToken };
    const path = `/api/v1/association-applications/drafts/${draft.draftCode}`;
    const upload = (key: string, bytes = PDF, headers = auth) => http().post(`${path}/attachments`).set(headers).field('fieldKey', key).attach('file', bytes, { filename: 'test.pdf', contentType: 'application/pdf' });
    const saved = await http().put(path).set(auth).send({ revision: 0, payload: validV2Payload() }).expect(200);
    await upload('licenseFile').expect(201);
    await upload('licenseFile', Buffer.from('%PDF-1.7\n%draft-replacement')).expect(201);
    await upload('financialStatementsFile').expect(201);
    await upload('governanceReportFile').expect(201);
    await upload('licenseFile', PDF, { 'x-application-resume-token': 'x'.repeat(43) }).expect(403);
    await prisma.associationApplicationDraft.update({ where: { publicCode: draft.draftCode }, data: { expiresAt: new Date(0) } });
    await upload('licenseFile').expect(403);
    await prisma.associationApplicationDraft.update({ where: { publicCode: draft.draftCode }, data: { expiresAt: new Date(Date.now() + 60_000) } });
    const submitted = await http().post(`${path}/submit`).set(auth).send({ revision: saved.body.revision }).expect(201);
    const application = await prisma.associationApplication.findUniqueOrThrow({ where: { publicCode: submitted.body.id } });
    await upload('licenseFile').expect(403);
    const info = await http().post(`/api/v1/association-applications/${application.id}/information-request`).set('Cookie', adminCookie).send({ items: [{ type: 'ATTACHMENT', key: 'licenseFile', reason: 'ترخيص أوضح' }], opId: randomUUID() }).expect(201);
    await upload('financialStatementsFile').expect(403);
    const replacement = Buffer.from('%PDF-1.7\n%requested-license-B');
    await upload('licenseFile', replacement).expect(201);
    for (let reload = 0; reload < 2; reload += 1) {
      const refreshed = await prisma.associationApplication.findUniqueOrThrow({ where: { id: application.id }, include: { attachments: true } });
      expect(refreshed.licenseFileId).not.toBe(application.licenseFileId);
      expect(refreshed.licenseFileId).toBe(refreshed.attachments.find((item) => item.fieldKey === 'licenseFile')?.fileId);
      const download = await http().get(`/api/v1/association-applications/${application.id}/license-file`).set('Cookie', adminCookie).expect(200);
      const content = await fetch(download.body.url, { signal: AbortSignal.timeout(5000) });
      expect(content.status).toBe(200);
      expect(Buffer.from(await content.arrayBuffer())).toEqual(replacement);
    }
    expect(await prisma.fileObject.findUnique({ where: { id: application.licenseFileId! } })).toBeNull();
    await http().post(`/api/v1/association-applications/track/${draft.draftCode}/information/${info.body.requestId}`).set(auth).send({ payload: {}, opId: randomUUID() }).expect(201);
    await upload('licenseFile').expect(403);
  });

  it('projects corrected onboarding identity atomically and creates the signing account from the corrected values', async () => {
    const draft = (await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201)).body;
    const auth = { 'x-application-resume-token': draft.resumeToken };
    const path = `/api/v1/association-applications/drafts/${draft.draftCode}`;
    const original = validV2Payload();
    const saved = await http().put(path).set(auth).send({ revision: 0, payload: original }).expect(200);
    for (const key of ['licenseFile', 'financialStatementsFile', 'governanceReportFile']) await http().post(`${path}/attachments`).set(auth).field('fieldKey', key).attach('file', PDF, { filename: 'test.pdf', contentType: 'application/pdf' }).expect(201);
    const submitted = await http().post(`${path}/submit`).set(auth).send({ revision: saved.body.revision }).expect(201);
    const application = await prisma.associationApplication.findUniqueOrThrow({ where: { publicCode: submitted.body.id } });
    const region = await prisma.geographicUnit.findFirstOrThrow({ where: { unitType: 'REGION', active: true, officialCode: { not: '0001' } } });
    const city = await prisma.geographicUnit.findFirstOrThrow({ where: { parentOfficialCode: region.officialCode, active: true, unitType: { in: ['EMIRATE_SEAT', 'GOVERNORATE'] } } });
    const corrected = { organization: { officialEmail: `corrected-${randomUUID()}@example.org`, name: `${PREFIX}مصححة`, category: 'كبيرة', officialPhone: `5${randomInt(10000000, 100000000)}` }, location: { regionCode: region.officialCode, governorateCode: city.officialCode } };
    const items = ['organization.officialEmail','organization.name','organization.category','organization.officialPhone','location.regionCode','location.governorateCode'].map((key) => ({ type: 'FIELD', key, reason: 'تصحيح بيانات التجهيز' }));
    const info = await http().post(`/api/v1/association-applications/${application.id}/information-request`).set('Cookie', adminCookie).send({ items, opId: randomUUID() }).expect(201);
    const informationPath = `/api/v1/association-applications/track/${draft.draftCode}/information/${info.body.requestId}`;
    await http().post(informationPath).set(auth).send({ payload: { organization: { officialEmail: 'invalid' } }, opId: randomUUID() }).expect(400);
    expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: application.id } })).email).toBe(original.organization.officialEmail);
    await http().post(informationPath).set(auth).send({ payload: { ...corrected, organization: { ...corrected.organization, category: 'غير مصنف' } }, opId: randomUUID() }).expect(400).expect(({ body }) => expect(body.error.code).toBe('APPLICATION_INVALID_REFERENCE'));
    expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: application.id } })).category).toBe(original.organization.category);
    const collision = await prisma.associationApplication.create({ data: { publicCode: `${PREFIX}${randomUUID()}`, name: `${PREFIX}تعارض تجريبي`, region: 'الرياض', city: 'الرياض', phone: `05${randomInt(10000000, 100000000)}`, email: `collision-${randomUUID()}@example.org`, contactName: 'تجريبي', pledgeAccepted: true, pledgeAcceptedAt: new Date() } });
    await http().post(informationPath).set(auth).send({ payload: { ...corrected, organization: { ...corrected.organization, officialEmail: collision.email } }, opId: randomUUID() }).expect(409);
    expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: application.id } })).email).toBe(original.organization.officialEmail);
    await http().post(informationPath).set(auth).send({ payload: corrected, opId: randomUUID() }).expect(201);
    const current = await prisma.associationApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(current).toMatchObject({ email: corrected.organization.officialEmail, name: corrected.organization.name, category: corrected.organization.category, phone: `0${corrected.organization.officialPhone}`, region: region.nameAr.replace(/^منطقة\s+/, ''), city: city.nameAr.replace(/^(مدينة|محافظة)\s+/, '') });
    expect(current.v2Payload).toMatchObject(corrected);
    // Isolated fixture for the existing account-creation prerequisites, not a Production bypass.
    await prisma.associationApplication.update({ where: { id: current.id }, data: { selectionList: 'MAIN' } });
    const participation = await prisma.projectParticipation.create({ data: { applicationId: current.id, status: 'APPROVED_AWAITING_SETUP', activationBasis: 'AGREEMENT_COMPLETED', setupCompletedAt: new Date() } });
    const agreement = await http().post(`/api/v1/participations/${participation.id}/agreements`).set('Cookie', adminCookie).send({ version: 1, templateVersion: '1.0' }).expect(201);
    await http().post(`/api/v1/participations/agreements/${agreement.body.id}/transition`).set('Cookie', adminCookie).send({ status: 'SENT', opId: randomUUID() }).expect(201);
    const prepared = await http().post(`/api/v1/participations/${participation.id}/signing-account`).set('Cookie', adminCookie).send({ opId: randomUUID() }).expect(201);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: prepared.body.accountId } })).toMatchObject({ email: current.email, name: current.name });
    expect(await prisma.authCredential.findFirstOrThrow({ where: { accountId: prepared.body.accountId } })).toMatchObject({ identifier: current.email });
    expect(await prisma.association.findUniqueOrThrow({ where: { id: prepared.body.associationId } })).toMatchObject({ email: current.email, name: current.name, category: current.category, phones: [current.phone], region: current.region, city: current.city });
  });

  it('persists required attachments across reload and accepts the optional previous-project evidence as absent', async () => {
    const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    const auth = { 'x-application-resume-token': created.body.resumeToken };
    const payload = validV2Payload();
    payload.experience = { ...payload.experience, hasRecentInKindProject: true, projectName: 'مشروع سابق', projectYear: riyadhRecentYears()[0], supportType: 'أجهزة', projectBeneficiaries: 12, supporter: 'جهة تجريبية' };
    const saved = await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set(auth).send({ revision: 0, payload }).expect(200);
    for (const fieldKey of ['licenseFile', 'financialStatementsFile', 'governanceReportFile']) await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(auth).field('fieldKey', fieldKey).attach('file', PDF, { filename: `${fieldKey}.pdf`, contentType: 'application/pdf' }).expect(201);
    const loaded = await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set(auth).expect(200);
    expect(loaded.body.attachments.sort()).toEqual(['financialStatementsFile', 'governanceReportFile', 'licenseFile']);
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/submit`).set(auth).send({ revision: saved.body.revision }).expect(201);
  });

  it('rejects malformed email, prefixed phone, stale project year, missing supporter and missing financial statements', async () => {
    const cases: Array<[string, (payload: ReturnType<typeof validV2Payload>) => void, string]> = [
      ['email', (payload) => { payload.organization.officialEmail = 'nameexample.com'; }, 'أدخل بريدًا إلكترونيًا صحيحًا'],
      ['phone', (payload) => { payload.organization.officialPhone = '+966512345678'; }, '9 أرقام تبدأ بالرقم 5'],
      ['category-other', (payload) => { payload.organization.category = 'أخرى'; }, 'تصنيف الجمعية حسب حجمها المالي'],
      ['year', (payload) => { payload.experience = { ...payload.experience, hasRecentInKindProject: true, projectName: 'سابق', projectYear: 2020, supportType: 'أجهزة', projectBeneficiaries: 2, supporter: 'داعم' }; }, 'آخر سنتين'],
      ['supporter', (payload) => { payload.experience = { ...payload.experience, hasRecentInKindProject: true, projectName: 'سابق', projectYear: riyadhRecentYears()[0], supportType: 'أجهزة', projectBeneficiaries: 2 }; }, 'الجهة الداعمة'],
      ['satisfaction-other', (payload) => { payload.planning = { ...payload.planning, measuresSatisfaction: true, satisfactionTool: 'أخرى' }; }, 'تحديد أداة قياس الرضا'],
    ];
    for (const [name, mutate, expected] of cases) {
      const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
      const auth = { 'x-application-resume-token': created.body.resumeToken };
      const payload = validV2Payload(); mutate(payload);
      const saved = await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set(auth).send({ revision: 0, payload }).expect(200);
      await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(auth).field('fieldKey', 'licenseFile').attach('file', PDF, { filename: `${name}.pdf`, contentType: 'application/pdf' }).expect(201);
      await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(auth).field('fieldKey', 'financialStatementsFile').attach('file', PDF, { filename: `${name}-statements.pdf`, contentType: 'application/pdf' }).expect(201);
      await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(auth).field('fieldKey', 'governanceReportFile').attach('file', PDF, { filename: `${name}-governance.pdf`, contentType: 'application/pdf' }).expect(201);
      const response = await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/submit`).set(auth).send({ revision: saved.body.revision }).expect(400);
      expect(response.body.error.message).toContain(expected);
    }
    const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    const auth = { 'x-application-resume-token': created.body.resumeToken };
    const saved = await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set(auth).send({ revision: 0, payload: validV2Payload() }).expect(200);
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(auth).field('fieldKey', 'licenseFile').attach('file', PDF, { filename: 'license.pdf', contentType: 'application/pdf' }).expect(201);
    await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/attachments`).set(auth).field('fieldKey', 'governanceReportFile').attach('file', PDF, { filename: 'governance.pdf', contentType: 'application/pdf' }).expect(201);
    const missingStatements = await http().post(`/api/v1/association-applications/drafts/${created.body.draftCode}/submit`).set(auth).send({ revision: saved.body.revision }).expect(400);
    expect(missingStatements.body.error.message).toContain('القوائم المالية');
  });

  it('separates passive draft reads from autosave rate limits', async () => {
    const created = await http().post('/api/v1/association-applications/drafts').send({ clientRequestId: randomUUID() }).expect(201);
    const auth = { 'x-application-resume-token': created.body.resumeToken };
    for (let index = 0; index < 61; index += 1) await http().get(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set(auth).expect(200);
    await http().put(`/api/v1/association-applications/drafts/${created.body.draftCode}`).set(auth).send({ revision: 0, payload: { organization: { name: 'بعد القراءات' } } }).expect(200);
  });
});

function validV2Payload() {
  return {
    organization: { name: `${PREFIX}جمعية`, licenseNumber: `${PREFIX}LICENSE-${randomUUID()}`, licenseExpiryDate: '2030-12-31', category: 'متوسطة', sector: 'رعاية الأيتام، التنمية المجتمعية', sectors: ['رعاية الأيتام', 'التنمية المجتمعية'], hasWebsite: true, websiteUrl: 'https://example.org', officialEmail: `${PREFIX.toLowerCase()}${randomUUID()}@example.org`, officialPhone: `5${randomInt(10000000, 100000000)}` },
    location: { regionCode: '0001', governorateCode: '0100', districtCustom: 'حي تجريبي', serviceScope: 'المدينة أو المحافظة المختارة' },
    coordinator: { name: 'منسق تجريبي', title: 'منسق مشروع', phone: '512345679', email: `coordinator-${Date.now()}@example.org` }, covenantRepresentative: { name: 'ممثل تجريبي', title: 'رئيس مجلس الإدارة' },
    executive: { name: 'مدير تجريبي', phone: '512345670', education: 'بكالوريوس', experienceYears: 8 }, team: { fullTime: 5, partTime: 2, activeVolunteers: 10, nonSaudis: 0, universityOrHigher: 4 },
    socialResearcher: { exists: false }, readiness: { fieldTeamCount: 3, weeklyDeliveryCapacity: 20, hasReceiptStorage: false, canDocumentDigitally: true },
    beneficiaries: { registeredFamilies: 100, databaseUpdatedAt: '2026-09-01', hasSystem: false, classifiesNeed: false, hasCaseStudyMechanism: false },
    experience: { hasRecentInKindProject: false, projectName: undefined as string | undefined, projectYear: undefined as number | undefined, supportType: undefined as string | undefined, projectBeneficiaries: undefined as number | undefined, supporter: undefined as string | undefined, recentProjectsCount: 0, recentBeneficiariesCount: 0, ehsanSupportCount2025: 0, hasPreviousSimilarSupport: false },
    finance: { hasAccountingSystem: false, hasSpendingPolicy: false, governanceScore: 87.5, revenue: 12_000_000, expenses: 10_000_000, currentAssets: 11_000_000, currentLiabilities: 2_000_000 },
    planning: { hasStrategicPlan: false, hasOperationalPlan: false, hasPostAidFollowUp: false, measuresSatisfaction: false, satisfactionTool: undefined as string | undefined, lastYearProgramsCount: 4, lastYearBeneficiariesCount: 300 },
    acknowledgements: { allAccepted: true, acceptedAt: new Date().toISOString(), consentVersion: 'application-declarations-v1' },
  };
}

function riyadhRecentYears(now = new Date()) { const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric' }).format(now)); return [year, year - 1]; }

async function cleanup() {
  const apps = await prisma.associationApplication.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true, resultingAssociationId: true } });
  const associationIds = apps.map((item) => item.resultingAssociationId).filter((id): id is string => Boolean(id));
  await prisma.participationAgreement.deleteMany({ where: { participation: { applicationId: { in: apps.map((item) => item.id) } } } });
  await prisma.projectParticipation.deleteMany({ where: { applicationId: { in: apps.map((item) => item.id) } } });
  await prisma.associationApplicationDraft.deleteMany({ where: { OR: [{ contactEmail: { startsWith: PREFIX.toLowerCase() } }, { contactEmail: { startsWith: 'access-' } }, { submittedApplicationId: { in: apps.map((item) => item.id) } }] } });
  await prisma.associationApplication.deleteMany({ where: { id: { in: apps.map((item) => item.id) } } });
  await prisma.authCredential.deleteMany({ where: { account: { associationId: { in: associationIds } } } });
  await prisma.account.deleteMany({ where: { associationId: { in: associationIds } } });
  await prisma.association.deleteMany({ where: { id: { in: associationIds } } });
}
