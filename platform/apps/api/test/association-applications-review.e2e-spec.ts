import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { prisma, AccountRole, ApplicationStatus, EligibilityStatus } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import {
  cleanNode2State,
  loginAs,
  loginAsDelegate,
  submitApplication,
  validApplicationPayload,
  type ApplicationPayload,
} from './utils/node2-fixtures';
import { clearLicenseObjects, startTestStorage, stopTestStorage } from './utils/storage-harness';
import { MAX_PAGE } from '../src/common/pagination.util';

/** NODE-2 — مراجعة الطلبات (ADMIN حصرًا): قائمة/تفاصيل/ملف الترخيص/قبول/رفض. */
describe('NODE-2 — مراجعة طلبات الانضمام (ADMIN)', () => {
  let app: INestApplication;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;
  let adminCookie: string;

  beforeAll(async () => {
    await startTestStorage();
    ({ app } = await createTestApp());
    fixtures = await seedTestFixtures();
  }, 60000);

  beforeEach(async () => {
    await cleanAuthState();
    await cleanNode2State();
    await clearLicenseObjects();
    adminCookie = await loginAs(app, fixtures.adminEmail, fixtures.adminPassword);
  });

  afterAll(async () => {
    await cleanNode2State();
    await app.close();
    await stopTestStorage();
  });

  const http = () => request(app.getHttpServer());

  async function createApplication(overrides: Partial<ApplicationPayload> = {}): Promise<{ id: string; publicCode: string; payload: ApplicationPayload }> {
    const payload = validApplicationPayload(overrides);
    const res = await submitApplication(app, payload);
    expect(res.status).toBe(200);
    const row = await prisma.associationApplication.findUniqueOrThrow({ where: { clientRequestId: payload.clientRequestId } });
    return { id: row.id, publicCode: row.publicCode, payload };
  }

  const accept = (id: string, opId: string, cookie = adminCookie) =>
    http().post(`/api/v1/association-applications/${id}/review`).set('Cookie', cookie).send({ decision: 'accept', opId });

  const reject = (id: string, opId: string, reason?: string, cookie = adminCookie) =>
    http()
      .post(`/api/v1/association-applications/${id}/review`)
      .set('Cookie', cookie)
      .send({ decision: 'reject', opId, ...(reason === undefined ? {} : { reason }) });

  // ————————————————————————————————————————
  // 41) 42) 45) الأدوار
  // ————————————————————————————————————————
  it('حساب ASSOCIATION لا يستطيع الاطّلاع على قائمة الطلبات أو تفاصيلها أو مراجعتها', async () => {
    const { id } = await createApplication();
    const cookie = await loginAs(app, fixtures.assocEmail, fixtures.assocPassword);

    for (const res of [
      await http().get('/api/v1/association-applications').set('Cookie', cookie),
      await http().get(`/api/v1/association-applications/${id}`).set('Cookie', cookie),
      await http().get(`/api/v1/association-applications/${id}/license-file`).set('Cookie', cookie),
      await accept(id, randomUUID(), cookie),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    }
  });

  it('حساب DELEGATE لا يستطيع الاطّلاع على قائمة الطلبات ولا ملف الترخيص', async () => {
    const { id } = await createApplication();
    const cookie = await loginAsDelegate(app, fixtures.delegateCode);

    for (const res of [
      await http().get('/api/v1/association-applications').set('Cookie', cookie),
      await http().get(`/api/v1/association-applications/${id}/license-file`).set('Cookie', cookie),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it('بلا جلسة إطلاقًا تُرفض كل مسارات المراجعة', async () => {
    const { id } = await createApplication();
    expect((await http().get('/api/v1/association-applications')).status).toBe(401);
    expect((await http().get(`/api/v1/association-applications/${id}/license-file`)).status).toBe(401);
  });

  // ————————————————————————————————————————
  // 43) قائمة/ترقيم/تصفية/بحث
  // ————————————————————————————————————————
  it('ADMIN يستعرض القائمة مع ترقيم وتصفية بالحالة وبحث بالاسم/الرمز/البريد/المسؤول/الترخيص', async () => {
    const a = await createApplication({ name: 'NODE2E2E جمعية النور للبحث', contactName: 'سعد المسؤول' });
    const b = await createApplication();
    await prisma.associationApplication.update({ where: { id: b.id }, data: { status: ApplicationStatus.REJECTED, rejectReason: 'اختبار' } });
    await createApplication();

    const all = await http().get('/api/v1/association-applications').set('Cookie', adminCookie);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.page).toBe(1);
    expect(all.body.items).toHaveLength(3);
    expect(all.body.items[0].scoreLabel).toBe('8/8');
    expect(all.body.items[0].totalQuestions).toBe(8);

    const paged = await http().get('/api/v1/association-applications?page=2&pageSize=2').set('Cookie', adminCookie);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.totalPages).toBe(2);

    const filtered = await http().get('/api/v1/association-applications?status=REJECTED').set('Cookie', adminCookie);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].id).toBe(b.id);

    for (const term of ['النور للبحث', a.publicCode, a.payload.email, 'سعد المسؤول', a.payload.licenseNumber]) {
      const found = await http()
        .get(`/api/v1/association-applications?search=${encodeURIComponent(term)}`)
        .set('Cookie', adminCookie);
      expect(found.body.total).toBe(1);
      expect(found.body.items[0].id).toBe(a.id);
    }
  });

  // ————————————————————————————————————————
  // NODE-2.1 (3) تحقق زمن تشغيل لمعاملات الاستعلام
  // ————————————————————————————————————————
  it.each(['abc', '-1', '0', '2.5'])('page غير صالح (%s) على قائمة الطلبات يُرفض بـ400 لا 500', async (page) => {
    const res = await http().get(`/api/v1/association-applications?page=${encodeURIComponent(page)}`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it.each(['abc', '-5', '0', '101', '99999'])('pageSize غير صالح (%s) على قائمة الطلبات يُرفض بـ400', async (pageSize) => {
    const res = await http().get(`/api/v1/association-applications?pageSize=${encodeURIComponent(pageSize)}`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  // ————————————————————————————————————————
  // NODE-2.2 (1) سقف أعلى لـpage — حاجز ضد skip غير محدود
  // ————————————————————————————————————————
  it.each([1, MAX_PAGE])('page ضمن الحدود (%s) على قائمة الطلبات يُقبل بـ200', async (page) => {
    const res = await http().get(`/api/v1/association-applications?page=${page}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(page);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it.each([String(MAX_PAGE + 1), '1e308', '9007199254740991'])(
    'page فوق السقف (%s) على قائمة الطلبات يُرفض بـ400 نظيف بلا 500 وبلا تسريب Prisma/SQL',
    async (page) => {
      const res = await http()
        .get(`/api/v1/association-applications?page=${encodeURIComponent(page)}`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
      expect(res.body.ok).toBe(false);
      expect(typeof res.body.error?.code).toBe('string');
      expect(typeof res.body.error?.message).toBe('string');
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(/prisma|postgres|postgresql/i);
      expect(serialized).not.toMatch(/SELECT |OFFSET|LIMIT|\bat \w+ \(/i);
      expect(serialized).not.toMatch(/Infinity|NaN/);
    },
  );

  it('pageSize ضمن الحدود [1,100] ما يزال يعمل كما هو (تراجُع NODE-2.1)', async () => {
    for (const pageSize of [1, 100]) {
      const res = await http()
        .get(`/api/v1/association-applications?page=1&pageSize=${pageSize}`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.pageSize).toBe(pageSize);
    }
  });

  it('status عشوائي على قائمة الطلبات يُرفض بـ400 ولا يصل إلى Prisma', async () => {
    for (const status of ['NOPE', 'accepted', "UNDER_REVIEW'; DROP TABLE association_applications; --"]) {
      const res = await http()
        .get(`/api/v1/association-applications?status=${encodeURIComponent(status)}`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres/i);
    }
    for (const status of ['UNDER_REVIEW', 'ACCEPTED', 'REJECTED']) {
      expect((await http().get(`/api/v1/association-applications?status=${status}`).set('Cookie', adminCookie)).status).toBe(200);
    }
  });

  // ————————————————————————————————————————
  // NODE-2.1 (4) UUID مشوَّه على مسارات الطلبات الثلاثة
  // ————————————————————————————————————————
  it.each(['not-a-uuid', '42', "' OR 1=1 --", '00000000-0000-0000-0000-0000000000zz'])(
    'معرّف طلب مشوَّه (%s) يُرفض بـ400 على التفاصيل وملف الترخيص والمراجعة',
    async (badId) => {
      const encoded = encodeURIComponent(badId);

      const detail = await http().get(`/api/v1/association-applications/${encoded}`).set('Cookie', adminCookie);
      expect(detail.status).toBe(400);

      const licenseFile = await http().get(`/api/v1/association-applications/${encoded}/license-file`).set('Cookie', adminCookie);
      expect(licenseFile.status).toBe(400);

      const review = await http()
        .post(`/api/v1/association-applications/${encoded}/review`)
        .set('Cookie', adminCookie)
        .send({ decision: 'accept', opId: randomUUID() });
      expect(review.status).toBe(400);

      for (const res of [detail, licenseFile, review]) {
        expect(res.body.ok).toBe(false);
        expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres|invalid input syntax|uuid_in/i);
      }

      // لا شيء نُفِّذ: لا جمعية أُنشئت ولا سجل تدقيق كُتب.
      expect(await prisma.auditLog.count({ where: { action: 'APPLICATION_LICENSE_VIEWED' } })).toBe(0);
      expect(await prisma.idempotencyKey.count()).toBe(0);
    },
  );

  it('تفاصيل الطلب تُعيد كل الإجابات مع مؤشّر العرض yes/total، والطلب المجهول يُعيد 404', async () => {
    const { id } = await createApplication();
    const detail = await http().get(`/api/v1/association-applications/${id}`).set('Cookie', adminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.answers).toHaveLength(8);
    expect(detail.body.yesCount).toBe(8);
    expect(detail.body.scoreLabel).toBe('8/8');
    expect(detail.body.hasLicenseFile).toBe(true);

    const missing = await http().get(`/api/v1/association-applications/${randomUUID()}`).set('Cookie', adminCookie);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('APPLICATION_NOT_FOUND');
  });

  // ————————————————————————————————————————
  // 44) 46) ملف الترخيص
  // ————————————————————————————————————————
  it('ADMIN يحصل على رابط موقَّع قصير العمر لملف الترخيص، ويُسجَّل ذلك في سجل التدقيق', async () => {
    const { id } = await createApplication();
    const res = await http().get(`/api/v1/association-applications/${id}/license-file`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe('string');
    expect(res.body.url).toContain('association-licenses/');
    // الوصول موقَّع فعليًا — لا رابط عام دائم.
    expect(res.body.url).toMatch(/X-Amz-Signature=/);
    expect(res.body.url).toMatch(/X-Amz-Expires=300/);

    const audits = await prisma.auditLog.findMany({ where: { action: 'APPLICATION_LICENSE_VIEWED', entityId: id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorRole).toBe(AccountRole.ADMIN);
    expect(audits[0].entityType).toBe('association_applications');
  });

  it('مسار ملف الترخيص مفتاحه معرّف الطلب لا معرّف ملف حر — لا يمكن استخدامه للوصول لملف غير مرتبط', async () => {
    // (أ) معرّف طلب غير موجود
    const bogus = await http().get(`/api/v1/association-applications/${randomUUID()}/license-file`).set('Cookie', adminCookie);
    expect(bogus.status).toBe(404);
    expect(bogus.body.error.code).toBe('APPLICATION_NOT_FOUND');

    // (ب) طلب بلا ملف ترخيص مرتبط — لا يُسرَّب أي كائن آخر
    const { id } = await createApplication();
    await prisma.associationApplication.update({ where: { id }, data: { licenseFileId: null } });
    const detached = await http().get(`/api/v1/association-applications/${id}/license-file`).set('Cookie', adminCookie);
    expect(detached.status).toBe(404);
    expect(detached.body.error.code).toBe('APPLICATION_LICENSE_INVALID');

    // (ج) لا يقبل المسار أي معلمة fileId (لا استعلامًا ولا في المسار) — تُتجاهَل تمامًا.
    const other = await createApplication();
    const otherFile = await prisma.associationApplication.findUniqueOrThrow({ where: { id: other.id }, include: { licenseFile: true } });
    const injected = await http()
      .get(`/api/v1/association-applications/${id}/license-file?fileId=${otherFile.licenseFileId}`)
      .set('Cookie', adminCookie);
    expect(injected.status).toBe(404);
    expect(JSON.stringify(injected.body)).not.toContain(otherFile.licenseFile!.objectKey);
  });

  // ————————————————————————————————————————
  // 47) 48) 49) 50) 51) القبول
  // ————————————————————————————————————————
  it('اجتياز بوابة الأهلية لا ينشئ جمعية أو حسابًا قبل التقييم والاختيار النهائي', async () => {
    const { id, payload } = await createApplication();
    const res = await accept(id, randomUUID());

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.temporaryPassword).toBeUndefined();
    expect(await prisma.association.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
    expect(await prisma.account.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
    expect(await prisma.authCredential.count({ where: { identifier: payload.email.toLowerCase() } })).toBe(0);

    const application = await prisma.associationApplication.findUniqueOrThrow({ where: { id } });
    expect(application.status).toBe(ApplicationStatus.UNDER_REVIEW);
    expect(application.eligibilityStatus).toBe(EligibilityStatus.PASSED);
    expect(application.resultingAssociationId).toBeNull();
    expect(application.eligibilityReviewedById).toBeTruthy();
    expect(application.eligibilityReviewedAt).toBeTruthy();
  });

  // ————————————————————————————————————————
  // 52) 53) 54) التزامن والنهائية
  // ————————————————————————————————————————
  it('قرارا أهلية متزامنان متطابقان آمنان ولا ينشئان أي كيان تشغيلي', async () => {
    const { id, payload } = await createApplication();

    const results = await Promise.all([accept(id, randomUUID()), accept(id, randomUUID())]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201]);

    expect(await prisma.association.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
    expect(await prisma.account.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
    expect(await prisma.authCredential.count({ where: { identifier: payload.email.toLowerCase() } })).toBe(0);
    expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id } })).eligibilityStatus).toBe(EligibilityStatus.PASSED);
  });

  it('قرار أهلية ثم رفض نهائي متزامنان لا ينشئان جمعية، والرفض إن التزم يصبح نهائيًا', async () => {
    const { id, payload } = await createApplication();

    const [acceptRes, rejectRes] = await Promise.all([accept(id, randomUUID()), reject(id, randomUUID(), 'سبب الرفض المتزامن')]);
    const statuses = [acceptRes.status, rejectRes.status].sort();
    expect([[201, 201], [201, 409]]).toContainEqual(statuses);

    const application = await prisma.associationApplication.findUniqueOrThrow({ where: { id } });
    expect(application.status).toBe(ApplicationStatus.REJECTED);
    expect(rejectRes.status).toBe(201);
    expect(await prisma.association.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
  });

  it('قرار الأهلية قابل لإعادة التقييم قبل الاختيار، بينما الرفض النهائي يمنع إعادة الفتح', async () => {
    const eligible = await createApplication();
    expect((await accept(eligible.id, randomUUID())).status).toBe(201);
    expect((await accept(eligible.id, randomUUID())).status).toBe(201);

    const rejected = await createApplication();
    expect((await reject(rejected.id, randomUUID(), 'سبب أول')).status).toBe(201);
    const reAccept = await accept(rejected.id, randomUUID());
    expect(reAccept.status).toBe(409);
    expect(reAccept.body.error.code).toBe('APPLICATION_ALREADY_REVIEWED');
  });

  // ————————————————————————————————————————
  // 55) 56) الرفض
  // ————————————————————————————————————————
  it('الرفض يتطلّب سببًا صريحًا (مفقود/فارغ/مسافات) ولا يُنشئ أي جمعية أو حساب أو بيانات دخول', async () => {
    const { id, payload } = await createApplication();

    for (const reason of [undefined, '', '   ']) {
      const res = await reject(id, randomUUID(), reason);
      expect(res.status).toBe(400);
    }

    const ok = await reject(id, randomUUID(), 'الترخيص غير ساري والمستندات ناقصة');
    expect(ok.status).toBe(201);

    const application = await prisma.associationApplication.findUniqueOrThrow({ where: { id } });
    expect(application.status).toBe(ApplicationStatus.REJECTED);
    expect(application.rejectReason).toBe('الترخيص غير ساري والمستندات ناقصة');
    expect(application.resultingAssociationId).toBeNull();

    expect(await prisma.association.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
    expect(await prisma.account.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
    expect(await prisma.authCredential.count({ where: { identifier: payload.email.toLowerCase() } })).toBe(0);
  });

  it('سبب رفض أطول من 300 حرف يُقصّ إلى الحد الأقصى بلا فشل صامت', async () => {
    const { id } = await createApplication();
    const res = await reject(id, randomUUID(), 'س'.repeat(400));
    expect(res.status).toBe(201);
    const application = await prisma.associationApplication.findUniqueOrThrow({ where: { id } });
    expect(application.rejectReason!.length).toBe(300);
  });

  // ————————————————————————————————————————
  // 57) 58) كلمة المرور المؤقتة
  // ————————————————————————————————————————
  it('قرار الأهلية لا يولّد كلمة مرور أو بيانات دخول في أي موضع', async () => {
    const { id, payload } = await createApplication();
    const opId = randomUUID();
    const res = await accept(id, opId);
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeUndefined();

    const idempotencyRows = await prisma.idempotencyKey.findMany();
    expect(idempotencyRows).toHaveLength(1);
    const stored = JSON.stringify(idempotencyRows[0].responseJson);
    expect(stored).toBe('{"ok":true}');

    const audits = await prisma.auditLog.findMany({ where: { action: 'APPLICATION_ELIGIBILITY_DECIDED', entityId: id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('APPLICATION_ELIGIBILITY_DECIDED');
    expect(await prisma.authCredential.count({ where: { identifier: payload.email.toLowerCase() } })).toBe(0);
  });

  it('إعادة قرار الأهلية بنفس opId تعيد نفس الرد بلا كتابة مكررة', async () => {
    const { id, payload } = await createApplication();
    const opId = randomUUID();

    const first = await accept(id, opId);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ ok: true });

    const replay = await accept(id, opId);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({ ok: true });

    expect(await prisma.association.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
    expect(await prisma.account.count({ where: { email: payload.email.toLowerCase() } })).toBe(0);
    expect(await prisma.idempotencyKey.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'APPLICATION_ELIGIBILITY_DECIDED', entityId: id } })).toBe(1);
  });

  it('نفس opId بحمولة مختلفة (طلب آخر) يُرفض بـAPPLICATION_IDEMPOTENCY_CONFLICT', async () => {
    const first = await createApplication();
    const second = await createApplication();
    const opId = randomUUID();

    expect((await accept(first.id, opId)).status).toBe(201);

    const conflict = await accept(second.id, opId);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');
    expect(await prisma.associationApplication.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      status: ApplicationStatus.UNDER_REVIEW,
    });
  });

  // ————————————————————————————————————————
  // 59) سجل التدقيق بعد الالتزام فقط
  // ————————————————————————————————————————
  it('سجل التدقيق يميّز قرار الأهلية عن الرفض النهائي ولا يكتب للمحاولة الفاشلة', async () => {
    const { id } = await createApplication();

    // محاولة فاشلة أولًا (طلب غير موجود) — يجب ألّا تُنتج أي سجل تدقيق.
    const missing = await accept(randomUUID(), randomUUID());
    expect(missing.status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'APPLICATION_ELIGIBILITY_DECIDED' } })).toBe(0);

    const accepted = await accept(id, randomUUID());
    expect(accepted.status).toBe(201);
    const acceptAudits = await prisma.auditLog.findMany({ where: { action: 'APPLICATION_ELIGIBILITY_DECIDED', entityId: id } });
    expect(acceptAudits).toHaveLength(1);
    expect(acceptAudits[0].metadata).toMatchObject({ decision: EligibilityStatus.PASSED });

    // إعادة القرار بمعرّف عملية جديد مراجعة جديدة موثقة، وليست قبولًا نهائيًا.
    expect((await accept(id, randomUUID())).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: 'APPLICATION_ELIGIBILITY_DECIDED', entityId: id } })).toBe(2);

    // رفض ناجح على طلب آخر يُنتج سجلًا واحدًا فقط بنوعه.
    const other = await createApplication();
    expect((await reject(other.id, randomUUID(), 'سبب موثَّق')).status).toBe(201);
    const rejectAudits = await prisma.auditLog.findMany({ where: { action: 'APPLICATION_REJECTED', entityId: other.id } });
    expect(rejectAudits).toHaveLength(1);
    expect(rejectAudits[0].metadata).toMatchObject({ reason: 'سبب موثَّق' });
  });
});
