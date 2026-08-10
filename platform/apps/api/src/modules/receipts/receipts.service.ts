import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  prisma,
  Prisma,
  AccountRole,
  AssociationStatus,
  DeviceStatus,
  DeviceMovementLocationType,
  DeviceType,
  FileCategory,
  ReceiptBatchStatus,
} from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { cleanText } from '../../common/validation/text.util';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import { validateDeviceSpec, validateDifferenceReason, validateReceiverTitle, validateSupplier } from './receipt-reference.util';
import { validateReceiptEvidenceFile } from '../files/file-validation.util';
import { StorageService } from '../files/storage.service';
import { storageConfig } from '../../config/storage.config';
import { ALLOCATION_TRIGGER_PORT, type AllocationTriggerPort } from '../allocation/allocation-trigger.port';
import type { AuthContext } from '../auth/auth.types';

const NOTES_MAX = 1000;
const DIFFERENCE_NOTES_MAX = 500;
const DEVICE_TYPE_VALUES = Object.values(DeviceType);

export interface CreateReceiptItemInput {
  deviceType: DeviceType;
  spec: string;
  sentQty: number;
}

export interface CreateReceiptBatchInput {
  associationId: string;
  supplierName: string;
  sentDate: string;
  notes?: string;
  items: CreateReceiptItemInput[];
  opId: string;
}

export interface ConfirmItemInput {
  itemId: string;
  receivedQty?: number;
  damagedQty?: number;
  missingQty?: number;
  differenceReason?: string;
  differenceNotes?: string;
}

export interface UploadedEvidenceFile {
  buffer: Buffer;
  declaredMimeType?: string;
}

