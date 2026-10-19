import { Injectable } from '@nestjs/common';
import { AccountRole, BeneficiaryReviewStatus, DeliveryStatus, ReceiptBatchStatus, prisma } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';
import { StorageService } from '../files/storage.service';
import type { AbanmiExploreDto } from './dto/abanmi-explore.dto';

const associationSelect = { id: true, name: true, region: true, publicCode: true } as const;

/** Dedicated ABANMI projections: never serialize a beneficiary, signature, contact or free-text note. */
@Injectable()
export class AbanmiReaderService {
  constructor(private readonly storage: StorageService) {}

  private authorize(ctx: AuthContext) { if (ctx.role !== AccountRole.ABANMI) throw authForbidden(); }

  async explore(ctx: AuthContext, query: AbanmiExploreDto) {
    this.authorize(ctx);
    const association = { archivedAt: null, ...(query.region ? { region: query.region } : {}) };
    const base = { association, ...(query.associationId ? { associationId: query.associationId } : {}),
      ...(query.search?.trim() ? { publicCode: { contains: query.search.trim(), mode: 'insensitive' as const } } : {}) };
    const skip = (query.page - 1) * query.pageSize;
    if (query.kind === 'beneficiaries') {
      if (query.status && !Object.values(BeneficiaryReviewStatus).includes(query.status as BeneficiaryReviewStatus)) throw new ApiError('INVALID_STATUS', 'حالة المستفيد غير صحيحة', 400);
      const where = { ...base, archivedAt: null, ...(query.status ? { reviewStatus: query.status as BeneficiaryReviewStatus } : {}) };
      const [items, total] = await prisma.$transaction([
        prisma.beneficiary.findMany({ where, skip, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, publicCode: true, reviewStatus: true, createdAt: true, association: { select: associationSelect },
            needs: { select: { deviceType: true, decisionStatus: true, fulfillmentStatus: true } }, _count: { select: { deliveryMissions: true } } } }),
        prisma.beneficiary.count({ where }),
      ]);
      return { items: items.map(({ reviewStatus, ...row }) => ({ ...row, status: reviewStatus })), total, page: query.page, pageSize: query.pageSize };
    }
    if (query.kind === 'receipts') {
      if (query.status && !Object.values(ReceiptBatchStatus).includes(query.status as ReceiptBatchStatus)) throw new ApiError('INVALID_STATUS', 'حالة المحضر غير صحيحة', 400);
      const where = { ...base, ...(query.status ? { status: query.status as ReceiptBatchStatus } : {}) };
      const [items, total] = await prisma.$transaction([
        prisma.receiptBatch.findMany({ where, skip, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, publicCode: true, status: true, createdAt: true, confirmedAt: true, association: { select: associationSelect }, _count: { select: { items: true } } } }),
        prisma.receiptBatch.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    }
    // COMPLETED is a read-filter group, never a persisted workflow status.
    const completed = query.status === 'COMPLETED';
    if (query.status && !completed && !Object.values(DeliveryStatus).includes(query.status as DeliveryStatus)) throw new ApiError('INVALID_STATUS', 'حالة التسليم غير صحيحة', 400);
    const where = { ...base, beneficiary: { archivedAt: null }, ...(completed ? { status: { in: [DeliveryStatus.DELIVERED, DeliveryStatus.DELIVERY_CLOSED] } } : query.status ? { status: query.status as DeliveryStatus } : {}) };
    const [items, total] = await prisma.$transaction([
      prisma.deliveryMission.findMany({ where, skip, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, publicCode: true, status: true, createdAt: true, scheduledFor: true, association: { select: associationSelect }, _count: { select: { attempts: true } } } }),
      prisma.deliveryMission.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async record(ctx: AuthContext, kind: string, id: string) {
    this.authorize(ctx);
    if (kind === 'applications') {
      const application = await prisma.associationApplication.findUnique({ where: { id }, select: { id: true, publicCode: true, name: true, region: true, status: true, eligibilityStatus: true, selectionList: true, resultingAssociationId: true } });
      if (!application) throw new ApiError('RECORD_NOT_FOUND', 'الطلب غير موجود', 404);
      const participation = await prisma.projectParticipation.findUnique({ where: { applicationId: id }, select: { status: true, setupCompletedAt: true, activatedAt: true,
        agreements: { orderBy: { version: 'desc' }, take: 1, select: { status: true, signedByOrgAt: true, signedByZaadAt: true, fullyExecutedAt: true } } } });
      return { application, participation };
    }
    if (kind === 'associations') {
      const association = await prisma.association.findFirst({ where: { id, archivedAt: null }, select: { ...associationSelect, city: true, status: true } });
      if (!association) throw new ApiError('RECORD_NOT_FOUND', 'الجمعية غير موجودة', 404);
      const [participation, beneficiaries, inventory, receiptQuantities, shipments, deliveries, approvedNeeds, sent] = await prisma.$transaction([
        prisma.projectParticipation.findUnique({ where: { associationId: id }, select: { status: true, setupCompletedAt: true, activatedAt: true,
          agreements: { orderBy: { version: 'desc' }, take: 1, select: { status: true, signedByOrgAt: true, signedByZaadAt: true, fullyExecutedAt: true } } } }),
        prisma.beneficiary.groupBy({ by: ['reviewStatus'], where: { associationId: id, archivedAt: null }, orderBy: { reviewStatus: 'asc' }, _count: { _all: true } }),
        prisma.deviceUnit.groupBy({ by: ['status'], where: { associationId: id }, orderBy: { status: 'asc' }, _count: { _all: true } }),
        prisma.receiptItem.aggregate({ where: { receiptBatch: { associationId: id, confirmedAt: { not: null }, status: { in: ['RECEIVED_COMPLETE', 'RECEIVED_WITH_DISCREPANCIES'] } } }, _sum: { sentQty: true, goodQty: true, damagedQty: true, missingQty: true } }),
        prisma.shipment.findMany({ where: { associationId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, select: { id: true, publicCode: true, status: true, route: true, items: { select: { purchaseOrderItem: { select: { deviceType: true } }, shippedQty: true } }, _count: { select: { receiptBatches: true } } } }),
        prisma.deliveryMission.groupBy({ by: ['status'], where: { associationId: id }, orderBy: { status: 'asc' }, _count: { _all: true } }),
        prisma.beneficiaryNeed.count({ where: { associationId: id, decisionStatus: 'APPROVED', beneficiary: { archivedAt: null } } }),
        prisma.shipmentItem.aggregate({ where: { shipment: { associationId: id, status: { notIn: ['PLANNED', 'CANCELLED'] } } }, _sum: { shippedQty: true } }),
      ]);
      return { association, participation, beneficiaries, inventory, approvedNeeds, sentQty: sent._sum.shippedQty ?? 0, received: receiptQuantities._sum, shipments: shipments.map(s => ({ ...s, items: s.items.map(i => ({ sentQty: i.shippedQty, deviceType: i.purchaseOrderItem.deviceType })) })), deliveries, shipmentsShownLimit: 50 };
    }
    if (kind === 'beneficiaries') {
      const beneficiary = await prisma.beneficiary.findFirst({ where: { id, archivedAt: null, association: { archivedAt: null } }, select: { id: true, publicCode: true, reviewStatus: true, createdAt: true,
        association: { select: associationSelect }, needs: { select: { publicCode: true, deviceType: true, decisionStatus: true, fulfillmentStatus: true } },
        deviceAllocations: { where: { status: 'ACTIVE' }, select: { device: { select: { publicCode: true, deviceType: true, status: true } } } },
        deliveryMissions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, select: { id: true, publicCode: true, status: true, assignedAt: true, scheduledFor: true } }, _count: { select: { deliveryMissions: true } } } });
      if (!beneficiary) throw new ApiError('RECORD_NOT_FOUND', 'المستفيد غير موجود', 404);
      return beneficiary;
    }
    if (kind === 'receipts') {
      const record = await prisma.receiptBatch.findFirst({ where: { id, association: { archivedAt: null } },
        select: { id: true, publicCode: true, status: true, createdAt: true, sentAt: true, confirmedAt: true,
          association: { select: associationSelect }, items: { orderBy: { publicCode: 'asc' },
            select: { publicCode: true, deviceType: true, sentQty: true, goodQty: true, damagedQty: true, missingQty: true } } } });
      if (!record) throw new ApiError('RECORD_NOT_FOUND', 'المحضر غير موجود', 404);
      return record;
    }
    if (kind !== 'deliveries') throw new ApiError('INVALID_KIND', 'نوع السجل غير صحيح', 400);
    const record = await prisma.deliveryMission.findFirst({ where: { id, association: { archivedAt: null }, beneficiary: { archivedAt: null } },
      select: { id: true, publicCode: true, status: true, createdAt: true, assignedAt: true, scheduledFor: true,
        association: { select: associationSelect }, attempts: { orderBy: [{ attemptedAt: 'desc' }, { id: 'desc' }], take: 100,
          select: { id: true, publicCode: true, status: true, attemptedAt: true, proofFileId: true, recipientSignatureFileId: true } }, _count: { select: { attempts: true } } } });
    if (!record) throw new ApiError('RECORD_NOT_FOUND', 'التسليم غير موجود', 404);
    return { ...record, attempts: record.attempts.map(({ proofFileId, recipientSignatureFileId, ...row }) => ({ ...row, hasProof: Boolean(proofFileId), hasSignature: Boolean(recipientSignatureFileId) })) };
  }

  async deliveryEvidence(ctx: AuthContext, id: string, kind: string) {
    this.authorize(ctx);
    if (!['photo', 'signature'].includes(kind)) throw new ApiError('INVALID_KIND', 'نوع الشاهد غير صحيح', 400);
    const attempt = await prisma.deliveryAttempt.findFirst({ where: { id, mission: { association: { archivedAt: null }, beneficiary: { archivedAt: null } } },
      select: { proofFile: { select: { objectKey: true, mimeType: true } }, signatureFile: { select: { objectKey: true, mimeType: true } } } });
    const file = kind === 'photo' ? attempt?.proofFile : attempt?.signatureFile;
    if (!file) throw new ApiError('EVIDENCE_NOT_FOUND', 'الشاهد غير موجود', 404);
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimeType)) throw new ApiError('EVIDENCE_TYPE_UNSUPPORTED', 'نوع ملف الشاهد غير متاح للعرض الآمن', 400);
    return { url: await this.storage.getSignedGetUrl(file.objectKey, 120), expiresIn: 120 };
  }

  async activities(ctx: AuthContext) {
    this.authorize(ctx);
    return prisma.activity.findMany({ orderBy: [{ phaseOrder: 'asc' }, { mainActivityOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, phaseOrder: true, phaseName: true, mainActivityOrder: true, mainActivityName: true, subActivityName: true,
        status: true, completionPercent: true, startDate: true, endDate: true, evidenceUrl: true,
        evidence: { select: { id: true, approvalStatus: true, uploadedAt: true } } } });
  }

  async evidence(ctx: AuthContext, id: string) {
    this.authorize(ctx);
    const evidence = await prisma.activityEvidence.findUnique({ where: { id }, select: { file: { select: { objectKey: true } } } });
    if (!evidence?.file) throw new ApiError('EVIDENCE_NOT_FOUND', 'ملف الشاهد غير موجود', 404);
    // Membership in ActivityEvidence is mandatory; arbitrary file IDs are never accepted.
    return { url: await this.storage.getSignedGetUrl(evidence.file.objectKey, 300), expiresIn: 300 };
  }
}
