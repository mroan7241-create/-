import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  prisma,
  Prisma,
  AccountRole,
  AccountStatus,
  BeneficiaryReviewStatus,
  NeedDecisionStatus,
  NeedFulfillmentStatus,
  DeviceStatus,
  DeviceAllocationStatus,
  DeviceMovementLocationType,
  DeliveryStatus,
  DeliveryFailureReason,
  FileCategory,
  DeliveryApprovalDecision,
  DeliveryApprovalStage,
  ReturnCondition,
  OutboxEventType,
} from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../files/storage.service';
import { validateReceiptEvidenceFile } from '../files/file-validation.util';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import { storageConfig } from '../../config/storage.config';
import { ALLOCATION_TRIGGER_PORT, type AllocationTriggerPort } from '../allocation/allocation-trigger.port';
import type { AuthContext } from '../auth/auth.types';

/**
 * ============================================================
 * DeliveriesService — NODE-6
 * ============================================================
 *
 * قرار تصميم موثَّق صراحةً (راجع PRODUCT_PARITY_MASTER.md §6 "قرارات"):
 * النظام القديم لم يبنِ أبدًا endpoint حقيقيًا لخطوة "استلام المندوب
 * الفعلي للجهاز" منفصلة عن "تعيين المندوب" — assignDelegate القديمة
 * توقفت عند "جاري التجهيز" فقط (راجع audit/01-legacy-auth.md، DEL-005
 * إلى DEL-011)، وaudit/05-legacy-ui-and-docs.md يؤكد صراحةً أن هذه
 * الفجوة كانت موجودة في Legacy نفسه ولم تُغلَق قط. بما أن الاحتياج
 * الحقيقي لهذه المنصة هو "المندوب يرى المهمة ويستطيع تأكيد/فشل التسليم"
 * (السلوك المُثبَت فعليًا في بوابة المندوب القديمة)، `assignDelegate` هنا
 * تنفّذ **الإسناد + التسليم الفعلي للمندوب في خطوة ذرّية واحدة**:
 * تُنشئ/تُحدِّث مهمة تسليم واحدة، تنقل الأجهزة المخصَّصة مباشرة إلى حالة
 * "مع المندوب"، وتضع كل احتياجات المستفيد المعتمدة على "خرج مع المندوب" —
 * تمامًا كما كانت ستظهر لأي مندوب في بوابته القديمة فور التعيين operationally،
 * دون اختراع خطوة وسيطة لم تكن موجودة في أي تجربة مستخدم فعلية.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly publicCode: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(ALLOCATION_TRIGGER_PORT) private readonly allocationTrigger: AllocationTriggerPort,
  ) {}

  private actor(ctx: AuthContext) {
    return { id: ctx.accountId, role: ctx.role, associationId: ctx.associationId };
  }

  // ================================================================
  // assignDelegate — إسناد + تسليم فعلي للمندوب (خطوة واحدة، راجع التعليق أعلاه)
  // ================================================================
  async assignDelegate(ctx: AuthContext, input: { beneficiaryId: string; delegateId: string; opId: string }) {
    if (ctx.role !== AccountRole.ADMIN && ctx.role !== AccountRole.ASSOCIATION) throw authForbidden();

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ missionId: string }>(tx, ctx.accountId, 'delivery-assign', input.opId, input);
      if (!claim.claimed) return { replayed: true as const, missionId: claim.existingResponse!.missionId };

      await tx.$queryRaw<{ id: string }[]>`SELECT id FROM beneficiaries WHERE id = ${input.beneficiaryId}::uuid FOR UPDATE`;

      const beneficiary = await tx.beneficiary.findUnique({ where: { id: input.beneficiaryId } });
      if (!beneficiary || beneficiary.archivedAt) throw new ApiError('BENEFICIARY_NOT_FOUND', 'المستفيد غير موجود', 404);
      if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== beneficiary.associationId) {
        throw new ApiError('BENEFICIARY_NOT_FOUND', 'المستفيد غير موجود', 404);
      }
      if (beneficiary.reviewStatus !== BeneficiaryReviewStatus.APPROVED) {
        throw new ApiError('DELIVERY_BENEFICIARY_NOT_APPROVED', 'المستفيد ليس معتمَدًا بعد', 409);
      }

      const delegate = await tx.account.findUnique({ where: { id: input.delegateId } });
      if (!delegate || delegate.role !== AccountRole.DELEGATE || delegate.archivedAt) {
        throw new ApiError('DELEGATE_NOT_FOUND', 'المندوب غير موجود', 404);
      }
      if (delegate.status !== AccountStatus.ACTIVE) throw new ApiError('DELEGATE_INACTIVE', 'المندوب معطَّل حاليًا', 409);
      if (delegate.associationId !== beneficiary.associationId) {
        throw new ApiError('DELIVERY_ASSOCIATION_MISMATCH', 'المندوب لا ينتمي لجمعية المستفيد نفسها', 409);
      }

      const needs = await tx.beneficiaryNeed.findMany({
        where: { beneficiaryId: beneficiary.id, decisionStatus: NeedDecisionStatus.APPROVED },
      });
      if (needs.length === 0) throw new ApiError('DELIVERY_NO_APPROVED_NEEDS', 'لا يملك المستفيد أي احتياج معتمد', 409);
      // ALLOC/BEN-015: يجب أن تكون كل الاحتياجات المعتمدة قد اكتملت جماعيًا عبر NODE-5 أولًا.
      const notReady = needs.filter((n) => n.fulfillmentStatus !== NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT);
      if (notReady.length > 0) {
        throw new ApiError('DELIVERY_NOT_READY', 'لا تزال بعض الأجهزة غير جاهزة لهذا المستفيد — أكمِل التخصيص أولًا', 409);
      }

      const allocations = await tx.deviceAllocation.findMany({
        where: { beneficiaryNeedId: { in: needs.map((n) => n.id) }, status: DeviceAllocationStatus.ACTIVE },
      });
      if (allocations.length !== needs.length) {
        // حارس تكامل صريح — لا يجب أن يحدث إن كانت NODE-5 اتّسقت فعليًا، لكن لا كتابة جزئية أبدًا إن وُجد تعارض بيانات.
        throw new ApiError('DELIVERY_ALLOCATION_MISMATCH', 'تعارض بيانات بين الاحتياجات والتخصيصات — راجع الفريق التقني', 409);
      }

      // مهمة تسليم واحدة لكل مستفيد — يُعاد استخدام آخر مهمة غير مكتملة (النادر: إسناد ثانٍ بعد استرجاع NODE-5) بدل تكديس صفوف يتيمة.
      const existingMission = await tx.deliveryMission.findFirst({
        where: { beneficiaryId: beneficiary.id, status: { notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.DELIVERY_CLOSED] } },
        orderBy: { createdAt: 'desc' },
      });

      const missionId = existingMission
        ? existingMission.id
        : (
            await tx.deliveryMission.create({
              data: {
                publicCode: await this.publicCode.nextPublicCode(tx, 'DLV'),
                beneficiaryId: beneficiary.id,
                associationId: beneficiary.associationId,
                delegateAccountId: delegate.id,
                status: DeliveryStatus.PENDING_DELEGATE_ACKNOWLEDGEMENT,
                assignedAt: new Date(),
              },
            })
          ).id;

      if (existingMission) {
        await tx.deliveryMission.update({
          where: { id: existingMission.id },
          data: { delegateAccountId: delegate.id, status: DeliveryStatus.PENDING_DELEGATE_ACKNOWLEDGEMENT, assignedAt: new Date() },
        });
      }

      await tx.beneficiaryNeed.updateMany({
        where: { id: { in: needs.map((n) => n.id) } },
        data: { fulfillmentStatus: NeedFulfillmentStatus.ASSIGNED_TO_DELEGATE_PENDING },
      });

      const response = { missionId };
      await this.idempotency.complete(tx, ctx.accountId, 'delivery-assign', input.opId, response);
      return { replayed: false as const, missionId };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'DELIVERY_ASSIGNED', 'delivery_missions', outcome.missionId, {
        beneficiaryId: input.beneficiaryId,
        delegateId: input.delegateId,
      });
    }
    return { ok: true as const, missionId: outcome.missionId };
  }

  // ================================================================
  // confirmHandover — custody moves only after the assigned delegate acknowledges receipt
  // ================================================================
  async confirmHandover(ctx: AuthContext, missionId: string, opId: string) {
    if (ctx.role !== AccountRole.DELEGATE) throw authForbidden();

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true }>(tx, ctx.accountId, 'delivery-confirm-handover', opId, { missionId });
      if (!claim.claimed) return { replayed: true as const };

      const mission = await tx.deliveryMission.findUnique({ where: { id: missionId } });
      if (!mission || mission.delegateAccountId !== ctx.accountId) {
        throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      }
      if (mission.status !== DeliveryStatus.PENDING_DELEGATE_ACKNOWLEDGEMENT) {
        throw new ApiError('DELIVERY_INVALID_TRANSITION', `لا يمكن تأكيد استلام العهدة من الحالة الحالية (${mission.status})`, 409);
      }

      const needs = await tx.beneficiaryNeed.findMany({
        where: {
          beneficiaryId: mission.beneficiaryId,
          decisionStatus: NeedDecisionStatus.APPROVED,
        },
      });
      if (needs.length === 0 || needs.some((need) => need.fulfillmentStatus !== NeedFulfillmentStatus.ASSIGNED_TO_DELEGATE_PENDING)) {
        throw new ApiError('DELIVERY_CUSTODY_MISMATCH', 'لا توجد عهدة معلّقة لهذه المهمة', 409);
      }
      const allocations = await tx.deviceAllocation.findMany({
        where: { beneficiaryNeedId: { in: needs.map((need) => need.id) }, status: DeviceAllocationStatus.ACTIVE },
      });
      if (allocations.length !== needs.length) {
        throw new ApiError('DELIVERY_CUSTODY_MISMATCH', 'بيانات العهدة لا تطابق سلة المستفيد', 409);
      }

      const deviceIds = allocations.map((allocation) => allocation.deviceId);
      const devices = await tx.deviceUnit.findMany({ where: { id: { in: deviceIds } } });
      if (
        devices.length !== deviceIds.length ||
        devices.some(
          (device) =>
            device.associationId !== mission.associationId ||
            device.status !== DeviceStatus.ALLOCATED ||
            device.currentLocationType !== DeviceMovementLocationType.WAREHOUSE ||
            device.currentLocationRef !== null,
        )
      ) {
        throw new ApiError('DELIVERY_CUSTODY_MISMATCH', 'موقع الأجهزة أو حالتها لا يسمحان بتسليم العهدة', 409);
      }

      const transition = await tx.deliveryMission.updateMany({
        where: { id: mission.id, status: DeliveryStatus.PENDING_DELEGATE_ACKNOWLEDGEMENT },
        data: { status: DeliveryStatus.OUT_WITH_DELEGATE },
      });
      if (transition.count !== 1) {
        throw new ApiError('DELIVERY_INVALID_TRANSITION', 'تم تأكيد استلام هذه العهدة بالفعل', 409);
      }
      await tx.deviceUnit.updateMany({
        where: { id: { in: deviceIds } },
        data: { status: DeviceStatus.WITH_DELEGATE, currentLocationType: DeviceMovementLocationType.DELEGATE, currentLocationRef: ctx.accountId },
      });
      await tx.beneficiaryNeed.updateMany({
        where: { id: { in: needs.map((need) => need.id) } },
        data: { fulfillmentStatus: NeedFulfillmentStatus.OUT_WITH_DELEGATE },
      });
      await tx.deviceMovement.createMany({
        data: devices.map((device) => ({
          deviceId: device.id,
          associationId: mission.associationId,
          fromLocationType: device.currentLocationType,
          fromLocationRef: device.currentLocationRef,
          toLocationType: DeviceMovementLocationType.DELEGATE,
          toLocationRef: ctx.accountId,
          reason: 'delivery-handover-confirmed',
          referenceType: 'delivery_mission',
          referenceId: mission.id,
          performedById: ctx.accountId,
        })),
      });

      await this.idempotency.complete(tx, ctx.accountId, 'delivery-confirm-handover', opId, { ok: true });
      return { replayed: false as const };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'DELIVERY_HANDOVER_CONFIRMED', 'delivery_missions', missionId);
    }
    return { ok: true as const };
  }

  // ================================================================
  // confirmDelivery — DEL-008 (تأكيد التسليم بإثبات صورة)
  // ================================================================
  async confirmDelivery(ctx: AuthContext, missionId: string, proof: { buffer: Buffer; declaredMimeType?: string }, signature: { buffer: Buffer; declaredMimeType?: string }, opId: string) {
    if (ctx.role !== AccountRole.DELEGATE) throw authForbidden();
    if (!proof.buffer.length) throw new ApiError('DELIVERY_PROOF_REQUIRED', 'صورة إثبات التسليم مطلوبة', 400);
    if (!signature.buffer.length) throw new ApiError('DELIVERY_SIGNATURE_REQUIRED', 'توقيع المستفيد مطلوب', 400);
    const validated = validateReceiptEvidenceFile(proof.buffer, proof.declaredMimeType);
    const validatedSignature = validateReceiptEvidenceFile(signature.buffer, signature.declaredMimeType);
    if (!validated.valid) {
      throw new ApiError(
        validated.reason === 'TOO_LARGE' ? 'DELIVERY_PROOF_TOO_LARGE' : 'DELIVERY_PROOF_INVALID_TYPE',
        validated.reason === 'TOO_LARGE' ? 'حجم صورة الإثبات يتجاوز الحد المسموح (٦ ميجابايت)' : 'صيغة صورة الإثبات غير مدعومة (JPEG/PNG/WEBP فقط)',
        400,
      );
    }
    if (!validatedSignature.valid) throw new ApiError(validatedSignature.reason === 'TOO_LARGE' ? 'DELIVERY_SIGNATURE_TOO_LARGE' : 'DELIVERY_SIGNATURE_INVALID_TYPE', 'صورة توقيع المستفيد غير صالحة', 400);

    const uploadedKeys: string[] = [];
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const claim = await this.idempotency.claim<{ attemptId: string }>(tx, ctx.accountId, 'delivery-confirm', opId, { missionId });
        if (!claim.claimed) return { replayed: true as const, attemptId: claim.existingResponse!.attemptId };

        const mission = await tx.deliveryMission.findUnique({ where: { id: missionId } });
        if (!mission || mission.delegateAccountId !== ctx.accountId) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
        if (mission.status !== DeliveryStatus.OUT_WITH_DELEGATE) {
          throw new ApiError('DELIVERY_INVALID_TRANSITION', `لا يمكن تأكيد التسليم من الحالة الحالية (${mission.status})`, 409);
        }

        const needs = await tx.beneficiaryNeed.findMany({
          where: { beneficiaryId: mission.beneficiaryId, decisionStatus: NeedDecisionStatus.APPROVED, fulfillmentStatus: NeedFulfillmentStatus.OUT_WITH_DELEGATE },
        });
        const allocations = await tx.deviceAllocation.findMany({
          where: { beneficiaryNeedId: { in: needs.map((n) => n.id) }, status: DeviceAllocationStatus.ACTIVE },
        });

        const objectKey = `delivery-proof/${randomUUID()}.${validated.detectedMimeType === 'image/png' ? 'png' : validated.detectedMimeType === 'image/webp' ? 'webp' : 'jpg'}`;
        await this.storage.uploadPrivateObject(objectKey, proof.buffer, validated.detectedMimeType!);
        uploadedKeys.push(objectKey);
        const proofFile = await tx.fileObject.create({
          data: {
            storageProvider: 's3', bucket: storageConfig.bucket, objectKey,
            originalName: 'delivery-proof', mimeType: validated.detectedMimeType!, sizeBytes: BigInt(proof.buffer.length),
            category: FileCategory.DELIVERY_PROOF_PHOTO, uploadedById: ctx.accountId,
          },
        });
        const signatureKey = `delivery-signature/${randomUUID()}.${validatedSignature.detectedMimeType === 'image/png' ? 'png' : validatedSignature.detectedMimeType === 'image/webp' ? 'webp' : 'jpg'}`;
        await this.storage.uploadPrivateObject(signatureKey, signature.buffer, validatedSignature.detectedMimeType!); uploadedKeys.push(signatureKey);
        const signatureFile = await tx.fileObject.create({ data: { storageProvider: 's3', bucket: storageConfig.bucket, objectKey: signatureKey, originalName: 'recipient-signature', mimeType: validatedSignature.detectedMimeType!, sizeBytes: BigInt(signature.buffer.length), category: FileCategory.DELIVERY_RECIPIENT_SIGNATURE, uploadedById: ctx.accountId } });

        const now = new Date();
        await tx.deliveryMission.update({ where: { id: mission.id }, data: { status: DeliveryStatus.PENDING_DELIVERY_APPROVAL } });
        await tx.deviceUnit.updateMany({
          where: { id: { in: allocations.map((a) => a.deviceId) } },
          data: { status: DeviceStatus.WITH_BENEFICIARY_PENDING_APPROVAL, currentLocationType: DeviceMovementLocationType.BENEFICIARY, currentLocationRef: mission.beneficiaryId, deliveredAt: null },
        });
        if (allocations.length) await tx.deviceMovement.createMany({ data: allocations.map((allocation) => ({ deviceId: allocation.deviceId, associationId: mission.associationId, fromLocationType: DeviceMovementLocationType.DELEGATE, fromLocationRef: mission.delegateAccountId, toLocationType: DeviceMovementLocationType.BENEFICIARY, toLocationRef: mission.beneficiaryId, reason: 'delivery-submitted-pending-approval', referenceType: 'delivery_mission', referenceId: mission.id, performedById: ctx.accountId })) });

        const attempt = await tx.deliveryAttempt.create({
          data: {
            publicCode: await this.publicCode.nextPublicCode(tx, 'DAT'),
            missionId: mission.id, beneficiaryId: mission.beneficiaryId, delegateAccountId: ctx.accountId,
            status: DeliveryStatus.PENDING_DELIVERY_APPROVAL, proofFileId: proofFile.id, recipientSignatureFileId: signatureFile.id, attemptedAt: now,
          },
        });
        await tx.outboxEvent.create({ data: { type: OutboxEventType.DELIVERY_SUBMITTED, payload: { missionId: mission.id, associationId: mission.associationId } } });

        const response = { attemptId: attempt.id };
        await this.idempotency.complete(tx, ctx.accountId, 'delivery-confirm', opId, response);
        return { replayed: false as const, attemptId: attempt.id };
      });

      if (!outcome.replayed) {
        await this.audit.log(this.actor(ctx), 'DELIVERY_SUBMITTED_FOR_APPROVAL', 'delivery_missions', missionId, { attemptId: outcome.attemptId });
      }
      return { ok: true as const, attemptId: outcome.attemptId };
    } catch (error) {
      for (const key of uploadedKeys) await this.storage.deleteObjectBestEffort(key);
      throw error;
    }
  }

  // ================================================================
  // updateDeliveryStatus (تسجيل فشل) — DEL-006
  // ================================================================
  async failDelivery(ctx: AuthContext, missionId: string, input: { failureReason: DeliveryFailureReason; notes?: string; opId: string }) {
    if (ctx.role !== AccountRole.DELEGATE) throw authForbidden();

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ attemptId: string }>(tx, ctx.accountId, 'delivery-fail', input.opId, { missionId, ...input });
      if (!claim.claimed) return { replayed: true as const, attemptId: claim.existingResponse!.attemptId };

      const mission = await tx.deliveryMission.findUnique({ where: { id: missionId } });
      if (!mission || mission.delegateAccountId !== ctx.accountId) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (mission.status !== DeliveryStatus.OUT_WITH_DELEGATE) {
        throw new ApiError('DELIVERY_INVALID_TRANSITION', `لا يمكن تسجيل تعذّر التسليم من الحالة الحالية (${mission.status})`, 409);
      }

      // الأجهزة تبقى "مع المندوب" — لا تُعاد للمستودع تلقائيًا (DEL-006: نفس سلوك Legacy حرفيًا).
      await tx.deliveryMission.update({ where: { id: mission.id }, data: { status: DeliveryStatus.DELIVERY_FAILED } });
      const attempt = await tx.deliveryAttempt.create({
        data: {
          publicCode: await this.publicCode.nextPublicCode(tx, 'DAT'),
          missionId: mission.id, beneficiaryId: mission.beneficiaryId, delegateAccountId: ctx.accountId,
          status: DeliveryStatus.DELIVERY_FAILED, failureReason: input.failureReason, notes: input.notes ?? null, attemptedAt: new Date(),
        },
      });

      const response = { attemptId: attempt.id };
      await this.idempotency.complete(tx, ctx.accountId, 'delivery-fail', input.opId, response);
      return { replayed: false as const, attemptId: attempt.id };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'DELIVERY_FAILED', 'delivery_missions', missionId, { failureReason: input.failureReason, attemptId: outcome.attemptId });
    }
    return { ok: true as const, attemptId: outcome.attemptId };
  }

  // ================================================================
  // retryDelivery — DEL-007
  // ================================================================
  async retryDelivery(ctx: AuthContext, missionId: string, opId: string) {
    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true }>(tx, ctx.accountId, 'delivery-retry', opId, { missionId });
      if (!claim.claimed) return { replayed: true as const };

      const mission = await tx.deliveryMission.findUnique({ where: { id: missionId } });
      if (!mission) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (ctx.role === AccountRole.DELEGATE && mission.delegateAccountId !== ctx.accountId) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== mission.associationId) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (mission.status !== DeliveryStatus.DELIVERY_FAILED) {
        throw new ApiError('DELIVERY_INVALID_TRANSITION', `لا يمكن إعادة المحاولة من الحالة الحالية (${mission.status})`, 409);
      }

      // لا مساس بالأجهزة ولا المندوب ولا سجل المحاولات السابقة — إعادة فتح فقط (DEL-007).
      await tx.deliveryMission.update({ where: { id: mission.id }, data: { status: DeliveryStatus.OUT_WITH_DELEGATE } });
      await this.idempotency.complete(tx, ctx.accountId, 'delivery-retry', opId, { ok: true });
      return { replayed: false as const };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'DELIVERY_RETRIED', 'delivery_missions', missionId);
    }
    return { ok: true as const };
  }

  // ================================================================
  // Approval, reschedule and physical return workflows
  // ================================================================
  async approveDelivery(ctx: AuthContext, missionId: string, stageRaw: 'ASSOCIATION' | 'ZAAD', input: { decision: DeliveryApprovalDecision; reason?: string; opId: string }) {
    const stage = stageRaw === 'ASSOCIATION' ? DeliveryApprovalStage.ASSOCIATION : DeliveryApprovalStage.ZAAD;
    if (input.decision !== DeliveryApprovalDecision.APPROVED && !input.reason?.trim()) throw new ApiError('DELIVERY_APPROVAL_REASON_REQUIRED', 'سبب القرار مطلوب', 400);
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; finalized: boolean }>(tx, ctx.accountId, `delivery-approval-${stage}`, input.opId, { missionId, decision: input.decision, reason: input.reason ?? null }); if (!claim.claimed) return claim.existingResponse!;
      await tx.$queryRaw`SELECT id FROM delivery_missions WHERE id=${missionId}::uuid FOR UPDATE`;
      const mission = await tx.deliveryMission.findUnique({ where: { id: missionId }, include: { attempts: { orderBy: { attemptedAt: 'desc' }, take: 1 }, approvals: { orderBy: { createdAt: 'desc' } } } });
      if (!mission || (stage === DeliveryApprovalStage.ASSOCIATION && ctx.associationId !== mission.associationId)) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (mission.status !== DeliveryStatus.PENDING_DELIVERY_APPROVAL) throw new ApiError('DELIVERY_APPROVAL_INVALID_STATE', 'المهمة ليست بانتظار اعتماد التسليم', 409);
      const attempt = mission.attempts[0]; if (!attempt?.proofFileId || !attempt.recipientSignatureFileId) throw new ApiError('DELIVERY_EVIDENCE_INCOMPLETE', 'إثبات التسليم أو توقيع المستفيد غير مكتمل', 409);
      if (stage === DeliveryApprovalStage.ZAAD) {
        const latestAssociation = mission.approvals.find((a) => a.stage === DeliveryApprovalStage.ASSOCIATION);
        if (!latestAssociation || latestAssociation.decision !== DeliveryApprovalDecision.APPROVED) throw new ApiError('ASSOCIATION_APPROVAL_REQUIRED', 'اعتماد الجمعية مطلوب قبل اعتماد زاد النهائي', 409);
      }
      await tx.deliveryApproval.create({ data: { missionId, stage, decision: input.decision, actorId: ctx.accountId, reason: input.reason?.trim() || null } });
      let finalized = false;
      if (stage === DeliveryApprovalStage.ZAAD && input.decision === DeliveryApprovalDecision.APPROVED) {
        const needs = await tx.beneficiaryNeed.findMany({ where: { beneficiaryId: mission.beneficiaryId, decisionStatus: NeedDecisionStatus.APPROVED } });
        const allocations = await tx.deviceAllocation.findMany({ where: { beneficiaryNeedId: { in: needs.map((n) => n.id) }, status: DeviceAllocationStatus.ACTIVE } }); const now = new Date();
        await tx.deliveryMission.update({ where: { id: missionId }, data: { status: DeliveryStatus.DELIVERY_CLOSED } });
        await tx.deliveryAttempt.update({ where: { id: attempt.id }, data: { status: DeliveryStatus.DELIVERY_CLOSED } });
        await tx.deviceUnit.updateMany({ where: { id: { in: allocations.map((a) => a.deviceId) }, status: DeviceStatus.WITH_BENEFICIARY_PENDING_APPROVAL }, data: { status: DeviceStatus.DELIVERED, deliveredAt: now } });
        await tx.beneficiaryNeed.updateMany({ where: { id: { in: needs.map((n) => n.id) } }, data: { fulfillmentStatus: NeedFulfillmentStatus.DELIVERED } }); finalized = true;
      } else if (stage === DeliveryApprovalStage.ASSOCIATION && input.decision === DeliveryApprovalDecision.APPROVED) {
        await tx.outboxEvent.create({ data: { type: OutboxEventType.DELIVERY_ASSOCIATION_APPROVED, payload: { missionId, associationId: mission.associationId } } });
      }
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: mission.associationId, action: finalized ? 'DELIVERY_ZAAD_APPROVED_FINAL' : 'DELIVERY_APPROVAL_RECORDED', entityType: 'delivery_missions', entityId: missionId, metadata: { stage, decision: input.decision, reason: input.reason ?? null } } });
      const response = { ok: true as const, finalized }; await this.idempotency.complete(tx, ctx.accountId, `delivery-approval-${stage}`, input.opId, response); return response;
    });
  }

  async reschedule(ctx: AuthContext, missionId: string, input: { reason: string; scheduledFor: string; opId: string }) {
    const scheduledFor = new Date(input.scheduledFor); if (!input.reason?.trim() || Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) throw new ApiError('DELIVERY_RESCHEDULE_INVALID', 'سبب وموعد مستقبلي صالح مطلوبان', 400);
    return this.simpleMissionTransition(ctx, missionId, input.opId, DeliveryStatus.DELIVERY_FAILED, DeliveryStatus.DEFERRED, { scheduledFor }, 'DELIVERY_RESCHEDULED', { reason: input.reason.trim(), scheduledFor: scheduledFor.toISOString() });
  }

  resumeDeferred(ctx: AuthContext, missionId: string, opId: string) { return this.simpleMissionTransition(ctx, missionId, opId, DeliveryStatus.DEFERRED, DeliveryStatus.OUT_WITH_DELEGATE, { scheduledFor: null }, 'DELIVERY_RESUMED'); }

  private async simpleMissionTransition(ctx: AuthContext, missionId: string, opId: string, from: DeliveryStatus, to: DeliveryStatus, data: Prisma.DeliveryMissionUpdateInput, action: string, metadata?: Prisma.InputJsonObject) {
    return prisma.$transaction(async (tx) => {
      const scope = `delivery-${action.toLowerCase()}`; const claim = await this.idempotency.claim<{ ok: true }>(tx, ctx.accountId, scope, opId, { missionId, to, metadata: metadata ?? null }); if (!claim.claimed) return claim.existingResponse!;
      const mission = await tx.deliveryMission.findUnique({ where: { id: missionId } }); if (!mission || (ctx.role === AccountRole.DELEGATE && mission.delegateAccountId !== ctx.accountId) || (ctx.role === AccountRole.ASSOCIATION && mission.associationId !== ctx.associationId)) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (mission.status !== from) throw new ApiError('DELIVERY_INVALID_TRANSITION', 'انتقال حالة التسليم غير مسموح', 409);
      await tx.deliveryMission.update({ where: { id: missionId }, data: { ...data, status: to } }); await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: mission.associationId, action, entityType: 'delivery_missions', entityId: missionId, metadata } }); const response = { ok: true as const }; await this.idempotency.complete(tx, ctx.accountId, scope, opId, response); return response;
    });
  }

  async requestReturn(ctx: AuthContext, missionId: string, input: { notes?: string; opId: string }) {
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; attemptId: string }>(tx, ctx.accountId, 'delivery-return-request', input.opId, { missionId, notes: input.notes ?? null }); if (!claim.claimed) return claim.existingResponse!;
      await tx.$queryRaw`SELECT id FROM delivery_missions WHERE id=${missionId}::uuid FOR UPDATE`;
      const mission = await tx.deliveryMission.findUnique({ where: { id: missionId } }); if (!mission || (ctx.role === AccountRole.DELEGATE && mission.delegateAccountId !== ctx.accountId) || (ctx.role === AccountRole.ASSOCIATION && mission.associationId !== ctx.associationId)) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (mission.status !== DeliveryStatus.OUT_WITH_DELEGATE && mission.status !== DeliveryStatus.DELIVERY_FAILED && mission.status !== DeliveryStatus.DEFERRED) throw new ApiError('DELIVERY_INVALID_TRANSITION', 'لا يمكن طلب الإرجاع من الحالة الحالية', 409);
      const now = new Date(); await tx.deliveryMission.update({ where: { id: missionId }, data: { status: DeliveryStatus.PENDING_RETURN_APPROVAL } });
      await tx.beneficiaryNeed.updateMany({ where: { beneficiaryId: mission.beneficiaryId, decisionStatus: NeedDecisionStatus.APPROVED }, data: { fulfillmentStatus: NeedFulfillmentStatus.AWAITING_RETURN_CONFIRMATION } });
      const attempt = await tx.deliveryAttempt.create({ data: { publicCode: await this.publicCode.nextPublicCode(tx, 'DAT'), missionId, beneficiaryId: mission.beneficiaryId, delegateAccountId: mission.delegateAccountId ?? ctx.accountId, status: DeliveryStatus.PENDING_RETURN_APPROVAL, notes: input.notes ?? null, attemptedAt: now } });
      await tx.outboxEvent.create({ data: { type: OutboxEventType.RETURN_REQUESTED, payload: { missionId, associationId: mission.associationId } } }); await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: mission.associationId, action: 'DELIVERY_RETURN_REQUESTED', entityType: 'delivery_missions', entityId: missionId } });
      const response = { ok: true as const, attemptId: attempt.id }; await this.idempotency.complete(tx, ctx.accountId, 'delivery-return-request', input.opId, response); return response;
    });
  }

  async confirmPhysicalReturn(ctx: AuthContext, missionId: string, input: { condition: ReturnCondition; notes: string; opId: string }, adminOverride = false) {
    if (!input.notes?.trim()) throw new ApiError('RETURN_CONFIRMATION_REASON_REQUIRED', 'ملاحظات/سبب تأكيد الإرجاع مطلوبة', 400);
    const outcome = await prisma.$transaction(async (tx) => {
      const scope = adminOverride ? 'delivery-return-admin-override' : 'delivery-return-confirm'; const claim = await this.idempotency.claim<{ ok: true; associationId: string }>(tx, ctx.accountId, scope, input.opId, { missionId, condition: input.condition, notes: input.notes }); if (!claim.claimed) return { replayed: true as const, ...claim.existingResponse! };
      await tx.$queryRaw`SELECT id FROM delivery_missions WHERE id=${missionId}::uuid FOR UPDATE`;
      const mission = await tx.deliveryMission.findUnique({ where: { id: missionId } }); if (!mission || (!adminOverride && mission.associationId !== ctx.associationId)) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (mission.status !== DeliveryStatus.PENDING_RETURN_APPROVAL) throw new ApiError('RETURN_CONFIRMATION_INVALID', 'المهمة ليست بانتظار تأكيد الإرجاع', 409);
      const needs = await tx.beneficiaryNeed.findMany({ where: { beneficiaryId: mission.beneficiaryId, decisionStatus: NeedDecisionStatus.APPROVED } }); const allocations = await tx.deviceAllocation.findMany({ where: { beneficiaryNeedId: { in: needs.map((n) => n.id) }, status: DeviceAllocationStatus.ACTIVE } }); const now = new Date();
      await tx.deviceAllocation.updateMany({ where: { id: { in: allocations.map((a) => a.id) } }, data: { status: DeviceAllocationStatus.RELEASED, releasedAt: now, releaseReason: input.condition === ReturnCondition.GOOD ? 'physical-return-confirmed' : 'physical-return-damaged' } });
      await tx.deviceMovement.createMany({ data: allocations.map((a) => ({ deviceId: a.deviceId, associationId: mission.associationId, fromLocationType: DeviceMovementLocationType.DELEGATE, fromLocationRef: mission.delegateAccountId, toLocationType: input.condition === ReturnCondition.GOOD ? DeviceMovementLocationType.WAREHOUSE : DeviceMovementLocationType.DAMAGED_HOLDING, toLocationRef: null, reason: input.condition === ReturnCondition.GOOD ? 'physical-return-confirmed' : 'physical-return-damaged', referenceType: 'delivery_mission', referenceId: missionId, performedById: ctx.accountId })) });
      await tx.deviceUnit.updateMany({ where: { id: { in: allocations.map((a) => a.deviceId) } }, data: input.condition === ReturnCondition.GOOD ? { status: DeviceStatus.WAREHOUSE, currentLocationType: DeviceMovementLocationType.WAREHOUSE, currentLocationRef: null } : { status: DeviceStatus.DAMAGED, currentLocationType: DeviceMovementLocationType.DAMAGED_HOLDING, currentLocationRef: null } });
      if (input.condition === ReturnCondition.DAMAGED) await tx.damageCase.createMany({ data: allocations.map((a) => ({ deviceId: a.deviceId, associationId: mission.associationId, quantity: 1, description: input.notes.trim() })) });
      await tx.beneficiaryNeed.updateMany({ where: { id: { in: needs.map((n) => n.id) } }, data: { fulfillmentStatus: NeedFulfillmentStatus.AWAITING_DEVICE } }); await tx.deliveryMission.update({ where: { id: missionId }, data: { status: DeliveryStatus.RETURNED, returnCondition: input.condition } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: mission.associationId, action: adminOverride ? 'DELIVERY_RETURN_ADMIN_OVERRIDE' : 'DELIVERY_PHYSICAL_RETURN_CONFIRMED', entityType: 'delivery_missions', entityId: missionId, metadata: { condition: input.condition, notes: input.notes } } }); const response = { ok: true as const, associationId: mission.associationId }; await this.idempotency.complete(tx, ctx.accountId, scope, input.opId, response); return { replayed: false as const, ...response };
    });
    if (!outcome.replayed) try { await this.allocationTrigger.triggerForAssociation(outcome.associationId); } catch { /* committed return remains authoritative */ }
    return { ok: true as const };
  }

  // ================================================================
  // returnToWarehouse — تخلٍّ نهائي، الجهاز يعود للمستودع (راجع تعليق ReturnDeliveryDto)
  // ================================================================
  async returnToWarehouse(ctx: AuthContext, missionId: string, input: { notes?: string; opId: string }) {
    if (ctx.role !== AccountRole.DELEGATE && ctx.role !== AccountRole.ADMIN && ctx.role !== AccountRole.ASSOCIATION) throw authForbidden();

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ attemptId: string; associationId: string }>(tx, ctx.accountId, 'delivery-return', input.opId, { missionId, ...input });
      if (!claim.claimed) return { replayed: true as const, attemptId: claim.existingResponse!.attemptId, associationId: claim.existingResponse!.associationId };

      const mission = await tx.deliveryMission.findUnique({ where: { id: missionId } });
      if (!mission) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (ctx.role === AccountRole.DELEGATE && mission.delegateAccountId !== ctx.accountId) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== mission.associationId) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
      if (mission.status !== DeliveryStatus.OUT_WITH_DELEGATE && mission.status !== DeliveryStatus.DELIVERY_FAILED) {
        throw new ApiError('DELIVERY_INVALID_TRANSITION', `لا يمكن إرجاع الجهاز من الحالة الحالية (${mission.status})`, 409);
      }

      const needs = await tx.beneficiaryNeed.findMany({
        where: { beneficiaryId: mission.beneficiaryId, decisionStatus: NeedDecisionStatus.APPROVED, fulfillmentStatus: NeedFulfillmentStatus.OUT_WITH_DELEGATE },
      });
      const allocations = await tx.deviceAllocation.findMany({
        where: { beneficiaryNeedId: { in: needs.map((n) => n.id) }, status: DeviceAllocationStatus.ACTIVE },
      });

      const now = new Date();
      await tx.deliveryMission.update({ where: { id: mission.id }, data: { status: DeliveryStatus.RETURNED } });

      // الجهاز يعود فعليًا للمستودع — نفس نمط الإفراج في AutoAllocationService (RELEASED + إعادة الحالة).
      if (allocations.length > 0) {
        await tx.deviceAllocation.updateMany({
          where: { id: { in: allocations.map((a) => a.id) } },
          data: { status: DeviceAllocationStatus.RELEASED, releasedAt: now, releaseReason: 'delegate-return' },
        });
        await tx.deviceMovement.createMany({
          data: allocations.map((allocation) => ({
            deviceId: allocation.deviceId,
            associationId: mission.associationId,
            fromLocationType: DeviceMovementLocationType.DELEGATE,
            fromLocationRef: mission.delegateAccountId,
            toLocationType: DeviceMovementLocationType.WAREHOUSE,
            toLocationRef: null,
            reason: 'delegate-return',
            referenceType: 'delivery_mission',
            referenceId: mission.id,
            performedById: ctx.accountId,
          })),
        });
        await tx.deviceUnit.updateMany({
          where: { id: { in: allocations.map((a) => a.deviceId) } },
          data: { status: DeviceStatus.WAREHOUSE, currentLocationType: DeviceMovementLocationType.WAREHOUSE, currentLocationRef: null },
        });
      }
      // الاحتياج يعود لبداية طابور التخصيص — AutoAllocation هي من تُعيد مطابقته (بمن فيهم الجهاز
      // نفسه أو غيره)، لا ربط يدوي مباشر لجهاز بعينه (rule B: تحسين معماري حقيقي على القديم).
      await tx.beneficiaryNeed.updateMany({ where: { id: { in: needs.map((n) => n.id) } }, data: { fulfillmentStatus: NeedFulfillmentStatus.AWAITING_DEVICE } });

      const attempt = await tx.deliveryAttempt.create({
        data: {
          publicCode: await this.publicCode.nextPublicCode(tx, 'DAT'),
          missionId: mission.id, beneficiaryId: mission.beneficiaryId, delegateAccountId: mission.delegateAccountId ?? ctx.accountId,
          status: DeliveryStatus.RETURNED, notes: input.notes ?? null, attemptedAt: now,
        },
      });

      const response = { attemptId: attempt.id, associationId: mission.associationId };
      await this.idempotency.complete(tx, ctx.accountId, 'delivery-return', input.opId, response);
      return { replayed: false as const, attemptId: attempt.id, associationId: mission.associationId };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'DELIVERY_RETURNED', 'delivery_missions', missionId, { attemptId: outcome.attemptId });
      // إعادة تقييم فورية أفضل من انتظار الحدث التالي — فشلها لا يُسقط عملية الإرجاع نفسها (نفس مبدأ fireAllocationTrigger في beneficiaries.service.ts).
      try {
        await this.allocationTrigger.triggerForAssociation(outcome.associationId);
      } catch {
        /* best-effort — الاحتياج يبقى AWAITING_DEVICE وسيُعاد تقييمه في أي تشغيل لاحق */
      }
    }
    return { ok: true as const, attemptId: outcome.attemptId };
  }

  // ================================================================
  // listDeliveries — عزل الأدوار: DELEGATE مهامه فقط، ASSOCIATION جمعيتها فقط، ADMIN الكل
  // ================================================================
  async listDeliveries(
    ctx: AuthContext,
    params: PaginationParams & { associationId?: string; delegateId?: string; beneficiaryId?: string; status?: DeliveryStatus },
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);
    const where: Prisma.DeliveryMissionWhereInput = {};

    if (ctx.role === AccountRole.DELEGATE) where.delegateAccountId = ctx.accountId;
    else if (ctx.role === AccountRole.ASSOCIATION) where.associationId = ctx.associationId ?? undefined;
    else {
      if (params.associationId) where.associationId = params.associationId;
      if (params.delegateId) where.delegateAccountId = params.delegateId;
    }
    if (params.beneficiaryId) where.beneficiaryId = params.beneficiaryId;
    if (params.status) where.status = params.status;

    const [items, total] = await prisma.$transaction([
      prisma.deliveryMission.findMany({
        where,
        select: {
          id: true, publicCode: true, status: true, assignedAt: true, createdAt: true,
          beneficiaryId: true, associationId: true, delegateAccountId: true,
          beneficiary: { select: { name: true, region: true, city: true, district: true, phone: true, latitude: true, longitude: true } },
          delegate: { select: { name: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.deliveryMission.count({ where }),
    ]);

    return toPaginatedResult(items, total, page, pageSize);
  }

  // ================================================================
  // getDeliveryDetail — يتضمَّن سجل المحاولات الكامل (DEL-011، تراكمي لا يُمحى أبدًا)
  // ================================================================
  async getDeliveryDetail(ctx: AuthContext, missionId: string) {
    const mission = await prisma.deliveryMission.findUnique({
      where: { id: missionId },
      include: {
        beneficiary: { select: { name: true, region: true, city: true, district: true, phone: true, address: true, latitude: true, longitude: true } },
        delegate: { select: { name: true, phone: true, publicCode: true } },
        attempts: { orderBy: { attemptedAt: 'desc' }, select: { id: true, publicCode: true, status: true, failureReason: true, notes: true, attemptedAt: true, proofFileId: true, recipientSignatureFileId: true } },
        approvals: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!mission) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
    if (ctx.role === AccountRole.DELEGATE && mission.delegateAccountId !== ctx.accountId) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);
    if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== mission.associationId) throw new ApiError('DELIVERY_MISSION_NOT_FOUND', 'مهمة التسليم غير موجودة', 404);

    return {
      ...mission,
      attempts: mission.attempts.map((a) => ({ ...a, hasProof: !!a.proofFileId, hasRecipientSignature: !!a.recipientSignatureFileId, proofFileId: undefined, recipientSignatureFileId: undefined })),
    };
  }

  // ================================================================
  // getDeliveryProofImage — DEL-010: رابط موقَّت فقط عند الطلب الصريح، لا رابط دائم أبدًا
  // ================================================================
  async getDeliveryProofUrl(ctx: AuthContext, attemptId: string): Promise<{ url: string }> {
    const attempt = await prisma.deliveryAttempt.findUnique({ where: { id: attemptId }, include: { mission: true, proofFile: true } });
    if (!attempt || !attempt.proofFile) throw new ApiError('DELIVERY_PROOF_NOT_FOUND', 'لا توجد صورة إثبات لهذه المحاولة', 404);
    if (ctx.role === AccountRole.DELEGATE && attempt.delegateAccountId !== ctx.accountId) throw new ApiError('DELIVERY_PROOF_NOT_FOUND', 'لا توجد صورة إثبات لهذه المحاولة', 404);
    if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== attempt.mission.associationId) throw new ApiError('DELIVERY_PROOF_NOT_FOUND', 'لا توجد صورة إثبات لهذه المحاولة', 404);

    const url = await this.storage.getSignedGetUrl(attempt.proofFile.objectKey, storageConfig.licenseSignedUrlSeconds);
    await this.audit.log(this.actor(ctx), 'DELIVERY_PROOF_VIEWED', 'delivery_attempts', attemptId);
    return { url };
  }

  async getDeliverySignatureUrl(ctx: AuthContext, attemptId: string): Promise<{ url: string }> {
    const attempt = await prisma.deliveryAttempt.findUnique({ where: { id: attemptId }, include: { mission: true, signatureFile: true } });
    if (!attempt?.signatureFile || attempt.signatureFile.category !== FileCategory.DELIVERY_RECIPIENT_SIGNATURE) throw new ApiError('DELIVERY_SIGNATURE_NOT_FOUND', 'لا يوجد توقيع مستفيد لهذه المحاولة', 404);
    if (ctx.role === AccountRole.DELEGATE && attempt.delegateAccountId !== ctx.accountId) throw new ApiError('DELIVERY_SIGNATURE_NOT_FOUND', 'لا يوجد توقيع مستفيد لهذه المحاولة', 404);
    if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== attempt.mission.associationId) throw new ApiError('DELIVERY_SIGNATURE_NOT_FOUND', 'لا يوجد توقيع مستفيد لهذه المحاولة', 404);
    const url = await this.storage.getSignedGetUrl(attempt.signatureFile.objectKey, storageConfig.licenseSignedUrlSeconds);
    await this.audit.log(this.actor(ctx), 'DELIVERY_SIGNATURE_VIEWED', 'delivery_attempts', attemptId); return { url };
  }
}
