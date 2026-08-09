import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';

describe('Auth — DB-backed rate limiting (NODE-1)', () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // 30) user login 8/15min
  it('تسجيل دخول المستخدم (ADMIN/ASSOCIATION) يُحدّ بـ8 محاولات/15 دقيقة لكل بريد', async () => {
    const email = 'rate-limit-user@example.org';
    for (let i = 0; i < 8; i++) {
      const res = await http().post('/api/v1/auth/login').send({ type: 'user', email, password: 'WrongPassword123' });
      expect(res.status).toBe(401);
    }
    const ninth = await http().post('/api/v1/auth/login').send({ type: 'user', email, password: 'WrongPassword123' });
    expect(ninth.status).toBe(429);
    expect(ninth.body.error.code).toBe('AUTH_RATE_LIMITED');
  });

  // 31) delegate login 8/15min
  it('تسجيل دخول المندوب يُحدّ بـ8 محاولات/15 دقيقة لكل رمز', async () => {
    const code = 'MND-RLTEST';
    for (let i = 0; i < 8; i++) {
      const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code });
      expect(res.status).toBe(401);
    }
    const ninth = await http().post('/api/v1/auth/login').send({ type: 'delegate', code });
    expect(ninth.status).toBe(429);
    expect(ninth.body.error.code).toBe('AUTH_RATE_LIMITED');
  });

  // 32) password-reset request 5/15min per email
  it('طلب استعادة كلمة مرور يُحدّ بـ5 محاولات/15 دقيقة لكل بريد', async () => {
    const email = 'rate-limit-reset-req@example.org';
    for (let i = 0; i < 5; i++) {
      const res = await http().post('/api/v1/auth/password-reset/request').send({ email });
      expect(res.status).toBe(200);
    }
    const sixth = await http().post('/api/v1/auth/password-reset/request').send({ email });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('AUTH_RATE_LIMITED');
  });

  // 33) password-reset verify 10/15min per email
  it('تأكيد استعادة كلمة مرور يُحدّ بـ10 محاولات/15 دقيقة لكل بريد', async () => {
    const email = fixtures.assocEmail;
    for (let i = 0; i < 10; i++) {
      const res = await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ email, code: 'RST-WRONGX', newPassword: 'NewPass1234' });
      expect(res.status).toBe(400);
    }
    const eleventh = await http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ email, code: 'RST-WRONGX', newPassword: 'NewPass1234' });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error.code).toBe('AUTH_RATE_LIMITED');
  });
});
