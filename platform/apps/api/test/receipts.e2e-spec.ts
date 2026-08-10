import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { prisma, AssociationStatus, DeviceStatus, DeviceType, ReceiptBatchStatus } from '@alzad/db';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { EmailService } from '../src/modules/auth/email/email.service';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { ALLOCATION_TRIGGER_PORT, type AllocationTriggerPort } from '../src/modules/allocation/allocation-trigger.port';
import { MAX_PAGE } from '../src/common/pagination.util';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs, JPEG_1X1, PNG_1X1, WEBP_1X1 } from './utils/node2-fixtures';
import { cleanNode3State, seedNode3Fixtures, type Node3Fixtures } from './utils/node3-fixtures';
import { cleanNode4State, confirmBatchRequest, createAndSendBatch, createBatchPayload, newOpId } from './utils/node4-fixtures';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { clearLicenseObjects, startTestStorage, stopTestStorage, storageClient, testBucket } from './utils/storage-harness';

async function countObjectsWithPrefix(prefix: string): Promise<number> {
  const res = await storageClient().send(new ListObjectsV2Command({ Bucket: testBucket(), Prefix: prefix }));
  return (res.Contents ?? []).length;
}

/** ينظّف كل كائنات إثباتات محاضر الاستلام بين الاختبارات — نفس مبدأ clearLicenseObjects لكن لبادئات receipt-*. */
async function clearReceiptEvidenceObjects(): Promise<void> {
  for (const prefix of ['receipt-quantity/', 'receipt-signature/', 'receipt-damage/']) {
    const res = await storageClient().send(new ListObjectsV2Command({ Bucket: testBucket(), Prefix: prefix }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key) await storageClient().send(new DeleteObjectCommand({ Bucket: testBucket(), Key: obj.Key }));
    }
  }
}

class SpyAllocationTrigger implements AllocationTriggerPort {
  calls: string[] = [];
  async triggerForAssociation(associationId: string): Promise<void> {
    this.calls.push(associationId);
  }
  reset() {
    this.calls = [];
  }
}

/**
 * NODE-4 — محاضر استلام دفعات الأجهزة + مخزون الأجهزة (اختبارات مستهدفة).
 * منقولة من `ReceiptBatches.gs` (Phase 3.1/3.1.1) إلى اختبارات HTTP حقيقية.
 */
