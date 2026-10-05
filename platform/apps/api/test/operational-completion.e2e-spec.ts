import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AccountRole, ActivationBasis, AgreementStatus, BeneficiaryListType, BeneficiaryReviewStatus, DamageCaseStatus, DeliveryApprovalDecision, DeliveryFailureReason, DeliveryStatus, DeviceMovementLocationType, DeviceStatus, DeviceType, EligibilityStatus, EscalationSeverity, EscalationStatus, NeedDecisionStatus, OrganizationClosureStatus, OutboxEventType, OutboxEventStatus, ParticipationStatus, Prisma, ProjectClosureStatus, PurchaseOrderStatus, ReconciliationIssueStatus, ReturnCondition, ShipmentRoute, ShipmentStatus, prisma } from '@alzad/db';
import { LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import type { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { IdempotencyService } from '../src/common/idempotency.service';
import type { AuthContext } from '../src/modules/auth/auth.types';
import { ClosureService } from '../src/modules/reports/closure.service';
import { ClosureReadinessService } from '../src/modules/reports/closure-readiness.service';
import { EscalationsService } from '../src/modules/escalations/escalations.service';
import { BeneficiariesService } from '../src/modules/beneficiaries/beneficiaries.service';
import { DeliveriesService } from '../src/modules/deliveries/deliveries.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { AutoAllocationService } from '../src/modules/allocation/auto-allocation.service';
import { ApplicationV2Service } from '../src/modules/applications/application-v2.service';
import { beneficiaryPayload } from './utils/node3-fixtures';
import { JPEG_1X1, PNG_1X1 } from './utils/node2-fixtures';
import { startTestStorage, stopTestStorage } from './utils/storage-harness';

describe('final operational workflows', () => {
  let app: INestApplication;
  let adminCookie: string;
  let associationCookie: string;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;
  let fakeEmail: FakeEmailService;

  beforeAll(async () => {
    ({ app, fakeEmail } = await createTestApp());
    fixtures = await seedTestFixtures();
    adminCookie = await loginAs(app, fixtures.adminEmail, fixtures.adminPassword);
    associationCookie = await loginAs(app, fixtures.assocEmail, fixtures.assocPassword);
  }, 60000);

  afterAll(async () => {
    await prisma.projectClosureReport.deleteMany({ where: { projectKey: 'e2e-operational-review' } });
    await cleanAuthState();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const opId = (prefix: string) => `${prefix}-${randomUUID()}`;

  it('keeps eligibility, selection, setup, restricted signing credentials, and operational activation distinct', async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `operational-${suffix}@example.org`;
    const application = await prisma.associationApplication.create({ data: {
      publicCode: `E2E-OPS-${suffix}`,
      clientRequestId: `e2e-ops-${suffix}`,
      name: `جمعية قبول تشغيلي ${suffix}`,
      category: 'جمعية خيرية', sector: 'رعاية الأيتام', region: 'الرياض', city: 'الرياض',
      phone: `055${String(Number.parseInt(suffix.slice(0, 6), 16)).padStart(7, '0').slice(0, 7)}`,
      email, contactName: 'مسؤول القبول التشغيلي', pledgeAccepted: true, pledgeAcceptedAt: new Date(),
    } });
    await prisma.applicationAnswer.createMany({ data: LEGACY_APPLICATION_QUESTIONS.map((question) => ({ applicationId: application.id, questionKey: question.key, answer: true })) });
    const originalSettings = await prisma.systemSetting.findMany({ where: { key: 'selection.mainTargetCount' } });
    let resultingAssociationId: string | undefined;
    let resultingAccountId: string | undefined;
    try {
      const eligibility = await http().post(`/api/v1/association-applications/${application.id}/eligibility`).set('Cookie', adminCookie)
        .send({ decision: EligibilityStatus.PASSED, opId: opId('eligibility') });
      expect(eligibility.status).toBe(201);
      expect(eligibility.body.temporaryPassword).toBeUndefined();

      const evaluation = await http().post(`/api/v1/association-applications/${application.id}/evaluation`).set('Cookie', adminCookie).send({
        operationalReadiness: 5, technicalCapability: 5, previousExperience: 5,
        integrityTransparency: 5, participationCommitment: 5, sustainabilityImpact: 5,
        opId: opId('evaluation'),
      });
      expect(evaluation.status).toBe(201);
      expect(evaluation.body.temporaryPassword).toBeUndefined();

      await prisma.systemSetting.upsert({ where: { key: 'selection.mainTargetCount' }, create: { key: 'selection.mainTargetCount', value: 1 }, update: { value: 1 } });
      const preview = await http().post('/api/v1/association-applications/selection/preview').set('Cookie', adminCookie);
      expect(preview.status).toBe(201);
      expect(preview.body.threshold).toBeNull();
      expect(preview.body.items.some((item: { id: string; score: number }) => item.id === application.id && item.score === 100)).toBe(true);

      const commit = await http().post('/api/v1/association-applications/selection/commit').set('Cookie', adminCookie)
        .send({ mainTargetCount: 1, opId: opId('selection') });
      expect(commit.status).toBe(201);
      expect(commit.body).toMatchObject({ ok: true, main: 1 });
      expect(commit.body.temporaryPassword).toBeUndefined();

      const participation = await prisma.projectParticipation.findUniqueOrThrow({ where: { applicationId: application.id } });
      await http().post(`/api/v1/participations/${participation.id}/setup-complete`).set('Cookie', adminCookie)
        .send({ opId: opId('setup-before-agreement') }).expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('COVENANT_NOT_READY'));
      const prematureActivation = await http().post(`/api/v1/participations/${participation.id}/activate`).set('Cookie', adminCookie).send({ opId: opId('premature-activation') });
      expect(prematureActivation.status).toBe(409);
      expect(prematureActivation.body.temporaryPassword).toBeUndefined();

      const agreementResponse = await http().post(`/api/v1/participations/${participation.id}/agreements`).set('Cookie', adminCookie)
        .send({ version: 1, templateVersion: '1.0', reference: 'E2E-AGREEMENT' });
      expect(agreementResponse.status).toBe(201);
      const agreementId = agreementResponse.body.id as string;
      await http().post(`/api/v1/participations/${participation.id}/setup-complete`).set('Cookie', adminCookie)
        .send({ opId: opId('setup-before-sent') }).expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('COVENANT_NOT_READY'));
      await http().post(`/api/v1/participations/agreements/${agreementId}/transition`).set('Cookie', adminCookie)
        .send({ status: AgreementStatus.SENT, opId: opId('agreement-sent') }).expect(201);
      await http().post(`/api/v1/participations/${participation.id}/signing-account`).set('Cookie', adminCookie)
        .send({ opId: opId('account-before-readiness') }).expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('PARTICIPATION_SETUP_INCOMPLETE'));
      await http().post(`/api/v1/participations/${participation.id}/setup-complete`).set('Cookie', adminCookie).send({ opId: opId('setup') }).expect(201);
      const ready = await prisma.projectParticipation.findUniqueOrThrow({ where: { id: participation.id } });
      await http().post(`/api/v1/participations/${participation.id}/setup-complete`).set('Cookie', adminCookie)
        .send({ opId: opId('setup-repeat') }).expect(201);
      const unchanged = await prisma.projectParticipation.findUniqueOrThrow({ where: { id: participation.id } });
      expect(unchanged.setupCompletedAt).toEqual(ready.setupCompletedAt);
      expect(unchanged.setupCompletedById).toBe(ready.setupCompletedById);
      expect(await prisma.auditLog.count({ where: { entityId: participation.id, action: 'PARTICIPATION_SETUP_COMPLETED' } })).toBe(1);

      const accountOpId = opId('signing-account');
      const activation = await http().post(`/api/v1/participations/${participation.id}/signing-account`).set('Cookie', adminCookie).send({ opId: accountOpId });
      expect(activation.status).toBe(201); expect(typeof activation.body.temporaryPassword).toBe('string'); expect(activation.body.temporaryPassword.length).toBeGreaterThanOrEqual(10);
      resultingAssociationId = activation.body.associationId; resultingAccountId = activation.body.accountId;
      expect(activation.body).toMatchObject({ emailQueued: true, emailSent: null });
      expect(await prisma.outboxEvent.count({ where: { type: OutboxEventType.EMAIL_DELIVERY, status: OutboxEventStatus.PENDING } })).toBeGreaterThan(0);
      await app.get(NotificationsService).processOutbox();
      expect(fakeEmail.lastSecurityAlert).toMatchObject({ to: email, subject: 'بيانات دخول الجمعية — مشروع الأجهزة الكهربائية' });
      expect(fakeEmail.lastSecurityAlert?.body).toContain(activation.body.temporaryPassword);
      const queuedCount = await prisma.outboxEvent.count({ where: { type: OutboxEventType.EMAIL_DELIVERY } });

      const replay = await http().post(`/api/v1/participations/${participation.id}/signing-account`).set('Cookie', adminCookie).send({ opId: accountOpId });
      expect(replay.status).toBe(201);
      expect(replay.body.temporaryPassword).toBeNull();
      expect(replay.body.temporaryPasswordPreviouslyIssued).toBe(true);
      expect(replay.body.emailSent).toBeNull();
      expect(await prisma.outboxEvent.count({ where: { type: OutboxEventType.EMAIL_DELIVERY } })).toBe(queuedCount);
      const login = await http().post('/api/v1/auth/login').send({ type: 'user', email, password: activation.body.temporaryPassword });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(true);
      expect(login.body.user.covenantRequired).toBe(true);
    } finally {
      if (resultingAccountId) {
        await prisma.authSession.deleteMany({ where: { accountId: resultingAccountId } });
        await prisma.authCredential.deleteMany({ where: { accountId: resultingAccountId } });
      }
      await prisma.participationAgreement.deleteMany({ where: { participation: { applicationId: application.id } } });
      await prisma.projectParticipation.deleteMany({ where: { applicationId: application.id } });
      await prisma.idempotencyKey.deleteMany({});
      await prisma.auditLog.deleteMany({});
      await prisma.applicationAnswer.deleteMany({ where: { applicationId: application.id } });
      await prisma.associationApplication.deleteMany({ where: { id: application.id } });
      if (resultingAccountId) await prisma.account.deleteMany({ where: { id: resultingAccountId } });
      if (resultingAssociationId) await prisma.association.deleteMany({ where: { id: resultingAssociationId } });
      await prisma.systemSetting.deleteMany({ where: { key: 'selection.mainTargetCount' } });
      for (const setting of originalSettings) await prisma.systemSetting.create({ data: { key: setting.key, value: setting.value === null ? Prisma.JsonNull : setting.value as Prisma.InputJsonValue } });
    }
  });

  it('exposes the project closure report only to ADMIN and enforces the full transition sequence', async () => {
    await prisma.projectClosureReport.create({ data: { projectKey: 'e2e-operational-review', snapshotJson: { source: 'isolated-e2e' }, lastActorId: fixtures.assocAccountId } });
    const original = await prisma.projectClosureReport.findUniqueOrThrow({ where: { projectKey: 'e2e-operational-review' } });
    await prisma.projectClosureReport.delete({ where: { id: original.id } });
    const generated = await http().post('/api/v1/reports/closure/project/generate').set('Cookie', adminCookie).expect(201);
    const report = generated.body as { id: string };
    try {
      await http().get('/api/v1/reports/closure/project').set('Cookie', associationCookie).expect(403);
      const get = await http().get('/api/v1/reports/closure/project').set('Cookie', adminCookie).expect(200);
      expect(get.body.id).toBe(report.id);
      for (const status of [ProjectClosureStatus.UNDER_INTERNAL_REVIEW, ProjectClosureStatus.APPROVED_INTERNAL, ProjectClosureStatus.SUBMITTED_TO_DONOR]) {
        await http().post('/api/v1/reports/closure/project/transition').set('Cookie', adminCookie).send({ status }).expect(201);
      }
      await http().post('/api/v1/reports/closure/project/transition').set('Cookie', adminCookie).send({ status: ProjectClosureStatus.DONOR_FEEDBACK }).expect(400);
      await http().post('/api/v1/reports/closure/project/transition').set('Cookie', adminCookie).send({ status: ProjectClosureStatus.DONOR_FEEDBACK, donorFeedbackNotes: 'ملاحظات اختبار معزول' }).expect(201);
      await http().post('/api/v1/reports/closure/project/transition').set('Cookie', adminCookie).send({ status: ProjectClosureStatus.RESUBMITTED }).expect(201);
      await http().post('/api/v1/reports/closure/project/transition').set('Cookie', adminCookie).send({ status: ProjectClosureStatus.DONOR_APPROVED }).expect(201);
      await http().post('/api/v1/reports/closure/project/transition').set('Cookie', adminCookie).send({ status: ProjectClosureStatus.PROJECT_CLOSED }).expect(201);
    } finally {
      await prisma.projectClosureReport.deleteMany({ where: { id: report.id } });
    }
  });
});

