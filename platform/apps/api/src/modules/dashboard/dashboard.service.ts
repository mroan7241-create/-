import { Injectable } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { authForbidden } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';
import { adminApplicationScopeWhere, adminAssociationScopeWhere, adminAuditScopeWhere } from '../auth/admin-route-permissions';

@Injectable()
export class DashboardService {
  async admin(ctx?: AuthContext) {
    const applicationScope = ctx ? adminApplicationScopeWhere(ctx) : {};
    const associationScope = ctx ? adminAssociationScopeWhere(ctx) : {};
    const linkedScope = Object.keys(associationScope).length ? { association: { is: associationScope } } : {};
    const auditScope = ctx ? await adminAuditScopeWhere(ctx) : {};
    const [
      pendingApplications, associationGroups, beneficiaryGroups, deviceGroups,
      receiptsAwaitingConfirmation, delegates, deliveryGroups, activities, recentOperations,
    ] = await prisma.$transaction([
      prisma.associationApplication.count({ where: {
        ...applicationScope,
        status: 'UNDER_REVIEW',
        OR: [
          { eligibilityStatus: 'PENDING' },
          { eligibilityStatus: 'PASSED', selectionList: 'NONE' },
        ],
      } }),
      prisma.association.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: { ...associationScope, archivedAt: null }, _count: { _all: true as const } }),
      prisma.beneficiary.groupBy({ by: ['reviewStatus'], orderBy: { reviewStatus: 'asc' }, where: { ...linkedScope, archivedAt: null }, _count: { _all: true as const } }),
      prisma.deviceUnit.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: linkedScope, _count: { _all: true as const } }),
      prisma.receiptBatch.count({ where: { ...linkedScope, status: 'AWAITING_ASSOCIATION_CONFIRMATION' } }),
      prisma.account.count({ where: { ...linkedScope, role: 'DELEGATE', archivedAt: null } }),
      prisma.deliveryMission.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: linkedScope, _count: { _all: true as const } }),
      prisma.activity.findMany({ orderBy: [{ phaseOrder: 'asc' }, { mainActivityOrder: 'asc' }, { createdAt: 'asc' }], include: { evidence: { select: { id: true, approvalStatus: true, notes: true, uploadedAt: true } } } }),
      prisma.auditLog.findMany({ where: auditScope, orderBy: { createdAt: 'desc' }, take: 8, include: { actorAccount: { select: { name: true, role: true, publicCode: true } } } }),
    ]);
    const associations = associationGroups.reduce((sum, group) => sum + groupedCount(group), 0);
    const activeAssociations = groupedCount(associationGroups.find((group) => group.status === 'ACTIVE'));
    const inactiveAssociations = groupedCount(associationGroups.find((group) => group.status === 'INACTIVE'));
    const totalBeneficiaries = beneficiaryGroups.reduce((sum, group) => sum + groupedCount(group), 0);
    const approvedBeneficiaries = groupedCount(beneficiaryGroups.find((group) => group.reviewStatus === 'APPROVED'));
    const beneficiariesPendingReview = groupedCount(beneficiaryGroups.find((group) => group.reviewStatus === 'UNDER_REVIEW'));
    const rejectedBeneficiaries = groupedCount(beneficiaryGroups.find((group) => group.reviewStatus === 'REJECTED'));
    const warehouseDevices = groupedCount(deviceGroups.find((group) => group.status === 'WAREHOUSE'));
    const allocatedDevices = groupedCount(deviceGroups.find((group) => group.status === 'ALLOCATED'));
    const damagedDevices = groupedCount(deviceGroups.find((group) => group.status === 'DAMAGED'));
    const devicesWithDelegate = groupedCount(deviceGroups.find((group) => group.status === 'WITH_DELEGATE'));
    const devicesDelivered = groupedCount(deviceGroups.find((group) => group.status === 'DELIVERED'));
    const deliveriesPreparing = groupedCount(deliveryGroups.find((group) => group.status === 'PREPARING'));
    const deliveriesOutWithDelegate = groupedCount(deliveryGroups.find((group) => group.status === 'OUT_WITH_DELEGATE'));
    const deliveriesFailed = groupedCount(deliveryGroups.find((group) => group.status === 'DELIVERY_FAILED'));
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

function groupedCount(group: { _count?: true | { _all?: number } } | undefined): number {
  return group && typeof group._count === 'object' ? group._count._all ?? 0 : 0;
}
