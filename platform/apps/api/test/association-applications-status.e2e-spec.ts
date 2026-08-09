import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { prisma, ApplicationStatus } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { cleanNode2State, newClientRequestId, submitApplication, validApplicationPayload } from './utils/node2-fixtures';
import { clearLicenseObjects, startTestStorage, stopTestStorage } from './utils/storage-harness';

/**
 * NODE-2 — متابعة حالة الطلب العامة. عقد الخصوصية صريح: لا PII إطلاقًا
 * في الرد، ولا فرق قابل للاستغلال بين «غير موجود» و«موجود لغيرك».
 */
describe('NODE-2 — حالة طلب الانضمام (عامة)', () => {
  let app: INestApplication;

  const PII_KEYS = [
    'name',
    'email',
    'phone',
    'contactName',
    'licenseNumber',
    'licenseExpiryDate',
    'notes',
    'category',
    'sector',
    'region',
    'city',
    'answers',
    'licenseFile',
    'reviewedBy',
    'reviewer',
    'resultingAssociationId',
  ];

  beforeAll(async () => {
    await startTestStorage();
    ({ app } = await createTestApp());
    await seedTestFixtures();
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

  const http = () => request(app.getHttpServer());
  const statusOf = (clientRequestId: string) => http().get(`/api/v1/association-applications/status/${clientRequestId}`);

  // 35) موجود
  it('طلب موجود يُعيد الرمز العام والحالة وتاريخ التقديم', async () => {
    const payload = validApplicationPayload();
    const submit = await submitApplication(app, payload);
    expect(submit.status).toBe(200);

    const res = await statusOf(payload.clientRequestId);
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.id).toBe(submit.body.id);
    expect(res.body.status).toBe(ApplicationStatus.UNDER_REVIEW);
    expect(new Date(res.body.submittedAt).getTime()).toBeGreaterThan(0);
  });

  // 36) غير موجود — رد أدنى بلا تسريب
  it('طلب غير موجود يُعيد ردًّا أدنى موحَّدًا بلا أي تفصيل', async () => {
    const res = await statusOf(newClientRequestId());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, found: false });
  });

  // 37) صيغة غير صالحة
  it.each(['short', 'bad!id', 'x'.repeat(65)])('معرّف طلب غير مطابق للنمط يُرفض: %s', async (id) => {
    const res = await statusOf(id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('APPLICATION_INVALID_CLIENT_REQUEST_ID');
  });

  // 38) لا PII إطلاقًا
  it('الرد لا يحتوي أي حقل شخصي (لا اسم/بريد/جوال/ترخيص/إجابات)', async () => {
    const payload = validApplicationPayload();
    await submitApplication(app, payload);

    const res = await statusOf(payload.clientRequestId);
    expect(Object.keys(res.body).sort()).toEqual(['found', 'id', 'ok', 'rejectionReason', 'status', 'submittedAt']);

    for (const key of PII_KEYS) expect(res.body).not.toHaveProperty(key);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(payload.email);
    expect(serialized).not.toContain(payload.phone);
    expect(serialized).not.toContain(payload.name);
    expect(serialized).not.toContain(payload.contactName);
    expect(serialized).not.toContain(payload.licenseNumber);
  });

  // 39) سبب الرفض حصريًا عند REJECTED
  it('سبب الرفض يظهر فقط عند حالة REJECTED، ويبقى فارغًا في UNDER_REVIEW/ACCEPTED', async () => {
    const payload = validApplicationPayload();
    await submitApplication(app, payload);

    const pending = await statusOf(payload.clientRequestId);
    expect(pending.body.status).toBe(ApplicationStatus.UNDER_REVIEW);
    expect(pending.body.rejectionReason).toBe('');

    await prisma.associationApplication.update({
      where: { clientRequestId: payload.clientRequestId },
      data: { status: ApplicationStatus.ACCEPTED, reviewedAt: new Date() },
    });
    const accepted = await statusOf(payload.clientRequestId);
    expect(accepted.body.status).toBe(ApplicationStatus.ACCEPTED);
    expect(accepted.body.rejectionReason).toBe('');

    await prisma.associationApplication.update({
      where: { clientRequestId: payload.clientRequestId },
      data: { status: ApplicationStatus.REJECTED, rejectReason: 'بيانات الترخيص غير مكتملة' },
    });
    const rejected = await statusOf(payload.clientRequestId);
    expect(rejected.body.status).toBe(ApplicationStatus.REJECTED);
    expect(rejected.body.rejectionReason).toBe('بيانات الترخيص غير مكتملة');
  });

  // 40) حدّ المعدَّل 20/ساعة لكل معرّف طلب
  it('المحاولة الحادية والعشرون لنفس معرّف الطلب خلال الساعة تُرفض بـAUTH_RATE_LIMITED', async () => {
    const clientRequestId = newClientRequestId();
    for (let i = 0; i < 20; i++) {
      const res = await statusOf(clientRequestId);
      expect(res.status).toBe(200);
    }
    const blocked = await statusOf(clientRequestId);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('AUTH_RATE_LIMITED');

    // معرّف طلب آخر داخل نفس النافذة لا يتأثر — الحدّ لكل معرّف لا عالميًا.
    const other = await statusOf(newClientRequestId());
    expect(other.status).toBe(200);
  });
});