export interface ConfirmReceiptBatchInput {
  receiverTitle: string;
  items?: ConfirmItemInput[];
  damagePhotoItemLinks?: string[][];
  opId: string;
}

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly publicCode: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(ALLOCATION_TRIGGER_PORT) private readonly allocationTrigger: AllocationTriggerPort,
  ) {}

  // ================================================================
  // LIST / DETAIL — ADMIN يرى الكل (اختياريًا مصفّاة بجمعية)، ASSOCIATION محاضرها فقط.
  // ================================================================
  async listReceiptBatches(
    ctx: AuthContext,
    params: PaginationParams & { associationId?: string; status?: ReceiptBatchStatus },
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);
    const where: Prisma.ReceiptBatchWhereInput = {};
    if (ctx.role === AccountRole.ASSOCIATION) {
      if (!ctx.associationId) throw authForbidden();
      where.associationId = ctx.associationId;
    } else if (params.associationId) {
      where.associationId = params.associationId;
    }
    if (params.status) where.status = params.status;

    const [rows, total] = await Promise.all([
      prisma.receiptBatch.findMany({
        where,
        include: { items: { include: { damagePhotos: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.receiptBatch.count({ where }),
    ]);

    return toPaginatedResult(rows.map(mapBatchSummary), total, page, pageSize);
  }

  async getBatchDetail(ctx: AuthContext, id: string) {
    const batch = await prisma.receiptBatch.findUnique({ where: { id }, include: { items: { include: { damagePhotos: true } } } });
    if (!batch) throw new ApiError('RECEIPT_BATCH_NOT_FOUND', 'محضر الاستلام غير موجود', 404);
    assertTenantAccess(ctx, batch.associationId);
    return mapBatchSummary(batch);
  }

  // ================================================================
  // CREATE — ADMIN فقط، عملية ذرّية واحدة، الحالة الابتدائية دومًا مسودة.
  // ================================================================
  async createBatch(ctx: AuthContext, input: CreateReceiptBatchInput) {
    const supplierName = await validateSupplier(input.supplierName);
    const sentDate = parseRequiredDate(input.sentDate);
    const notes = input.notes ? cleanText(input.notes, NOTES_MAX) : undefined;
    if (!input.items?.length) throw new ApiError('RECEIPT_ITEMS_REQUIRED', 'أضف صنفًا واحدًا على الأقل للمحضر', 400);

    const items = [] as { deviceType: DeviceType; spec: string; sentQty: number }[];
    for (const raw of input.items) {
      if (!DEVICE_TYPE_VALUES.includes(raw.deviceType)) {
        throw new ApiError('RECEIPT_INVALID_DEVICE_TYPE', `نوع الجهاز "${raw.deviceType}" غير مسموح به في محضر الاستلام`, 400);
      }
      const spec = await validateDeviceSpec(raw.spec);
      const sentQty = requirePositiveSafeInt(raw.sentQty, 'الكمية المرسلة');
      items.push({ deviceType: raw.deviceType, spec, sentQty });
    }

    const payload = { associationId: input.associationId, supplierName, sentDate: sentDate.toISOString(), notes, items };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ batchId: string }>(tx, ctx.accountId, 'receipt-batch-create', input.opId, payload);
      if (!claim.claimed) return { replayed: true as const, batchId: claim.existingResponse!.batchId };

      await assertActiveAssociation(tx, input.associationId);

      const publicCode = await this.publicCode.nextPublicCode(tx, 'RCB');
      const batch = await tx.receiptBatch.create({
        data: {
          publicCode,
          associationId: input.associationId,
          supplierName,
          sentAt: sentDate,
          createdById: ctx.accountId,
          status: ReceiptBatchStatus.DRAFT,
          notes: notes ?? null,
        },
      });

      for (const item of items) {
        const itemCode = await this.publicCode.nextPublicCode(tx, 'RCI');
        await tx.receiptItem.create({
          data: { publicCode: itemCode, receiptBatchId: batch.id, deviceType: item.deviceType, spec: item.spec, sentQty: item.sentQty },
        });
      }

      await this.idempotency.complete(tx, ctx.accountId, 'receipt-batch-create', input.opId, { batchId: batch.id });
      return { replayed: false as const, batchId: batch.id };
    });

    if (!outcome.replayed) {
      await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'RECEIPT_BATCH_CREATED', 'receipt_batches', outcome.batchId, {
        associationId: input.associationId,
        itemCount: items.length,
      });
    }

    return { ok: true as const, id: outcome.batchId };
  }

  // ================================================================
  // SEND — ADMIN فقط. DRAFT → AWAITING_ASSOCIATION_CONFIRMATION فقط.
  // ================================================================
  async sendBatch(ctx: AuthContext, id: string, opId: string) {
    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true }>(tx, ctx.accountId, 'receipt-batch-send', opId, { id });
      if (!claim.claimed) return { replayed: true as const };

      const rows = await tx.$queryRaw<{ id: string; association_id: string; status: string }[]>`
        SELECT id, association_id, status FROM receipt_batches WHERE id = ${id}::uuid FOR UPDATE
      `;
      const batch = rows[0];
      if (!batch) throw new ApiError('RECEIPT_BATCH_NOT_FOUND', 'محضر الاستلام غير موجود', 404);
      await assertActiveAssociation(tx, batch.association_id);
      assertTransition(batch.status as ReceiptBatchStatus, ReceiptBatchStatus.AWAITING_ASSOCIATION_CONFIRMATION);

      await tx.receiptBatch.update({ where: { id }, data: { status: ReceiptBatchStatus.AWAITING_ASSOCIATION_CONFIRMATION } });
      await this.idempotency.complete(tx, ctx.accountId, 'receipt-batch-send', opId, { ok: true });
      return { replayed: false as const };
    });

    if (!outcome.replayed) {
      await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'RECEIPT_BATCH_SENT', 'receipt_batches', id);
    }
    return { ok: true as const };
  }

  // ================================================================
  // CONFIRM — ASSOCIATION فقط ولجمعيتها حصرًا (tenant من AuthContext).
  // ================================================================
  async confirmBatch(
    ctx: AuthContext,
    id: string,
    input: ConfirmReceiptBatchInput,
    quantityPhoto: UploadedEvidenceFile,
    signatureImage: UploadedEvidenceFile,
    damagePhotos: UploadedEvidenceFile[],
  ) {
    if (ctx.role !== AccountRole.ASSOCIATION || !ctx.associationId) throw authForbidden();

    const batch = await prisma.receiptBatch.findUnique({ where: { id }, include: { items: true } });
    if (!batch || batch.associationId !== ctx.associationId) {
      // لا كشف عن وجود محضر لجمعية أخرى (نفس مبدأ 404 anti-enumeration في NODE-3).
      throw new ApiError('RECEIPT_BATCH_NOT_FOUND', 'محضر الاستلام غير موجود', 404);
    }
    // ملاحظة تصميم مهمة: **لا** رفض مبكر هنا بناءً على batch.status — لو
    // رفضنا هنا لمحضر انتقل بالفعل إلى حالة نهائية، لن نصل أبدًا لادّعاء
    // idempotency (claim) داخل المعاملة أدناه، فيُكسَر replay مشروع لنفس
    // opId (الطلب الثاني لنفس opId يرى الحالة الجديدة بعد نجاح الأول
    // ويُرفَض خطأً بدل أن يُعاد له الرد المخزَّن). التحقق الحاسم الوحيد هو
    // `assertTransition` **داخل** المعاملة بعد `FOR UPDATE`، حيث يُفحَص
    // idempotency أولًا فعليًا.

    const itemById = new Map(batch.items.map((row) => [row.id, row]));
    const requestedByItemId = new Map<string, ConfirmItemInput>();
    for (const entry of input.items ?? []) {
      if (!entry.itemId || !itemById.has(entry.itemId)) {
        throw new ApiError('RECEIPT_ITEM_NOT_FOUND', `بند غير تابع لهذا المحضر: ${entry.itemId}`, 400);
      }
      if (requestedByItemId.has(entry.itemId)) {
        throw new ApiError('RECEIPT_ITEM_DUPLICATE', `البند «${entry.itemId}» مكرَّر أكثر من مرة في نفس طلب التأكيد`, 400);
      }
      requestedByItemId.set(entry.itemId, entry);
    }

    let totalDamaged = 0;
    let hasAnyDifference = false;
    const itemPlans: {
      itemId: string;
      deviceType: DeviceType | null;
      spec: string | null;
      receivedQty: number;
      damagedQty: number;
      missingQty: number;
      differenceReason: string;
      differenceNotes: string;
    }[] = [];
    for (const row of batch.items) {
      const sentQty = row.sentQty;
      const entry = requestedByItemId.get(row.id);
      // بند لم يُذكر صراحة = استلام كامل (Legacy semantics — راجع confirmReceiptBatch_).
      const receivedQty = entry ? requireNonNegativeSafeInt(entry.receivedQty, `الكمية السليمة للبند ${row.id}`) : sentQty;
      const damagedQty = entry ? requireNonNegativeSafeInt(entry.damagedQty, `الكمية التالفة للبند ${row.id}`) : 0;
      const missingQty = entry ? requireNonNegativeSafeInt(entry.missingQty, `الكمية الناقصة للبند ${row.id}`) : 0;
      if (receivedQty + damagedQty + missingQty !== sentQty) {
        throw new ApiError(
          'RECEIPT_ITEM_QUANTITY_MISMATCH',
          `معادلة الكميات غير متوازنة للبند ${row.id}: السليم(${receivedQty}) + التالف(${damagedQty}) + الناقص(${missingQty}) يجب أن تساوي المرسل(${sentQty})`,
          400,
        );
      }
      const itemHasDifference = damagedQty > 0 || missingQty > 0;
      if (itemHasDifference) hasAnyDifference = true;
      totalDamaged += damagedQty;
      const differenceReason = itemHasDifference ? await validateDifferenceReason(entry?.differenceReason) : '';
      const differenceNotes = entry?.differenceNotes ? cleanText(entry.differenceNotes, DIFFERENCE_NOTES_MAX) : '';
      itemPlans.push({ itemId: row.id, deviceType: row.deviceType, spec: row.spec, receivedQty, damagedQty, missingQty, differenceReason, differenceNotes });
    }

    const finalStatus = hasAnyDifference ? ReceiptBatchStatus.RECEIVED_WITH_DISCREPANCIES : ReceiptBatchStatus.RECEIVED_COMPLETE;
    const receiverTitle = await validateReceiverTitle(input.receiverTitle);

    // -------- صور التلف: تحقّق العدد والربط قبل أي رفع/كتابة --------
    const damagePhotoLinks = input.damagePhotoItemLinks ?? [];
    if (totalDamaged === 1 && damagePhotoLinks.length !== 1) {
      throw new ApiError('RECEIPT_DAMAGE_PHOTO_COUNT_MISMATCH', 'تلف جهاز واحد يتطلب صورة تلف واحدة بالضبط', 400);
    }
    if (totalDamaged > 1 && damagePhotoLinks.length < 1) {
      throw new ApiError('RECEIPT_DAMAGE_PHOTO_COUNT_MISMATCH', 'وجود أكثر من جهاز تالف يتطلب صورة تلف واحدة على الأقل', 400);
    }
    if (totalDamaged === 0 && damagePhotoLinks.length > 0) {
      throw new ApiError('RECEIPT_DAMAGE_PHOTO_COUNT_MISMATCH', 'لا يمكن إرفاق صور تلف دون تسجيل أي كمية تالفة في بنود المحضر', 400);
    }
    if (damagePhotoLinks.length !== damagePhotos.length) {
      throw new ApiError('RECEIPT_DAMAGE_PHOTO_COUNT_MISMATCH', 'عدد صور التلف المرفوعة لا يطابق عدد الروابط المُرسَلة', 400);
    }
    const itemPlanById = new Map(itemPlans.map((p) => [p.itemId, p]));
    const damagedItemIdsCovered = new Set<string>();
    for (const itemIds of damagePhotoLinks) {
      if (!itemIds.length) throw new ApiError('RECEIPT_DAMAGE_PHOTO_ITEM_INVALID', 'كل صورة تلف يجب أن تُربَط ببند واحد على الأقل', 400);
      const seenInThisPhoto = new Set<string>();
      for (const itemId of itemIds) {
        const plan = itemPlanById.get(itemId);
        if (!plan) throw new ApiError('RECEIPT_DAMAGE_PHOTO_ITEM_INVALID', `صورة تلف مرتبطة ببند غير تابع لهذا المحضر: ${itemId}`, 400);
        if (plan.damagedQty <= 0) {
          throw new ApiError('RECEIPT_DAMAGE_PHOTO_ITEM_INVALID', `صورة تلف مرتبطة ببند لا يحمل أي كمية تالفة فعلية: ${itemId}`, 400);
        }
        if (seenInThisPhoto.has(itemId)) {
          throw new ApiError('RECEIPT_DAMAGE_PHOTO_ITEM_INVALID', `البند «${itemId}» مكرَّر أكثر من مرة ضمن نفس صورة التلف`, 400);
        }
        seenInThisPhoto.add(itemId);
        damagedItemIdsCovered.add(itemId);
      }
    }
    for (const plan of itemPlans) {
      if (plan.damagedQty > 0 && !damagedItemIdsCovered.has(plan.itemId)) {
        throw new ApiError('RECEIPT_DAMAGE_PHOTO_ITEM_UNCOVERED', `البند «${plan.itemId}» يحمل كمية تالفة بلا أي صورة تلف تغطيه`, 400);
      }
    }

    // -------- الإثباتات الإلزامية: صورة الكمية + التوقيع --------
    if (!quantityPhoto?.buffer?.length) throw new ApiError('RECEIPT_EVIDENCE_REQUIRED', 'صورة الكمية المستلمة كاملة عن المحضر إلزامية قبل التأكيد', 400);
    if (!signatureImage?.buffer?.length) throw new ApiError('RECEIPT_EVIDENCE_REQUIRED', 'توقيع المستلم (صورة) إلزامي قبل التأكيد', 400);

    const validatedQuantity = validateEvidenceOrThrow(quantityPhoto);
    const validatedSignature = validateEvidenceOrThrow(signatureImage);
    const validatedDamagePhotos = damagePhotos.map(validateEvidenceOrThrow);

    // -------- بصمة idempotency: محتوى الطلب فقط (sha256 للملفات)، بلا timestamps ولا مفاتيح كائنات مولَّدة --------
    const idempotencyPayload = {
      batchId: id,
      receiverTitle,
      items: itemPlans.map((p) => ({ itemId: p.itemId, receivedQty: p.receivedQty, damagedQty: p.damagedQty, missingQty: p.missingQty, differenceReason: p.differenceReason, differenceNotes: p.differenceNotes })),
      damagePhotoLinks,
      quantityPhotoSha256: sha256(quantityPhoto.buffer),
      signatureSha256: sha256(signatureImage.buffer),
      damagePhotoSha256: damagePhotos.map((f) => sha256(f.buffer)),
    };

    // -------- رفع الصور خارج معاملة DB (Object Storage ليست جزءًا من transaction) --------
    const uploadedKeys: string[] = [];
    try {
      const quantityKey = await this.uploadEvidence('receipt-quantity', validatedQuantity, uploadedKeys);
      const signatureKey = await this.uploadEvidence('receipt-signature', validatedSignature, uploadedKeys);
      const damageKeys = [] as string[];
      for (const evidence of validatedDamagePhotos) {
        damageKeys.push(await this.uploadEvidence('receipt-damage', evidence, uploadedKeys));
      }

      const outcome = await prisma.$transaction(async (tx) => {
        const claim = await this.idempotency.claim<{ batchId: string; status: string; deviceUnitsCreated: number }>(
          tx,
          ctx.accountId,
          'receipt-batch-confirm',
          input.opId,
          idempotencyPayload,
        );
        if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };

        const rows = await tx.$queryRaw<{ id: string; association_id: string; status: string }[]>`
          SELECT id, association_id, status FROM receipt_batches WHERE id = ${id}::uuid FOR UPDATE
        `;
        const lockedBatch = rows[0];
        if (!lockedBatch) throw new ApiError('RECEIPT_BATCH_NOT_FOUND', 'محضر الاستلام غير موجود', 404);
        if (lockedBatch.association_id !== ctx.associationId) throw new ApiError('RECEIPT_BATCH_NOT_FOUND', 'محضر الاستلام غير موجود', 404);
        await assertActiveAssociation(tx, lockedBatch.association_id);
        assertTransition(lockedBatch.status as ReceiptBatchStatus, finalStatus);

        const account = await tx.account.findUnique({ where: { id: ctx.accountId }, select: { name: true } });
        const receiverName = account?.name ?? '';

        const quantityFile = await tx.fileObject.create({
          data: { storageProvider: 'S3', bucket: storageConfig.bucket, objectKey: quantityKey, originalName: 'quantity', mimeType: validatedQuantity.mime, sizeBytes: BigInt(validatedQuantity.buffer.length), category: FileCategory.RECEIPT_QUANTITY_PHOTO, uploadedById: ctx.accountId },
        });
        const signatureFile = await tx.fileObject.create({
          data: { storageProvider: 'S3', bucket: storageConfig.bucket, objectKey: signatureKey, originalName: 'signature', mimeType: validatedSignature.mime, sizeBytes: BigInt(validatedSignature.buffer.length), category: FileCategory.RECEIPT_SIGNATURE_PHOTO, uploadedById: ctx.accountId },
        });
        const damageFileRows = [] as { id: string }[];
        for (let i = 0; i < validatedDamagePhotos.length; i++) {
          const evidence = validatedDamagePhotos[i];
          const row = await tx.fileObject.create({
            data: { storageProvider: 'S3', bucket: storageConfig.bucket, objectKey: damageKeys[i], originalName: 'damage', mimeType: evidence.mime, sizeBytes: BigInt(evidence.buffer.length), category: FileCategory.RECEIPT_DAMAGE_PHOTO, uploadedById: ctx.accountId },
          });
          damageFileRows.push(row);
        }

        for (const plan of itemPlans) {
          await tx.receiptItem.update({
            where: { id: plan.itemId },
            data: { goodQty: plan.receivedQty, damagedQty: plan.damagedQty, missingQty: plan.missingQty, differenceReason: plan.differenceReason || null, differenceNotes: plan.differenceNotes || null },
          });
        }

        for (let i = 0; i < damagePhotoLinks.length; i++) {
          const fileRow = damageFileRows[i];
          for (const itemId of damagePhotoLinks[i]) {
            const linkCode = await this.publicCode.nextPublicCode(tx, 'RCD');
            await tx.receiptDamagePhoto.create({ data: { publicCode: linkCode, receiptItemId: itemId, fileId: fileRow.id } });
          }
        }

        await tx.receiptBatch.update({
          where: { id },
          data: {
            status: finalStatus,
            receiverName,
            receiverTitle,
            confirmedAt: new Date(),
            confirmedById: ctx.accountId,
            quantityPhotoFileId: quantityFile.id,
            signatureFileId: signatureFile.id,
          },
        });

        // الأجهزة آخر كتابة — للكمية السليمة فقط، وحدة واحدة لكل جهاز.
        let deviceUnitsCreated = 0;
        for (const plan of itemPlans) {
          if (plan.receivedQty <= 0) continue;
          for (let i = 0; i < plan.receivedQty; i++) {
            const deviceCode = await this.publicCode.nextPublicCode(tx, 'DEV');
            await tx.deviceUnit.create({
              data: {
                publicCode: deviceCode,
                associationId: lockedBatch.association_id,
                deviceType: plan.deviceType,
                spec: plan.spec,
                receiptItemId: plan.itemId,
                status: DeviceStatus.WAREHOUSE,
                currentLocationType: DeviceMovementLocationType.WAREHOUSE,
                currentLocationRef: null,
              },
            });
            deviceUnitsCreated++;
          }
        }

        const response = { batchId: id, status: finalStatus, deviceUnitsCreated };
        await this.idempotency.complete(tx, ctx.accountId, 'receipt-batch-confirm', input.opId, response);
        return { replayed: false as const, response };
      });

      if (!outcome.replayed) {
        await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'RECEIPT_BATCH_CONFIRMED', 'receipt_batches', id, {
          status: outcome.response.status,
          deviceUnitsCreated: outcome.response.deviceUnitsCreated,
        });
        // القسم 4 القديم: محرك التخصيص يُشغَّل بعد commit ناجح فقط، ومعزول تمامًا — فشله لا يُسقط نجاح التأكيد.
        if (outcome.response.deviceUnitsCreated > 0) {
          try {
            await this.allocationTrigger.triggerForAssociation(batch.associationId);
          } catch (allocationError) {
            this.logger.warn(`فشل إشارة التخصيص التلقائي بعد تأكيد المحضر ${id} — لا يؤثر في نجاح التأكيد: ${String(allocationError)}`);
          }
        }
      }

      return { ok: true as const, id, status: outcome.response.status };
    } catch (error) {
      // فشل بعد رفع ناجح (كليًا أو جزئيًا) — حذف best-effort لكل ما رُفع تجنبًا لكائنات يتيمة.
      await Promise.all(uploadedKeys.map((key) => this.storage.deleteObjectBestEffort(key)));
      throw error;
    }
  }

  private async uploadEvidence(prefix: string, evidence: { buffer: Buffer; mime: string; ext: string }, uploadedKeys: string[]): Promise<string> {
    const objectKey = `${prefix}/${randomUUID()}.${evidence.ext}`;
    await this.storage.uploadPrivateObject(objectKey, evidence.buffer, evidence.mime);
    uploadedKeys.push(objectKey);
    return objectKey;
  }

  // ================================================================
  // إثباتات محضر الاستلام — رابط موقَّع قصير العمر، بنفس نطاق tenant أعلاه.
  // ================================================================
  async getEvidenceSignedUrl(ctx: AuthContext, batchId: string, evidenceType: 'quantity' | 'signature' | 'damage', damagePhotoId?: string): Promise<{ url: string }> {
    const batch = await prisma.receiptBatch.findUnique({ where: { id: batchId }, include: { quantityPhotoFile: true, signatureFile: true } });
    if (!batch) throw new ApiError('RECEIPT_BATCH_NOT_FOUND', 'محضر الاستلام غير موجود', 404);
    assertTenantAccess(ctx, batch.associationId);

    let objectKey: string | undefined;
    let category: FileCategory;
    if (evidenceType === 'quantity') {
      objectKey = batch.quantityPhotoFile?.objectKey;
      category = FileCategory.RECEIPT_QUANTITY_PHOTO;
    } else if (evidenceType === 'signature') {
      objectKey = batch.signatureFile?.objectKey;
      category = FileCategory.RECEIPT_SIGNATURE_PHOTO;
    } else {
      if (!damagePhotoId) throw new ApiError('RECEIPT_EVIDENCE_NOT_FOUND', 'معرّف صورة التلف مطلوب', 400);
      const link = await prisma.receiptDamagePhoto.findUnique({ where: { id: damagePhotoId }, include: { file: true, receiptItem: true } });
      // لا وصول لملف تلف تابع لبند من محضر/جمعية مختلفة — الربط عبر receiptItem.receiptBatchId فعليًا لا معرّف حرّ.
      if (!link || link.receiptItem.receiptBatchId !== batchId) throw new ApiError('RECEIPT_EVIDENCE_NOT_FOUND', 'صورة تلف غير تابعة لهذا المحضر', 404);
      objectKey = link.file.objectKey;
      category = FileCategory.RECEIPT_DAMAGE_PHOTO;
    }
    if (!objectKey) throw new ApiError('RECEIPT_EVIDENCE_NOT_FOUND', 'لا توجد صورة إثبات مرفقة بهذا النوع', 404);

    const url = await this.storage.getSignedGetUrl(objectKey, storageConfig.licenseSignedUrlSeconds);
    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'RECEIPT_EVIDENCE_VIEWED', 'receipt_batches', batchId, { evidenceType, category });
    return { url };
  }
}