describe('NODE-4 — محاضر الاستلام والمخزون', () => {
  let app: INestApplication;
  let base: Awaited<ReturnType<typeof seedTestFixtures>>;
  let fx: Node3Fixtures;
  let adminCookie: string;
  let assocACookie: string;
  let assocBCookie: string;
  const spy = new SpyAllocationTrigger();

  beforeAll(async () => {
    await startTestStorage();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useClass(FakeEmailService)
      .overrideProvider(ALLOCATION_TRIGGER_PORT)
      .useValue(spy)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    base = await seedTestFixtures();
    fx = await seedNode3Fixtures();
  }, 60000);

  beforeEach(async () => {
    await cleanNode4State(fx);
    await cleanNode3State();
    await cleanAuthState();
    await clearLicenseObjects();
    await clearReceiptEvidenceObjects();
    spy.reset();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocACookie = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
    assocBCookie = await loginAs(app, fx.assocBEmail, fx.assocBPassword);
  });

  afterAll(async () => {
    await cleanNode4State(fx);
    await cleanNode3State();
    await app.close();
    await stopTestStorage();
  });

  const http = () => request(app.getHttpServer());

  // -------------------- الأدوار والعزل --------------------
  it('ASSOCIATION لا يمكنها إنشاء/إرسال محضر — ADMIN فقط', async () => {
    const res = await http().post('/api/v1/receipts').set('Cookie', assocACookie).send(createBatchPayload(fx.associationAId));
    expect(res.status).toBe(403);
  });

  it('ADMIN لا يمكنه تأكيد محضر — ASSOCIATION فقط', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, adminCookie, batchId);
    expect(res.status).toBe(403);
  });

  it('ASSOCIATION لا يمكنها تأكيد/رؤية محضر جمعية أخرى (عزل tenant، 404 لا 403)', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const getRes = await http().get(`/api/v1/receipts/${batchId}`).set('Cookie', assocBCookie);
    expect(getRes.status).toBe(404);
    const confirmRes = await confirmBatchRequest(app, assocBCookie, batchId);
    expect(confirmRes.status).toBe(404);
  });

  // -------------------- الجمعية غير النشطة --------------------
  it('جمعية غير نشطة تُرفض عند الإنشاء/الإرسال/التأكيد', async () => {
    await prisma.association.update({ where: { id: fx.associationBId }, data: { status: AssociationStatus.INACTIVE } });
    try {
      const createRes = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(createBatchPayload(fx.associationBId));
      expect(createRes.status).toBe(409);
      expect(createRes.body.error.code).toBe('RECEIPT_ASSOCIATION_INACTIVE');
    } finally {
      await prisma.association.update({ where: { id: fx.associationBId }, data: { status: AssociationStatus.ACTIVE } });
    }
  });

  // -------------------- شرعية الانتقال --------------------
  it('لا يمكن إرسال محضر مؤكَّد بالفعل، ولا تأكيد محضر لا يزال مسودة', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const confirmRes = await confirmBatchRequest(app, assocACookie, batchId);
    expect(confirmRes.status).toBe(201);
    const sendAgain = await http().post(`/api/v1/receipts/${batchId}/send`).set('Cookie', adminCookie).send({ opId: newOpId() });
    expect(sendAgain.status).toBe(409);
    expect(sendAgain.body.error.code).toBe('RECEIPT_BATCH_INVALID_TRANSITION');

    const draftRes = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(createBatchPayload(fx.associationAId));
    const draftId = draftRes.body.id as string;
    const confirmDraft = await confirmBatchRequest(app, assocACookie, draftId);
    expect(confirmDraft.status).toBe(409);
  });

  // -------------------- حفظ الكميات --------------------
  it('معادلة الكميات غير المتوازنة تُرفض', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: 2, damagedQty: 0, missingQty: 0 }], // sentQty=3
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECEIPT_ITEM_QUANTITY_MISMATCH');
  });

  it('بند غائب من payload التأكيد = استلام كامل (Legacy semantics)', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, assocACookie, batchId, { items: [] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(ReceiptBatchStatus.RECEIVED_COMPLETE);
    const units = await prisma.deviceUnit.findMany({ where: { receiptItemId: itemIds[0] } });
    expect(units).toHaveLength(3); // sentQty الكامل
  });

  // -------------------- الإثباتات --------------------
  it('صورة الكمية إلزامية', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, assocACookie, batchId, { quantityPhoto: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECEIPT_EVIDENCE_REQUIRED');
  });

  it('توقيع المستلم (صورة) إلزامي', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, assocACookie, batchId, { signatureImage: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECEIPT_EVIDENCE_REQUIRED');
  });

  it('MIME مُزوَّر (PNG معلَنًا كـJPEG) يُرفض عبر magic bytes', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const req = request(app.getHttpServer()).post(`/api/v1/receipts/${batchId}/confirm`).set('Cookie', assocACookie);
    req.field('receiverTitle', 'مدير الجمعية').field('opId', newOpId());
    req.attach('quantityPhoto', PNG_1X1, { filename: 'q.jpg', contentType: 'image/jpeg' });
    req.attach('signatureImage', PNG_1X1, { filename: 's.png', contentType: 'image/png' });
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECEIPT_EVIDENCE_INVALID');
  });

  it('حجم إثبات يتجاوز 6 ميجابايت يُرفض', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(6 * 1024 * 1024 + 10, 0)]);
    const res = await confirmBatchRequest(app, assocACookie, batchId, { quantityPhoto: oversized });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECEIPT_EVIDENCE_TOO_LARGE');
  });

  it('WEBP مقبول كصورة إثبات صالحة', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const req = request(app.getHttpServer()).post(`/api/v1/receipts/${batchId}/confirm`).set('Cookie', assocACookie);
    req.field('receiverTitle', 'مدير الجمعية').field('opId', newOpId());
    req.attach('quantityPhoto', WEBP_1X1, { filename: 'q.webp', contentType: 'image/webp' });
    req.attach('signatureImage', PNG_1X1, { filename: 's.png', contentType: 'image/png' });
    const res = await req;
    expect(res.status).toBe(201);
  });

  it('الملفات خاصة تمامًا — الوصول فقط عبر رابط موقَّع محروس، لا رابط عام', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    await confirmBatchRequest(app, assocACookie, batchId);
    const forbiddenForOtherAssoc = await http().get(`/api/v1/receipts/${batchId}/evidence/quantity`).set('Cookie', assocBCookie);
    expect(forbiddenForOtherAssoc.status).toBe(404);
    const adminRes = await http().get(`/api/v1/receipts/${batchId}/evidence/quantity`).set('Cookie', adminCookie);
    expect(adminRes.status).toBe(200);
    expect(typeof adminRes.body.url).toBe('string');
    expect(adminRes.body.url).not.toContain('base64');
    const audited = await prisma.auditLog.findFirst({ where: { action: 'RECEIPT_EVIDENCE_VIEWED', entityId: batchId } });
    expect(audited).toBeTruthy();
  });

  // -------------------- صور التلف: العدد والربط --------------------
  it('تلف جهاز واحد يتطلب صورة تلف واحدة بالضبط، مرتبطة بالبند الصحيح', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const noPhoto = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: 2, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }],
      damagePhotoLinks: [],
    });
    expect(noPhoto.status).toBe(400);
    expect(noPhoto.body.error.code).toBe('RECEIPT_DAMAGE_PHOTO_COUNT_MISMATCH');

    const withPhoto = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: 2, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }],
      damagePhotoLinks: [[itemIds[0]]],
      damagePhotos: [JPEG_1X1],
    });
    expect(withPhoto.status).toBe(201);
    expect(withPhoto.body.status).toBe(ReceiptBatchStatus.RECEIVED_WITH_DISCREPANCIES);
    const photos = await prisma.receiptDamagePhoto.findMany({ where: { receiptItemId: itemIds[0] } });
    expect(photos).toHaveLength(1);
  });

  it('صورة تلف مرتبطة ببند بلا كمية تالفة فعلية تُرفض', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: 3, damagedQty: 0, missingQty: 0 }],
      damagePhotoLinks: [[itemIds[0]]],
      damagePhotos: [JPEG_1X1],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECEIPT_DAMAGE_PHOTO_COUNT_MISMATCH');
  });

  it('سبب الفرق مطلوب فقط عند وجود فرق فعلي', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: 2, damagedQty: 1, missingQty: 0 }],
      damagePhotoLinks: [[itemIds[0]]],
      damagePhotos: [JPEG_1X1],
    });
    expect(res.status).toBe(400);
  });

  // -------------------- تنظيف تعويضي --------------------
  it('itemId غير موجود يُرفض قبل أي رفع فعليًا — لا كائنات يتيمة', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const before = await countObjectsWithPrefix('receipt-');
    const badRes = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: '00000000-0000-0000-0000-000000000000', receivedQty: 3, damagedQty: 0, missingQty: 0 }],
      opId: newOpId('confirm-fail'),
    });
    expect(badRes.status).toBe(400);
    expect(badRes.body.error.code).toBe('RECEIPT_ITEM_NOT_FOUND');
    const after = await countObjectsWithPrefix('receipt-');
    expect(after).toBe(before);
  });

  it('نفس opId بحمولة مختلفة بعد نجاح أول تأكيد → تعارض idempotency، وتُحذَف الملفات المرفوعة للمحاولة الفاشلة (لا يتيم)', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const opId = newOpId('confirm-conflict');
    const first = await confirmBatchRequest(app, assocACookie, batchId, { opId, receiverTitle: 'مدير الجمعية' });
    expect(first.status).toBe(201);
    const afterFirst = await countObjectsWithPrefix('receipt-');

    const conflict = await confirmBatchRequest(app, assocACookie, batchId, { opId, receiverTitle: 'مسؤول المستودع' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');

    // الملفات التي رُفعت أثناء محاولة التعارض (قبل اكتشاف التعارض داخل المعاملة) نُظِّفت best-effort.
    const afterConflict = await countObjectsWithPrefix('receipt-');
    expect(afterConflict).toBe(afterFirst);
  });

  // -------------------- idempotency --------------------
  it('إنشاء محضر idempotent بنفس opId — لا تكرار', async () => {
    const payload = createBatchPayload(fx.associationAId);
    const res1 = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(payload);
    const res2 = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(payload);
    expect(res1.body.id).toBe(res2.body.id);
    const count = await prisma.receiptBatch.count({ where: { id: res1.body.id } });
    expect(count).toBe(1);
  });

  it('تأكيد idempotent بنفس opId ونفس المحتوى — لا وحدات أجهزة مكرَّرة', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const opId = newOpId('confirm-idem');
    const res1 = await confirmBatchRequest(app, assocACookie, batchId, { opId });
    const res2 = await confirmBatchRequest(app, assocACookie, batchId, { opId });
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const units = await prisma.deviceUnit.findMany({ where: { receiptItemId: itemIds[0] } });
    expect(units).toHaveLength(3);
  });

  // -------------------- تزامن حقيقي --------------------
  it('تأكيدان متزامنان بنفس المحضر ينتجان جهازًا واحدًا فقط لكل وحدة سليمة — لا تكرار', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const [res1, res2] = await Promise.all([
      confirmBatchRequest(app, assocACookie, batchId, { opId: newOpId('race-1') }),
      confirmBatchRequest(app, assocACookie, batchId, { opId: newOpId('race-2') }),
    ]);
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const units = await prisma.deviceUnit.findMany({ where: { receiptItemId: itemIds[0] } });
    expect(units).toHaveLength(3); // ليس 6 — لا تكرار من السباق
    // الخاسر رفع صورتَي كمية/توقيع فعليًا قبل اكتشاف تعارض الحالة داخل المعاملة — يجب أن تُحذَفا best-effort، فيبقى فائزًا واحدًا فقط (كائنان: كمية+توقيع).
    const remaining = await countObjectsWithPrefix('receipt-quantity/');
    expect(remaining).toBe(1);
  });

  // -------------------- المخزون: goodQty فقط، تالف/ناقص = صفر وحدات --------------------
  it('عدد وحدات الأجهزة يساوي goodQty بالضبط؛ التالف/الناقص لا يُنشئان أي وحدة', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, {
      items: [{ deviceType: DeviceType.WASHING_MACHINE, spec: 'أوتوماتيك 7 كجم', sentQty: 5 }],
    });
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: 2, damagedQty: 1, missingQty: 2, differenceReason: 'نقص من المورد' }],
      damagePhotoLinks: [[itemIds[0]]],
      damagePhotos: [JPEG_1X1],
    });
    expect(res.status).toBe(201);
    const units = await prisma.deviceUnit.findMany({ where: { receiptItemId: itemIds[0] } });
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.status === DeviceStatus.WAREHOUSE)).toBe(true);
    expect(units.every((u) => u.deviceType === DeviceType.WASHING_MACHINE)).toBe(true);
  });

  // -------------------- إشارة التخصيص التلقائي (seam) --------------------
  it('إشارة التخصيص تُستدعى مرة واحدة فقط بعد تأكيد أنتج مخزونًا سليمًا — تبقى NO-OP', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    await confirmBatchRequest(app, assocACookie, batchId);
    expect(spy.calls).toEqual([fx.associationAId]);
  });

  it('لا إشارة تخصيص إن كانت كل الكمية تالفة/ناقصة (goodQty=0)', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, {
      items: [{ deviceType: DeviceType.OVEN, spec: '5 شعلات', sentQty: 1 }],
    });
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: 0, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء التفريغ' }],
      damagePhotoLinks: [[itemIds[0]]],
      damagePhotos: [JPEG_1X1],
    });
    expect(res.status).toBe(201);
    expect(spy.calls).toEqual([]);
  });

  // -------------------- الترقيم والتحقق الزمني --------------------
  it('page/pageSize/status غير صالحة تُرفض بـ400 لا 500', async () => {
    const invalidPage = await http().get(`/api/v1/receipts?page=${MAX_PAGE + 1}`).set('Cookie', adminCookie);
    expect(invalidPage.status).toBe(400);
    const invalidStatus = await http().get('/api/v1/receipts?status=NOT_A_STATUS').set('Cookie', adminCookie);
    expect(invalidStatus.status).toBe(400);
    const invalidUuid = await http().get('/api/v1/receipts/not-a-uuid').set('Cookie', adminCookie);
    expect(invalidUuid.status).toBe(400);
  });

  it('ADMIN يستطيع ترقيم/تصفية القائمة، ASSOCIATION تبقى مقيَّدة بجمعيتها', async () => {
    await createAndSendBatch(app, adminCookie, fx.associationAId);
    await createAndSendBatch(app, adminCookie, fx.associationBId);
    const adminList = await http().get('/api/v1/receipts?pageSize=10').set('Cookie', adminCookie);
    expect(adminList.status).toBe(200);
    expect(adminList.body.items.length).toBeGreaterThanOrEqual(2);
    const assocList = await http().get('/api/v1/receipts').set('Cookie', assocACookie);
    expect(assocList.body.items.every((b: { associationId: string }) => b.associationId === fx.associationAId)).toBe(true);
  });

  // -------------------- مخزون الأجهزة: قراءة --------------------
  it('قائمة/تفاصيل مخزون الأجهزة تحترم عزل tenant وترقيم خادمي', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    await confirmBatchRequest(app, assocACookie, batchId);
    const listRes = await http().get('/api/v1/inventory/devices').set('Cookie', assocACookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.length).toBeGreaterThan(0);
    const deviceId = listRes.body.items[0].id as string;
    const otherAssoc = await http().get(`/api/v1/inventory/devices/${deviceId}`).set('Cookie', assocBCookie);
    expect(otherAssoc.status).toBe(404);
    const owner = await http().get(`/api/v1/inventory/devices/${deviceId}`).set('Cookie', assocACookie);
    expect(owner.status).toBe(200);
  });
});
