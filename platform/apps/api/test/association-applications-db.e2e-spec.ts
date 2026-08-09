import { INestApplication } from '@nestjs/common';
import { prisma, AccountRole, AccountStatus, ApplicationStatus, AssociationStatus, FileCategory } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import {
  NODE2_MARKER,
  cleanNode2State,
  newClientRequestId,
  submitApplication,
  validApplicationPayload,
} from './utils/node2-fixtures';
import { clearLicenseObjects, startTestStorage, stopTestStorage } from './utils/storage-harness';
import { PublicCodeService } from '../src/common/public-code.service';

/**
 * NODE-2 — تأكيدات على مستوى قاعدة البيانات نفسها (وليس الـAPI فقط):
 * ذرّية مولّد publicCode تحت تزامن حقيقي، وسلامة الفهارس الجزئية
 * (partial unique indexes) التي تُشكّل خط الدفاع الأخير ضد التكرار.
 * كل شيء هنا يعمل على PostgreSQL الحقيقي المضبوط في DATABASE_URL.
 */
describe('NODE-2 — قيود قاعدة البيانات والتزامن', () => {
  let app: INestApplication;
  let fixtures: Awaited<ReturnType<typeof seedTestFixtures>>;
  const publicCode = new PublicCodeService();

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

  // ————————————————————————————————————————
  // 1) 2) 3) ذرّية publicCode تحت تزامن حقيقي
  // ————————————————————————————————————————
  describe.each(['APP', 'ASC', 'USR'])('publicCode ذرّي للبادئة %s', (prefix) => {
    it(`${prefix}: 25 استدعاءً متزامنًا يُنتج 25 رمزًا مختلفًا بلا تكرار`, async () => {
      const N = 25;
      const codes = await Promise.all(
        Array.from({ length: N }, () => prisma.$transaction((tx) => publicCode.nextPublicCode(tx, prefix))),
      );
      expect(codes).toHaveLength(N);
      expect(new Set(codes).size).toBe(N);
      for (const code of codes) expect(code).toMatch(new RegExp(`^${prefix}-\\d{6}$`));
    });
  });

  // ————————————————————————————————————————
  // 4) نفس clientRequestId لا يُنتج صفّين أبدًا
  // ————————————————————————————————————————
  it('طلبان متزامنان بنفس clientRequestId يُنتجان صفًّا واحدًا فقط', async () => {
    const payload = validApplicationPayload();
    const [a, b] = await Promise.all([submitApplication(app, payload), submitApplication(app, payload)]);

    for (const res of [a, b]) {
      expect([200, 409]).toContain(res.status);
    }
    const rows = await prisma.associationApplication.findMany({ where: { clientRequestId: payload.clientRequestId } });
    expect(rows).toHaveLength(1);
  });

  // ————————————————————————————————————————
  // 5) 6) 7) تكرار طلب قيد المراجعة بالبريد/الجوال/الترخيص
  // ————————————————————————————————————————
  it('طلب ثانٍ قيد المراجعة بنفس البريد يُرفض بـAPPLICATION_DUPLICATE_PENDING', async () => {
    const first = validApplicationPayload();
    expect((await submitApplication(app, first)).status).toBe(200);

    const second = validApplicationPayload({ email: first.email });
    const res = await submitApplication(app, second);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPLICATION_DUPLICATE_PENDING');
  });

  it('طلب ثانٍ قيد المراجعة بنفس رقم الجوال يُرفض', async () => {
    const first = validApplicationPayload();
    expect((await submitApplication(app, first)).status).toBe(200);

    const res = await submitApplication(app, validApplicationPayload({ phone: first.phone }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPLICATION_DUPLICATE_PENDING');
  });

  it('طلب ثانٍ قيد المراجعة بنفس رقم الترخيص يُرفض', async () => {
    const first = validApplicationPayload();
    expect((await submitApplication(app, first)).status).toBe(200);

    const res = await submitApplication(app, validApplicationPayload({ licenseNumber: first.licenseNumber }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPLICATION_DUPLICATE_PENDING');
  });

  // ————————————————————————————————————————
  // 8) السجل التاريخي المبتوت لا يمنع طلبًا جديدًا (سلوك الفهرس الجزئي)
  // ————————————————————————————————————————
  it('طلب ACCEPTED/REJECTED تاريخي لا يمنع طلبًا جديدًا بنفس الجوال/الترخيص/البريد', async () => {
    // (أ) طلب مرفوض تاريخيًا — لا حساب ناتج، فيجوز إعادة التقديم بنفس كل شيء.
    const rejected = validApplicationPayload();
    expect((await submitApplication(app, rejected)).status).toBe(200);
    await prisma.associationApplication.update({
      where: { clientRequestId: rejected.clientRequestId },
      data: { status: ApplicationStatus.REJECTED, rejectReason: 'اختبار', reviewedAt: new Date() },
    });

    const retry = await submitApplication(
      app,
      validApplicationPayload({ email: rejected.email, phone: rejected.phone, licenseNumber: rejected.licenseNumber }),
    );
    expect(retry.status).toBe(200);
    expect(retry.body.ok).toBe(true);

    // (ب) طلب مقبول تاريخيًا — الجوال/الترخيص لا يمنعان طلبًا جديدًا
    // (البريد وحده يمنعه لاحقًا لأن حساب دخول أُنشئ عليه فعلًا — وهو
    //  فحص AuthCredential منفصل تمامًا عن الفهارس الجزئية).
    const retryRow = await prisma.associationApplication.findFirstOrThrow({ where: { publicCode: retry.body.id } });
    await prisma.associationApplication.update({
      where: { id: retryRow.id },
      data: { status: ApplicationStatus.ACCEPTED, reviewedAt: new Date() },
    });

    const third = await submitApplication(
      app,
      validApplicationPayload({ phone: rejected.phone, licenseNumber: rejected.licenseNumber }),
    );
    expect(third.status).toBe(200);

    const all = await prisma.associationApplication.count({ where: { phone: rejected.phone } });
    expect(all).toBe(3);
  });

  // ————————————————————————————————————————
  // 9) جمعية ناتجة واحدة فقط لكل طلب (UNIQUE على resulting_association_id)
  // ————————————————————————————————————————
  it('لا يمكن لطلبين أن يشيرا لنفس الجمعية الناتجة (قيد فرادة على مستوى DB)', async () => {
    const association = await prisma.association.create({
      data: {
        publicCode: `ASC-T-${Date.now()}`,
        name: `${NODE2_MARKER} جمعية ناتجة`,
        category: 'جمعية خيرية',
        region: 'الرياض',
        city: 'الرياض',
        phones: ['0500000099'],
        status: AssociationStatus.ACTIVE,
      },
    });

    const first = validApplicationPayload();
    const second = validApplicationPayload();
    expect((await submitApplication(app, first)).status).toBe(200);
    expect((await submitApplication(app, second)).status).toBe(200);

    await prisma.associationApplication.update({
      where: { clientRequestId: first.clientRequestId },
      data: { status: ApplicationStatus.ACCEPTED, resultingAssociationId: association.id },
    });

    await expect(
      prisma.associationApplication.update({
        where: { clientRequestId: second.clientRequestId },
        data: { status: ApplicationStatus.ACCEPTED, resultingAssociationId: association.id },
      }),
    ).rejects.toThrow(/[Uu]nique|resulting_association_id/);
  });

  // ————————————————————————————————————————
  // 10) حساب ASSOCIATION تشغيلي واحد فقط لكل جمعية
  // ————————————————————————————————————————
  it('لا يمكن إنشاء حساب ASSOCIATION تشغيلي ثانٍ لنفس الجمعية (ux_accounts_one_association_role)', async () => {
    // fixtures.activeAssociationId يملك بالفعل حساب ASSOCIATION غير مؤرشَف.
    await expect(
      prisma.account.create({
        data: {
          publicCode: `USR-DUP-${Date.now()}`,
          name: `${NODE2_MARKER} حساب مكرر`,
          email: `dup-${Date.now()}@example.org`,
          role: AccountRole.ASSOCIATION,
          associationId: fixtures.activeAssociationId,
          status: AccountStatus.ACTIVE,
        },
      }),
    ).rejects.toThrow(/[Uu]nique|ux_accounts_one_association_role/);

    // نفس الجمعية تقبل حساب DELEGATE إضافيًا بلا مشكلة — الفهرس مشروط بالدور فقط.
    const delegate = await prisma.account.create({
      data: {
        publicCode: `MND-DUP-${Date.now()}`,
        name: `${NODE2_MARKER} مندوب إضافي`,
        email: `mnd-${Date.now()}@example.org`,
        role: AccountRole.DELEGATE,
        associationId: fixtures.activeAssociationId,
        status: AccountStatus.ACTIVE,
      },
    });
    expect(delegate.id).toBeTruthy();
    await prisma.account.delete({ where: { id: delegate.id } });
  });

  // fileObject/FileCategory مستخدَمان للتأكد من أن المخطط يُصدّر ما تتوقعه بقية الاختبارات.
  it('ملف الترخيص يُخزَّن بتصنيف ASSOCIATION_LICENSE وبمفتاح كائن خاص (لا رابط عام)', async () => {
    const payload = validApplicationPayload({ clientRequestId: newClientRequestId() });
    expect((await submitApplication(app, payload)).status).toBe(200);

    const application = await prisma.associationApplication.findUniqueOrThrow({
      where: { clientRequestId: payload.clientRequestId },
      include: { licenseFile: true },
    });
    expect(application.licenseFile?.category).toBe(FileCategory.ASSOCIATION_LICENSE);
    expect(application.licenseFile?.objectKey).toMatch(/^association-licenses\/[0-9a-f-]{36}\.(png|jpg|webp)$/);
    expect(application.licenseFile?.originalName).toBe('license');
  });
});
