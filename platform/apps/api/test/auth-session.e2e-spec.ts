import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { prisma } from '@alzad/db';
import { sha256Hex } from '../src/common/crypto.util';
import { authConfig } from '../src/config/auth.config';

describe('Auth — session lifecycle / mustChangePassword / roles / tenant context (NODE-1)', () => {
  let app: INestApplication;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    fixtures = await seedTestFixtures();
  });

  beforeEach(async () => {
    await cleanAuthState();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ type: 'user', email, password });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'][0];
  }

  function rawTokenFromCookie(cookie: string): string {
    return decodeURIComponent(cookie.split(`${authConfig.sessionCookieName}=`)[1].split(';')[0]);
  }

  // 8) logout revokes session
  it('logout يُبطل الجلسة الحالية فورًا — طلب لاحق بنفس الكوكي يُرفض', async () => {
    const cookie = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    const logout = await http().post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(200);

    const token = rawTokenFromCookie(cookie);
    const session = await prisma.authSession.findUnique({ where: { tokenHash: sha256Hex(token) } });
    expect(session?.revokedAt).toBeTruthy();

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('AUTH_SESSION_EXPIRED');
  });

  it('logout مرة ثانية على نفس الكوكي المُبطلة سلفًا لا يُرجع خطأً غريبًا (401 موحَّد فقط)', async () => {
    const cookie = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    await http().post('/api/v1/auth/logout').set('Cookie', cookie);
    const secondLogout = await http().post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(secondLogout.status).toBe(401);
    expect(secondLogout.body.error.code).toBe('AUTH_SESSION_EXPIRED');
  });

  // 9) idle expiry
  it('انتهاء صلاحية الخمول (expiresAt في الماضي) يرفض الجلسة', async () => {
    const cookie = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    const token = rawTokenFromCookie(cookie);
    await prisma.authSession.update({
      where: { tokenHash: sha256Hex(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('AUTH_SESSION_EXPIRED');
  });

  // 10) absolute 12h expiry
  it('تجاوز السقف المطلق (absoluteExpiresAt في الماضي) يرفض الجلسة حتى لو expiresAt مستقبلي', async () => {
    const cookie = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    const token = rawTokenFromCookie(cookie);
    await prisma.authSession.update({
      where: { tokenHash: sha256Hex(token) },
      data: { expiresAt: new Date(Date.now() + 60_000), absoluteExpiresAt: new Date(Date.now() - 1000) },
    });
    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('AUTH_SESSION_EXPIRED');
  });

  // 11) sliding expiry never exceeds absolute
  it('التمديد المنزلق (sliding) لا يتجاوز أبدًا السقف المطلق', async () => {
    const cookie = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    const token = rawTokenFromCookie(cookie);
    const nearAbsolute = new Date(Date.now() + 60_000); // absolute cap 1 minute from now
    await prisma.authSession.update({
      where: { tokenHash: sha256Hex(token) },
      data: { expiresAt: new Date(Date.now() + 30_000), absoluteExpiresAt: nearAbsolute },
    });

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);

    const after = await prisma.authSession.findUnique({ where: { tokenHash: sha256Hex(token) } });
    expect(after?.expiresAt.getTime()).toBeLessThanOrEqual(nearAbsolute.getTime());
    // sliding should have moved expiresAt close to (but not past) the absolute cap, not to a full 6h from now
    expect(after?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  // 12) mustChangePassword gating
  it('mustChangePassword=true يمنع أي endpoint محمي عادي (بلا @AllowMustChangePassword) بخطأ 403 موحَّد', async () => {
    const cookie = await loginAs(fixtures.mustChangeAssocEmail, fixtures.mustChangeAssocPassword);
    const res = await http().get('/api/v1/associations/me/settings').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
  });

  it('mustChangePassword=true يسمح بـ /auth/me و logout وتغيير كلمة المرور فقط', async () => {
    const cookie = await loginAs(fixtures.mustChangeAssocEmail, fixtures.mustChangeAssocPassword);

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(true);

    const changePassword = await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: fixtures.mustChangeAssocPassword, newPassword: 'BrandNewPass456' });
    expect(changePassword.status).toBe(200);
  });

  it('بعد نجاح تغيير كلمة المرور تصبح mustChangePassword=false ويُسمح بالوصول للـendpoints العادية', async () => {
    const cookie = await loginAs(fixtures.mustChangeAssocEmail2, fixtures.mustChangeAssocPassword2);
    const changePassword = await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: fixtures.mustChangeAssocPassword2, newPassword: 'AnotherNewPass789' });
    expect(changePassword.status).toBe(200);

    // Sessions are all revoked after password change — must log in again to prove mustChangePassword flipped to false.
    const relogin = await loginAs(fixtures.mustChangeAssocEmail2, 'AnotherNewPass789');
    const status = await http().get('/api/v1/associations/me/settings').set('Cookie', relogin);
    expect(status.status).toBe(200);
    const me = await http().get('/api/v1/auth/me').set('Cookie', relogin);
    expect(me.body.mustChangePassword).toBe(false);
  });

  // 13) wrong role rejected server-side
  it('حساب ASSOCIATION لا يستطيع الوصول لـ endpoint مخصَّص لـADMIN فقط', async () => {
    const cookie = await loginAs(fixtures.assocEmail, fixtures.assocPassword);
    const res = await http().post(`/api/v1/auth/associations/${fixtures.activeAssociationId}/reset-password`).set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('طلب بلا جلسة (بلا كوكي) على endpoint محمي يُرفض بـ401', async () => {
    const res = await http().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_SESSION_EXPIRED');
  });

  // 14) tenant context cannot be forged
  it('associationId في جسم/استعلام الطلب لا يمكن أن يزوّر السياق — /auth/me يعيد الجمعية من الجلسة دومًا', async () => {
    const cookie = await loginAs(fixtures.assocEmail, fixtures.assocPassword);
    const res = await http()
      .get('/api/v1/auth/me')
      .query({ associationId: 'some-other-association-uuid-that-does-not-belong-to-this-account' })
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.associationId).toBe(fixtures.activeAssociationId);
  });

  it('طلب انتحال جلسة برمز عشوائي غير موجود في قاعدة البيانات يُرفض بـ401', async () => {
    const forged = `${authConfig.sessionCookieName}=some-random-non-existent-token-value`;
    const res = await http().get('/api/v1/auth/me').set('Cookie', forged);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_SESSION_EXPIRED');
  });
});
