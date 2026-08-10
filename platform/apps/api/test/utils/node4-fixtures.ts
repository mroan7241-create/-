import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { prisma, DeviceType } from '@alzad/db';
import { RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY } from '../../src/modules/receipts/receipts.service';
import { uniqueSuffix } from './node2-fixtures';
import { JPEG_1X1, PNG_1X1 } from './node2-fixtures';
import type { Node3Fixtures } from './node3-fixtures';

/** أدوات اختبار NODE-4 فقط — ملف مستقل عمدًا، بنفس مبدأ node3-fixtures.ts. */
export function newOpId(prefix = 'op4'): string {
  return `${prefix}-${uniqueSuffix()}`;
}

/** ينظّف كل ما تُنشئه اختبارات NODE-4 لجمعيتَي NODE-3 المشتركتين، بلا مساس ببذور seed. */
export async function cleanNode4State(fx: Node3Fixtures): Promise<void> {
  const associationIds = [fx.associationAId, fx.associationBId];
  await prisma.deviceUnit.deleteMany({ where: { associationId: { in: associationIds } } });
  const batches = await prisma.receiptBatch.findMany({ where: { associationId: { in: associationIds } }, select: { id: true } });
  const batchIds = batches.map((b) => b.id);
  if (batchIds.length > 0) {
    const items = await prisma.receiptItem.findMany({ where: { receiptBatchId: { in: batchIds } }, select: { id: true } });
    const itemIds = items.map((i) => i.id);
    if (itemIds.length > 0) await prisma.receiptDamagePhoto.deleteMany({ where: { receiptItemId: { in: itemIds } } });
    await prisma.receiptItem.deleteMany({ where: { receiptBatchId: { in: batchIds } } });
    await prisma.receiptBatch.deleteMany({ where: { id: { in: batchIds } } });
  }
  await prisma.idempotencyKey.deleteMany({});
  await prisma.auditLog.deleteMany({});
  // NODE-4.2 — مفتاح إلزامية محضر/ختم الجمعية لا يجب أن يتسرَّب بين الاختبارات.
  await prisma.systemSetting.deleteMany({ where: { key: RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY } });
}

/** NODE-4.2 — نموذج PDF أدنى (magic bytes `%PDF-` فعلية) لاختبار إثبات الشراء الإداري ومحضر/ختم الجمعية. */
export const PDF_DOC = Buffer.from('%PDF-1.7\n%NODE-4.2 test fixture\n', 'utf8');

export interface CreateBatchOverrides {
  associationId?: string;
  supplierName?: string;
  sentDate?: string;
  notes?: string;
  items?: { deviceType: DeviceType; spec: string; sentQty: number }[];
  opId?: string;
}

export function createBatchPayload(associationId: string, overrides: CreateBatchOverrides = {}) {
  return {
    associationId,
    supplierName: `مورد ${uniqueSuffix()}`,
    sentDate: '2026-01-15',
    notes: 'دفعة اختبار',
    items: [{ deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 3 }],
    opId: newOpId('create-batch'),
    ...overrides,
  };
}

interface CreateBatchWithProofOptions extends CreateBatchOverrides {
  documentNumber?: string;
  adminProofFile?: Buffer | null;
  adminProofFilename?: string;
  adminProofContentType?: string;
}

/**
 * NODE-4.2 — نفس `POST /receipts` لكن عبر multipart/form-data (رقم مستند
 * + إثبات شراء إداري اختياريان). `createBatchPayload`/`createAndSendBatch`
 * أعلاه تبقيان JSON بحتًا بلا أي تعديل — endpoint الإنشاء أصبح
 * multipart-capable لكن يقبل JSON عاديًا أيضًا (توافق خلفي كامل).
 */