// These tests use the existing canary-protected PostgreSQL/S3 harness and real
// service transactions. Latches keep each competing transaction open until
// PostgreSQL confirms the other transaction is actually waiting for its lock.
describe('closure and operational transaction serialization', () => {
  let app: INestApplication;
  let admin: AuthContext;
  let scope: Awaited<ReturnType<typeof createScope>>;
  let closure: ClosureService;
  let escalation: EscalationsService;
  const op = (name: string) => `closure-e2e-${name}-${randomUUID()}`;

  function latch() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }

  async function waitForParticipationLock() {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%project_participations%') AS waiting
      `;
      if (rows[0]?.waiting) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error('Competing service transaction did not reach its PostgreSQL participation lock');
  }

  async function createScope() {
    const suffix = randomUUID();
    const association = await prisma.association.create({ data: { publicCode: `CLOSURE-ASC-${suffix}`, name: 'جمعية اختبار الإغلاق', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض', phones: ['0551234567'] } });
    const account = await prisma.account.create({ data: { publicCode: `CLOSURE-USR-${suffix}`, name: 'مسؤول اختبار الإغلاق', role: AccountRole.ASSOCIATION, associationId: association.id } });
    const delegate = await prisma.account.create({ data: { publicCode: `CLOSURE-MND-${suffix}`, name: 'مندوب اختبار الإغلاق', role: AccountRole.DELEGATE, associationId: association.id } });
    const participation = await prisma.projectParticipation.create({ data: { associationId: association.id, status: ParticipationStatus.ACTIVE, activationBasis: ActivationBasis.LEGACY_MIGRATION } });
    const ctx: AuthContext = { accountId: account.id, associationId: association.id, role: AccountRole.ASSOCIATION, sessionId: 'isolated-closure-test', mustChangePassword: false };
    return { associationId: association.id, participationId: participation.id, accountId: account.id, delegateId: delegate.id, ctx, delegate: { ...ctx, accountId: delegate.id, role: AccountRole.DELEGATE } };
  }

  async function cleanScope(item: Awaited<ReturnType<typeof createScope>>) {
    const associationId = item.associationId;
    await prisma.auditLog.deleteMany({ where: { associationId } });
    await prisma.idempotencyKey.deleteMany({ where: { OR: [{ accountId: item.accountId }, { accountId: item.delegateId }, { key: { startsWith: 'closure-e2e-' } }] } });
    await prisma.outboxEvent.deleteMany({ where: { payload: { path: ['associationId'], equals: associationId } } });
    await prisma.organizationClosureReport.deleteMany({ where: { participationId: item.participationId } });
    await prisma.projectParticipation.delete({ where: { id: item.participationId } });
    await prisma.escalationCase.deleteMany({ where: { associationId } });
    await prisma.damageCase.deleteMany({ where: { associationId } });
    await prisma.shipmentReconciliationIssue.deleteMany({ where: { associationId } });
    await prisma.deliveryApproval.deleteMany({ where: { mission: { associationId } } });
    await prisma.deliveryAttempt.deleteMany({ where: { mission: { associationId } } });
    await prisma.deliveryMission.deleteMany({ where: { associationId } });
    await prisma.deviceMovement.deleteMany({ where: { associationId } });
    await prisma.deviceAllocation.deleteMany({ where: { associationId } });
    await prisma.deviceUnit.deleteMany({ where: { associationId } });
    await prisma.beneficiaryNeed.deleteMany({ where: { associationId } });
    await prisma.beneficiary.deleteMany({ where: { associationId } });
    await prisma.notification.deleteMany({ where: { associationId } });
    await prisma.receiptItem.deleteMany({ where: { receiptBatch: { associationId } } });
    await prisma.receiptBatch.deleteMany({ where: { associationId } });
    await prisma.shipmentItem.deleteMany({ where: { shipment: { associationId } } });
    await prisma.shipment.deleteMany({ where: { associationId } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { associationId } } });
    await prisma.purchaseOrder.deleteMany({ where: { associationId } });
    await prisma.account.deleteMany({ where: { id: { in: [item.accountId, item.delegateId] } } });
    await prisma.association.delete({ where: { id: associationId } });
  }

  const openEscalation = (ctx: AuthContext, severity: EscalationSeverity = EscalationSeverity.HIGH, opId = op('open')) => escalation.create(ctx, { severity, category: 'اختبار الإغلاق', description: 'تصعيد اختبار معزول', requestedAction: 'مراجعة', opId });

  beforeAll(async () => {
    await startTestStorage();
    ({ app } = await createTestApp());
    const fixtures = await seedTestFixtures();
    const account = await prisma.account.findFirstOrThrow({ where: { email: fixtures.adminEmail } });
    admin = { accountId: account.id, associationId: null, role: AccountRole.ADMIN, sessionId: 'isolated-closure-admin', mustChangePassword: false };
    closure = app.get(ClosureService);
    escalation = app.get(EscalationsService);
  }, 60000);

  beforeEach(async () => { scope = await createScope(); });
  afterEach(async () => { jest.restoreAllMocks(); await prisma.projectClosureReport.deleteMany({ where: { projectKey: 'electrical-appliances' } }); await cleanScope(scope); });
  afterAll(async () => { await app.close(); await stopTestStorage(); });

  async function closeScope() {
    const report = await closure.generate(scope.ctx, scope.participationId, op('project-source'));
    await closure.transitionOrganization(scope.ctx, report.id, OrganizationClosureStatus.SUBMITTED, op('project-submit'));
    for (const status of [OrganizationClosureStatus.UNDER_REVIEW, OrganizationClosureStatus.APPROVED, OrganizationClosureStatus.CLOSED]) {
      await closure.transitionOrganization(admin, report.id, status, op(`project-${status}`));
    }
    return report;
  }

  async function waitForAdmissionLock() {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE '%association-selection:electrical-appliances%') AS waiting
      `;
      if (rows[0]?.waiting) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error('Competing project transaction did not reach the existing admission lock');
  }

  it('keeps externally reviewed/final project snapshots immutable and preserves their actor', async () => {
    await closeScope();
    const report = await closure.generateProject(admin);
    for (const status of [ProjectClosureStatus.UNDER_INTERNAL_REVIEW, ProjectClosureStatus.APPROVED_INTERNAL, ProjectClosureStatus.SUBMITTED_TO_DONOR, ProjectClosureStatus.DONOR_APPROVED, ProjectClosureStatus.PROJECT_CLOSED]) {
      await closure.transitionProject(admin, status);
      if (status === ProjectClosureStatus.SUBMITTED_TO_DONOR || status === ProjectClosureStatus.DONOR_APPROVED || status === ProjectClosureStatus.PROJECT_CLOSED) {
        const before = await prisma.projectClosureReport.findUniqueOrThrow({ where: { id: report.id } });
        await expect(closure.generateProject(admin)).rejects.toMatchObject({ code: 'PROJECT_CLOSURE_REPORT_LOCKED' });
        expect(await prisma.projectClosureReport.findUniqueOrThrow({ where: { id: report.id } })).toEqual(before);
      }
    }
  });

  it('does not approve an outdated snapshot after reopening, then refreshes through the existing review path', async () => {
    const organization = await closeScope();
    await closure.generateProject(admin);
    await closure.transitionProject(admin, ProjectClosureStatus.UNDER_INTERNAL_REVIEW);
    await closure.reopen(admin, organization.id, 'إعادة فتح معزولة');
    await expect(closure.transitionProject(admin, ProjectClosureStatus.APPROVED_INTERNAL)).rejects.toMatchObject({ code: 'PROJECT_CLOSURE_ORGANIZATIONS_OPEN' });
    await openEscalation(scope.ctx, EscalationSeverity.LOW);
    await closure.transitionOrganization(scope.ctx, organization.id, OrganizationClosureStatus.SUBMITTED, op('project-resubmit'));
    for (const status of [OrganizationClosureStatus.UNDER_REVIEW, OrganizationClosureStatus.APPROVED, OrganizationClosureStatus.CLOSED]) await closure.transitionOrganization(admin, organization.id, status, op(`refresh-${status}`));
    await expect(closure.transitionProject(admin, ProjectClosureStatus.APPROVED_INTERNAL)).rejects.toMatchObject({ code: 'PROJECT_CLOSURE_SNAPSHOT_STALE' });
    const refreshed = await closure.generateProject(admin);
    expect(refreshed.status).toBe(ProjectClosureStatus.GENERATED);
    await closure.transitionProject(admin, ProjectClosureStatus.UNDER_INTERNAL_REVIEW);
    await closure.transitionProject(admin, ProjectClosureStatus.APPROVED_INTERNAL);
  });

  it('sees a concurrently committed new participation before generation without rejecting its admission', async () => {
    await closeScope();
    const gate = latch(); const release = latch(); let addedId: string | undefined;
    const admission = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('association-selection:electrical-appliances'))`;
      addedId = (await tx.projectParticipation.create({ data: { status: ParticipationStatus.APPROVED_AWAITING_SETUP, activationBasis: ActivationBasis.AGREEMENT_COMPLETED } })).id;
      gate.resolve(); await release.promise;
    }, { timeout: 10000 });
    await gate.promise;
    const generated = closure.generateProject(admin).then(() => ({ ok: true }), (error: unknown) => ({ error }));
    try {
      await waitForAdmissionLock(); release.resolve(); await admission;
      expect(await generated).toMatchObject({ error: { code: 'PROJECT_CLOSURE_ORGANIZATIONS_OPEN' } });
      expect(await prisma.projectParticipation.findUnique({ where: { id: addedId } })).not.toBeNull();
    } finally { release.resolve(); await admission; await generated; if (addedId) await prisma.projectParticipation.delete({ where: { id: addedId } }); }
  });

  it('serializes concurrent initial generation instead of creating duplicate project reports', async () => {
    await closeScope();
    const reports = await Promise.all([closure.generateProject(admin), closure.generateProject(admin)]);
    expect(reports[0].id).toBe(reports[1].id);
    expect(await prisma.projectClosureReport.count({ where: { projectKey: 'electrical-appliances' } })).toBe(1);
  });

  it('allows public draft creation during a project snapshot and admits a later participation without freezing intake', async () => {
    await closeScope();
    const gate = latch(); const release = latch(); let addedId: string | undefined;
    const target = closure as unknown as { currentProjectReports(tx: Prisma.TransactionClient): Promise<unknown> };
    const collect = target.currentProjectReports.bind(closure);
    jest.spyOn(target, 'currentProjectReports').mockImplementationOnce(async (tx) => {
      const reports = await collect(tx); gate.resolve(); await release.promise; return reports;
    });
    const generation = closure.generateProject(admin);
    await gate.promise;
    const admission = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('association-selection:electrical-appliances'))`;
      return tx.projectParticipation.create({ data: { status: ParticipationStatus.APPROVED_AWAITING_SETUP, activationBasis: ActivationBasis.AGREEMENT_COMPLETED } });
    }, { timeout: 10000 });
    const draftRequest = op('public-draft');
    try {
      await waitForAdmissionLock();
      const draft = await app.get(ApplicationV2Service).createDraft(draftRequest, undefined, 'isolated-project-closure');
      expect(draft.draftCode).toBeTruthy();
      release.resolve(); const report = await generation; addedId = (await admission).id;
      expect((report.snapshotJson as { organizationReports: unknown[] }).organizationReports).toHaveLength(1);
      await expect(closure.transitionProject(admin, ProjectClosureStatus.UNDER_INTERNAL_REVIEW)).rejects.toMatchObject({ code: 'PROJECT_CLOSURE_ORGANIZATIONS_OPEN' });
      expect(await prisma.projectParticipation.findUnique({ where: { id: addedId } })).not.toBeNull();
    } finally {
      release.resolve(); await generation; addedId ??= (await admission).id;
      await prisma.associationApplicationDraft.deleteMany({ where: { clientRequestId: draftRequest } });
      if (addedId) await prisma.projectParticipation.delete({ where: { id: addedId } });
    }
  });

  it('completes closure from ACTIVE, replays past operations, and refreshes a reopened snapshot', async () => {
    const generateOp = op('generate');
    const report = await closure.generate(scope.ctx, scope.participationId, generateOp);
    await closure.updateQualitative(scope.ctx, report.id, { finalNotes: 'تقرير الاختبار' });
    await closure.transitionOrganization(scope.ctx, report.id, OrganizationClosureStatus.SUBMITTED, op('submit'));
    for (const status of [OrganizationClosureStatus.UNDER_REVIEW, OrganizationClosureStatus.APPROVED, OrganizationClosureStatus.CLOSED]) await closure.transitionOrganization(admin, report.id, status, op(status));
    await expect(closure.generate(scope.ctx, scope.participationId, generateOp)).resolves.toEqual(report);
    await expect(closure.generate(scope.ctx, scope.participationId, op('regenerate'))).rejects.toMatchObject({ code: 'CLOSURE_REPORT_LOCKED' });
    const previous = await prisma.organizationClosureReport.findUniqueOrThrow({ where: { id: report.id } });
    await closure.reopen(admin, report.id, 'تصحيح موثق للاختبار');
    await openEscalation(scope.ctx, EscalationSeverity.LOW);
    await closure.transitionOrganization(scope.ctx, report.id, OrganizationClosureStatus.SUBMITTED, op('resubmit'));
    const current = await prisma.organizationClosureReport.findUniqueOrThrow({ where: { id: report.id } });
    expect((previous.snapshotJson as Record<string, unknown>).escalations).toEqual([]);
    expect((current.snapshotJson as Record<string, unknown>).escalations).toEqual(expect.arrayContaining([expect.objectContaining({ status: EscalationStatus.OPEN, _count: { _all: 1 } })]));
    expect(current.finalNotes).toBe('تقرير الاختبار');
    const reopenAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: report.id, action: 'ORGANIZATION_CLOSURE_REOPENED' } });
    expect((reopenAudit.metadata as Record<string, unknown>).previousSnapshot).toEqual(previous.snapshotJson);
  });

  it('sees a blocker committed by an operational transaction that acquired its lock first', async () => {
    const entered = latch(); const release = latch();
    const idem = app.get(IdempotencyService); const original = idem.complete.bind(idem);
    jest.spyOn(idem, 'complete').mockImplementation(async (...args) => {
      await original(...args);
      if (args[2] === 'escalation-open') { entered.resolve(); await release.promise; }
    });
    const writing = openEscalation(scope.ctx);
    await entered.promise;
    const closing = closure.generate(scope.ctx, scope.participationId, op('race-writer-first')).then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    try { await waitForParticipationLock(); } finally { release.resolve(); }
    await writing;
    expect((await closing).error).toMatchObject({ code: 'CLOSURE_NOT_READY' });
    expect(await prisma.organizationClosureReport.count({ where: { participationId: scope.participationId } })).toBe(0);
    expect((await prisma.projectParticipation.findUniqueOrThrow({ where: { id: scope.participationId } })).status).toBe(ParticipationStatus.ACTIVE);
  });

  it('rejects a waiting operational mutation after closure wins while another association remains independent', async () => {
    const entered = latch(); const release = latch();
    const readiness = app.get(ClosureReadinessService); const original = readiness.check.bind(readiness);
    jest.spyOn(readiness, 'check').mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return original(...args); });
    const other = await createScope();
    const closing = closure.generate(scope.ctx, scope.participationId, op('race-closure-first'));
    await entered.promise;
    const writeOp = op('race-waiting-write');
    const writing = openEscalation(scope.ctx, EscalationSeverity.HIGH, writeOp).then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    try {
      await waitForParticipationLock();
      await openEscalation(other.ctx, EscalationSeverity.LOW);
    } finally { release.resolve(); }
    await closing;
    expect((await writing).error).toMatchObject({ code: 'PARTICIPATION_CLOSURE_IN_PROGRESS' });
    expect(await prisma.escalationCase.count({ where: { associationId: scope.associationId } })).toBe(0);
    expect(await prisma.idempotencyKey.count({ where: { key: writeOp } })).toBe(0);
    await cleanScope(other);
  });

  it('allows two normal operational transactions to share the participation lock', async () => {
    const entered = latch(); const release = latch();
    const idem = app.get(IdempotencyService); const original = idem.complete.bind(idem);
    const firstOp = op('shared-first');
    jest.spyOn(idem, 'complete').mockImplementation(async (...args) => { await original(...args); if (args[3] === firstOp) { entered.resolve(); await release.promise; } });
    const first = openEscalation(scope.ctx, EscalationSeverity.LOW, firstOp);
    await entered.promise;
    try { await openEscalation(scope.ctx, EscalationSeverity.LOW); } finally { release.resolve(); }
    await first;
    expect(await prisma.escalationCase.count({ where: { associationId: scope.associationId } })).toBe(2);
  });

  it('rereads report editability after waiting behind submission', async () => {
    const report = await closure.generate(scope.ctx, scope.participationId, op('edit-race-generate'));
    const entered = latch(); const release = latch();
    const readiness = app.get(ClosureReadinessService); const original = readiness.check.bind(readiness);
    jest.spyOn(readiness, 'check').mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return original(...args); });
    const submission = closure.transitionOrganization(scope.ctx, report.id, OrganizationClosureStatus.SUBMITTED, op('edit-race-submit'));
    await entered.promise;
    const editing = closure.updateQualitative(scope.ctx, report.id, { finalNotes: 'late edit' }).then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    try { await waitForParticipationLock(); } finally { release.resolve(); }
    await submission;
    expect((await editing).error).toMatchObject({ code: 'CLOSURE_REPORT_LOCKED' });
    expect((await prisma.organizationClosureReport.findUniqueOrThrow({ where: { id: report.id } })).finalNotes).toBeNull();
  });

  it('does not let concurrent distinct submissions advance a report twice', async () => {
    const report = await closure.generate(scope.ctx, scope.participationId, op('submit-race-generate'));
    const outcomes = await Promise.allSettled([closure.transitionOrganization(scope.ctx, report.id, OrganizationClosureStatus.SUBMITTED, op('submit-a')), closure.transitionOrganization(scope.ctx, report.id, OrganizationClosureStatus.SUBMITTED, op('submit-b'))]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: 'CLOSURE_TRANSITION_INVALID' }) })]);
    expect(await prisma.auditLog.count({ where: { entityId: report.id, action: 'ORGANIZATION_CLOSURE_TRANSITIONED' } })).toBe(1);
  });

  it.each([ParticipationStatus.READY_TO_CLOSE, ParticipationStatus.CLOSURE_SUBMITTED, ParticipationStatus.CLOSED])('protects each existing operational writer in %s without domain writes', async (status) => {
    const beneficiary = await prisma.beneficiary.create({ data: { publicCode: op('beneficiary'), associationId: scope.associationId, name: 'اختبار', region: 'الرياض', city: 'الرياض', phone: '0551234567', familyCount: 3, maritalStatus: 'أرملة', reviewStatus: BeneficiaryReviewStatus.APPROVED } });
    const need = await prisma.beneficiaryNeed.create({ data: { publicCode: op('need'), beneficiaryId: beneficiary.id, associationId: scope.associationId, deviceType: DeviceType.REFRIGERATOR } });
    const mission = await prisma.deliveryMission.create({ data: { publicCode: op('mission'), beneficiaryId: beneficiary.id, associationId: scope.associationId, delegateAccountId: scope.delegateId, status: DeliveryStatus.OUT_WITH_DELEGATE } });
    const device = await prisma.deviceUnit.create({ data: { publicCode: op('device'), associationId: scope.associationId, deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', currentLocationType: DeviceMovementLocationType.WAREHOUSE } });
    const damage = await prisma.damageCase.create({ data: { associationId: scope.associationId, deviceId: device.id, description: 'اختبار تلف' } });
    const batch = await prisma.receiptBatch.create({ data: { publicCode: op('batch'), associationId: scope.associationId, supplierName: 'مورد اختبار', createdById: admin.accountId } });
    await prisma.receiptItem.create({ data: { publicCode: op('receipt-item'), receiptBatchId: batch.id, deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 1 } });
    const order = await prisma.purchaseOrder.create({ data: { publicCode: op('order'), orderNumber: op('order-number'), associationId: scope.associationId, supplierName: 'مورد اختبار', createdById: admin.accountId } });
    const orderItem = await prisma.purchaseOrderItem.create({ data: { purchaseOrderId: order.id, deviceType: DeviceType.REFRIGERATOR, approvedQty: 1 } });
    const shipment = await prisma.shipment.create({ data: { publicCode: op('shipment'), purchaseOrderId: order.id, associationId: scope.associationId, route: ShipmentRoute.SUPPLIER_TO_ORGANIZATION } });
    const issue = await prisma.shipmentReconciliationIssue.create({ data: { shipmentId: shipment.id, associationId: scope.associationId, type: 'MISSING', expectedQty: 1, actualQty: 0 } });
    const escalationItem = await openEscalation(scope.ctx, EscalationSeverity.LOW);
    await prisma.projectParticipation.update({ where: { id: scope.participationId }, data: { status } });
    const beneficiaries = app.get(BeneficiariesService); const deliveries = app.get(DeliveriesService); const receipts = app.get(ReceiptsService); const inventory = app.get(InventoryService); const procurement = app.get(ProcurementService);
    const payload = beneficiaryPayload({ associationId: scope.associationId, opId: op('create-beneficiary') });
    const updatePayload = { ...payload, deviceTypes: undefined, opId: op('update-beneficiary') };
    const evidence = { buffer: JPEG_1X1, declaredMimeType: 'image/jpeg' }; const signature = { buffer: PNG_1X1, declaredMimeType: 'image/png' };
    const operations: Array<() => Promise<unknown>> = [
      () => beneficiaries.createBeneficiary(scope.ctx, payload),
      () => beneficiaries.importBeneficiaries(scope.ctx, { acceptedPledge: true, rows: [payload], opId: op('import') }),
      () => beneficiaries.updateBeneficiary(scope.ctx, beneficiary.id, updatePayload),
      () => beneficiaries.updateBeneficiaryLocation(scope.ctx, beneficiary.id, { lat: 24.7, lng: 46.7, opId: op('location') }),
      () => beneficiaries.removePendingNeed(scope.ctx, need.id, op('remove-need')),
      () => beneficiaries.reviewBeneficiary(admin, beneficiary.id, { beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: need.id, decision: 'APPROVED' }], opId: op('review') }),
      () => beneficiaries.setListDecision(admin, beneficiary.id, BeneficiaryListType.MAIN, 1, 'اختبار', op('list')),
      () => beneficiaries.promoteReserve(admin, beneficiary.id, 1, 'اختبار', op('promote')),
      () => beneficiaries.replaceBeneficiary(admin, beneficiary.id, beneficiary.id, escalationItem.id, 'اختبار', op('replace')),
      () => deliveries.assignDelegate(admin, { beneficiaryId: beneficiary.id, delegateId: scope.delegateId, opId: op('assign') }),
      () => deliveries.confirmHandover(scope.delegate, mission.id, op('handover')),
      () => deliveries.declineHandover(scope.delegate, mission.id, 'اختبار', op('decline')),
      () => deliveries.confirmDelivery(scope.delegate, mission.id, evidence, signature, op('confirm-delivery')),
      () => deliveries.failDelivery(scope.delegate, mission.id, { failureReason: DeliveryFailureReason.NOT_FOUND, opId: op('fail-delivery') }),
      () => deliveries.retryDelivery(scope.delegate, mission.id, op('retry-delivery')),
      () => deliveries.approveDelivery(admin, mission.id, 'ZAAD', { decision: DeliveryApprovalDecision.APPROVED, opId: op('approve-delivery') }),
      () => deliveries.reschedule(scope.delegate, mission.id, { reason: 'اختبار', scheduledFor: new Date(Date.now() + 86400000).toISOString(), opId: op('reschedule') }),
      () => deliveries.resumeDeferred(scope.delegate, mission.id, op('resume')),
      () => deliveries.requestReturn(scope.delegate, mission.id, { opId: op('return-request') }),
      () => deliveries.confirmPhysicalReturn(admin, mission.id, { condition: ReturnCondition.GOOD, notes: 'اختبار', opId: op('return-confirm') }, true),
      () => deliveries.returnToWarehouse(scope.delegate, mission.id, { opId: op('return-legacy') }),
      () => receipts.sendBatch(admin, batch.id, op('receipt-send')),
      () => receipts.createBatch(admin, { associationId: scope.associationId, supplierName: 'مورد اختبار', sentDate: '2026-01-15', items: [{ deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 1 }], opId: op('receipt-create') }),
      () => receipts.confirmBatch(scope.ctx, batch.id, { receiverTitle: 'مدير الجمعية', opId: op('receipt-confirm') }, evidence, signature, []),
      () => inventory.updateDeviceUnit(admin, device.id, { spec: '18 قدم', opId: op('device-update') }),
      () => inventory.markDeviceDamaged(admin, device.id, { opId: op('device-damage') }),
      () => inventory.decideDamageCase(admin, damage.id, { status: DamageCaseStatus.UNDER_REVIEW, opId: op('damage-decision') }),
      () => procurement.createOrder(admin, { associationId: scope.associationId, orderNumber: op('new-order'), supplierName: 'مورد اختبار', items: [{ deviceType: DeviceType.REFRIGERATOR, approvedQty: 1 }], opId: op('order-create') }),
      () => procurement.transitionOrder(admin, order.id, PurchaseOrderStatus.APPROVED, op('order-transition')),
      () => procurement.createShipment(admin, { purchaseOrderId: order.id, route: ShipmentRoute.SUPPLIER_TO_ORGANIZATION, items: [{ purchaseOrderItemId: orderItem.id, shippedQty: 1 }], opId: op('shipment-create') }),
      () => procurement.transitionShipment(admin, shipment.id, ShipmentStatus.DISPATCHED, op('shipment-transition')),
      () => procurement.decideIssue(admin, issue.id, ReconciliationIssueStatus.UNDER_REVIEW, 'اختبار', op('issue-decision')),
      () => openEscalation(scope.ctx),
      () => escalation.decide(admin, escalationItem.id, { decision: EscalationStatus.NEEDS_INFO, resolution: 'اختبار', opId: op('escalation-decision') }),
    ];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ code: 'PARTICIPATION_CLOSURE_IN_PROGRESS' });
    await expect(app.get(AutoAllocationService).runForAssociation(admin, scope.associationId, op('allocation'))).resolves.toMatchObject({ skipped: 'closure-in-progress', filled: 0, reclaimed: 0 });
    await expect(app.get(AutoAllocationService).triggerForAssociation(scope.associationId)).resolves.toBeUndefined();
    expect(await prisma.idempotencyKey.count({ where: { accountId: { in: [scope.accountId, scope.delegateId] } } })).toBe(1);
    expect(await prisma.deviceMovement.count({ where: { associationId: scope.associationId } })).toBe(0);
    expect(await prisma.deviceAllocation.count({ where: { associationId: scope.associationId } })).toBe(0);
    expect((await prisma.deviceUnit.findUniqueOrThrow({ where: { id: device.id } })).status).toBe(DeviceStatus.WAREHOUSE);
    expect((await prisma.deliveryMission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe(DeliveryStatus.OUT_WITH_DELEGATE);
  }, 60000);
});