function validateEvidenceOrThrow(file: UploadedEvidenceFile): { buffer: Buffer; mime: string; ext: string } {
  const result = validateReceiptEvidenceFile(file.buffer, file.declaredMimeType);
  if (!result.valid) {
    if (result.reason === 'TOO_LARGE') throw new ApiError('RECEIPT_EVIDENCE_TOO_LARGE', 'حجم الصورة يتجاوز 6 ميجابايت', 400);
    throw new ApiError('RECEIPT_EVIDENCE_INVALID', 'أرفق صورة بصيغة JPG أو PNG أو WEBP', 400);
  }
  const mime = result.detectedMimeType!;
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  return { buffer: file.buffer, mime, ext };
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function requirePositiveSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError('RECEIPT_VALIDATION_FAILED', `${label} يجب أن يكون رقمًا صحيحًا موجبًا`, 400);
  return value;
}

function requireNonNegativeSafeInt(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError('RECEIPT_VALIDATION_FAILED', `${label} يجب أن يكون رقمًا صحيحًا غير سالب`, 400);
  }
  return value;
}

function parseRequiredDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) throw new ApiError('RECEIPT_VALIDATION_FAILED', 'تاريخ الإرسال غير صالح', 400);
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) {
    throw new ApiError('RECEIPT_VALIDATION_FAILED', 'تاريخ الإرسال غير صالح', 400);
  }
  return date;
}

