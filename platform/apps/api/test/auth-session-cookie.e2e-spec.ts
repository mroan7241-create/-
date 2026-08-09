import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { prisma } from '@alzad/db';
import { sha256Hex } from '../src/common/crypto.util';
import { authConfig } from '../src/config/auth.config';

/**
 * NODE-1.1 §1 — الكوكي يجب أن تغطي عمر الجلسة المطلق (12h)، لا idle
 * expiresAt الأول (6h)؛ الخادم (DB) يبقى الحكم الوحيد لـidle/absolute،
 * والكوكي غلاف نقل فقط.
 */
describe('Auth — session cookie lifetime vs DB idle/absolute (NODE-1.1)', () => {
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

  function rawTokenFromCookie(cookie: string): string {
    return decodeURIComponent(cookie.split(`${authConfig.sessionCookieName}=`)[1].split(';')[0]);
  }

  function cookieExpiresDate(cookie: string): Date {
    const match = cookie.match(/Expires=([^;]+)/i);
    if (!match) throw new Error('لا Expires في الكوكي');
    return new Date(match[1]);
  }

  it('كوكي الجلسة لا تنتهي عند idle 6h الأول — عمرها يطابق absolute 12h', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const cookie: string = res.headers['set-cookie'][0];
    const cookieExpires = cookieExpiresDate(cookie);

    const now = Date.now();
    const idle6h = now + authConfig.sessionIdleSeconds * 1000;
    const absolute12h = now + authConfig.sessionAbsoluteSeconds * 1000;

    // ضمن هامش تسامح (٥ دقائق) — عمر الكوكي قريب من absolute 12h، وأبعد بوضوح عن idle 6h.
    expect(Math.abs(cookieExpires.getTime() - absolute12h)).toBeLessThan(5 * 60 * 1000);
    expect(cookieExpires.getTime()).toBeGreaterThan(idle6h + 60 * 60 * 1000);
  });

  it('DB session idle (expires_at) تبقى 6h عند الإنشاء رغم أن عمر الكوكي 12h', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const cookie: string = res.headers['set-cookie'][0];
    const token = rawTokenFromCookie(cookie);

    const session = await prisma.authSession.findUnique({ where: { tokenHash: sha256Hex(token) } });
    expect(session).toBeTruthy();

    const now = Date.now();
    const idle6h = now + authConfig.sessionIdleSeconds * 1000;
    const absolute12h = now + authConfig.sessionAbsoluteSeconds * 1000;

    expect(Math.abs(session!.expiresAt.getTime() - idle6h)).toBeLessThan(60 * 1000);
    expect(Math.abs(session!.absoluteExpiresAt.getTime() - absolute12h)).toBeLessThan(60 * 1000);
  });

  it('جلسة نشطة يمكن أن تستمر بعد تجاوز نافذة idle الأولى (6h) — الخادم يمدّد expires_at، لا الكوكي', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const cookie: string = res.headers['set-cookie'][0];
    const token = rawTokenFromCookie(cookie);

    // نحاكي جلسة أُنشئت قبل ٥ ساعات و٥٩ دقيقة (قريبة من idle الأول)، وسقف مطلق لا يزال بعيدًا (خلال ٧ ساعات).
    await prisma.authSession.update({
      where: { tokenHash: sha256Hex(token) },
      data: {
        expiresAt: new Date(Date.now() + 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 7 * 60 * 60 * 1000),
      },
    });

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);

    // بعد الطلب الموثَّق، expires_at يجب أن يكون قد تمدَّد لِـ6h إضافية من الآن (لا يزال دون السقف المطلق).
    const after = await prisma.authSession.findUnique({ where: { tokenHash: sha256Hex(token) } });
    const slidTo6h = Date.now() + authConfig.sessionIdleSeconds * 1000;
    expect(after!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60 * 60 * 1000);
    expect(Math.abs(after!.expiresAt.getTime() - slidTo6h)).toBeLessThan(60 * 1000);
  });

  it('لا يمكن للجلسة أن تتجاوز absolute 12h أبدًا — حتى مع طلبات موثَّقة متكررة', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const cookie: string = res.headers['set-cookie'][0];
    const token = rawTokenFromCookie(cookie);
    const absoluteExpiresAt = new Date(Date.now() + 20 * 60 * 1000); // سقف مطلق قريب جدًا (20 دقيقة)

    await prisma.authSession.update({
      where: { tokenHash: sha256Hex(token) },
      data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000), absoluteExpiresAt },
    });

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);

    const after = await prisma.authSession.findUnique({ where: { tokenHash: sha256Hex(token) } });
    // التمديد لا يتجاوز absoluteExpiresAt الثابت أبدًا، رغم أن idle الافتراضي (6h) أكبر بكثير.
    expect(after!.expiresAt.getTime()).toBeLessThanOrEqual(absoluteExpiresAt.getTime());
  });
});
