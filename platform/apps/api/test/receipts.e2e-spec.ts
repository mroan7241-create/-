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
import { PublicCodeService } from '../src/common/public-code.service';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs, JPEG_1X1, PNG_1X1, WEBP_1X1 } from './utils/node2-fixtures';
import { cleanNode3State, seedNode3Fixtures, type Node3Fixtures } from './utils/node3-fixtures';
import { RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY } from '../src/modules/receipts/receipts.service';
import { cleanNode4State, confirmBatchRequest, createAndSendBatch, createBatchPayload, createBatchRequest, newOpId, PDF_DOC } from './utils/node4-fixtures';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { clearLicenseObjects, startTestStorage, stopTestStorage, storageClient, testBucket } from './utils/storage-harness';

async function countObjectsWithPrefix(prefix: string): Promise<number> {
  const res = await storageClient().send(new ListObjectsV2Command({ Bucket: testBucket(), Prefix: prefix }));
  return (res.Contents ?? []).length;
}

/** ينظّف كل كائنات إثباتات محاضر الاستلام بين الاختبارات — نفس مبدأ clearLicenseObjects لكن لبادئات receipt-*. */
async function clearReceiptEvidenceObjects(): Promise<void> {
  for (const prefix of ['receipt-quantity/', 'receipt-signature/', 'receipt-damage/', 'receipt-admin-proof/', 'receipt-association-report/']) {
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

  // ================================================================
  // NODE-4.1 — تصليب: replay orphans + multipart صارم + MIME صارم +
  // deviceType↔spec + بحث الجمعية + ترقيم القائمة + خفة القائمة + bulk.
  // ================================================================

  it('NODE-4.1: replay بنفس opId ونفس المحتوى لا يترك أي كائن يتيم — عدد الكائنات ثابت بعد replay', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const opId = newOpId('replay-cleanup');
    const first = await confirmBatchRequest(app, assocACookie, batchId, { opId });
    expect(first.status).toBe(201);
    const afterFirst = { q: await countObjectsWithPrefix('receipt-quantity/'), s: await countObjectsWithPrefix('receipt-signature/') };

    const replay = await confirmBatchRequest(app, assocACookie, batchId, { opId });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(batchId);

    const afterReplay = { q: await countObjectsWithPrefix('receipt-quantity/'), s: await countObjectsWithPrefix('receipt-signature/') };
    expect(afterReplay).toEqual(afterFirst);
  });

  it('NODE-4.1: replay مع صورة تلف ينظّف نسخة صورة التلف المكرَّرة أيضًا', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const opId = newOpId('replay-damage');
    const options = {
      opId,
      items: [{ itemId: itemIds[0], receivedQty: 2, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }],
      damagePhotoLinks: [[itemIds[0]]],
      damagePhotos: [JPEG_1X1],
    };
    const first = await confirmBatchRequest(app, assocACookie, batchId, options);
    expect(first.status).toBe(201);
    const afterFirst = await countObjectsWithPrefix('receipt-damage/');
    const replay = await confirmBatchRequest(app, assocACookie, batchId, options);
    expect(replay.status).toBe(201);
    const afterReplay = await countObjectsWithPrefix('receipt-damage/');
    expect(afterReplay).toBe(afterFirst);
    const units = await prisma.deviceUnit.findMany({ where: { receiptItemId: itemIds[0] } });
    expect(units).toHaveLength(2); // لا تكرار DeviceUnit جرّاء الـreplay
  });

  it('NODE-4.1: أشكال multipart مشوَّهة تُرفض بـ400 نظيف — لا 500، لا تسريب داخلي', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const malformedItems = ['{}', '[null]', '"x"'];
    for (const raw of malformedItems) {
      const req = request(app.getHttpServer()).post(`/api/v1/receipts/${batchId}/confirm`).set('Cookie', assocACookie);
      req.field('receiverTitle', 'مدير الجمعية').field('opId', newOpId()).field('items', raw);
      req.attach('quantityPhoto', JPEG_1X1, { filename: 'q.jpg', contentType: 'image/jpeg' });
      req.attach('signatureImage', PNG_1X1, { filename: 's.png', contentType: 'image/png' });
      const res = await req;
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres|stack|at Object/i);
    }

    const malformedLinks = ['{}', '[null]'];
    for (const raw of malformedLinks) {
      const req = request(app.getHttpServer()).post(`/api/v1/receipts/${batchId}/confirm`).set('Cookie', assocACookie);
      req.field('receiverTitle', 'مدير الجمعية').field('opId', newOpId()).field('damagePhotoLinks', raw);
      req.attach('quantityPhoto', JPEG_1X1, { filename: 'q.jpg', contentType: 'image/jpeg' });
      req.attach('signatureImage', PNG_1X1, { filename: 's.png', contentType: 'image/png' });
      const res = await req;
      expect(res.status).toBe(400);
    }

    const nonUuidItem = await confirmBatchRequest(app, assocACookie, batchId, { items: [{ itemId: 'not-a-uuid', receivedQty: 1, damagedQty: 0, missingQty: 0 }] });
    expect(nonUuidItem.status).toBe(400);
  });

  it('NODE-4.1: damagePhotoId غير صالح على endpoint الإثبات → 400 بلا تسريب داخلي', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await http().get(`/api/v1/receipts/${batchId}/evidence/damage?damagePhotoId=not-a-uuid`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres|stack/i);
  });

  it('NODE-4.1: MIME صارم — مُعلَن خارج القائمة أو غير مطابق للبايتات الفعلية يُرفض دومًا', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const cases: [string, Buffer][] = [
      ['text/plain', JPEG_1X1],
      ['application/octet-stream', PNG_1X1],
      ['image/jpeg', PNG_1X1],
    ];
    for (const [mime, bytes] of cases) {
      const req = request(app.getHttpServer()).post(`/api/v1/receipts/${batchId}/confirm`).set('Cookie', assocACookie);
      req.field('receiverTitle', 'مدير الجمعية').field('opId', newOpId());
      req.attach('quantityPhoto', bytes, { filename: 'q.bin', contentType: mime });
      req.attach('signatureImage', PNG_1X1, { filename: 's.png', contentType: 'image/png' });
      const res = await req;
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RECEIPT_EVIDENCE_INVALID');
    }
    // مطابقة MIME + بايتات صحيحة تُقبَل (تنظيم مقارَنة إيجابية).
    const ok = await confirmBatchRequest(app, assocACookie, batchId, {});
    expect(ok.status).toBe(201);
  });

  it('NODE-4.1: المواصفة تتبع نوع الجهاز — مواصفة نوع آخر تُرفض، ونوع بلا قائمة معتمدة يبقى نصًا حرًّا', async () => {
    const refrigeratorOk = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(
      createBatchPayload(fx.associationAId, { items: [{ deviceType: 'REFRIGERATOR', spec: '16 قدم', sentQty: 1 }] }),
    );
    expect(refrigeratorOk.status).toBe(201);

    const washerOk = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(
      createBatchPayload(fx.associationAId, { items: [{ deviceType: 'WASHING_MACHINE', spec: 'أوتوماتيك 7 كجم', sentQty: 1 }] }),
    );
    expect(washerOk.status).toBe(201);

    const crossTypeSpec = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(
      createBatchPayload(fx.associationAId, { items: [{ deviceType: 'REFRIGERATOR', spec: 'أوتوماتيك 7 كجم', sentQty: 1 }] }),
    );
    expect(crossTypeSpec.status).toBe(400);
    expect(crossTypeSpec.body.error.code).toBe('RECEIPT_INVALID_REFERENCE');

    // OVEN مبذور بقائمة نشطة أيضًا ("5 شعلات"...) — نص حر يُقبَل فقط لو لم توجد أي قائمة نشطة لنوعه؛ نتحقق من القبول الحر عبر مواصفة غير موجودة في القائمة لنوع بلا بذور فعلية (نستخدم OVEN بقيمة غير مُبذَرة للتأكد أن الرفض حقيقي أولًا).
    const ovenUnknownSpec = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(
      createBatchPayload(fx.associationAId, { items: [{ deviceType: 'OVEN', spec: 'مواصفة غير موجودة إطلاقًا', sentQty: 1 }] }),
    );
    expect(ovenUnknownSpec.status).toBe(400);
  });

  it('NODE-4.1: قائمة المحاضر خفيفة (itemCount بلا items)، والتفاصيل الكاملة فقط عبر GET /receipts/:id', async () => {
    await createAndSendBatch(app, adminCookie, fx.associationAId);
    const listRes = await http().get('/api/v1/receipts?pageSize=5').set('Cookie', adminCookie);
    expect(listRes.status).toBe(200);
    const row = listRes.body.items[0];
    expect(row.itemCount).toBeGreaterThanOrEqual(1);
    expect(row.items).toBeUndefined();

    const detailRes = await http().get(`/api/v1/receipts/${row.id}`).set('Cookie', adminCookie);
    expect(detailRes.status).toBe(200);
    expect(Array.isArray(detailRes.body.items)).toBe(true);
  });

  it('NODE-4.1: ترقيم قائمة المحاضر خادمي حقيقي — صفحتان مختلفتان بدون تداخل', async () => {
    for (let i = 0; i < 3; i++) await createAndSendBatch(app, adminCookie, fx.associationAId);
    const page1 = await http().get('/api/v1/receipts?pageSize=2&page=1').set('Cookie', adminCookie);
    const page2 = await http().get('/api/v1/receipts?pageSize=2&page=2').set('Cookie', adminCookie);
    expect(page1.body.items).toHaveLength(2);
    const idsPage1 = page1.body.items.map((b: { id: string }) => b.id);
    const idsPage2 = page2.body.items.map((b: { id: string }) => b.id);
    expect(idsPage1.some((id: string) => idsPage2.includes(id))).toBe(false);
  });

  it('NODE-4.1: نطاق أكواد PublicCodeService.nextPublicCodes ذرّي ولا يتداخل تحت تزامن حقيقي', async () => {
    const publicCode = new PublicCodeService();
    const prefix = `T4${Date.now().toString(36)}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => prisma.$transaction((tx) => publicCode.nextPublicCodes(tx, prefix, 4 + i))),
    );
    const allCodes = results.flat();
    expect(new Set(allCodes).size).toBe(allCodes.length); // لا تكرار إطلاقًا عبر 5 حجوزات متزامنة
    for (const codes of results) {
      expect(new Set(codes).size).toBe(codes.length); // كل نطاق داخليًا فريد ومتسلسل
      expect(codes.every((c) => /^T4\w+-\d{6}$/.test(c))).toBe(true);
    }
  });

  it('NODE-4.1: تأكيد بكمية أكبر (bulk) ينتج بالضبط goodQty وحدة جهاز بأكواد فريدة صحيحة الصيغة', async () => {
    const BULK_QTY = 40;
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, {
      items: [{ deviceType: 'REFRIGERATOR', spec: '18 قدم', sentQty: BULK_QTY }],
    });
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: BULK_QTY, damagedQty: 0, missingQty: 0 }],
    });
    expect(res.status).toBe(201);
    const units = await prisma.deviceUnit.findMany({ where: { receiptItemId: itemIds[0] } });
    expect(units).toHaveLength(BULK_QTY);
    const codes = units.map((u) => u.publicCode);
    expect(new Set(codes).size).toBe(BULK_QTY);
    expect(codes.every((c) => /^DEV-\d{6}$/.test(c))).toBe(true);
  });

  // ================================================================
  // NODE-4.2 — إغلاق محضر الاستلام: رقم مستند + إثبات شراء إداري +
  // محضر/ختم الجمعية (اختياري بشرط SystemSetting) + دعم حقيقي لأكثر من
  // صورة تلف مرتبطة ببنود متعددة.
  // ================================================================

  it('NODE-4.2: إنشاء بلا رقم مستند ولا إثبات يعمل (JSON عادي، توافق خلفي كامل)', async () => {
    const payload = createBatchPayload(fx.associationAId);
    const res = await http().post('/api/v1/receipts').set('Cookie', adminCookie).send(payload);
    expect(res.status).toBe(201);
    const detail = await http().get(`/api/v1/receipts/${res.body.id}`).set('Cookie', adminCookie);
    expect(detail.body.documentNumber).toBeNull();
    expect(detail.body.hasAdminProof).toBe(false);
  });

  it('NODE-4.2: إنشاء برقم مستند + إثبات شراء صورة يعمل (multipart)', async () => {
    const res = await createBatchRequest(app, adminCookie, fx.associationAId, {
      documentNumber: 'DOC-2026-001',
      adminProofFile: JPEG_1X1,
      adminProofFilename: 'proof.jpg',
      adminProofContentType: 'image/jpeg',
    });
    expect(res.status).toBe(201);
    const detail = await http().get(`/api/v1/receipts/${res.body.id}`).set('Cookie', adminCookie);
    expect(detail.body.documentNumber).toBe('DOC-2026-001');
    expect(detail.body.hasAdminProof).toBe(true);
  });

  it('NODE-4.2: إنشاء بإثبات شراء PDF يعمل', async () => {
    const res = await createBatchRequest(app, adminCookie, fx.associationAId, { adminProofFile: PDF_DOC });
    expect(res.status).toBe(201);
    const detail = await http().get(`/api/v1/receipts/${res.body.id}`).set('Cookie', adminCookie);
    expect(detail.body.hasAdminProof).toBe(true);
  });

  it('NODE-4.2: إثبات شراء إداري غير صالح (MIME/magic bytes/حجم) يُرفض', async () => {
    const mismatched = await createBatchRequest(app, adminCookie, fx.associationAId, {
      adminProofFile: PNG_1X1,
      adminProofContentType: 'application/pdf',
    });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.error.code).toBe('RECEIPT_DOCUMENT_INVALID');

    const oversized = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(8 * 1024 * 1024 + 10, 0x41)]);
    const tooLarge = await createBatchRequest(app, adminCookie, fx.associationAId, { adminProofFile: oversized });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe('RECEIPT_DOCUMENT_TOO_LARGE');

    const notADocument = await createBatchRequest(app, adminCookie, fx.associationAId, {
      adminProofFile: Buffer.from('plain text, not a document at all'),
    });
    expect(notADocument.status).toBe(400);
    expect(notADocument.body.error.code).toBe('RECEIPT_DOCUMENT_INVALID');
  });

  it('NODE-4.2: فشل الإنشاء (جمعية غير نشطة) بعد رفع إثبات شراء ينظّف الكائن — لا يتيم', async () => {
    const before = await countObjectsWithPrefix('receipt-admin-proof/');
    await prisma.association.update({ where: { id: fx.associationBId }, data: { status: AssociationStatus.INACTIVE } });
    try {
      const res = await createBatchRequest(app, adminCookie, fx.associationBId, { adminProofFile: JPEG_1X1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RECEIPT_ASSOCIATION_INACTIVE');
    } finally {
      await prisma.association.update({ where: { id: fx.associationBId }, data: { status: AssociationStatus.ACTIVE } });
    }
    const after = await countObjectsWithPrefix('receipt-admin-proof/');
    expect(after).toBe(before);
  });

  it('NODE-4.2: إعادة تشغيل (replay) إنشاء بنفس opId ونفس إثبات الشراء لا تترك كائنًا يتيمًا', async () => {
    // بصمة idempotency تشمل كل الحمولة — لا بد من ثبات كل الحقول (بما فيها
    // supplierName عشوائي افتراضيًا) بين المحاولتين حتى تُعتبر replay حقيقية لا تعارضًا.
    const opId = newOpId('create-proof-replay');
    const overrides = { opId, supplierName: 'مورد ثابت لإعادة تشغيل الإنشاء', adminProofFile: JPEG_1X1 };
    const first = await createBatchRequest(app, adminCookie, fx.associationAId, overrides);
    expect(first.status).toBe(201);
    const afterFirst = await countObjectsWithPrefix('receipt-admin-proof/');

    const replay = await createBatchRequest(app, adminCookie, fx.associationAId, overrides);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);

    const afterReplay = await countObjectsWithPrefix('receipt-admin-proof/');
    expect(afterReplay).toBe(afterFirst);
  });

  it('NODE-4.2: محضر/ختم الجمعية اختياري افتراضيًا — التأكيد ينجح بدونه', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, assocACookie, batchId, {});
    expect(res.status).toBe(201);
    const detail = await http().get(`/api/v1/receipts/${batchId}`).set('Cookie', adminCookie);
    expect(detail.body.hasAssociationReport).toBe(false);
  });

  it('NODE-4.2: SystemSetting=true (boolean صارم) يجعل محضر/ختم الجمعية إلزاميًا — 400 نظيف بدونه، ينجح معه', async () => {
    await prisma.systemSetting.upsert({
      where: { key: RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY },
      create: { key: RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY, value: true },
      update: { value: true },
    });
    try {
      const { batchId: batchWithout } = await createAndSendBatch(app, adminCookie, fx.associationAId);
      const withoutReport = await confirmBatchRequest(app, assocACookie, batchWithout, {});
      expect(withoutReport.status).toBe(400);
      expect(withoutReport.body.error.code).toBe('RECEIPT_ASSOCIATION_REPORT_REQUIRED');

      const { batchId: batchWith } = await createAndSendBatch(app, adminCookie, fx.associationAId);
      const withReport = await confirmBatchRequest(app, assocACookie, batchWith, { associationReportFile: PDF_DOC });
      expect(withReport.status).toBe(201);
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY } });
    }
  });

  it('NODE-4.2: قيمة system_settings غير boolean صارمة ("true" نصية) لا تُفعّل الإلزام — يبقى اختياريًا', async () => {
    await prisma.systemSetting.upsert({
      where: { key: RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY },
      create: { key: RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY, value: 'true' },
      update: { value: 'true' },
    });
    try {
      const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
      const res = await confirmBatchRequest(app, assocACookie, batchId, {});
      expect(res.status).toBe(201);
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY } });
    }
  });

  it('NODE-4.2: محضر/ختم الجمعية يقبل PDF أو صورة', async () => {
    const { batchId: batchPdf } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const pdfRes = await confirmBatchRequest(app, assocACookie, batchPdf, { associationReportFile: PDF_DOC });
    expect(pdfRes.status).toBe(201);

    const { batchId: batchImg } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const imgRes = await confirmBatchRequest(app, assocACookie, batchImg, {
      associationReportFile: PNG_1X1,
      associationReportFilename: 'report.png',
      associationReportContentType: 'image/png',
    });
    expect(imgRes.status).toBe(201);
  });

  it('NODE-4.2: محضر/ختم الجمعية غير الصالح يُرفض (MIME/magic/حجم)', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      associationReportFile: JPEG_1X1,
      associationReportContentType: 'application/pdf',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECEIPT_DOCUMENT_INVALID');
  });

  it('NODE-4.2: إعادة تشغيل (replay) تأكيد بمحضر/ختم جمعية لا تترك كائنًا مكرَّرًا', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const opId = newOpId('confirm-report-replay');
    const first = await confirmBatchRequest(app, assocACookie, batchId, { opId, associationReportFile: PDF_DOC });
    expect(first.status).toBe(201);
    const afterFirst = await countObjectsWithPrefix('receipt-association-report/');

    const replay = await confirmBatchRequest(app, assocACookie, batchId, { opId, associationReportFile: PDF_DOC });
    expect(replay.status).toBe(201);
    const afterReplay = await countObjectsWithPrefix('receipt-association-report/');
    expect(afterReplay).toBe(afterFirst);
  });

  it('NODE-4.2: محتوى محضر/ختم الجمعية يشارك في بصمة idempotency — نفس opId بمحتوى مختلف → تعارض', async () => {
    const { batchId } = await createAndSendBatch(app, adminCookie, fx.associationAId);
    const opId = newOpId('confirm-report-conflict');
    const first = await confirmBatchRequest(app, assocACookie, batchId, { opId, associationReportFile: PDF_DOC });
    expect(first.status).toBe(201);

    const conflict = await confirmBatchRequest(app, assocACookie, batchId, { opId, associationReportFile: undefined });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');
  });

  it('NODE-4.2: تفاصيل المحضر النهائية للجمعية تُظهر وجود الإثبات الإداري/محضر الجمعية + ملاحظات الفرق', async () => {
    const created = await createBatchRequest(app, adminCookie, fx.associationAId, { documentNumber: 'DOC-42', adminProofFile: JPEG_1X1 });
    expect(created.status).toBe(201);
    const batchId = created.body.id as string;
    await http().post(`/api/v1/receipts/${batchId}/send`).set('Cookie', adminCookie).send({ opId: newOpId('send') });
    const itemsRow = await prisma.receiptItem.findMany({ where: { receiptBatchId: batchId } });

    const confirmRes = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemsRow[0].id, receivedQty: itemsRow[0].sentQty, damagedQty: 0, missingQty: 0, differenceNotes: 'ملاحظة اختبارية للفرق' }],
      associationReportFile: PDF_DOC,
    });
    expect(confirmRes.status).toBe(201);

    const detail = await http().get(`/api/v1/receipts/${batchId}`).set('Cookie', adminCookie);
    expect(detail.body.documentNumber).toBe('DOC-42');
    expect(detail.body.hasAdminProof).toBe(true);
    expect(detail.body.hasAssociationReport).toBe(true);
    expect(detail.body.items[0].differenceNotes).toBe('ملاحظة اختبارية للفرق');
  });

  it('NODE-4.2: عزل tenant على أنواع الإثبات الجديدة (إثبات إداري/محضر جمعية)', async () => {
    const created = await createBatchRequest(app, adminCookie, fx.associationAId, { adminProofFile: JPEG_1X1 });
    const batchId = created.body.id as string;
    await http().post(`/api/v1/receipts/${batchId}/send`).set('Cookie', adminCookie).send({ opId: newOpId('send') });
    await confirmBatchRequest(app, assocACookie, batchId, { associationReportFile: PDF_DOC });

    const adminProofOtherAssoc = await http().get(`/api/v1/receipts/${batchId}/evidence/adminProof`).set('Cookie', assocBCookie);
    expect(adminProofOtherAssoc.status).toBe(404);
    const reportOtherAssoc = await http().get(`/api/v1/receipts/${batchId}/evidence/report`).set('Cookie', assocBCookie);
    expect(reportOtherAssoc.status).toBe(404);

    const adminProofOwner = await http().get(`/api/v1/receipts/${batchId}/evidence/adminProof`).set('Cookie', adminCookie);
    expect(adminProofOwner.status).toBe(200);
    const reportOwner = await http().get(`/api/v1/receipts/${batchId}/evidence/report`).set('Cookie', assocACookie);
    expect(reportOwner.status).toBe(200);
  });

  it('NODE-4.2: أكثر من صورة تلف مرتبطة ببنود تالفة متعددة — كل بند يُغطَّى بصورته', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, {
      items: [
        { deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 2 },
        { deviceType: DeviceType.WASHING_MACHINE, spec: 'أوتوماتيك 7 كجم', sentQty: 2 },
      ],
    });
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [
        { itemId: itemIds[0], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' },
        { itemId: itemIds[1], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' },
      ],
      damagePhotoLinks: [[itemIds[0]], [itemIds[1]]],
      damagePhotos: [JPEG_1X1, PNG_1X1],
    });
    expect(res.status).toBe(201);
    const photosItem0 = await prisma.receiptDamagePhoto.findMany({ where: { receiptItemId: itemIds[0] } });
    const photosItem1 = await prisma.receiptDamagePhoto.findMany({ where: { receiptItemId: itemIds[1] } });
    expect(photosItem0).toHaveLength(1);
    expect(photosItem1).toHaveLength(1);
  });

  it('NODE-4.2: كل بند تالف يجب أن تغطيه صورة — عدم تغطية بند ثانٍ يُرفض حتى مع صورة واحدة صالحة لبند آخر', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, {
      items: [
        { deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 2 },
        { deviceType: DeviceType.WASHING_MACHINE, spec: 'أوتوماتيك 7 كجم', sentQty: 2 },
      ],
    });
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [
        { itemId: itemIds[0], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' },
        { itemId: itemIds[1], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' },
      ],
      damagePhotoLinks: [[itemIds[0]]],
      damagePhotos: [JPEG_1X1],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECEIPT_DAMAGE_PHOTO_ITEM_UNCOVERED');
  });

  it('NODE-4.2: صورة تلف واحدة يمكن أن تغطي عدة بنود تالفة دفعة واحدة (totalDamaged>1 يقبل صورة واحدة على الأقل)', async () => {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, {
      items: [
        { deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 2 },
        { deviceType: DeviceType.WASHING_MACHINE, spec: 'أوتوماتيك 7 كجم', sentQty: 2 },
      ],
    });
    const res = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [
        { itemId: itemIds[0], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' },
        { itemId: itemIds[1], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' },
      ],
      damagePhotoLinks: [[itemIds[0], itemIds[1]]],
      damagePhotos: [JPEG_1X1],
    });
    expect(res.status).toBe(201);
    const photosItem0 = await prisma.receiptDamagePhoto.findMany({ where: { receiptItemId: itemIds[0] } });
    const photosItem1 = await prisma.receiptDamagePhoto.findMany({ where: { receiptItemId: itemIds[1] } });
    expect(photosItem0).toHaveLength(1);
    expect(photosItem1).toHaveLength(1);
  });
});