const RECEIPT_BATCH_TRANSITIONS: Record<string, ReceiptBatchStatus[]> = {
  [ReceiptBatchStatus.DRAFT]: [ReceiptBatchStatus.AWAITING_ASSOCIATION_CONFIRMATION],
  [ReceiptBatchStatus.AWAITING_ASSOCIATION_CONFIRMATION]: [ReceiptBatchStatus.RECEIVED_COMPLETE, ReceiptBatchStatus.RECEIVED_WITH_DISCREPANCIES],
  [ReceiptBatchStatus.RECEIVED_COMPLETE]: [],
  [ReceiptBatchStatus.RECEIVED_WITH_DISCREPANCIES]: [],
};

function assertTransition(from: ReceiptBatchStatus, to: ReceiptBatchStatus): void {
  const allowed = RECEIPT_BATCH_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiError('RECEIPT_BATCH_INVALID_TRANSITION', `انتقال غير مسموح لحالة محضر الاستلام: من «${from}» إلى «${to}»`, 409);
  }
}

async function assertActiveAssociation(tx: Prisma.TransactionClient, associationId: string): Promise<void> {
  const association = await tx.association.findUnique({ where: { id: associationId }, select: { status: true } });
  if (!association) throw new ApiError('RECEIPT_ASSOCIATION_NOT_FOUND', 'الجمعية المحدَّدة غير موجودة', 404);
  if (association.status !== AssociationStatus.ACTIVE) {
    throw new ApiError('RECEIPT_ASSOCIATION_INACTIVE', 'الجمعية المحدَّدة غير نشطة — لا يمكن إتمام عمليات محاضر الاستلام لها', 409);
  }
}

