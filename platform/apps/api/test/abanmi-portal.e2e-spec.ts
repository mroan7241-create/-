import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { AccountRole, AccountStatus, AuthCredentialType, prisma } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, hashSecret, seedTestFixtures } from './utils/fixtures';

describe('ABANMI — read-only portal and privacy boundary', () => {
  let app: INestApplication;
  let cookie: string;
  let accountId: string;
  let generatedAccountId: string | undefined;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;
  const email = 'e2e-abanmi@example.org';
  const password = 'E2eAbanmiPass123';

  beforeAll(async () => {
    ({ app } = await createTestApp());
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

  it('returns aggregate reports and project tracking without beneficiary PII', async () => {
    const report = await request(app.getHttpServer()).get('/api/v1/reports/abanmi').set('Cookie', cookie);
    expect(report.status).toBe(200);
    expect(report.body.privacy).toEqual({ beneficiaryPiiIncluded: false });
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
    expect(admin.body.performance).toEqual({ browserRequests: 1, replacesBrowserRequests: 20 });

    const associationLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: fixtures.assocPassword });
    const associationCookie = associationLogin.headers['set-cookie'][0].split(';')[0];
    const association = await request(app.getHttpServer()).get('/api/v1/dashboard/association').set('Cookie', associationCookie);
    expect(association.status).toBe(200);
    expect(association.body.performance).toEqual({ browserRequests: 1, replacesBrowserRequests: 11 });

    const delegateLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'delegate', code: fixtures.delegateCode });
    const delegateCookie = delegateLogin.headers['set-cookie'][0].split(';')[0];
    const delegate = await request(app.getHttpServer()).get('/api/v1/deliveries/delegate-portal').set('Cookie', delegateCookie);
    expect(delegate.status).toBe(200);
    expect(delegate.body.performance).toEqual({ browserRequests: 1, previousMinimumRequests: 9, truncated: false });
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
