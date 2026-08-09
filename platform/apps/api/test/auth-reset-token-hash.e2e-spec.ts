import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, resetAccountPassword, seedTestFixtures } from './utils/fixtures';
import { prisma } from '@alzad/db';
import { resetTokenHash, sha256Hex } from '../src/common/crypto.util';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';

/**
 * NODE-1.1 §3 — password_reset_tokens.token_hash يجب أن يكون
 * HMAC-SHA256(normalized code, مفتاح سرّي مخصَّص) — لا SHA-256 عادٍ —
 * لأن الرمز نفسه (8 خانات) أقل entropy بكثير من رمز جلسة عشوائي.
 */
describe('Auth — password reset token HMAC hashing (NODE-1.1 §3)', () => {
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

  it('token_hash المخزَّن في DB لا يساوي الرمز الخام', async () => {
    await http().post('/api/v1/auth/password-reset/request').send({ email: fixtures.assocEmail });
    const code = fakeEmail.lastPasswordReset!.code;

    const token = await prisma.passwordResetToken.findFirst({ where: { emailNormalized: fixtures.assocEmail }, orderBy: { createdAt: 'desc' } });
    expect(token).toBeTruthy();
    expect(token!.tokenHash).not.toBe(code);
  });

  it('token_hash لا يساوي SHA-256 العادي للرمز (يجب أن يكون HMAC بمفتاح سرّي، لا hash بلا مفتاح)', async () => {
    await http().post('/api/v1/auth/password-reset/request').send({ email: fixtures.assocEmail });
    const code = fakeEmail.lastPasswordReset!.code;

    const token = await prisma.passwordResetToken.findFirst({ where: { emailNormalized: fixtures.assocEmail }, orderBy: { createdAt: 'desc' } });
    expect(token!.tokenHash).not.toBe(sha256Hex(code));
    expect(token!.tokenHash).toBe(resetTokenHash(code));
  });

  it('HMAC الصحيح يُتحقَّق منه بنجاح عند تأكيد الاستعادة', async () => {
    await http().post('/api/v1/auth/password-reset/request').send({ email: fixtures.assocEmail });
    const code = fakeEmail.lastPasswordReset!.code;

    const confirm = await http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ email: fixtures.assocEmail, code, newPassword: 'ResetHmacPass999' });
    expect(confirm.status).toBe(200);

    // استعادة كلمة المرور الأصلية لأي اختبارات لاحقة في هذا الملف.
    const relogin = await http().post('/api/v1/auth/login').send({ type: 'user', email: fixtures.assocEmail, password: 'ResetHmacPass999' });
    await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', relogin.headers['set-cookie'][0])
      .send({ currentPassword: 'ResetHmacPass999', newPassword: fixtures.assocPassword });
  });

  it('رمز خاطئ (HMAC غير مطابق) يُرفض برسالة موحَّدة', async () => {
    await http().post('/api/v1/auth/password-reset/request').send({ email: fixtures.assocEmail });

    const res = await http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ email: fixtures.assocEmail, code: 'RST-WRONG1', newPassword: 'ShouldNotApply123' });
    expect(res.status).toBe(400);
  });
});
