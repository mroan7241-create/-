import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, resetAccountPassword, seedTestFixtures } from './utils/fixtures';
import { prisma } from '@alzad/db';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';

describe('Audit — security-sensitive actions recorded (NODE-1)', () => {
  let app: INestApplication;
  let fakeEmail: FakeEmailService;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;

  beforeAll(async () => {
    ({ app, fakeEmail } = await createTestApp());
    fixtures = await seedTestFixtures();
  });

  beforeEach(async () => {
    await cleanAuthState();
    fakeEmail.reset();
    await resetAccountPassword(fixtures.assocEmail, fixtures.assocPassword);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // 29) audit entries created for security-sensitive actions
  it('LOGIN_SUCCESS يُسجَّل بعد دخول ناجح', async () => {
    await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const entries = await prisma.auditLog.findMany({ where: { action: 'LOGIN_SUCCESS' } });
    expect(entries.length).toBe(1);
    expect(JSON.stringify(entries[0])).not.toMatch(/password|secretHash|tokenHash/i);
  });

  it('LOGOUT يُسجَّل بعد تسجيل خروج', async () => {
    const login = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const cookie = login.headers['set-cookie'][0];
    await http().post('/api/v1/auth/logout').set('Cookie', cookie);
    const entries = await prisma.auditLog.findMany({ where: { action: 'LOGOUT' } });
    expect(entries.length).toBe(1);
  });

  it('PASSWORD_CHANGED يُسجَّل بعد تغيير كلمة مرور ناجح', async () => {
    const login = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: fixtures.assocPassword });
    const cookie = login.headers['set-cookie'][0];
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: fixtures.assocPassword, newPassword: 'AuditTestPass999' });

    const entries = await prisma.auditLog.findMany({ where: { action: 'PASSWORD_CHANGED' } });
    expect(entries.length).toBe(1);
    expect(JSON.stringify(entries[0])).not.toMatch(/AuditTestPass999|secretHash/i);

    // restore
    const relogin = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: 'AuditTestPass999' });
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', relogin.headers['set-cookie'][0])
      .send({ currentPassword: 'AuditTestPass999', newPassword: fixtures.assocPassword });
  });

  it('PASSWORD_RESET_REQUESTED وPASSWORD_RESET_COMPLETED يُسجَّلان في دورة استعادة كاملة', async () => {
    await http().post('/api/v1/auth/password-reset/request').send({ email: fixtures.assocEmail });
    const requestedEntries = await prisma.auditLog.findMany({ where: { action: 'PASSWORD_RESET_REQUESTED' } });
    expect(requestedEntries.length).toBe(1);

    const code = fakeEmail.lastPasswordReset!.code;
    await http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ email: fixtures.assocEmail, code, newPassword: 'AuditResetPass999' });

    const completedEntries = await prisma.auditLog.findMany({ where: { action: 'PASSWORD_RESET_COMPLETED' } });
    expect(completedEntries.length).toBe(1);
    expect(JSON.stringify(completedEntries[0])).not.toMatch(/AuditResetPass999|RST-|secretHash/i);

    // restore
    const relogin = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: 'AuditResetPass999' });
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', relogin.headers['set-cookie'][0])
      .send({ currentPassword: 'AuditResetPass999', newPassword: fixtures.assocPassword });
  });

  it('ASSOCIATION_PASSWORD_RESET يُسجَّل عند استخدام ADMIN لإعادة تعيين كلمة مرور جمعية', async () => {
    const adminLogin = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const res = await http()
      .post(`/api/v1/auth/associations/${fixtures.activeAssociationId}/reset-password`)
      .set('Cookie', adminLogin.headers['set-cookie'][0]);
    const entries = await prisma.auditLog.findMany({ where: { action: 'ASSOCIATION_PASSWORD_RESET' } });
    expect(entries.length).toBe(1);

    // restore
    const relogin = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: res.body.temporaryPassword });
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', relogin.headers['set-cookie'][0])
      .send({ currentPassword: res.body.temporaryPassword, newPassword: fixtures.assocPassword });
  });
});
