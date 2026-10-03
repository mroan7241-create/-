import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, resetAccountPassword, seedTestFixtures } from './utils/fixtures';
import { prisma } from '@alzad/db';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

describe('Auth — password change / reset / association reset (NODE-1)', () => {
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
    // كل اختبار يبدأ من كلمة مرور assocEmail المعروفة، بصرف النظر عمّا غيّره اختبار سابق —
    // يتجنّب هذا الاعتماد الهش على أن كل اختبار "يستعيد" الحالة بنجاح داخل جسمه هو نفسه.
    await resetAccountPassword(fixtures.assocEmail, fixtures.assocPassword);
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

  async function requestReset(email: string) {
    const result = await http().post('/api/v1/auth/password-reset/request').send({ email });
    await app.get(NotificationsService).processOutbox();
    return result;
  }

  // 16) previous password reuse rejected
  it('إعادة استخدام كلمة المرور الحالية/السابقة كـكلمة مرور جديدة تُرفض', async () => {
    const cookie = await loginAs(fixtures.assocEmail, fixtures.assocPassword);
    const res = await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: fixtures.assocPassword, newPassword: fixtures.assocPassword });
    expect(res.status).toBe(400);
  });

  // 15) password change revokes ALL sessions (including current)
  it('تغيير كلمة المرور بنجاح يُبطل كل الجلسات — بما فيها الجلسة الحالية', async () => {
    const cookie1 = await loginAs(fixtures.assocEmail, fixtures.assocPassword);
    const cookie2 = await loginAs(fixtures.assocEmail, fixtures.assocPassword);

    const changeRes = await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', cookie1)
      .send({ currentPassword: fixtures.assocPassword, newPassword: 'FreshAssocPass999' });
    expect(changeRes.status).toBe(200);

    const meAfterOnSameSession = await http().get('/api/v1/auth/me').set('Cookie', cookie1);
    expect(meAfterOnSameSession.status).toBe(401);

    const meOtherSession = await http().get('/api/v1/auth/me').set('Cookie', cookie2);
    expect(meOtherSession.status).toBe(401);

    // restore password for any subsequent tests in this file relying on the original value
    const relogin = await loginAs(fixtures.assocEmail, 'FreshAssocPass999');
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', relogin)
      .send({ currentPassword: 'FreshAssocPass999', newPassword: fixtures.assocPassword });
  });

  // 17) password reset request generic for unknown email / disabled account / disabled association
  it('طلب استعادة كلمة مرور لبريد غير موجود يُرجع رسالة عامة موحَّدة بلا إنشاء أي رمز', async () => {
    const res = await requestReset('unknown-nobody@example.org');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(fakeEmail.lastPasswordReset).toBeNull();
  });

  it('طلب استعادة كلمة مرور لحساب موقوف يُرجع نفس الرسالة العامة بلا إنشاء رمز', async () => {
    const res = await requestReset(fixtures.suspendedAssocEmail);
    expect(res.status).toBe(200);
    expect(fakeEmail.lastPasswordReset).toBeNull();
  });

  it('طلب استعادة كلمة مرور لحساب جمعيته معطَّلة يُرجع نفس الرسالة العامة بلا إنشاء رمز', async () => {
    const res = await requestReset(fixtures.disabledAssocOrgEmail);
    expect(res.status).toBe(200);
    expect(fakeEmail.lastPasswordReset).toBeNull();
  });

  // 22) delegate cannot use email reset
  it('لا يمكن لمندوب استخدام مسار استعادة كلمة المرور بالبريد (لا يوجد credential بريد+كلمة مرور له)', async () => {
    const res = await requestReset(fixtures.delegateEmail);
    expect(res.status).toBe(200);
    expect(fakeEmail.lastPasswordReset).toBeNull();
    const tokenCount = await prisma.passwordResetToken.count();
    expect(tokenCount).toBe(0);
  });

  it('طلب استعادة كلمة مرور صالح لـ ASSOCIATION نشطة ينشئ رمزًا ويرسله عبر FakeEmailService', async () => {
    const res = await requestReset(fixtures.assocEmail);
    expect(res.status).toBe(200);
    expect(fakeEmail.lastPasswordReset?.to).toBe(fixtures.assocEmail);
    expect(fakeEmail.lastPasswordReset?.code).toMatch(/^RST-/);
  });

  it('keeps the delivered predecessor usable while a replacement is queued and suppresses that stale replacement after reset', async () => {
    await requestReset(fixtures.assocEmail);
    const deliveredCode = fakeEmail.lastPasswordReset!.code;
    await http().post('/api/v1/auth/password-reset/request').send({ email: fixtures.assocEmail }).expect(200);
    expect(await prisma.passwordResetToken.count({ where: { emailNormalized: fixtures.assocEmail, consumedAt: null } })).toBe(2);
    expect(fakeEmail.lastPasswordReset!.code).toBe(deliveredCode);
    await http().post('/api/v1/auth/password-reset/confirm').send({ email: fixtures.assocEmail, code: deliveredCode, newPassword: 'PredecessorResetPass123' }).expect(200);
    await app.get(NotificationsService).processOutbox();
    expect(fakeEmail.lastPasswordReset!.code).toBe(deliveredCode);
    expect(await prisma.passwordResetToken.count({ where: { emailNormalized: fixtures.assocEmail, consumedAt: null } })).toBe(0);
    await loginAs(fixtures.assocEmail, 'PredecessorResetPass123');
  });

  it('preserves a previously delivered reset code when replacement SMTP acceptance is uncertain', async () => {
    await requestReset(fixtures.assocEmail);
    const deliveredCode = fakeEmail.lastPasswordReset!.code;
    const failure = jest.spyOn(fakeEmail, 'sendPasswordResetCode').mockRejectedValueOnce(new Error('synthetic uncertain SMTP outcome'));
    try {
      await requestReset(fixtures.assocEmail);
      expect(await prisma.passwordResetToken.count({ where: { emailNormalized: fixtures.assocEmail, consumedAt: null } })).toBe(2);
      await http().post('/api/v1/auth/password-reset/confirm').send({ email: fixtures.assocEmail, code: deliveredCode, newPassword: 'UncertainResetPass123' }).expect(200);
      await loginAs(fixtures.assocEmail, 'UncertainResetPass123');
    } finally { failure.mockRestore(); }
  });

  // 18) TTL 15 minutes
  it('رمز إعادة التعيين منتهي الصلاحية (expiresAt في الماضي) يُرفض برسالة موحَّدة', async () => {
    await requestReset(fixtures.assocEmail);
    const code = fakeEmail.lastPasswordReset!.code;
    await prisma.passwordResetToken.updateMany({
      where: { emailNormalized: fixtures.assocEmail, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ email: fixtures.assocEmail, code, newPassword: 'ShouldNotApply123' });
    expect(res.status).toBe(400);
  });

  // 19) invalid attempt counting
  it('محاولات رمز خاطئ تُحسب — بعد استنفاد الحد الأقصى يُبطَل الرمز حتى لو أُدخل الرمز الصحيح لاحقًا', async () => {
    await requestReset(fixtures.assocEmail);
    const correctCode = fakeEmail.lastPasswordReset!.code;

    // authConfig.passwordResetMaxAttempts = 6 — نستنفدها بمحاولات خاطئة
    for (let i = 0; i < 6; i++) {
      const attempt = await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ email: fixtures.assocEmail, code: 'RST-WRONG0', newPassword: 'ShouldNotApply123' });
      expect(attempt.status).toBe(400);
    }

    const token = await prisma.passwordResetToken.findFirst({ where: { emailNormalized: fixtures.assocEmail }, orderBy: { createdAt: 'desc' } });
    expect(token?.consumedAt).toBeTruthy();
    expect(token?.attemptCount).toBeGreaterThanOrEqual(6);

    const finalAttempt = await http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ email: fixtures.assocEmail, code: correctCode, newPassword: 'ShouldNotApplyEither123' });
    expect(finalAttempt.status).toBe(400);
  });

  // 20 + 21) single-use + successful reset revokes sessions
  it('رمز صحيح يُتيح تعيين كلمة مرور جديدة مرة واحدة فقط، ويُبطل كل الجلسات القائمة', async () => {
    const activeSessionCookie = await loginAs(fixtures.assocEmail, fixtures.assocPassword);

    await requestReset(fixtures.assocEmail);
    const code = fakeEmail.lastPasswordReset!.code;

    const confirm = await http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ email: fixtures.assocEmail, code, newPassword: 'ResetAppliedPass123' });
    expect(confirm.status).toBe(200);

    // existing session revoked
    const me = await http().get('/api/v1/auth/me').set('Cookie', activeSessionCookie);
    expect(me.status).toBe(401);

    // same code cannot be reused (single-use)
    const reuse = await http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ email: fixtures.assocEmail, code, newPassword: 'AnotherAttemptPass456' });
    expect(reuse.status).toBe(400);

    // restore original password for any later tests
    const relogin = await loginAs(fixtures.assocEmail, 'ResetAppliedPass123');
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', relogin)
      .send({ currentPassword: 'ResetAppliedPass123', newPassword: fixtures.assocPassword });
  });

  // 23) ADMIN-only association password reset
  it('ADMIN فقط يستطيع إعادة تعيين كلمة مرور حساب جمعية — يعيد كلمة مرور مؤقتة مرة واحدة وmustChangePassword=true', async () => {
    const adminCookie = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    const res = await http().post(`/api/v1/auth/associations/${fixtures.activeAssociationId}/reset-password`).set('Cookie', adminCookie);
    expect(res.status).toBe(201);
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(10);

    // restore the account's password to the known fixture value so later tests in this file remain deterministic
    const loginRes = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: res.body.temporaryPassword });
    const cookie = loginRes.headers['set-cookie'][0];
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: res.body.temporaryPassword, newPassword: fixtures.assocPassword });
  });

  it('كلمة المرور المؤقتة الناتجة تعمل فعليًا لتسجيل الدخول وmustChangePassword=true بعدها', async () => {
    const adminCookie = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    const res = await http().post(`/api/v1/auth/associations/${fixtures.activeAssociationId}/reset-password`).set('Cookie', adminCookie);
    expect(res.status).toBeLessThan(300);
    const tempPassword = res.body.temporaryPassword;
    expect(typeof tempPassword).toBe('string');

    const loginRes = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: tempPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.mustChangePassword).toBe(true);

    // restore account to a known, non-temp password state for later runs
    const cookie = loginRes.headers['set-cookie'][0];
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: tempPassword, newPassword: fixtures.assocPassword });
  });

  it('كلمة المرور المؤقتة لا تُسجَّل في audit_logs (metadata لا يحوي أي سر)', async () => {
    const adminCookie = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    const res = await http().post(`/api/v1/auth/associations/${fixtures.activeAssociationId}/reset-password`).set('Cookie', adminCookie);
    const tempPassword = res.body.temporaryPassword;

    const entries = await prisma.auditLog.findMany({ where: { action: 'ASSOCIATION_PASSWORD_RESET' } });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(JSON.stringify(entry)).not.toContain(tempPassword);
    }

    // restore
    const loginRes = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: tempPassword });
    const cookie = loginRes.headers['set-cookie'][0];
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: tempPassword, newPassword: fixtures.assocPassword });
  });

  it('حساب ASSOCIATION لا يستطيع إعادة تعيين كلمة مرور جمعية أخرى (403)', async () => {
    const cookie = await loginAs(fixtures.assocEmail, fixtures.assocPassword);
    const res = await http().post(`/api/v1/auth/associations/${fixtures.activeAssociationId}/reset-password`).set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});
