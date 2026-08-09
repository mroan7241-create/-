import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, hashSecret, seedTestFixtures } from './utils/fixtures';
import { prisma, AuthCredentialType } from '@alzad/db';
import { delegateCredentialLookupHash, normalizeDelegateCode } from '../src/common/crypto.util';

/**
 * NODE-1.1 §2 — loginDelegate يجب أن يبحث بـO(1) عبر lookup hash
 * (HMAC-SHA256 للـidentifier في auth_credentials) بدل فحص خطي (findMany)
 * على كل بيانات اعتماد المناديب النشطة.
 */
describe('Auth — delegate credential lookup (NODE-1.1 §2)', () => {
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

  it('دخول مندوب صحيح ينجح', async () => {
    const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: fixtures.delegateCode });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('DELEGATE');
  });

  it('رمز مندوب خاطئ يُرفض بخطأ عام موحَّد', async () => {
    const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: 'MND-NOPE99' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('لا يوجد فحص خطي (findMany) على بيانات اعتماد المناديب أثناء تسجيل الدخول — بحث O(1) فقط', async () => {
    const findManySpy = jest.spyOn(prisma.authCredential, 'findMany');
    const findUniqueSpy = jest.spyOn(prisma.authCredential, 'findUnique');
    try {
      const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: fixtures.delegateCode });
      expect(res.status).toBe(200);
      expect(findManySpy).not.toHaveBeenCalled();
      expect(findUniqueSpy).toHaveBeenCalledTimes(1);
    } finally {
      findManySpy.mockRestore();
      findUniqueSpy.mockRestore();
    }
  });

  it('identifier المخزَّن في DB لا يساوي رمز المندوب الخام ولا يحويه', async () => {
    const normalized = normalizeDelegateCode(fixtures.delegateCode);
    const lookupHash = delegateCredentialLookupHash(normalized);
    const credential = await prisma.authCredential.findUnique({
      where: { type_identifier: { type: AuthCredentialType.DELEGATE_ACCESS_CODE, identifier: lookupHash } },
    });
    expect(credential).toBeTruthy();
    expect(credential!.identifier).not.toBe(fixtures.delegateCode);
    expect(credential!.identifier).not.toContain(fixtures.delegateCode);
    expect(credential!.identifier).not.toContain(normalized);
  });

  it('lookup hash حتمي (deterministic) — نفس الرمز المطبَّع ينتج نفس identifier دائمًا، بصرف النظر عن حالة الأحرف/المسافات', async () => {
    const a = delegateCredentialLookupHash(normalizeDelegateCode(fixtures.delegateCode));
    const b = delegateCredentialLookupHash(normalizeDelegateCode(`  ${fixtures.delegateCode.toLowerCase()}  `));
    expect(a).toBe(b);

    // ويعمل فعليًا عند تسجيل الدخول برمز بحالة أحرف مختلفة/مسافات إضافية.
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'delegate', code: `  ${fixtures.delegateCode.toLowerCase()}  ` });
    expect(res.status).toBe(200);
  });

  it('التحقق بـArgon2 يبقى إلزاميًا حتى بعد نجاح lookup — تطابق identifier وحده لا يكفي لتسجيل الدخول', async () => {
    const normalized = normalizeDelegateCode(fixtures.delegateCode);
    const lookupHash = delegateCredentialLookupHash(normalized);

    // نُفسد secretHash المخزَّن (يصبح لرمز مختلف تمامًا) بينما identifier (lookup hash) يبقى صحيحًا للرمز الأصلي —
    // إن كان lookup وحده كافيًا لتسجيل الدخول لنجح هذا رغم فساد secretHash.
    const tamperedHash = await hashSecret('MND-TAMPERED');
    await prisma.authCredential.update({
      where: { type_identifier: { type: AuthCredentialType.DELEGATE_ACCESS_CODE, identifier: lookupHash } },
      data: { secretHash: tamperedHash },
    });

    const res = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: fixtures.delegateCode });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
});
