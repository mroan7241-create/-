import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import type { Response } from 'superagent';
import ExcelJS from 'exceljs';
import { AccountRole, AccountStatus, AuthCredentialType, DeliveryStatus, prisma } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, hashSecret, seedTestFixtures } from './utils/fixtures';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

function parseBinary(response: Response, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error) => callback(error));
}

describe('ABANMI — read-only portal and privacy boundary', () => {
  let app: INestApplication;
  let cookie: string;
  let accountId: string;
  let generatedAccountId: string | undefined;
  let invitedAccountId: string | undefined;
  let fakeEmail: FakeEmailService;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;
  const email = 'e2e-abanmi@example.org';
  const password = 'E2eAbanmiPass123';

  beforeAll(async () => {
    ({ app, fakeEmail } = await createTestApp());
    fixtures = await seedTestFixtures();
    const account = await prisma.account.upsert({
      where: { publicCode: 'E2E-ABN-0001' },
      update: { name: 'أبانمي اختبار', email, role: AccountRole.ABANMI, associationId: null, status: AccountStatus.ACTIVE, mustChangePassword: false, archivedAt: null },
      create: { publicCode: 'E2E-ABN-0001', name: 'أبانمي اختبار', email, role: AccountRole.ABANMI, status: AccountStatus.ACTIVE },
    });
    accountId = account.id;
    await prisma.authCredential.upsert({
      where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
      update: { accountId, secretHash: await hashSecret(password) },
      create: { accountId, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash: await hashSecret(password) },
    });
  });

  beforeEach(async () => {
    await cleanAuthState();
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'user', email, password });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('ABANMI');
    cookie = login.headers['set-cookie'][0].split(';')[0];
  });

  afterAll(async () => {
    if (invitedAccountId) {
      await prisma.passwordResetToken.deleteMany({ where: { accountId: invitedAccountId } });
      await prisma.authSession.deleteMany({ where: { accountId: invitedAccountId } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorAccountId: invitedAccountId }, { entityId: invitedAccountId }] } });
      await prisma.authCredential.deleteMany({ where: { accountId: invitedAccountId } });
      await prisma.account.deleteMany({ where: { id: invitedAccountId } });
    }
    if (generatedAccountId) {
      await prisma.authSession.deleteMany({ where: { accountId: generatedAccountId } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorAccountId: generatedAccountId }, { entityId: generatedAccountId }] } });
      await prisma.authCredential.deleteMany({ where: { accountId: generatedAccountId } });
      await prisma.account.deleteMany({ where: { id: generatedAccountId } });
    }
    await prisma.authSession.deleteMany({ where: { accountId } });
    await prisma.auditLog.deleteMany({ where: { actorAccountId: accountId } });
    await prisma.authCredential.deleteMany({ where: { accountId } });
    await prisma.account.deleteMany({ where: { id: accountId } });
    await app.close();
  });

  it('invites by email, renews expiry without another account, activates once, and preserves existing accounts/reset', async () => {
    const http = () => request(app.getHttpServer());
    const adminLogin = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword }).expect(200);
    const adminCookie = adminLogin.headers['set-cookie'][0];
    const invitedEmail = 'e2e-abanmi-invitation@example.org';
    const encryptionKey = process.env.EMAIL_DELIVERY_ENCRYPTION_KEY;
    try {
      process.env.EMAIL_DELIVERY_ENCRYPTION_KEY = '';
      await http().post('/api/v1/accounts/abanmi').set('Cookie', adminCookie).send({ email: 'e2e-abanmi-queue-failed@example.org', invite: true }).expect(500);
      expect(await prisma.account.count({ where: { email: 'e2e-abanmi-queue-failed@example.org' } })).toBe(0);
    } finally { process.env.EMAIL_DELIVERY_ENCRYPTION_KEY = encryptionKey; }
    const created = await http().post('/api/v1/accounts/abanmi').set('Cookie', adminCookie).send({ email: invitedEmail, invite: true }).expect(201);
    invitedAccountId = created.body.accountId;
    expect(created.body.emailQueued).toBe(true); expect(created.body.temporaryPassword).toBeUndefined();
    await app.get(NotificationsService).processOutbox();
    const initial = fakeEmail.lastPasswordReset!;
    expect(initial).toMatchObject({ to: invitedEmail, invitation: true, code: expect.stringMatching(/^INV-[A-Z0-9]{32}$/) });
    const confirm = (code: string, name = 'مدعو أبانمي') => http().post('/api/v1/auth/password-reset/confirm').send({ email: invitedEmail, code, newPassword: 'InvitedAbanmiPassword123', name });
    await prisma.passwordResetToken.updateMany({ where: { accountId: invitedAccountId }, data: { expiresAt: new Date(0) } });
    await confirm(initial.code).expect(400);
    const retries = await Promise.all([1, 2].map(() => http().post('/api/v1/accounts/abanmi').set('Cookie', adminCookie).send({ email: invitedEmail, invite: true }).expect(201)));
    expect(retries.every((retry) => retry.body.accountId === invitedAccountId)).toBe(true);
    expect(await prisma.account.count({ where: { email: invitedEmail } })).toBe(1);
    await app.get(NotificationsService).processOutbox();
    const renewed = fakeEmail.lastPasswordReset!.code;
    expect(renewed).not.toBe(initial.code);
    await confirm(renewed, '').expect(400);
    await confirm(renewed).expect(200);
    const activated = await prisma.account.findUniqueOrThrow({ where: { id: invitedAccountId } });
    expect(activated).toMatchObject({ name: 'مدعو أبانمي', role: AccountRole.ABANMI, associationId: null, mustChangePassword: false });
    await confirm(renewed).expect(400);
    await http().post('/api/v1/accounts/abanmi').set('Cookie', adminCookie).send({ email: invitedEmail, invite: true }).expect(409);
    await http().post('/api/v1/accounts/abanmi').set('Cookie', adminCookie).send({ email: fixtures.adminEmail, invite: true }).expect(409);
    const login = await http().post('/api/v1/auth/login').send({ type: 'user', email: invitedEmail, password: 'InvitedAbanmiPassword123' }).expect(200);
    await http().get('/api/v1/association-applications').set('Cookie', login.headers['set-cookie'][0]).expect(403);
    await http().post('/api/v1/auth/password-reset/request').send({ email: invitedEmail }).expect(200);
    await app.get(NotificationsService).processOutbox();
    expect(fakeEmail.lastPasswordReset!.code).toMatch(/^RST-/);
    expect(fakeEmail.lastPasswordReset!.invitation).toBeUndefined();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: invitedAccountId } })).name).toBe('مدعو أبانمي');
  });

  it('returns aggregate reports and project tracking without beneficiary PII', async () => {
    const report = await request(app.getHttpServer()).get('/api/v1/reports/abanmi').set('Cookie', cookie);
    expect(report.status).toBe(200);
    expect(report.body.privacy).toEqual({ beneficiaryPiiIncluded: false });
    expect(Array.isArray(report.body.applications)).toBe(true);
    for (const application of report.body.applications) {
      expect(Object.keys(application).sort()).toEqual(['eligibilityStatus', 'id', 'name', 'processingStarted', 'publicCode', 'region', 'selectionList', 'status', 'submittedAt']);
    }
    const region = report.body.applications[0]?.region ?? report.body.associations[0]?.region;
    if (region) {
      const filtered = await request(app.getHttpServer()).get(`/api/v1/reports/abanmi?region=${encodeURIComponent(region)}`).set('Cookie', cookie);
      expect(filtered.status).toBe(200);
      expect(filtered.body.applications.every((row: { region: string }) => row.region === region)).toBe(true);
      expect(filtered.body.associations.every((row: { region: string }) => row.region === region)).toBe(true);
    }
    const serialized = JSON.stringify(report.body);
    expect(serialized).not.toContain('secondaryPhone');
    expect(serialized).not.toContain('address');
    expect(serialized).not.toContain('nationalId');

    const activities = await request(app.getHttpServer()).get('/api/v1/activities').set('Cookie', cookie);
    expect(activities.status).toBe(200);
  });

  it('denies every non-approved portal read and all business mutations at the central guard', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/dashboard/admin').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/api/v1/beneficiaries').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/api/v1/deliveries').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).post('/api/v1/activities').set('Cookie', cookie).send({ phaseOrder: 1, phaseName: 'x', mainActivityOrder: 1, mainActivityName: 'x', status: 'NOT_STARTED' })).status).toBe(403);
  });

  it('serves each operational dashboard through one aggregate browser request', async () => {
    const adminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];
    const admin = await request(app.getHttpServer()).get('/api/v1/dashboard/admin').set('Cookie', adminCookie);
    expect(admin.status).toBe(200);
    expect(admin.body).not.toHaveProperty('performance');
    expect(admin.body.counts.associations).toBe(await prisma.association.count({ where: { archivedAt: null } }));
    expect(admin.body.counts.totalBeneficiaries).toBe(await prisma.beneficiary.count({ where: { archivedAt: null } }));

    const associationLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: fixtures.assocPassword });
    const associationCookie = associationLogin.headers['set-cookie'][0].split(';')[0];
    const association = await request(app.getHttpServer()).get('/api/v1/dashboard/association').set('Cookie', associationCookie);
    expect(association.status).toBe(200);
    expect(association.body).not.toHaveProperty('performance');
    expect(association.body.counts.beneficiariesTotal).toBe(await prisma.beneficiary.count({ where: { associationId: fixtures.activeAssociationId, archivedAt: null } }));

    const delegateLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'delegate', code: fixtures.delegateCode });
    const delegateCookie = delegateLogin.headers['set-cookie'][0].split(';')[0];
    const delegate = await request(app.getHttpServer()).get('/api/v1/deliveries/delegate-portal').set('Cookie', delegateCookie);
    expect(delegate.status).toBe(200);
    expect(delegate.body).not.toHaveProperty('performance');
    expect(delegate.body.active).toMatchObject({ page: 1, pageSize: 25 });
    expect(delegate.body.history).toMatchObject({ page: 1, pageSize: 25 });
    expect(Array.isArray(delegate.body.active.items)).toBe(true);
    expect(Array.isArray(delegate.body.history.items)).toBe(true);
    const delegateAccount = await prisma.account.findUniqueOrThrow({ where: { publicCode: 'E2E-MND-0001' } });
    const historyStatuses = [DeliveryStatus.DELIVERY_CLOSED, DeliveryStatus.DELIVERED, DeliveryStatus.RETURNED];
    expect(delegate.body.active.total).toBe(await prisma.deliveryMission.count({ where: { delegateAccountId: delegateAccount.id, status: { notIn: historyStatuses } } }));
    expect(delegate.body.history.total).toBe(await prisma.deliveryMission.count({ where: { delegateAccountId: delegateAccount.id, status: { in: historyStatuses } } }));
  });

  it('serves the same PII-safe project report and XLSX to ADMIN', async () => {
    const adminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];
    const report = await request(app.getHttpServer()).get('/api/v1/reports/admin?from=2026-01-01&to=2026-12-31').set('Cookie', adminCookie);
    expect(report.status).toBe(200);
    expect(report.body.privacy).toEqual({ beneficiaryPiiIncluded: false });
    expect(report.body).toHaveProperty('procurement.purchaseOrders');
    expect(report.body).toHaveProperty('allocations');
    expect(JSON.stringify(report.body)).not.toMatch(/secondaryPhone|nationalId|secretHash|tokenHash/);

    const exportResult = await request(app.getHttpServer()).get('/api/v1/reports/admin/export.xlsx?from=2026-01-01&to=2026-12-31').set('Cookie', adminCookie).buffer(true).parse(parseBinary);
    expect(exportResult.status).toBe(200);
    expect(exportResult.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(Buffer.isBuffer(exportResult.body)).toBe(true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResult.body as unknown as ExcelJS.Buffer);
    const associationSheet = workbook.getWorksheet('حسب الجمعية');
    expect(associationSheet).toBeDefined();
    expect(workbook.getWorksheet('طلبات الانضمام')).toBeDefined();
    expect(workbook.getWorksheet('ملخص المشروع')?.getCell('A8').value).toBe('قراءة تنفيذية');
    const exportedStatuses: string[] = [];
    associationSheet?.eachRow((row, rowNumber) => { if (rowNumber > 1) exportedStatuses.push(String(row.getCell(5).value)); });
    expect(exportedStatuses).toContain('نشط');
    expect(exportedStatuses).not.toContain('ACTIVE');
  });

  it('creates an ABANMI account only through ADMIN and returns its temporary password once', async () => {
    const adminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];
    const created = await request(app.getHttpServer()).post('/api/v1/accounts/abanmi').set('Cookie', adminCookie).send({ name: 'أبانمي قبول مؤقت', email: 'e2e-abanmi-generated@example.org' });
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toEqual(expect.any(String));
    generatedAccountId = created.body.accountId;
    const stored = await prisma.authCredential.findFirstOrThrow({ where: { accountId: generatedAccountId } });
    expect(stored.secretHash).not.toBe(created.body.temporaryPassword);

    expect((await request(app.getHttpServer()).get('/api/v1/accounts/abanmi').set('Cookie', cookie)).status).toBe(403);
  });
});
