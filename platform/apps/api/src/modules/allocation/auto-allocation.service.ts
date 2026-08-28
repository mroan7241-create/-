import { Injectable, Logger } from '@nestjs/common';
import {
  prisma,
  Prisma,
  AssociationStatus,
  BeneficiaryReviewStatus,
  NeedDecisionStatus,
  NeedFulfillmentStatus,
  DeviceStatus,
  DeviceAllocationStatus,
  DeviceType,
  AccountRole,
} from '@alzad/db';
import type { AllocationTriggerPort } from './allocation-trigger.port';
import { AuditService } from '../audit/audit.service';
import { planAutoAllocation, type CandidateBeneficiary } from './auto-allocation-planner';
import type { AuthContext } from '../auth/auth.types';
import { ApiError, authForbidden } from '../../common/api-error';

type AllocationRunSummary = { skipped: string | null; completed: number; filled: number; reclaimed: number };

/**
 * ============================================================
 * AutoAllocationService — NODE-5 (يستبدل NoopAllocationTriggerService)
 * ============================================================
 *
 * ينفّذ عقد AllocationTriggerPort الصارم (راجع allocation-trigger.port.ts):
 * لا يُستدعى إلا بعد التزام معاملة المُستدعي، وفشله لا يُسقط أي قرار
 * ناجح فعليًا (المُستدعي — beneficiaries.service.ts/receipts.service.ts —
 * يلتقط الاستثناء بالفعل ويسجّله تحذيرًا فقط).
 *
 * كل القراءة/التخطيط/الكتابة تتم هنا داخل معاملة واحدة، خلف قفل استشاري
 * لكل جمعية (pg_advisory_xact_lock) — نفس نمط acquirePhoneLocks
 * (beneficiary-phone-lock.util.ts، NODE-3.1) — لمنع تشغيلتين متزامنتين
 * لنفس الجمعية من التنافس على نفس المخزون. النطاق لكل association فقط،
 * فلا تتسلسل جمعيات مختلفة ببعضها.
 */
@Injectable()
export class AutoAllocationService implements AllocationTriggerPort {
  private readonly logger = new Logger('AutoAllocationService');

  constructor(private readonly audit: AuditService) {}

  async triggerForAssociation(associationId: string): Promise<void> {
    const summary = await this.executeForAssociation(associationId);

    if (!summary.skipped) {
      await this.audit.log(null, 'AUTO_ALLOCATION_RUN', 'associations', associationId, {
        completedBeneficiaries: summary.completed,
        devicesFilled: summary.filled,
        devicesReclaimed: summary.reclaimed,
      });
      this.logger.log(
        `تخصيص تلقائي — جمعية ${associationId}: ${summary.completed} مستفيدًا مكتمِلًا، ${summary.filled} جهازًا مخصَّصًا (${summary.reclaimed} منها مسترجَع).`,
      );
    }
  }