export function createBatchRequest(
  app: INestApplication,
  adminCookie: string,
  associationId: string,
  options: CreateBatchWithProofOptions = {},
) {
  const payload = createBatchPayload(associationId, options);
  const req = request(app.getHttpServer()).post('/api/v1/receipts').set('Cookie', adminCookie);
  req.field('associationId', payload.associationId);
  req.field('supplierName', payload.supplierName);
  req.field('sentDate', payload.sentDate);
  if (payload.notes) req.field('notes', payload.notes);
  if (options.documentNumber !== undefined) req.field('documentNumber', options.documentNumber);
  req.field('items', JSON.stringify(payload.items));
  req.field('opId', payload.opId);
  if (options.adminProofFile) {
    req.attach('adminProofFile', options.adminProofFile, {
      filename: options.adminProofFilename ?? 'proof.pdf',
      contentType: options.adminProofContentType ?? 'application/pdf',
    });
  }
  return req;
}

export async function createAndSendBatch(
  app: INestApplication,
  adminCookie: string,
  associationId: string,
  overrides: CreateBatchOverrides = {},
): Promise<{ batchId: string; itemIds: string[] }> {
  const payload = createBatchPayload(associationId, overrides);
  const createRes = await request(app.getHttpServer()).post('/api/v1/receipts').set('Cookie', adminCookie).send(payload);
  if (createRes.status !== 201 && createRes.status !== 200) {
    throw new Error(`createBatch failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  }
  const batchId = createRes.body.id as string;
  const sendRes = await request(app.getHttpServer())
    .post(`/api/v1/receipts/${batchId}/send`)
    .set('Cookie', adminCookie)
    .send({ opId: newOpId('send') });
  if (sendRes.status !== 201 && sendRes.status !== 200) {
    throw new Error(`sendBatch failed: ${sendRes.status} ${JSON.stringify(sendRes.body)}`);
  }
  const items = await prisma.receiptItem.findMany({ where: { receiptBatchId: batchId }, orderBy: { createdAt: 'asc' } });
  return { batchId, itemIds: items.map((i) => i.id) };
}

interface ConfirmOptions {
  receiverTitle?: string;
  items?: { itemId: string; receivedQty: number; damagedQty: number; missingQty: number; differenceReason?: string; differenceNotes?: string }[];
  damagePhotoLinks?: string[][];
  opId?: string;
  quantityPhoto?: Buffer | null;
  signatureImage?: Buffer | null;
  damagePhotos?: Buffer[];
  /** NODE-4.2 — محضر/ختم الجمعية (PDF/صورة، اختياري افتراضيًا). */
  associationReportFile?: Buffer | null;
  associationReportFilename?: string;
  associationReportContentType?: string;
}

export function confirmBatchRequest(app: INestApplication, cookie: string, batchId: string, options: ConfirmOptions = {}) {
  const req = request(app.getHttpServer()).post(`/api/v1/receipts/${batchId}/confirm`).set('Cookie', cookie);
  req.field('receiverTitle', options.receiverTitle ?? 'مدير الجمعية');
  req.field('opId', options.opId ?? newOpId('confirm'));
  if (options.items !== undefined) req.field('items', JSON.stringify(options.items));
  if (options.damagePhotoLinks !== undefined) req.field('damagePhotoLinks', JSON.stringify(options.damagePhotoLinks));
  const quantityPhoto = options.quantityPhoto === undefined ? JPEG_1X1 : options.quantityPhoto;
  const signatureImage = options.signatureImage === undefined ? PNG_1X1 : options.signatureImage;
  if (quantityPhoto) req.attach('quantityPhoto', quantityPhoto, { filename: 'q.jpg', contentType: 'image/jpeg' });
  if (signatureImage) req.attach('signatureImage', signatureImage, { filename: 's.png', contentType: 'image/png' });
  for (const photo of options.damagePhotos ?? []) {
    req.attach('damagePhotos', photo, { filename: 'd.jpg', contentType: 'image/jpeg' });
  }
  if (options.associationReportFile) {
    req.attach('associationReportFile', options.associationReportFile, {
      filename: options.associationReportFilename ?? 'report.pdf',
      contentType: options.associationReportContentType ?? 'application/pdf',
    });
  }
  return req;
}
