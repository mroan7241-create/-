import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { prisma } from '@alzad/db';
import { RateLimitService } from '../src/common/rate-limit.service';
import { hmacHex } from '../src/common/crypto.util';

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
  const limiter = new RateLimitService();

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

  it('keeps a fixed expiry despite rejected attempts, then opens a fresh window', async () => {
    const scope = 'e2e-fixed-window';
    const subject = 'victim@example.test';
    const where = { scope_subjectHash: { scope, subjectHash: hmacHex(`${scope}:${subject}`) } };
    const rule = { limit: 2, windowSeconds: 600 };
    await limiter.consume(scope, subject, rule);
    await limiter.consume(scope, subject, rule);
    const initial = await prisma.authRateLimit.findUniqueOrThrow({ where });
    await expect(limiter.consume(scope, subject, rule)).rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED' });
    await expect(limiter.consume(scope, subject, rule)).rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED' });
    const blocked = await prisma.authRateLimit.findUniqueOrThrow({ where });
    expect(blocked.expiresAt).toEqual(initial.expiresAt);
    expect(blocked.windowStartedAt).toEqual(initial.windowStartedAt);
    expect(blocked.attemptCount).toBe(3);
    await prisma.authRateLimit.update({ where, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(limiter.consume(scope, subject, rule)).resolves.toBeUndefined();
    const refreshed = await prisma.authRateLimit.findUniqueOrThrow({ where });
    expect(refreshed.attemptCount).toBe(1);
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(initial.expiresAt.getTime() - 600_000);
  });

  it('keeps account and source limits independent', async () => {
    const sourceRule = { limit: 1, windowSeconds: 900 };
    await limiter.consume('source:e2e-login', '127.0.0.1', sourceRule);
    await expect(limiter.consume('source:e2e-login', '127.0.0.1', sourceRule)).rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED' });
    await expect(limiter.consume('account:e2e-login', 'first@example.test', sourceRule)).resolves.toBeUndefined();
    await expect(limiter.consume('account:e2e-login', 'second@example.test', sourceRule)).resolves.toBeUndefined();
  });

  it('never trusts a client-forged X-Forwarded-For with default proxy settings', async () => {
    const spoofed = '203.0.113.77';
    await http().post('/api/v1/auth/login').set('X-Forwarded-For', spoofed)
      .send({ type: 'user', email: 'unknown@example.test', password: 'WrongPassword123' });
    const forgedHash = hmacHex(`source:auth-login:${spoofed}`);
    expect(await prisma.authRateLimit.count({ where: { scope: 'source:auth-login', subjectHash: forgedHash } })).toBe(0);
    expect(await prisma.authRateLimit.count({ where: { scope: 'source:auth-login' } })).toBe(1);
  });

  it('cleans expired random subjects but preserves active windows', async () => {
    const scope = 'e2e-expired-cleanup';
    const rule = { limit: 5, windowSeconds: 900 };
    for (let i = 0; i < 3; i++) await limiter.consume(scope, `random-${i}`, rule);
    await limiter.consume(scope, 'active', rule);
    await prisma.authRateLimit.updateMany({ where: { scope, subjectHash: { not: hmacHex(`${scope}:active`) } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await limiter.cleanupExpired()).toBeGreaterThanOrEqual(3);
    expect(await prisma.authRateLimit.count({ where: { scope, subjectHash: hmacHex(`${scope}:active`) } })).toBe(1);
    expect(await prisma.authRateLimit.count({ where: { scope, subjectHash: { not: hmacHex(`${scope}:active`) } } })).toBe(0);
  });

  it('admits exactly the limit under concurrent requests to the same subject', async () => {
    const scope = 'e2e-concurrent-limit';
    const subject = 'same-source';
    const rule = { limit: 5, windowSeconds: 900 };
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => limiter.consume(scope, subject, rule)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(15);
    const stored = await prisma.authRateLimit.findUniqueOrThrow({ where: { scope_subjectHash: { scope, subjectHash: hmacHex(`${scope}:${subject}`) } } });
    expect(stored.attemptCount).toBe(6);
  });
});