  /** شاشة التشغيل تقرأ نفس الحقيقة التي يكتبها المحرك؛ لا توجد حالة عرض مشتقة أو مخزنة. */
  async getBaskets(ctx: AuthContext, requestedAssociationId?: string) {
    const associationId = this.resolveAssociationScope(ctx, requestedAssociationId);
    const [association, beneficiaries, stock] = await Promise.all([
      prisma.association.findUnique({ where: { id: associationId }, select: { id: true, publicCode: true, name: true } }),
      prisma.beneficiary.findMany({
        where: {
          associationId,
          archivedAt: null,
          reviewStatus: BeneficiaryReviewStatus.APPROVED,
          needs: { some: { decisionStatus: NeedDecisionStatus.APPROVED } },
        },
        select: {
          id: true,
          publicCode: true,
          name: true,
          needs: {
            where: { decisionStatus: NeedDecisionStatus.APPROVED },
            select: {
              id: true,
              publicCode: true,
              deviceType: true,
              fulfillmentStatus: true,
              allocations: {
                where: { status: DeviceAllocationStatus.ACTIVE },
                select: { id: true, device: { select: { id: true, publicCode: true, status: true } } },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.loadFreeStock(prisma, associationId),
    ]);

    if (!association) throw new ApiError('ASSOCIATION_NOT_FOUND', 'الجمعية غير موجودة', 404);

    const rows = beneficiaries.map((beneficiary) => {
      const missing = beneficiary.needs.filter((need) => need.allocations.length === 0).map((need) => ({
        needId: need.id,
        needPublicCode: need.publicCode,
        deviceType: need.deviceType,
        reason: stock[need.deviceType] > 0 ? 'بانتظار تنفيذ المطابقة' : 'لا يوجد جهاز متاح من هذا النوع في مخزون الجمعية',
      }));
      const complete = missing.length === 0;
      return {
        beneficiary: { id: beneficiary.id, publicCode: beneficiary.publicCode, name: beneficiary.name },
        association,
        complete,
        readyForAssignment: complete && beneficiary.needs.every((need) => need.fulfillmentStatus === NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT),
        missing,
        needs: beneficiary.needs.map((need) => ({
          id: need.id,
          publicCode: need.publicCode,
          deviceType: need.deviceType,
          fulfillmentStatus: need.fulfillmentStatus,
          allocation: need.allocations[0] ? { id: need.allocations[0].id, device: need.allocations[0].device } : null,
        })),
      };
    });
    const complete = rows.filter((row) => row.complete);
    const incomplete = rows.filter((row) => !row.complete);
    return {
      association,
      stock,
      summary: { total: rows.length, complete: complete.length, incomplete: incomplete.length, readyForAssignment: rows.filter((row) => row.readyForAssignment).length },
      complete,
      incomplete,
    };
  }

  async runForAssociation(ctx: AuthContext, associationId: string, opId: string) {
    if (ctx.role !== AccountRole.ADMIN) throw authForbidden();
    const summary = await this.executeForAssociation(associationId);
    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: null }, 'ALLOCATION_RUN_REQUESTED', 'associations', associationId, {
      opId,
      ...summary,
    });
    return { ...summary, baskets: await this.getBaskets(ctx, associationId) };
  }

  private resolveAssociationScope(ctx: AuthContext, requestedAssociationId?: string): string {
    if (ctx.role === AccountRole.ASSOCIATION) {
      if (!ctx.associationId) throw authForbidden();
      if (requestedAssociationId && requestedAssociationId !== ctx.associationId) throw authForbidden();
      return ctx.associationId;
    }
    if (!requestedAssociationId) throw new ApiError('ASSOCIATION_ID_REQUIRED', 'معرّف الجمعية مطلوب', 400);
    return requestedAssociationId;
  }

  private async executeForAssociation(associationId: string): Promise<AllocationRunSummary> {
    return prisma.$transaction(
      async (tx) => {
        await this.acquireAssociationLock(tx, associationId);

        const association = await tx.association.findUnique({ where: { id: associationId }, select: { status: true } });
        // ALLOC-009: تخطٍّ صامت لجمعية غير نشطة — لا يجوز أن يظهر كخطأ لعملية المستدعي الناجحة فعليًا بالفعل.
        if (!association || association.status !== AssociationStatus.ACTIVE) {
          return { skipped: 'inactive-association' as const, completed: 0, filled: 0, reclaimed: 0 };
        }

        const candidates = await this.loadCandidates(tx, associationId);
        if (candidates.length === 0) return { skipped: 'no-candidates' as const, completed: 0, filled: 0, reclaimed: 0 };

        const freeStock = await this.loadFreeStock(tx, associationId);
        const plan = planAutoAllocation(candidates, freeStock);
        if (plan.fills.length === 0) return { skipped: 'nothing-to-allocate' as const, completed: 0, filled: 0, reclaimed: 0 };

        await this.commitPlan(tx, associationId, plan);

        return {
          skipped: null,
          completed: plan.completedBeneficiaryIds.length,
          filled: plan.fills.length,
          reclaimed: plan.reclaims.length,
        };
      },
      // مهلة أطول من الافتراضي (5s) عمدًا: القفل الاستشاري قد يُبقي المعاملة منتظِرة تشغيلة
      // أخرى لنفس الجمعية، وحساب الحقيبة (DP) قد يستغرق وقتًا ملموسًا عند مرشَّحين كثر.
      { timeout: 15000, maxWait: 10000 },
    );
  }

  /** قفل استشاري واحد لكل association+نطاق "allocation" — نفس مبدأ acquirePhoneLocks (NODE-3.1) بلا أي تغيير مخطط. */
  private async acquireAssociationLock(tx: Prisma.TransactionClient, associationId: string): Promise<void> {
    const keyText = `auto-allocation:${associationId}`;
    const rows = await tx.$queryRaw<{ lock_key: bigint }[]>`SELECT hashtextextended(${keyText}, 0) AS lock_key`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${rows[0].lock_key}::bigint)`;
  }

  /** ALLOC-002/003: يستبعد بالكامل أي مستفيد لديه احتياج واحد على الأقل بدأت عهدته فعليًا، أو اكتملت كل احتياجاته بالفعل (لا فجوة). */
  private async loadCandidates(tx: Prisma.TransactionClient, associationId: string): Promise<CandidateBeneficiary[]> {
    const custodyStarted: NeedFulfillmentStatus[] = [
      NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT,
      NeedFulfillmentStatus.ASSIGNED_TO_DELEGATE_PENDING,
      NeedFulfillmentStatus.OUT_WITH_DELEGATE,
      NeedFulfillmentStatus.DEFERRED,
      NeedFulfillmentStatus.AWAITING_RETURN_CONFIRMATION,
      NeedFulfillmentStatus.RETURNED_TO_ASSOCIATION_WAREHOUSE,
      NeedFulfillmentStatus.DELIVERED,
    ];

    const beneficiaries = await tx.beneficiary.findMany({
      where: { associationId, archivedAt: null, reviewStatus: BeneficiaryReviewStatus.APPROVED },
      select: {
        id: true,
        needs: {
          where: { decisionStatus: NeedDecisionStatus.APPROVED },
          select: { id: true, deviceType: true, fulfillmentStatus: true },
        },
      },
    });

    const candidates: CandidateBeneficiary[] = [];
    for (const b of beneficiaries) {
      if (b.needs.length === 0) continue;
      const hasCustodyStarted = b.needs.some((n) => n.fulfillmentStatus && custodyStarted.includes(n.fulfillmentStatus));
      if (hasCustodyStarted) continue;
      candidates.push({
        beneficiaryId: b.id,
        needs: b.needs.map((n) => ({
          needId: n.id,
          deviceType: n.deviceType,
          ready: n.fulfillmentStatus === NeedFulfillmentStatus.DEVICE_READY,
        })),
      });
    }
    return candidates;
  }

  private async loadFreeStock(tx: Prisma.TransactionClient | typeof prisma, associationId: string): Promise<Record<DeviceType, number>> {
    const grouped = await tx.deviceUnit.groupBy({
      by: ['deviceType'],
      where: { associationId, status: DeviceStatus.WAREHOUSE, deviceType: { not: null } },
      _count: { _all: true },
    });
    const stock: Record<DeviceType, number> = { REFRIGERATOR: 0, OVEN: 0, WASHING_MACHINE: 0 };
    for (const row of grouped) {
      if (row.deviceType) stock[row.deviceType] = row._count._all;
    }
    return stock;
  }

  private async commitPlan(
    tx: Prisma.TransactionClient,
    associationId: string,
    plan: ReturnType<typeof planAutoAllocation>,
  ): Promise<void> {
    // مصدر الأجهزة المسترجَعة: التخصيص النشط الحالي لكل احتياج مانح.
    const reclaimNeedIds = plan.reclaims.map((r) => r.fromNeedId);
    const reclaimAllocations = reclaimNeedIds.length
      ? await tx.deviceAllocation.findMany({
          where: { beneficiaryNeedId: { in: reclaimNeedIds }, status: DeviceAllocationStatus.ACTIVE },
          select: { id: true, deviceId: true, beneficiaryNeedId: true },
        })
      : [];
    const activeAllocationByNeedId = new Map(reclaimAllocations.map((a) => [a.beneficiaryNeedId, a]));

    // مصدر الأجهزة الحرة: طابور مفروز حتميًا لكل نوع من المخزون الحر الفعلي وقت الكتابة (لا يقين زمني — داخل نفس القفل).
    const freeUnits = await tx.deviceUnit.findMany({
      where: { associationId, status: DeviceStatus.WAREHOUSE, deviceType: { not: null } },
      select: { id: true, deviceType: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const freeQueueByType: Record<DeviceType, string[]> = { REFRIGERATOR: [], OVEN: [], WASHING_MACHINE: [] };
    for (const u of freeUnits) if (u.deviceType) freeQueueByType[u.deviceType].push(u.id);

    const newAllocations: Prisma.DeviceAllocationCreateManyInput[] = [];
    const releasedAllocationIds: string[] = [];
    const donorNeedIds: string[] = [];
    const allocatedDeviceIds: string[] = [];
    const filledNeedIds: string[] = [];

    let reclaimCursor = 0;
    for (const fill of plan.fills) {
      let deviceId: string | undefined;
      if (fill.source === 'free') {
        deviceId = freeQueueByType[fill.deviceType].shift();
      } else {
        const donor = plan.reclaims[reclaimCursor++];
        const activeAllocation = donor ? activeAllocationByNeedId.get(donor.fromNeedId) : undefined;
        if (donor && activeAllocation) {
          releasedAllocationIds.push(activeAllocation.id);
          donorNeedIds.push(donor.fromNeedId);
          deviceId = activeAllocation.deviceId;
        }
      }
      if (!deviceId) {
        throw new Error(
          `تعارض بيانات أثناء تنفيذ خطة التخصيص التلقائي (جمعية ${associationId}, نوع ${fill.deviceType}) — تراجع كامل، لا كتابة جزئية.`,
        );
      }
      newAllocations.push({
        deviceId,
        beneficiaryNeedId: fill.needId,
        beneficiaryId: fill.beneficiaryId,
        associationId,
        status: DeviceAllocationStatus.ACTIVE,
        source: 'auto-allocator',
      });
      allocatedDeviceIds.push(deviceId);
      filledNeedIds.push(fill.needId);
    }

    // ترتيب الكتابة: التخصيصات المُلغاة أولًا (تحرّر الفهرس الجزئي الفريد لكل جهاز)، ثم الجديدة — يتجنّب تعارض "أكثر من تخصيص نشط لنفس الجهاز" في نفس المعاملة.
    if (releasedAllocationIds.length) {
      await tx.deviceAllocation.updateMany({
        where: { id: { in: releasedAllocationIds } },
        data: { status: DeviceAllocationStatus.RELEASED, releasedAt: new Date(), releaseReason: 'auto-allocator-reclaim' },
      });
      await tx.beneficiaryNeed.updateMany({
        where: { id: { in: donorNeedIds } },
        data: { fulfillmentStatus: NeedFulfillmentStatus.AWAITING_DEVICE },
      });
    }

    if (newAllocations.length) {
      await tx.deviceAllocation.createMany({ data: newAllocations });
      await tx.deviceUnit.updateMany({ where: { id: { in: allocatedDeviceIds } }, data: { status: DeviceStatus.ALLOCATED } });
      await tx.beneficiaryNeed.updateMany({
        where: { id: { in: filledNeedIds } },
        data: { fulfillmentStatus: NeedFulfillmentStatus.DEVICE_READY },
      });
    }

    // انتقال جماعي: كل مستفيد اكتملت **جميع** احتياجاته المعتمدة الآن (جهاز جاهز) ينتقل معًا إلى "بانتظار تعيين مندوب".
    if (plan.completedBeneficiaryIds.length) {
      await tx.beneficiaryNeed.updateMany({
        where: {
          beneficiaryId: { in: plan.completedBeneficiaryIds },
          decisionStatus: NeedDecisionStatus.APPROVED,
          fulfillmentStatus: NeedFulfillmentStatus.DEVICE_READY,
        },
        data: { fulfillmentStatus: NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT },
      });
    }
  }
}
