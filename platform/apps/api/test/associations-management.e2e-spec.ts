import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { prisma, AccountRole, AssociationStatus, AuthCredentialType } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { NODE2_MARKER, cleanNode2State, loginAs, loginAsDelegate, uniqueSuffix } from './utils/node2-fixtures';
import { clearLicenseObjects, startTestStorage, stopTestStorage } from './utils/storage-harness';

/** NODE-2 — إدارة الجمعيات: قائمة/إنشاء مباشر/تعديل/تعطيل + إعدادات الجمعية الذاتية. */
describe('NODE-2 — إدارة الجمعيات', () => {
  let app: INestApplication;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;
  let adminCookie: string;

  const TEMP_PASSWORD = 'TempPass12345';

  beforeAll(async () => {
    await startTestStorage();
    ({ app } = await createTestApp());
    fixtures = await seedTestFixtures();
  }, 60000);

  beforeEach(async () => {
    await cleanAuthState();
    await cleanNode2State();
    await clearLicenseObjects();
    await prisma.association.update({ where: { id: fixtures.activeAssociationId }, data: { status: AssociationStatus.ACTIVE } });
    adminCookie = await loginAs(app, fixtures.adminEmail, fixtures.adminPassword);
  });

  afterAll(async () => {
    await cleanNode2State();
    await prisma.association.update({ where: { id: fixtures.activeAssociationId }, data: { status: AssociationStatus.ACTIVE } });
    await app.close();
    await stopTestStorage();
  });

  const http = () => request(app.getHttpServer());

  interface CreateBody {
    name: string;
    category: string;
    region: string;
    city: string;
    phone: string;
    email: string;
    status?: 'ACTIVE' | 'INACTIVE';
    temporaryPassword: string;
    opId: string;
  }

  function newAssociationBody(overrides: Partial<CreateBody> = {}): CreateBody {
    const suffix = uniqueSuffix();
    return {
      name: `${NODE2_MARKER} جمعية مُنشأة ${suffix}`,
      category: 'جمعية خيرية',
      region: 'الرياض',
      city: 'الرياض',
      phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      email: `created-${suffix}@example.org`,
      temporaryPassword: TEMP_PASSWORD,
      opId: randomUUID(),
      ...overrides,
    };
  }

  const createAssociation = (body: CreateBody, cookie = adminCookie) =>
    http().post('/api/v1/associations').set('Cookie', cookie).send(body);

  /** ينشئ جمعية عبر الـAPI ثم يُنهي إلزام تغيير كلمة المرور ويُعيد جلسة ASSOCIATION صالحة. */
  async function createAssociationWithSession(body = newAssociationBody()) {
    const created = await createAssociation(body);
    expect(created.status).toBe(201);

    const firstLogin = await loginAs(app, body.email, body.temporaryPassword);
    const permanentPassword = `Perm${uniqueSuffix()}9`;
    const changed = await http()
      .patch('/api/v1/auth/password')
      .set('Cookie', firstLogin)
      .send({ currentPassword: body.temporaryPassword, newPassword: permanentPassword });
    expect(changed.status).toBe(200);

    const cookie = await loginAs(app, body.email, permanentPassword);
    return { associationId: created.body.associationId as string, body, permanentPassword, cookie };
  }

  // ————————————————————————————————————————
  // 60) 61) القائمة
  // ————————————————————————————————————————
  it('ADMIN يستعرض قائمة الجمعيات مع العدّادات والترقيم والبحث والتصفية بالحالة', async () => {
    const a = await newAssociationBody({ name: `${NODE2_MARKER} جمعية القائمة الأولى` });
    const b = newAssociationBody({ name: `${NODE2_MARKER} جمعية القائمة الثانية`, status: 'INACTIVE' });
    expect((await createAssociation(a)).status).toBe(201);
    expect((await createAssociation(b)).status).toBe(201);

    const list = await http().get('/api/v1/associations?pageSize=100').set('Cookie', adminCookie);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.total).toBeGreaterThanOrEqual(2);

    const created = list.body.items.find((row: { name: string }) => row.name === a.name);
    expect(created).toBeDefined();
    expect(created.publicCode).toMatch(/^ASC-\d{6}$/);
    expect(created.beneficiariesCount).toBe(0);
    expect(created.devicesCount).toBe(0);
    expect(created.delegatesCount).toBe(0);
    expect(created.phone).toBe(a.phone);

    // العدّادات حقيقية لا أصفار ثابتة — جمعية الاختبار NODE-1 تملك مندوبين فعليًا.
    const withDelegates = list.body.items.find((row: { id: string }) => row.id === fixtures.activeAssociationId);
    expect(withDelegates.delegatesCount).toBeGreaterThanOrEqual(2);

    const search = await http()
      .get(`/api/v1/associations?search=${encodeURIComponent('جمعية القائمة الأولى')}`)
      .set('Cookie', adminCookie);
    expect(search.body.total).toBe(1);
    expect(search.body.items[0].name).toBe(a.name);

    const inactive = await http().get('/api/v1/associations?status=INACTIVE&pageSize=100').set('Cookie', adminCookie);
    expect(inactive.body.items.every((row: { status: string }) => row.status === 'INACTIVE')).toBe(true);
    expect(inactive.body.items.some((row: { name: string }) => row.name === b.name)).toBe(true);
  });

  it('غير ADMIN (جمعية/مندوب/بلا جلسة) لا يستطيع استعراض الجمعيات أو إنشاءها أو تعديلها', async () => {
    const assocCookie = await loginAs(app, fixtures.assocEmail, fixtures.assocPassword);
    const delegateCookie = await loginAsDelegate(app, fixtures.delegateCode);

    for (const cookie of [assocCookie, delegateCookie]) {
      expect((await http().get('/api/v1/associations').set('Cookie', cookie)).status).toBe(403);
      expect((await http().get(`/api/v1/associations/${fixtures.activeAssociationId}`).set('Cookie', cookie)).status).toBe(403);
      expect((await createAssociation(newAssociationBody(), cookie)).status).toBe(403);
      expect(
        (await http().patch(`/api/v1/associations/${fixtures.activeAssociationId}`).set('Cookie', cookie).send({ name: 'x' })).status,
      ).toBe(403);
    }

    expect((await http().get('/api/v1/associations')).status).toBe(401);
  });

  // ————————————————————————————————————————
  // 62) 63) 64) الإنشاء المباشر
  // ————————————————————————————————————————
  it('الإنشاء المباشر ينشئ Association+Account+AuthCredential مترابطة في معاملة واحدة', async () => {
    const body = newAssociationBody();
    const res = await createAssociation(body);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const association = await prisma.association.findUniqueOrThrow({ where: { id: res.body.associationId } });
    expect(association.publicCode).toMatch(/^ASC-\d{6}$/);
    expect(association.name).toBe(body.name);
    expect(association.status).toBe(AssociationStatus.ACTIVE);
    expect(association.phones).toEqual([body.phone]);

    const account = await prisma.account.findFirstOrThrow({ where: { associationId: association.id, role: AccountRole.ASSOCIATION } });
    expect(account.publicCode).toMatch(/^USR-\d{6}$/);
    expect(account.mustChangePassword).toBe(true);
    expect(account.email).toBe(body.email);

    const credential = await prisma.authCredential.findUniqueOrThrow({
      where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: body.email } },
    });
    expect(credential.accountId).toBe(account.id);
    expect(credential.secretHash.startsWith('$argon2id$')).toBe(true);

    // كلمة المرور المؤقتة التي زوّدها ADMIN تعمل فعلًا.
    const login = await http().post('/api/v1/auth/login').send({ type: 'user', email: body.email, password: body.temporaryPassword });
    expect(login.status).toBe(200);
  });

  it('نفس opId بنفس الحمولة لا يُنشئ جمعية ثانية ويُعيد نفس النتيجة', async () => {
    const body = newAssociationBody();
    const first = await createAssociation(body);
    expect(first.status).toBe(201);

    const replay = await createAssociation(body);
    expect(replay.status).toBe(201);
    expect(replay.body.associationId).toBe(first.body.associationId);

    expect(await prisma.association.count({ where: { name: body.name } })).toBe(1);
    expect(await prisma.account.count({ where: { email: body.email } })).toBe(1);
    expect(await prisma.idempotencyKey.count()).toBe(1);
  });

  it('نفس opId بحمولة مختلفة يُرفض بـAPPLICATION_IDEMPOTENCY_CONFLICT بلا إنشاء شيء', async () => {
    const body = newAssociationBody();
    expect((await createAssociation(body)).status).toBe(201);

    const different = newAssociationBody({ opId: body.opId });
    const conflict = await createAssociation(different);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');
    expect(await prisma.association.count({ where: { name: different.name } })).toBe(0);
  });

  it('بريد مرتبط بحساب قائم يُرفض عند الإنشاء المباشر، وكلمة مرور ضعيفة تُرفض', async () => {
    const inUse = await createAssociation(newAssociationBody({ email: fixtures.assocEmail }));
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('ASSOCIATION_EMAIL_IN_USE');

    const weak = await createAssociation(newAssociationBody({ temporaryPassword: 'abc' }));
    expect(weak.status).toBe(400);
  });

  // ————————————————————————————————————————
  // 65) التعديل
  // ————————————————————————————————————————
  it('ADMIN يعدّل الاسم/التصنيف/المنطقة/المدينة/الجوال/البريد/الحالة ويُحفَظ كل ذلك فعليًا', async () => {
    const body = newAssociationBody();
    const created = await createAssociation(body);
    const id = created.body.associationId;

    const update = {
      name: `${NODE2_MARKER} اسم بعد التعديل`,
      category: 'جمعية أهلية',
      region: 'مكة المكرمة',
      city: 'جدة',
      phone: '0555555555',
      email: `updated-${uniqueSuffix()}@example.org`,
      status: 'INACTIVE' as const,
    };
    const res = await http().patch(`/api/v1/associations/${id}`).set('Cookie', adminCookie).send(update);
    expect(res.status).toBe(200);

    const after = await prisma.association.findUniqueOrThrow({ where: { id } });
    expect(after.name).toBe(update.name);
    expect(after.category).toBe(update.category);
    expect(after.region).toBe(update.region);
    expect(after.city).toBe(update.city);
    expect(after.phones).toEqual([update.phone]);
    expect(after.email).toBe(update.email);
    expect(after.status).toBe(AssociationStatus.INACTIVE);

    const detail = await http().get(`/api/v1/associations/${id}`).set('Cookie', adminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe(update.name);
    expect(detail.body.account.email).toBe(body.email);

    const missing = await http().patch(`/api/v1/associations/${randomUUID()}`).set('Cookie', adminCookie).send({ name: 'x' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ASSOCIATION_NOT_FOUND');
  });

  // ————————————————————————————————————————
  // NODE-2.1 (1) البيانات المرجعية عند الإنشاء المباشر
  // ————————————————————————————————————————
  it('الإنشاء المباشر يرفض منطقة غير معروفة وزوج منطقة/مدينة غير متطابق وتصنيفًا غير معتمد', async () => {
    const badRegion = await createAssociation(newAssociationBody({ region: 'منطقة وهمية', city: 'الرياض' }));
    expect(badRegion.status).toBe(400);
    expect(badRegion.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');

    const badPair = await createAssociation(newAssociationBody({ region: 'الرياض', city: 'جدة' }));
    expect(badPair.status).toBe(400);
    expect(badPair.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');

    const badCategory = await createAssociation(newAssociationBody({ category: 'تصنيف غير موجود' }));
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');

    // لا شيء أُنشئ من أيٍّ من المحاولات الثلاث.
    expect(await prisma.association.count({ where: { name: { contains: NODE2_MARKER } } })).toBe(0);
  });

  it('المرادف التاريخي «بر» يُطبَّع إلى «جمعية بر» عند الإنشاء المباشر', async () => {
    const body = newAssociationBody({ category: 'بر' });
    const res = await createAssociation(body);
    expect(res.status).toBe(201);

    const association = await prisma.association.findUniqueOrThrow({ where: { id: res.body.associationId } });
    expect(association.category).toBe('جمعية بر');
  });

  // ————————————————————————————————————————
  // NODE-2.1 (1) grandfathering عند التعديل
  // ————————————————————————————————————————
  /** ينشئ جمعية صالحة ثم يزرع فيها قيمًا مرجعية تاريخية غير معتمدة مباشرةً في القاعدة. */
  async function createWithLegacyReferenceValues() {
    const body = newAssociationBody();
    const created = await createAssociation(body);
    expect(created.status).toBe(201);
    const id = created.body.associationId as string;

    await prisma.association.update({
      where: { id },
      data: { category: 'تصنيف تاريخي ملغى', region: 'منطقة تاريخية', city: 'مدينة تاريخية' },
    });
    return { id, body };
  }

  it('تعديل حقل غير ذي صلة ينجح رغم وجود تصنيف/منطقة/مدينة تاريخية غير معتمدة (grandfathering)', async () => {
    const { id } = await createWithLegacyReferenceValues();

    const res = await http()
      .patch(`/api/v1/associations/${id}`)
      .set('Cookie', adminCookie)
      .send({ name: `${NODE2_MARKER} اسم جديد فقط`, phone: '0561111111' });
    expect(res.status).toBe(200);

    const after = await prisma.association.findUniqueOrThrow({ where: { id } });
    expect(after.name).toBe(`${NODE2_MARKER} اسم جديد فقط`);
    expect(after.phones).toEqual(['0561111111']);
    // الحقول التاريخية لم تُمَسّ ولم تُجبَر على إعادة التحقق.
    expect(after.category).toBe('تصنيف تاريخي ملغى');
    expect(after.region).toBe('منطقة تاريخية');
    expect(after.city).toBe('مدينة تاريخية');
  });

  it('إعادة إرسال نفس القيمة التاريخية بعينها مقبولة، واستبدالها بقيمة غير صالحة أخرى مرفوضة', async () => {
    const { id } = await createWithLegacyReferenceValues();

    // نفس القيم المخزَّنة حرفيًا — مقبولة (isGrandfatheredValue_ في Legacy).
    const same = await http()
      .patch(`/api/v1/associations/${id}`)
      .set('Cookie', adminCookie)
      .send({ category: 'تصنيف تاريخي ملغى', region: 'منطقة تاريخية', city: 'مدينة تاريخية' });
    expect(same.status).toBe(200);

    // قيمة غير صالحة **أخرى** — مرفوضة في الحقول الثلاثة، لا تبديل لغير صالح بغير صالح.
    const otherCategory = await http()
      .patch(`/api/v1/associations/${id}`)
      .set('Cookie', adminCookie)
      .send({ category: 'تصنيف ملغى آخر' });
    expect(otherCategory.status).toBe(400);
    expect(otherCategory.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');

    const otherRegion = await http().patch(`/api/v1/associations/${id}`).set('Cookie', adminCookie).send({ region: 'منطقة ملغاة أخرى' });
    expect(otherRegion.status).toBe(400);

    const otherCity = await http().patch(`/api/v1/associations/${id}`).set('Cookie', adminCookie).send({ city: 'مدينة ملغاة أخرى' });
    expect(otherCity.status).toBe(400);

    const after = await prisma.association.findUniqueOrThrow({ where: { id } });
    expect(after.category).toBe('تصنيف تاريخي ملغى');
    expect(after.region).toBe('منطقة تاريخية');
    expect(after.city).toBe('مدينة تاريخية');
  });

  it('تغيير المدينة وحدها يُتحقَّق منه مقابل الزوج النهائي المدمَج مع المنطقة المخزَّنة', async () => {
    const body = newAssociationBody({ region: 'الرياض', city: 'الرياض' });
    const created = await createAssociation(body);
    const id = created.body.associationId;

    // 'جدة' مدينة صالحة بذاتها لكنها لا تتبع 'الرياض' المخزَّنة → يجب أن تُرفض.
    const wrongPair = await http().patch(`/api/v1/associations/${id}`).set('Cookie', adminCookie).send({ city: 'جدة' });
    expect(wrongPair.status).toBe(400);
    expect(wrongPair.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');

    // مدينة تتبع المنطقة المخزَّنة فعلًا → تُقبل.
    const rightPair = await http().patch(`/api/v1/associations/${id}`).set('Cookie', adminCookie).send({ city: 'الخرج' });
    expect(rightPair.status).toBe(200);
    expect((await prisma.association.findUniqueOrThrow({ where: { id } })).city).toBe('الخرج');
  });

  // ————————————————————————————————————————
  // NODE-2.1 (2) البحث بالجوال
  // ————————————————————————————————————————
  it('البحث في قائمة الجمعيات يطابق رقم الجوال بأي صيغة مقبولة', async () => {
    const phone = '0567654321';
    const body = newAssociationBody({ phone, name: `${NODE2_MARKER} جمعية البحث بالجوال` });
    expect((await createAssociation(body)).status).toBe(201);

    for (const term of ['0567654321', '567654321', '966567654321', '+966567654321']) {
      const res = await http().get(`/api/v1/associations?search=${encodeURIComponent(term)}&pageSize=100`).set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.items.some((row: { name: string }) => row.name === body.name)).toBe(true);
    }

    // رقم كامل صالح لكنه لغير هذه الجمعية لا يطابقها.
    const miss = await http().get('/api/v1/associations?search=0509999999&pageSize=100').set('Cookie', adminCookie);
    expect(miss.body.items.some((row: { name: string }) => row.name === body.name)).toBe(false);
  });

  // ————————————————————————————————————————
  // NODE-2.1 (3) تحقق زمن تشغيل لمعاملات الاستعلام
  // ————————————————————————————————————————
  it.each(['abc', '-1', '0', '1.5'])('page غير صالح (%s) يُرفض بـ400 لا 500 ولا قيمة افتراضية صامتة', async (page) => {
    const res = await http().get(`/api/v1/associations?page=${encodeURIComponent(page)}`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it.each(['abc', '-5', '0', '101', '1000'])('pageSize غير صالح (%s) يُرفض بـ400', async (pageSize) => {
    const res = await http().get(`/api/v1/associations?pageSize=${encodeURIComponent(pageSize)}`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('status عشوائي على قائمة الجمعيات يُرفض بـ400 ولا يصل إلى Prisma', async () => {
    for (const status of ['NOPE', 'active', "ACTIVE'; DROP TABLE associations; --"]) {
      const res = await http().get(`/api/v1/associations?status=${encodeURIComponent(status)}`).set('Cookie', adminCookie);
      expect(res.status).toBe(400);
    }
    // القيم الصحيحة ما تزال تعمل.
    expect((await http().get('/api/v1/associations?status=ACTIVE').set('Cookie', adminCookie)).status).toBe(200);
    expect((await http().get('/api/v1/associations?pageSize=100&page=1').set('Cookie', adminCookie)).status).toBe(200);
  });

  // ————————————————————————————————————————
  // NODE-2.1 (4) UUID مشوَّه
  // ————————————————————————————————————————
  it.each(['not-a-uuid', '123', "' OR 1=1 --", '00000000-0000-0000-0000-00000000zzzz'])(
    'معرّف جمعية مشوَّه (%s) يُرفض بـ400 نظيف لا 500 على التفاصيل والتعديل',
    async (badId) => {
      const detail = await http().get(`/api/v1/associations/${encodeURIComponent(badId)}`).set('Cookie', adminCookie);
      expect(detail.status).toBe(400);
      expect(detail.body.ok).toBe(false);
      expect(JSON.stringify(detail.body)).not.toMatch(/prisma|postgres|invalid input syntax/i);

      const update = await http()
        .patch(`/api/v1/associations/${encodeURIComponent(badId)}`)
        .set('Cookie', adminCookie)
        .send({ name: 'x' });
      expect(update.status).toBe(400);
      expect(JSON.stringify(update.body)).not.toMatch(/prisma|postgres|invalid input syntax/i);
    },
  );

  // ————————————————————————————————————————
  // NODE-2.1 (6) بصمة كلمة المرور في حمولة الـidempotency
  // ————————————————————————————————————————
  it('نفس opId ونفس بقية الحقول لكن بكلمة مرور مؤقتة مختلفة يُرفض بـ409 ولا يُنشئ شيئًا', async () => {
    const body = newAssociationBody();
    const first = await createAssociation(body);
    expect(first.status).toBe(201);

    const replaySamePassword = await createAssociation(body);
    expect(replaySamePassword.status).toBe(201);
    expect(replaySamePassword.body.associationId).toBe(first.body.associationId);

    const differentPassword = { ...body, temporaryPassword: 'CompletelyOther99' };
    const conflict = await createAssociation(differentPassword);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');

    expect(await prisma.association.count({ where: { name: body.name } })).toBe(1);
    expect(await prisma.account.count({ where: { email: body.email } })).toBe(1);
    expect(await prisma.idempotencyKey.count()).toBe(1);
  });

  it('كلمة المرور المؤقتة للإنشاء المباشر لا تُخزَّن صريحةً في أي عمود', async () => {
    const body = newAssociationBody();
    expect((await createAssociation(body)).status).toBe(201);

    const rows = await prisma.idempotencyKey.findMany();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(body.temporaryPassword);
    // البصمة المخزَّنة hex فقط — لا أثر لأي بايت من كلمة المرور.
    expect(rows[0].requestHash).toMatch(/^[0-9a-f]{64}$/);

    const audits = await prisma.auditLog.findMany();
    expect(JSON.stringify(audits)).not.toContain(body.temporaryPassword);

    // مسح نصّي فعلي على كل الجداول ذات الصلة — نفس نمط اختبار القبول القائم.
    const hits = await prisma.$queryRawUnsafe<{ hit: number }[]>(
      `SELECT (
         (SELECT count(*) FROM idempotency_keys WHERE coalesce(response_json::text,'') LIKE $1 OR request_hash LIKE $1 OR key LIKE $1) +
         (SELECT count(*) FROM audit_logs WHERE coalesce(metadata::text,'') LIKE $1) +
         (SELECT count(*) FROM auth_credentials WHERE secret_hash LIKE $1 OR identifier LIKE $1) +
         (SELECT count(*) FROM accounts WHERE name LIKE $1 OR email LIKE $1) +
         (SELECT count(*) FROM associations WHERE name LIKE $1 OR coalesce(email,'') LIKE $1)
       )::int AS hit`,
      `%${body.temporaryPassword}%`,
    );
    expect(hits[0].hit).toBe(0);
  });

  // ————————————————————————————————————————
  // NODE-2.1 (8) الترتيب — parity مع applySort_ في listAssociations_
  // ————————————————————————————————————————
  it('sortBy المسموح يغيّر الترتيب فعلًا، وأي عمود آخر يُرفض بـ400', async () => {
    const first = newAssociationBody({ name: `${NODE2_MARKER} أ جمعية الترتيب`, region: 'الرياض', city: 'الخرج' });
    const second = newAssociationBody({ name: `${NODE2_MARKER} ي جمعية الترتيب`, region: 'الرياض', city: 'الرياض' });
    expect((await createAssociation(first)).status).toBe(201);
    expect((await createAssociation(second)).status).toBe(201);

    const namesOf = (body: { items: { name: string }[] }) =>
      body.items.filter((row) => row.name.includes('جمعية الترتيب')).map((row) => row.name);

    const asc = await http().get('/api/v1/associations?sortBy=name&sortDir=asc&pageSize=100').set('Cookie', adminCookie);
    expect(asc.status).toBe(200);
    const desc = await http().get('/api/v1/associations?sortBy=name&sortDir=desc&pageSize=100').set('Cookie', adminCookie);
    expect(desc.status).toBe(200);
    expect(namesOf(desc.body)).toEqual([...namesOf(asc.body)].reverse());

    const byCity = await http().get('/api/v1/associations?sortBy=city&pageSize=100').set('Cookie', adminCookie);
    expect(byCity.status).toBe(200);

    // قائمة بيضاء صارمة — أي عمود آخر أو محاولة حقن تُرفض قبل أي استعلام.
    for (const sortBy of ['id', 'createdAt', 'progress', 'email', 'name; DROP TABLE associations', '(SELECT 1)']) {
      const res = await http().get(`/api/v1/associations?sortBy=${encodeURIComponent(sortBy)}`).set('Cookie', adminCookie);
      expect(res.status).toBe(400);
    }
    for (const sortDir of ['ascending', 'DESC;', 'up']) {
      const res = await http().get(`/api/v1/associations?sortBy=name&sortDir=${encodeURIComponent(sortDir)}`).set('Cookie', adminCookie);
      expect(res.status).toBe(400);
    }
  });

  // ————————————————————————————————————————
  // 66) 67) 68) التعطيل وإبطال الجلسات
  // ————————————————————————————————————————
  it('تعطيل الجمعية يُبطل جلسات حساب الجمعية وحسابات المندوبين معًا، وإعادة التفعيل لا تُحييها', async () => {
    const assocCookie = await loginAs(app, fixtures.assocEmail, fixtures.assocPassword);
    const delegateCookie = await loginAsDelegate(app, fixtures.delegateCode);

    expect((await http().get('/api/v1/auth/me').set('Cookie', assocCookie)).status).toBe(200);
    expect((await http().get('/api/v1/auth/me').set('Cookie', delegateCookie)).status).toBe(200);

    const activeBefore = await prisma.authSession.count({ where: { revokedAt: null } });
    expect(activeBefore).toBeGreaterThanOrEqual(3);

    const deactivate = await http()
      .patch(`/api/v1/associations/${fixtures.activeAssociationId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'INACTIVE' });
    expect(deactivate.status).toBe(200);

    // 66) + 67) الدوران معًا
    expect((await http().get('/api/v1/auth/me').set('Cookie', assocCookie)).status).toBe(401);
    expect((await http().get('/api/v1/auth/me').set('Cookie', delegateCookie)).status).toBe(401);

    const accountIds = (
      await prisma.account.findMany({ where: { associationId: fixtures.activeAssociationId }, select: { id: true } })
    ).map((a) => a.id);
    expect(await prisma.authSession.count({ where: { accountId: { in: accountIds }, revokedAt: null } })).toBe(0);

    // جلسة ADMIN (خارج الجمعية) لم تتأثر إطلاقًا.
    expect((await http().get('/api/v1/auth/me').set('Cookie', adminCookie)).status).toBe(200);

    // 68) إعادة التفعيل لا تُحيي الجلسات القديمة — تلزم جلسة جديدة.
    const reactivate = await http()
      .patch(`/api/v1/associations/${fixtures.activeAssociationId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'ACTIVE' });
    expect(reactivate.status).toBe(200);

    expect((await http().get('/api/v1/auth/me').set('Cookie', assocCookie)).status).toBe(401);
    expect((await http().get('/api/v1/auth/me').set('Cookie', delegateCookie)).status).toBe(401);
    expect(await prisma.authSession.count({ where: { accountId: { in: accountIds }, revokedAt: null } })).toBe(0);

    const freshCookie = await loginAs(app, fixtures.assocEmail, fixtures.assocPassword);
    expect((await http().get('/api/v1/auth/me').set('Cookie', freshCookie)).status).toBe(200);
  });

  // ————————————————————————————————————————
  // 69) 70) 71) الإعدادات الذاتية
  // ————————————————————————————————————————
  it('الجمعية تُحدّث جوالها وبريدها عبر إعداداتها الذاتية، ويُزامَن بريد الحساب معها', async () => {
    const session = await createAssociationWithSession();
    const newEmail = `self-${uniqueSuffix()}@example.org`;

    const res = await http()
      .patch('/api/v1/associations/me/settings')
      .set('Cookie', session.cookie)
      .send({ phone: '0533333333', email: newEmail });
    expect(res.status).toBe(200);

    const association = await prisma.association.findUniqueOrThrow({ where: { id: session.associationId } });
    expect(association.phones).toEqual(['0533333333']);
    expect(association.email).toBe(newEmail);

    const account = await prisma.account.findFirstOrThrow({
      where: { associationId: session.associationId, role: AccountRole.ASSOCIATION },
    });
    expect(account.email).toBe(newEmail);

    // بريد الدخول (AuthCredential.identifier) لا يتغيّر — الدخول يبقى بالبريد الأصلي.
    const credential = await prisma.authCredential.findUnique({
      where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: session.body.email } },
    });
    expect(credential).toBeTruthy();

    const audits = await prisma.auditLog.findMany({ where: { action: 'ASSOCIATION_SETTINGS_UPDATED' } });
    expect(audits).toHaveLength(1);
  });

  it('الجمعية لا تستطيع تزوير associationId ولا تعديل الحالة/الاسم/التصنيف عبر إعداداتها الذاتية', async () => {
    const session = await createAssociationWithSession();
    const otherAssociationId = fixtures.activeAssociationId;
    const otherBefore = await prisma.association.findUniqueOrThrow({ where: { id: otherAssociationId } });

    // 70) حقل associationId مرفوض أصلًا من ValidationPipe (whitelist صارم) — لا يصل للخدمة إطلاقًا.
    const forged = await http()
      .patch('/api/v1/associations/me/settings')
      .set('Cookie', session.cookie)
      .send({ phone: '0544444444', email: `x-${uniqueSuffix()}@example.org`, associationId: otherAssociationId });
    expect(forged.status).toBe(400);

    // 71) الحالة/الاسم/التصنيف مرفوضة كذلك — لا مسار لتصعيد الصلاحيات عبر هذا المسار.
    const escalate = await http()
      .patch('/api/v1/associations/me/settings')
      .set('Cookie', session.cookie)
      .send({ phone: '0544444444', email: `y-${uniqueSuffix()}@example.org`, status: 'ACTIVE', name: 'اسم مزوَّر', category: 'جمعية أهلية' });
    expect(escalate.status).toBe(400);

    // لا شيء تغيّر في أي من الجمعيتين.
    const otherAfter = await prisma.association.findUniqueOrThrow({ where: { id: otherAssociationId } });
    expect(otherAfter.phones).toEqual(otherBefore.phones);
    expect(otherAfter.email).toBe(otherBefore.email);
    expect(otherAfter.name).toBe(otherBefore.name);

    const own = await prisma.association.findUniqueOrThrow({ where: { id: session.associationId } });
    expect(own.name).toBe(session.body.name);
    expect(own.status).toBe(AssociationStatus.ACTIVE);
  });

  it('ADMIN/المندوب لا يستطيعان استخدام مسار إعدادات الجمعية الذاتية', async () => {
    const delegateCookie = await loginAsDelegate(app, fixtures.delegateCode);
    for (const cookie of [adminCookie, delegateCookie]) {
      const res = await http()
        .patch('/api/v1/associations/me/settings')
        .set('Cookie', cookie)
        .send({ phone: '0522222222', email: 'nope@example.org' });
      expect(res.status).toBe(403);
    }
  });

  // ————————————————————————————————————————
  // 72) بريد التواصل ≠ بريد الدخول
  // ————————————————————————————————————————
  it('تعديل ADMIN لبريد التواصل لا يغيّر بريد الدخول — القديم يبقى صالحًا والجديد لا يصلح للدخول', async () => {
    const body = newAssociationBody();
    const created = await createAssociation(body);
    const id = created.body.associationId;

    const newContactEmail = `contact-${uniqueSuffix()}@example.org`;
    expect((await http().patch(`/api/v1/associations/${id}`).set('Cookie', adminCookie).send({ email: newContactEmail })).status).toBe(200);

    // بريد الدخول الأصلي ما يزال يعمل بنفس كلمة المرور المؤقتة.
    const oldLogin = await http().post('/api/v1/auth/login').send({ type: 'user', email: body.email, password: body.temporaryPassword });
    expect(oldLogin.status).toBe(200);

    // بريد التواصل الجديد ليس هوية دخول — يُرفض بنفس الخطأ العام.
    const newLogin = await http()
      .post('/api/v1/auth/login')
      .send({ type: 'user', email: newContactEmail, password: body.temporaryPassword });
    expect(newLogin.status).toBe(401);
    expect(newLogin.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

    const credential = await prisma.authCredential.findUnique({
      where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: newContactEmail } },
    });
    expect(credential).toBeNull();
  });

  it('إعادة تعيين كلمة مرور الجمعية (مسار NODE-1 القائم) تعمل مع جمعية أُنشئت في NODE-2', async () => {
    const body = newAssociationBody();
    const created = await createAssociation(body);

    const res = await http().post(`/api/v1/auth/associations/${created.body.associationId}/reset-password`).set('Cookie', adminCookie);
    expect(res.status).toBe(201);
    expect(typeof res.body.temporaryPassword).toBe('string');

    const login = await http().post('/api/v1/auth/login').send({ type: 'user', email: body.email, password: res.body.temporaryPassword });
    expect(login.status).toBe(200);
  });

  // ————————————————————————————————————————
  // 73) لا تسريب لأي hash/token في أي رد
  // ————————————————————————————————————————
  it('لا يظهر أي secretHash/كلمة مرور/رمز جلسة في أي رد من مسارات الجمعيات', async () => {
    const body = newAssociationBody();
    const create = await createAssociation(body);
    const id = create.body.associationId;

    const update = await http().patch(`/api/v1/associations/${id}`).set('Cookie', adminCookie).send({ city: 'الخرج' });
    const list = await http().get('/api/v1/associations?pageSize=100').set('Cookie', adminCookie);
    const detail = await http().get(`/api/v1/associations/${id}`).set('Cookie', adminCookie);

    const forbidden = [/secretHash/i, /secret_hash/i, /previousSecretHash/i, /passwordHash/i, /\$argon2/, /tokenHash/i, /token_hash/i];
    for (const res of [create, update, list, detail]) {
      const serialized = JSON.stringify(res.body);
      for (const pattern of forbidden) expect(serialized).not.toMatch(pattern);
      expect(serialized).not.toContain(body.temporaryPassword);
    }

    // تفاصيل الجمعية تعرض بيانات الحساب المسموح بها فقط.
    expect(Object.keys(detail.body.account).sort()).toEqual(['email', 'id', 'lastLoginAt', 'mustChangePassword', 'publicCode', 'status']);
  });
});
