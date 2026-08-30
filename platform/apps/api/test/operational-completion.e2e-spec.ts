import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AgreementStatus, EligibilityStatus, Prisma, ProjectClosureStatus, prisma } from '@alzad/db';
import { LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';

describe('final operational workflows', () => {
  let app: INestApplication;
  let adminCookie: string;
  let associationCookie: string;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
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

  it('keeps eligibility, selection, setup, and activation distinct and returns credentials only from activation', async () => {
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
    const originalSettings = await prisma.systemSetting.findMany({ where: { key: { in: ['selection.passThreshold', 'selection.mainTargetCount'] } } });
    let resultingAssociationId: string | undefined;
    let resultingAccountId: string | undefined;
    try {
      const eligibility = await http().post(`/api/v1/association-applications/${application.id}/eligibility`).set('Cookie', adminCookie)
        .send({ decision: EligibilityStatus.PASSED, opId: opId('eligibility') });
      expect(eligibility.status).toBe(201);
      expect(eligibility.body.temporaryPassword).toBeUndefined();

      const evaluation = await http().post(`/api/v1/association-applications/${application.id}/evaluation`).set('Cookie', adminCookie).send({
        operationalReadiness: 100, technicalCapability: 100, previousExperience: 100,
        integrityTransparency: 100, participationCommitment: 100, sustainabilityImpact: 100,
        geographicProjectNeed: 100, opId: opId('evaluation'),
      });
      expect(evaluation.status).toBe(201);
      expect(evaluation.body.temporaryPassword).toBeUndefined();

      await prisma.systemSetting.upsert({ where: { key: 'selection.passThreshold' }, create: { key: 'selection.passThreshold', value: 100 }, update: { value: 100 } });
      await prisma.systemSetting.upsert({ where: { key: 'selection.mainTargetCount' }, create: { key: 'selection.mainTargetCount', value: 1 }, update: { value: 1 } });
      const preview = await http().post('/api/v1/association-applications/selection/preview').set('Cookie', adminCookie);
      expect(preview.status).toBe(201);
      expect(preview.body.items.some((item: { id: string; passesThreshold: boolean }) => item.id === application.id && item.passesThreshold)).toBe(true);

      const commit = await http().post('/api/v1/association-applications/selection/commit').set('Cookie', adminCookie)
        .send({ mainTargetCount: 1, supporterApprovalReference: 'E2E-DERIVED-SELECTION', opId: opId('selection') });
      expect(commit.status).toBe(201);
      expect(commit.body).toMatchObject({ ok: true, main: 1 });
      expect(commit.body.temporaryPassword).toBeUndefined();

      const participation = await prisma.projectParticipation.findUniqueOrThrow({ where: { applicationId: application.id } });
      const prematureActivation = await http().post(`/api/v1/participations/${participation.id}/activate`).set('Cookie', adminCookie).send({ opId: opId('premature-activation') });
      expect(prematureActivation.status).toBe(409);
      expect(prematureActivation.body.temporaryPassword).toBeUndefined();

      const agreementResponse = await http().post(`/api/v1/participations/${participation.id}/agreements`).set('Cookie', adminCookie)
        .send({ version: 1, templateVersion: 'E2E-APPROVED-TEMPLATE', reference: 'E2E-AGREEMENT' });
      expect(agreementResponse.status).toBe(201);
      const agreementId = agreementResponse.body.id as string;
      for (const [status, signerName] of [[AgreementStatus.SENT, undefined], [AgreementStatus.SIGNED_BY_ORG, 'ممثل الجمعية'], [AgreementStatus.SIGNED, 'ممثل زاد']] as const) {
        const transition = await http().post(`/api/v1/participations/agreements/${agreementId}/transition`).set('Cookie', adminCookie)
          .send({ status, signerName, opId: opId(`agreement-${status}`) });
        expect(transition.status).toBe(201);
      }
      await http().post(`/api/v1/participations/${participation.id}/setup-complete`).set('Cookie', adminCookie).send({ opId: opId('setup') }).expect(201);

      const activationOpId = opId('activation');
      const activation = await http().post(`/api/v1/participations/${participation.id}/activate`).set('Cookie', adminCookie).send({ opId: activationOpId });
      expect(activation.status).toBe(201);
      expect(typeof activation.body.temporaryPassword).toBe('string');
      expect(activation.body.temporaryPassword.length).toBeGreaterThanOrEqual(10);
      resultingAssociationId = activation.body.associationId;
      resultingAccountId = activation.body.accountId;

      const replay = await http().post(`/api/v1/participations/${participation.id}/activate`).set('Cookie', adminCookie).send({ opId: activationOpId });
      expect(replay.status).toBe(201);
      expect(replay.body.temporaryPassword).toBeNull();
      expect(replay.body.temporaryPasswordPreviouslyIssued).toBe(true);
      const login = await http().post('/api/v1/auth/login').send({ type: 'user', email, password: activation.body.temporaryPassword });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(true);
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
      await prisma.systemSetting.deleteMany({ where: { key: { in: ['selection.passThreshold', 'selection.mainTargetCount'] } } });
      for (const setting of originalSettings) await prisma.systemSetting.create({ data: { key: setting.key, value: setting.value === null ? Prisma.JsonNull : setting.value as Prisma.InputJsonValue } });
    }
  });

  it('exposes the project closure report only to ADMIN and enforces the full transition sequence', async () => {
    await prisma.projectClosureReport.create({ data: { projectKey: 'e2e-operational-review', snapshotJson: { source: 'isolated-e2e' }, lastActorId: fixtures.assocAccountId } });
    const original = await prisma.projectClosureReport.findUniqueOrThrow({ where: { projectKey: 'e2e-operational-review' } });
    await prisma.projectClosureReport.delete({ where: { id: original.id } });
    const report = await prisma.projectClosureReport.upsert({ where: { projectKey: 'electrical-appliances' }, create: { projectKey: 'electrical-appliances', snapshotJson: { source: 'isolated-e2e' }, lastActorId: fixtures.assocAccountId }, update: { status: ProjectClosureStatus.GENERATED, snapshotJson: { source: 'isolated-e2e' }, donorFeedbackNotes: null, lastActorId: fixtures.assocAccountId } });
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
