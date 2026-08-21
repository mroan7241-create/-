import { HttpStatus, Injectable } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';
import type { AssociationReportQueryDto } from './dto/association-report-query.dto';

const DAY_MS = 86_400_000;

function countMap<T extends { _count: { _all: number } }>(rows: T[], key: keyof T): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [String(row[key]), row._count._all]));
}

async function reportQuery<T>(section: string, query: Promise<T>): Promise<T> {
  try {
    return await query;
  } catch (error) {
    console.error(`[reports] ${section} query failed`, error);
    throw new ApiError(`REPORT_${section}_FAILED`, 'تعذّر احتساب أحد أقسام التقرير', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@Injectable()
export class ReportsService {
  async associationReport(ctx: AuthContext, query: AssociationReportQueryDto) {
    if (ctx.role !== AccountRole.ASSOCIATION || !ctx.associationId) throw authForbidden();

    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T00:00:00.000Z`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      throw new ApiError('REPORT_PERIOD_INVALID', 'الفترة الزمنية غير صحيحة', HttpStatus.BAD_REQUEST);
    }
    if (to.getTime() - from.getTime() > 366 * DAY_MS) {
      throw new ApiError('REPORT_PERIOD_TOO_LONG', 'الحد الأقصى لفترة التقرير 366 يومًا', HttpStatus.BAD_REQUEST);
    }
    const toExclusive = new Date(to.getTime() + DAY_MS);
    const associationId = ctx.associationId;
    const inPeriod = { gte: from, lt: toExclusive };

    const [
      association,
      beneficiaryTotal,
      beneficiariesByReviewStatus,
      needTotal,
      needsByDecisionStatus,
      needsByFulfillmentStatus,
      inventoryTotal,
      inventoryByStatus,
      inventoryByDeviceType,
      receiptPeriodTotal,
      receiptsByStatus,
      deliveryCurrentTotal,
      deliveriesByStatus,
      attemptsInPeriod,
      attemptsByStatus,
      movementsInPeriod,
      recentOperations,
    ] = await Promise.all([
      reportQuery('ASSOCIATION', prisma.association.findUniqueOrThrow({
        where: { id: associationId },
        select: { id: true, publicCode: true, name: true, region: true, city: true },
      })),
      reportQuery('BENEFICIARY_TOTAL', prisma.beneficiary.count({ where: { associationId, archivedAt: null } })),
      reportQuery('BENEFICIARY_STATUS', prisma.beneficiary.groupBy({ by: ['reviewStatus'], where: { associationId, archivedAt: null }, _count: { _all: true } })),
      reportQuery('NEED_TOTAL', prisma.beneficiaryNeed.count({ where: { associationId } })),
      reportQuery('NEED_DECISION', prisma.beneficiaryNeed.groupBy({ by: ['decisionStatus'], where: { associationId }, _count: { _all: true } })),
      reportQuery('NEED_FULFILLMENT', prisma.beneficiaryNeed.groupBy({ by: ['fulfillmentStatus'], where: { associationId }, _count: { _all: true } })),
      reportQuery('INVENTORY_TOTAL', prisma.deviceUnit.count({ where: { associationId } })),
      reportQuery('INVENTORY_STATUS', prisma.deviceUnit.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } })),
      reportQuery('INVENTORY_TYPE', prisma.deviceUnit.groupBy({ by: ['deviceType'], where: { associationId }, _count: { _all: true } })),
      reportQuery('RECEIPT_TOTAL', prisma.receiptBatch.count({ where: { associationId, createdAt: inPeriod } })),
      reportQuery('RECEIPT_STATUS', prisma.receiptBatch.groupBy({ by: ['status'], where: { associationId, createdAt: inPeriod }, _count: { _all: true } })),
      reportQuery('DELIVERY_TOTAL', prisma.deliveryMission.count({ where: { associationId } })),
      reportQuery('DELIVERY_STATUS', prisma.deliveryMission.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } })),
      reportQuery('ATTEMPT_TOTAL', prisma.deliveryAttempt.count({ where: { mission: { associationId }, attemptedAt: inPeriod } })),
      reportQuery('ATTEMPT_STATUS', prisma.deliveryAttempt.groupBy({ by: ['status'], where: { mission: { associationId }, attemptedAt: inPeriod }, _count: { _all: true } })),
      reportQuery('MOVEMENT_TOTAL', prisma.deviceMovement.count({ where: { associationId, createdAt: inPeriod } })),
      reportQuery('AUDIT', prisma.auditLog.findMany({
        where: { associationId, createdAt: inPeriod },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { action: true, entityType: true, createdAt: true },
      })),
    ]);

    return {
      association,
      period: { from: query.from, to: query.to, generatedAt: new Date().toISOString() },
      beneficiaries: { total: beneficiaryTotal, byReviewStatus: countMap(beneficiariesByReviewStatus, 'reviewStatus') },
      needs: {
        total: needTotal,
        byDecisionStatus: countMap(needsByDecisionStatus, 'decisionStatus'),
        byFulfillmentStatus: countMap(needsByFulfillmentStatus, 'fulfillmentStatus'),
      },
      inventory: {
        total: inventoryTotal,
        byStatus: countMap(inventoryByStatus, 'status'),
        byDeviceType: countMap(inventoryByDeviceType, 'deviceType'),
      },
      receipts: { periodTotal: receiptPeriodTotal, byStatus: countMap(receiptsByStatus, 'status') },
      deliveries: {
        currentTotal: deliveryCurrentTotal,
        byStatus: countMap(deliveriesByStatus, 'status'),
        attemptsInPeriod,
        attemptsByStatus: countMap(attemptsByStatus, 'status'),
      },
      custody: { movementsInPeriod },
      recentOperations,
    };
  }
}
