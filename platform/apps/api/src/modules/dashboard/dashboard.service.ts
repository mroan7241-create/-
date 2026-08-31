import { Injectable } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { authForbidden } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';

@Injectable()
export class DashboardService {
  async admin() {
    const [
      pendingApplications, associations, activeAssociations, inactiveAssociations,
      totalBeneficiaries, approvedBeneficiaries, beneficiariesPendingReview, rejectedBeneficiaries,
      warehouseDevices, allocatedDevices, damagedDevices, receiptsAwaitingConfirmation,
      delegates, devicesWithDelegate, devicesDelivered, deliveriesPreparing,
      deliveriesOutWithDelegate, deliveriesFailed, activities, recentOperations,
    ] = await prisma.$transaction([
      prisma.associationApplication.count({ where: { status: 'UNDER_REVIEW' } }),
      prisma.association.count({ where: { archivedAt: null } }),
      prisma.association.count({ where: { archivedAt: null, status: 'ACTIVE' } }),
      prisma.association.count({ where: { archivedAt: null, status: 'INACTIVE' } }),
      prisma.beneficiary.count({ where: { archivedAt: null } }),
      prisma.beneficiary.count({ where: { archivedAt: null, reviewStatus: 'APPROVED' } }),
      prisma.beneficiary.count({ where: { archivedAt: null, reviewStatus: 'UNDER_REVIEW' } }),
      prisma.beneficiary.count({ where: { archivedAt: null, reviewStatus: 'REJECTED' } }),
      prisma.deviceUnit.count({ where: { status: 'WAREHOUSE' } }),
      prisma.deviceUnit.count({ where: { status: 'ALLOCATED' } }),
      prisma.deviceUnit.count({ where: { status: 'DAMAGED' } }),
      prisma.receiptBatch.count({ where: { status: 'AWAITING_ASSOCIATION_CONFIRMATION' } }),
      prisma.account.count({ where: { role: 'DELEGATE', archivedAt: null } }),
      prisma.deviceUnit.count({ where: { status: 'WITH_DELEGATE' } }),
      prisma.deviceUnit.count({ where: { status: 'DELIVERED' } }),
      prisma.deliveryMission.count({ where: { status: 'PREPARING' } }),
      prisma.deliveryMission.count({ where: { status: 'OUT_WITH_DELEGATE' } }),
      prisma.deliveryMission.count({ where: { status: 'DELIVERY_FAILED' } }),
      prisma.activity.findMany({ orderBy: [{ phaseOrder: 'asc' }, { mainActivityOrder: 'asc' }, { createdAt: 'asc' }], include: { evidence: { select: { id: true, approvalStatus: true, notes: true, uploadedAt: true } } } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { actorAccount: { select: { name: true, role: true, publicCode: true } } } }),
    ]);
    return {
      counts: { pendingApplications, associations, activeAssociations, inactiveAssociations, totalBeneficiaries, approvedBeneficiaries, beneficiariesPendingReview, rejectedBeneficiaries, warehouseDevices, allocatedDevices, damagedDevices, receiptsAwaitingConfirmation, delegates, devicesWithDelegate, devicesDelivered, deliveriesPreparing, deliveriesOutWithDelegate, deliveriesFailed },
      activities,
      recentOperations,
    };
  }

  async association(ctx: AuthContext) {
    if (ctx.role !== AccountRole.ASSOCIATION || !ctx.associationId) throw authForbidden();
    const associationId = ctx.associationId;
    const [beneficiariesTotal, beneficiariesPendingReview, receiptsAwaitingConfirmation, devicesAllocated, delegates, devicesWithDelegate, devicesDelivered, deliveriesPendingApproval, deliveriesPendingReturnApproval, deliveriesDeferred, recentOperations] = await prisma.$transaction([
      prisma.beneficiary.count({ where: { associationId, archivedAt: null } }),
      prisma.beneficiary.count({ where: { associationId, archivedAt: null, reviewStatus: 'UNDER_REVIEW' } }),
      prisma.receiptBatch.count({ where: { associationId, status: 'AWAITING_ASSOCIATION_CONFIRMATION' } }),
      prisma.deviceUnit.count({ where: { associationId, status: 'ALLOCATED' } }),
      prisma.account.count({ where: { associationId, role: 'DELEGATE', archivedAt: null } }),
      prisma.deviceUnit.count({ where: { associationId, status: 'WITH_DELEGATE' } }),
      prisma.deviceUnit.count({ where: { associationId, status: 'DELIVERED' } }),
      prisma.deliveryMission.count({ where: { associationId, status: 'PENDING_DELIVERY_APPROVAL' } }),
      prisma.deliveryMission.count({ where: { associationId, status: 'PENDING_RETURN_APPROVAL' } }),
      prisma.deliveryMission.count({ where: { associationId, status: 'DEFERRED' } }),
      prisma.auditLog.findMany({ where: { associationId }, orderBy: { createdAt: 'desc' }, take: 6, include: { actorAccount: { select: { name: true, role: true, publicCode: true } } } }),
    ]);
    return {
      counts: { beneficiariesTotal, beneficiariesPendingReview, receiptsAwaitingConfirmation, devicesAllocated, delegates, devicesWithDelegate, devicesDelivered, deliveriesPendingApproval, deliveriesPendingReturnApproval, deliveriesDeferred },
      recentOperations,
    };
  }
}
