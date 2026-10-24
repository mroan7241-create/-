import { Injectable } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { authForbidden } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';
import { adminApplicationScopeWhere, adminAssociationScopeWhere, adminAuditScopeWhere } from '../auth/admin-route-permissions';
import { boundedReads } from '../../common/bounded-reads';

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
    ] = await boundedReads([
      () => prisma.associationApplication.count({ where: {
        ...applicationScope,
        status: 'UNDER_REVIEW',
        OR: [
          { eligibilityStatus: 'PENDING' },
          { eligibilityStatus: 'PASSED', selectionList: 'NONE' },
        ],
      } }),
      () => prisma.association.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: { ...associationScope, archivedAt: null }, _count: { _all: true as const } }),
      () => prisma.beneficiary.groupBy({ by: ['reviewStatus'], orderBy: { reviewStatus: 'asc' }, where: { ...linkedScope, archivedAt: null }, _count: { _all: true as const } }),
      () => prisma.deviceUnit.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: linkedScope, _count: { _all: true as const } }),
      () => prisma.receiptBatch.count({ where: { ...linkedScope, status: 'AWAITING_ASSOCIATION_CONFIRMATION' } }),
      () => prisma.account.count({ where: { ...linkedScope, role: 'DELEGATE', archivedAt: null } }),
      () => prisma.deliveryMission.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: linkedScope, _count: { _all: true as const } }),
      () => prisma.activity.findMany({ orderBy: [{ phaseOrder: 'asc' }, { mainActivityOrder: 'asc' }, { createdAt: 'asc' }], include: { evidence: { select: { id: true, approvalStatus: true, notes: true, uploadedAt: true } } } }),
      () => prisma.auditLog.findMany({ where: auditScope, orderBy: { createdAt: 'desc' }, take: 8, include: { actorAccount: { select: { name: true, role: true, publicCode: true } } } }),
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
    const [beneficiaries, devices, deliveries, receiptsAwaitingConfirmation, delegates, recentOperations, participation] = await boundedReads([
      () => prisma.beneficiary.groupBy({ by: ['reviewStatus'], where: { associationId, archivedAt: null }, _count: { _all: true as const } }),
      () => prisma.deviceUnit.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true as const } }),
      () => prisma.deliveryMission.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true as const } }),
      () => prisma.receiptBatch.count({ where: { associationId, status: 'AWAITING_ASSOCIATION_CONFIRMATION' } }),
      () => prisma.account.count({ where: { associationId, role: 'DELEGATE', archivedAt: null } }),
      () => prisma.auditLog.findMany({ where: { associationId }, orderBy: { createdAt: 'desc' }, take: 6, include: { actorAccount: { select: { name: true, role: true, publicCode: true } } } }),
      () => prisma.projectParticipation.findUnique({ where: { associationId }, select: { status: true } }),
    ]);
    const beneficiariesTotal = beneficiaries.reduce((sum, row) => sum + groupedCount(row), 0);
    const beneficiariesPendingReview = groupedCount(beneficiaries.find(row => row.reviewStatus === 'UNDER_REVIEW'));
    const beneficiariesApproved = groupedCount(beneficiaries.find(row => row.reviewStatus === 'APPROVED'));
    const beneficiariesRejected = groupedCount(beneficiaries.find(row => row.reviewStatus === 'REJECTED'));
    const devicesAllocated = groupedCount(devices.find(row => row.status === 'ALLOCATED'));
    const devicesWithDelegate = groupedCount(devices.find(row => row.status === 'WITH_DELEGATE'));
    const devicesDelivered = groupedCount(devices.find(row => row.status === 'DELIVERED'));
    const deliveriesPendingApproval = groupedCount(deliveries.find(row => row.status === 'PENDING_DELIVERY_APPROVAL'));
    const deliveriesPendingReturnApproval = groupedCount(deliveries.find(row => row.status === 'PENDING_RETURN_APPROVAL'));
    const deliveriesDeferred = groupedCount(deliveries.find(row => row.status === 'DEFERRED'));
    return {
      counts: { beneficiariesTotal, beneficiariesPendingReview, beneficiariesApproved, beneficiariesRejected, receiptsAwaitingConfirmation, devicesAllocated, delegates, devicesWithDelegate, devicesDelivered, deliveriesPendingApproval, deliveriesPendingReturnApproval, deliveriesDeferred },
      participationStatus: participation?.status ?? null,
      recentOperations,
    };
  }
}

function groupedCount(group: { _count?: true | { _all?: number } } | undefined): number {
  return group && typeof group._count === 'object' ? group._count._all ?? 0 : 0;
}
