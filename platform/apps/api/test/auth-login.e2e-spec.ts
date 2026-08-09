import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { prisma } from '@alzad/db';
import { sha256Hex } from '../src/common/crypto.util';
import { authConfig } from '../src/config/auth.config';

describe('Auth — login (NODE-1)', () => {
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

  // 1) ADMIN login success
  it('ADMIN يسجل الدخول بنجاح ببريد+كلمة مرور', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.headers['set-cookie']?.[0]).toMatch(new RegExp(`${authConfig.sessionCookieName}=`));
  });

  // 2) ASSOCIATION login success
  it('ASSOCIATION يسجل الدخول بنجاح ببريد+كلمة مرور', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.assocEmail, password: fixtures.assocPassword });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ASSOCIATION');
    expect(res.body.user.associationId).toBe(fixtures.activeAssociationId);
  });

  // 3) DELEGATE login success
  it('DELEGATE يسجل الدخول بنجاح برمز الدخول', async () => {
    const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: fixtures.delegateCode });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('DELEGATE');
  });

  // 4) wrong password → generic invalid-credentials
  it('كلمة مرور خاطئة تُرجع خطأ عام موحَّد (بلا كشف وجود الحساب)', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.assocEmail, password: 'WrongPassword999' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('بريد غير موجود يُرجع نفس الخطأ العام مثل كلمة مرور خاطئة', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: 'no-such-account@example.org', password: 'WhateverPass123' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  // 4b) wrong delegate code → generic
  it('رمز مندوب خاطئ يُرجع خطأ عام موحَّد', async () => {
    const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: 'MND-NOPE99' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  // 5) suspended account rejected (folded into generic invalid-credentials, matching legacy .find() filter)
  it('حساب جمعية موقوف (SUSPENDED) يُرفض بنفس الخطأ العام', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.suspendedAssocEmail, password: fixtures.suspendedAssocPassword });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('مندوب موقوف يُرفض بنفس الخطأ العام', async () => {
    const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: fixtures.suspendedDelegateCode });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  // 6) inactive association rejected — distinct AUTH_ASSOCIATION_DISABLED, only after password success, only for ASSOCIATION role
  it('جمعية معطَّلة (INACTIVE) ترفض دخول حساب ASSOCIATION التابع لها بخطأ مميَّز', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.disabledAssocOrgEmail, password: fixtures.disabledAssocOrgPassword });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_ASSOCIATION_DISABLED');
  });

  it('جمعية معطَّلة ترفض دخول مندوبها بخطأ مميَّز أيضًا', async () => {
    const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: fixtures.disabledAssocOrgDelegateCode });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_ASSOCIATION_DISABLED');
  });

  // 7) session persisted as hash only — raw token never stored
  it('الجلسة تُخزَّن كـtoken_hash فقط — الرمز الخام لا يظهر أبدًا في قاعدة البيانات', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.adminEmail, password: fixtures.adminPassword });
    const rawCookie: string = res.headers['set-cookie'][0];
    const rawToken = decodeURIComponent(rawCookie.split(`${authConfig.sessionCookieName}=`)[1].split(';')[0]);

    const session = await prisma.authSession.findUnique({ where: { tokenHash: sha256Hex(rawToken) } });
    expect(session).toBeTruthy();

    const allSessions = await prisma.authSession.findMany({});
    for (const s of allSessions) {
      expect(s.tokenHash).not.toBe(rawToken);
      expect(JSON.stringify(s)).not.toContain(rawToken);
    }
  });

  // 28) no password/hash/token ever appears in a serialized API response
  it('لا يظهر أي password/hash/token في استجابة تسجيل الدخول أو /auth/me', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: fixtures.assocEmail, password: fixtures.assocPassword });
    const cookie = login.headers['set-cookie'][0];
    const serializedLogin = JSON.stringify(login.body);
    expect(serializedLogin).not.toMatch(/secretHash|passwordHash|tokenHash|rawToken|\bpassword\b/i);

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(Object.keys(me.body).sort()).toEqual(['associationId', 'id', 'mustChangePassword', 'name', 'publicCode', 'role'].sort());
    expect(JSON.stringify(me.body)).not.toMatch(/secretHash|passwordHash|tokenHash/i);
  });
});