function assertTenantAccess(ctx: AuthContext, batchAssociationId: string): void {
  if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== batchAssociationId) {
    throw new ApiError('RECEIPT_BATCH_NOT_FOUND', 'محضر الاستلام غير موجود', 404);
  }
}

function mapBatchSummary(row: {
  id: string;
  publicCode: string;
  associationId: string;
  supplierName: string;
  sentAt: Date | null;
  status: string;
  notes: string | null;
  receiverName: string | null;
  receiverTitle: string | null;
  confirmedAt: Date | null;
  quantityPhotoFileId: string | null;
  signatureFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: {
    id: string;
    publicCode: string;
    deviceType: string | null;
    spec: string | null;
    sentQty: number;
    goodQty: number;
    damagedQty: number;
    missingQty: number;
    differenceReason: string | null;
    differenceNotes: string | null;
    damagePhotos: { id: string }[];
  }[];
}) {
  return {
    id: row.id,
    publicCode: row.publicCode,
    associationId: row.associationId,
    supplierName: row.supplierName,
    sentDate: row.sentAt,
    status: row.status,
    notes: row.notes,
    receiverName: row.receiverName,
    receiverTitle: row.receiverTitle,
    confirmedAt: row.confirmedAt,
    hasQuantityPhoto: !!row.quantityPhotoFileId,
    hasSignature: !!row.signatureFileId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: row.items.map((item) => ({
      id: item.id,
      publicCode: item.publicCode,
      deviceType: item.deviceType,
      spec: item.spec,
      sentQty: item.sentQty,
      receivedQty: item.goodQty,
      damagedQty: item.damagedQty,
      missingQty: item.missingQty,
      differenceReason: item.differenceReason,
      differenceNotes: item.differenceNotes,
      damagePhotos: item.damagePhotos.map((p) => ({ id: p.id })),
      damagePhotoCount: item.damagePhotos.length,
    })),
  };
}
