import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { prisma, DeviceType } from '@alzad/db';
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
}

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
  return req;
}
