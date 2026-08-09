import { INestApplication } from '@nestjs/common';
import { prisma, ApplicationStatus } from '@alzad/db';
import { LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import {
  JPEG_1X1,
  NOT_AN_IMAGE,
  PNG_1X1,
  WEBP_1X1,
  cleanNode2State,
  oversizedImage,
  submitApplication,
  validApplicationPayload,
} from './utils/node2-fixtures';
import { clearLicenseObjects, listLicenseObjectKeys, objectExists, startTestStorage, stopTestStorage } from './utils/storage-harness';
import { PublicCodeService } from '../src/common/public-code.service';

/** NODE-2 — تقديم طلب انضمام جمعية عبر الـendpoint العام الحقيقي (multipart/form-data). */
describe('NODE-2 — تقديم طلب الانضمام (عام)', () => {
  let app: INestApplication;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;

  beforeAll(async () => {
    await startTestStorage();
    ({ app } = await createTestApp());
    fixtures = await seedTestFixtures();
  }, 60000);

  beforeEach(async () => {
    await cleanAuthState();
    await cleanNode2State();
    await clearLicenseObjects();
  });

  afterAll(async () => {
    await cleanNode2State();
    await app.close();
    await stopTestStorage();
  });

  // 11) + 12) نجاح كامل + حفظ الإجابات الثماني
  it('طلب صالح يُقبَل، يُنشأ بحالة UNDER_REVIEW برمز APP-، وتُحفَظ الأسئلة الثمانية كاملة', async () => {
    const payload = validApplicationPayload();
    const res = await submitApplication(app, payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^APP-\d{6}$/);

    const row = await prisma.associationApplication.findUniqueOrThrow({
      where: { clientRequestId: payload.clientRequestId },
      include: { answers: true },
    });
    expect(row.status).toBe(ApplicationStatus.UNDER_REVIEW);
    expect(row.publicCode).toBe(res.body.id);
    expect(row.sector).toBe(payload.sector);
    expect(row.category).toBe(payload.category);
    expect(row.pledgeAccepted).toBe(true);
    expect(row.pledgeAcceptedAt).toBeTruthy();

    expect(row.answers).toHaveLength(LEGACY_APPLICATION_QUESTIONS.length);
    for (const question of LEGACY_APPLICATION_QUESTIONS) {
      const stored = row.answers.find((a) => a.questionKey === question.key);
      expect(stored).toBeDefined();
      expect(stored!.answer).toBe(payload.answers[question.key]);
    }
  });

  it('الإجابات المختلطة (نعم/لا) تُحفَظ بقيمها الفعلية لا بقيمة موحَّدة', async () => {
    const answers: Record<string, boolean> = {};
    LEGACY_APPLICATION_QUESTIONS.forEach((q, i) => (answers[q.key] = i % 2 === 0));
    const payload = validApplicationPayload({ answers });

    expect((await submitApplication(app, payload)).status).toBe(200);
    const row = await prisma.associationApplication.findUniqueOrThrow({
      where: { clientRequestId: payload.clientRequestId },
      include: { answers: true },
    });
    LEGACY_APPLICATION_QUESTIONS.forEach((q, i) => {
      expect(row.answers.find((a) => a.questionKey === q.key)!.answer).toBe(i % 2 === 0);
    });
  });

  it('إجابة سؤال ناقصة تُرفض بـAPPLICATION_ANSWER_REQUIRED', async () => {
    const answers = { ...validApplicationPayload().answers };
    delete answers[LEGACY_APPLICATION_QUESTIONS[3].key];
    const res = await submitApplication(app, validApplicationPayload({ answers }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_ANSWER_REQUIRED');
  });

  // 13) الإقرار إلزامي
  it('بلا موافقة على الإقرار يُرفض الطلب بـAPPLICATION_PLEDGE_REQUIRED', async () => {
    const res = await submitApplication(app, validApplicationPayload({ pledgeAccepted: 'false' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_PLEDGE_REQUIRED');
    expect(await prisma.associationApplication.count()).toBe(0);
  });

  // 14) clientRequestId غير صالح
  it.each(['short', 'has spaces here', 'x'.repeat(65), 'bad!chars@here'])(
    'clientRequestId غير مطابق للنمط يُرفض: %s',
    async (clientRequestId) => {
      const res = await submitApplication(app, validApplicationPayload({ clientRequestId }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('APPLICATION_INVALID_CLIENT_REQUEST_ID');
    },
  );

  // 15) honeypot
  it('honeypot: ملء الحقل المخفي يُرجع نجاحًا صوريًا بلا أي كتابة أو رفع أو تدقيق', async () => {
    const before = await listLicenseObjectKeys();
    const res = await submitApplication(app, validApplicationPayload({ website: 'https://spam.example' }));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBe('');

    expect(await prisma.associationApplication.count()).toBe(0);
    expect(await prisma.applicationAnswer.count()).toBe(0);
    expect(await prisma.fileObject.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    expect(await listLicenseObjectKeys()).toEqual(before);
  });

  it('honeypot يعمل حتى بلا إرفاق ملف إطلاقًا (لا يصل الآلي إلى أي تحقق يميّزه)', async () => {
    const res = await submitApplication(app, validApplicationPayload({ website: 'bot' }), { file: null });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('');
    expect(await prisma.associationApplication.count()).toBe(0);
  });

  // 16) تطبيع البريد
  it('البريد يُخزَّن مطبَّعًا (حروف صغيرة، بلا مسافات طرفية)', async () => {
    const payload = validApplicationPayload();
    const res = await submitApplication(app, { ...payload, email: `  ${payload.email.toUpperCase()}  ` });
    expect(res.status).toBe(200);

    const row = await prisma.associationApplication.findUniqueOrThrow({ where: { clientRequestId: payload.clientRequestId } });
    expect(row.email).toBe(payload.email.toLowerCase());
  });

  // 17) تطبيع الجوال بكل صيغ Legacy
  it.each([
    ['05', '0512345678'],
    ['بلا صفر', '512345678'],
    ['966', '966512345678'],
    ['+966', '+966512345678'],
    ['بفواصل', '05-1234-5678'],
  ])('صيغة الجوال (%s) تُطبَّع إلى 05XXXXXXXX', async (_label, phone) => {
    await cleanNode2State();
    const payload = validApplicationPayload({ phone });
    const res = await submitApplication(app, payload);
    expect(res.status).toBe(200);

    const row = await prisma.associationApplication.findUniqueOrThrow({ where: { clientRequestId: payload.clientRequestId } });
    expect(row.phone).toBe('0512345678');
  });

  // 18) جوال غير صالح
  it.each(['0412345678', '12345', '05123456789', 'abcdefghij'])('جوال غير صالح يُرفض: %s', async (phone) => {
    const res = await submitApplication(app, validApplicationPayload({ phone }));
    expect(res.status).toBe(400);
  });

  // 19) 20) 21) البيانات المرجعية
  it('تصنيف غير معروف يُرفض بـAPPLICATION_INVALID_REFERENCE', async () => {
    const res = await submitApplication(app, validApplicationPayload({ category: 'تصنيف غير موجود' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');
  });

  it('مجال عمل غير معروف يُرفض، والمجال إلزامي أصلًا', async () => {
    const bad = await submitApplication(app, validApplicationPayload({ sector: 'مجال غير موجود' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');

    const empty = await submitApplication(app, validApplicationPayload({ sector: '' }));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');
  });

  it('مدينة لا تتبع المنطقة المُختارة تُرفض (تحقق علاقة الأب/الابن الفعلية)', async () => {
    const res = await submitApplication(app, validApplicationPayload({ region: 'الرياض', city: 'جدة' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');

    const unknownRegion = await submitApplication(app, validApplicationPayload({ region: 'منطقة وهمية', city: 'الرياض' }));
    expect(unknownRegion.status).toBe(400);
    expect(unknownRegion.body.error.code).toBe('APPLICATION_INVALID_REFERENCE');
  });

  // 22) تناقض سريان الترخيص
  it('«الترخيص ساري = نعم» مع تاريخ انتهاء في الماضي يُرفض', async () => {
    const answers = { ...validApplicationPayload().answers, 'الترخيص ساري': true };
    const res = await submitApplication(app, validApplicationPayload({ answers, licenseExpiryDate: '2020-01-01' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_LICENSE_EXPIRY_CONTRADICTION');
  });

  it('«الترخيص ساري = لا» مع تاريخ منتهٍ مقبول (لا تناقض)', async () => {
    const answers = { ...validApplicationPayload().answers, 'الترخيص ساري': false };
    const res = await submitApplication(app, validApplicationPayload({ answers, licenseExpiryDate: '2020-01-01' }));
    expect(res.status).toBe(200);
  });

  // 23) 24) 25) الصيغ المقبولة فعليًا عبر magic bytes
  it.each([
    ['JPG', JPEG_1X1, 'image/jpeg', 'license.jpg'],
    ['PNG', PNG_1X1, 'image/png', 'license.png'],
    ['WEBP', WEBP_1X1, 'image/webp', 'license.webp'],
  ])('صيغة %s تُقبَل ويُخزَّن نوعها الحقيقي المكتشَف', async (_label, buffer, contentType, filename) => {
    await cleanNode2State();
    const payload = validApplicationPayload();
    const res = await submitApplication(app, payload, { file: buffer as Buffer, contentType, filename });
    expect(res.status).toBe(200);

    const row = await prisma.associationApplication.findUniqueOrThrow({
      where: { clientRequestId: payload.clientRequestId },
      include: { licenseFile: true },
    });
    expect(row.licenseFile!.mimeType).toBe(contentType);
    expect(Number(row.licenseFile!.sizeBytes)).toBe((buffer as Buffer).length);
  });

  // 26) تزوير MIME
  it('MIME مُعلَن يخالف المحتوى الفعلي يُرفض (PNG معلَنًا كـJPEG)', async () => {
    const res = await submitApplication(app, validApplicationPayload(), {
      file: PNG_1X1,
      contentType: 'image/jpeg',
      filename: 'forged.jpg',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_LICENSE_INVALID');
    expect(await prisma.associationApplication.count()).toBe(0);
  });

  it('ملف ليس صورة إطلاقًا يُرفض ولو حمل امتدادًا ونوعًا صحيحين ظاهريًا', async () => {
    const res = await submitApplication(app, validApplicationPayload(), {
      file: NOT_AN_IMAGE,
      contentType: 'image/png',
      filename: 'license.png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_LICENSE_INVALID');
  });

  it('بلا ملف ترخيص أصلًا يُرفض الطلب', async () => {
    const res = await submitApplication(app, validApplicationPayload(), { file: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_LICENSE_INVALID');
  });

  // 27) الحجم
  it('ملف أكبر من 8 ميجابايت يُرفض بـAPPLICATION_LICENSE_TOO_LARGE', async () => {
    const res = await submitApplication(app, validApplicationPayload(), {
      file: oversizedImage(),
      contentType: 'image/png',
      filename: 'big.png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_LICENSE_TOO_LARGE');
    expect(await listLicenseObjectKeys()).toHaveLength(0);
  }, 60000);

  // 28) الملف يبقى خاصًا — لا رابط عام ولا معرّف قابل للتخمين في أي رد عام
  it('لا يُعاد أي رابط/معرّف ملف في رد التقديم أو رد الحالة العامة', async () => {
    const payload = validApplicationPayload();
    const res = await submitApplication(app, payload);
    expect(res.status).toBe(200);

    const submitBody = JSON.stringify(res.body);
    expect(submitBody).not.toMatch(/http/i);
    expect(submitBody).not.toMatch(/association-licenses/);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'message', 'ok']);

    const statusRes = await require('supertest')(app.getHttpServer()).get(
      `/api/v1/association-applications/status/${payload.clientRequestId}`,
    );
    const statusBody = JSON.stringify(statusRes.body);
    expect(statusBody).not.toMatch(/http/i);
    expect(statusBody).not.toMatch(/association-licenses/);
    expect(statusBody).not.toMatch(/objectKey|licenseFile|fileId/i);
  });

  // 29) فشل المعاملة بعد رفع ناجح يحذف الكائن (تعويض)
  it('فشل معاملة قاعدة البيانات بعد الرفع يحذف الكائن المرفوع (لا كائن يتيم)', async () => {
    const publicCodeService = app.get(PublicCodeService);
    const spy = jest
      .spyOn(publicCodeService, 'nextPublicCode')
      .mockRejectedValueOnce(new Error('فشل مُصطنَع داخل المعاملة بعد رفع الملف'));

    const payload = validApplicationPayload();
    const res = await submitApplication(app, payload);
    expect(res.status).toBe(500);

    expect(await prisma.associationApplication.count()).toBe(0);
    expect(await prisma.fileObject.count()).toBe(0);
    expect(await listLicenseObjectKeys()).toHaveLength(0);

    spy.mockRestore();
  });

  // 30) سباق تكرار: كائن الخاسر يُحذف، كائن الفائز فقط يبقى
  it('في سباق تكرار حقيقي يبقى كائن واحد فقط (كائن الطلب الفائز) ويُحذف كائن الخاسر', async () => {
    const payload = validApplicationPayload();
    await Promise.all([submitApplication(app, payload), submitApplication(app, payload)]);

    const rows = await prisma.associationApplication.findMany({ include: { licenseFile: true } });
    expect(rows).toHaveLength(1);

    const remaining = await listLicenseObjectKeys();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(rows[0].licenseFile!.objectKey);
    expect(await objectExists(rows[0].licenseFile!.objectKey)).toBe(true);
  });

  it('سباق تكرار على البريد/الجوال/الترخيص (بمعرّفات طلب مختلفة) يترك كائنًا واحدًا فقط', async () => {
    const base = validApplicationPayload();
    const twin = validApplicationPayload({ email: base.email, phone: base.phone, licenseNumber: base.licenseNumber });

    const results = await Promise.all([submitApplication(app, base), submitApplication(app, twin)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);

    expect(await prisma.associationApplication.count()).toBe(1);
    expect(await listLicenseObjectKeys()).toHaveLength(1);
  });

  // 31) إعادة الإرسال بنفس clientRequestId
  it('إعادة الإرسال بنفس clientRequestId تُعيد نفس الطلب بلا صف/ملف/رمز APP جديد', async () => {
    const payload = validApplicationPayload();
    const first = await submitApplication(app, payload);
    expect(first.status).toBe(200);

    const second = await submitApplication(app, payload);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);

    expect(await prisma.associationApplication.count()).toBe(1);
    expect(await prisma.fileObject.count()).toBe(1);
    expect(await listLicenseObjectKeys()).toHaveLength(1);
  });

  // 32) قاعدة التكرار قيد المراجعة عبر الـendpoint الحقيقي
  it('قاعدة «طلب واحد قيد المراجعة» مطبَّقة فعليًا عبر الـendpoint العام', async () => {
    const first = validApplicationPayload();
    expect((await submitApplication(app, first)).status).toBe(200);

    for (const field of ['email', 'phone', 'licenseNumber'] as const) {
      const res = await submitApplication(app, validApplicationPayload({ [field]: first[field] }));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('APPLICATION_DUPLICATE_PENDING');
    }
  });

  // 33) بريد مرتبط بحساب قائم
  it('بريد مرتبط بحساب دخول قائم يُرفض بـASSOCIATION_EMAIL_IN_USE', async () => {
    const res = await submitApplication(app, validApplicationPayload({ email: fixtures.assocEmail }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSOCIATION_EMAIL_IN_USE');
    expect(await prisma.associationApplication.count()).toBe(0);
  });

  // 34) حدّ المعدَّل 5/ساعة لكل بريد
  it('المحاولة السادسة خلال الساعة لنفس البريد تُرفض بـAUTH_RATE_LIMITED (5/ساعة)', async () => {
    // ملف غير صالح عمدًا: التحقق من الملف يقع **بعد** استهلاك حدّ المعدَّل
    // (نفس ترتيب Applications.gs)، فتصل كل محاولة إلى العدّاد فعلًا بلا
    // إنشاء طلب يمنع المحاولة التالية بقاعدة التكرار.
    const email = `ratelimit-${Date.now()}@example.org`;
    for (let i = 0; i < 5; i++) {
      const res = await submitApplication(app, validApplicationPayload({ email }), {
        file: NOT_AN_IMAGE,
        contentType: 'image/png',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('APPLICATION_LICENSE_INVALID');
    }

    const sixth = await submitApplication(app, validApplicationPayload({ email }), {
      file: NOT_AN_IMAGE,
      contentType: 'image/png',
    });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('AUTH_RATE_LIMITED');

    // بريد آخر داخل نفس النافذة لا يتأثر — الحدّ لكل بريد لا عالميًا.
    const other = await submitApplication(app, validApplicationPayload());
    expect(other.status).toBe(200);
  });
});
