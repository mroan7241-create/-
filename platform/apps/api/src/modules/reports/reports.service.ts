import { HttpStatus, Injectable } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';
import type { AssociationReportQueryDto } from './dto/association-report-query.dto';
import type { AbanmiReportQueryDto } from './dto/abanmi-report-query.dto';

const DAY_MS = 86_400_000;

function countMap<T extends { _count: { _all: number } }>(rows: T[], key: keyof T): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [String(row[key]), row._count._all]));
}

function aggregateCount(row: { _count?: true | { _all?: number } }): number {
  return typeof row._count === 'object' ? row._count._all ?? 0 : 0;
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
  async abanmiReport(ctx: AuthContext, query: AbanmiReportQueryDto) {
    if (ctx.role !== AccountRole.ABANMI) throw authForbidden();
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined;
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime())) || (from && to && from > to)) {
      throw new ApiError('REPORT_PERIOD_INVALID', 'الفترة الزمنية غير صحيحة', HttpStatus.BAD_REQUEST);
    }
    if (from && to && to.getTime() - from.getTime() > 366 * DAY_MS) {
      throw new ApiError('REPORT_PERIOD_TOO_LONG', 'الحد الأقصى لفترة التقرير 366 يومًا', HttpStatus.BAD_REQUEST);
    }
    const associations = await prisma.association.findMany({
      where: { archivedAt: null, ...(query.associationId ? { id: query.associationId } : {}), ...(query.region ? { region: query.region } : {}) },
      select: { id: true, publicCode: true, name: true, region: true, city: true, status: true },
      orderBy: [{ region: 'asc' }, { name: 'asc' }],
    });
    const associationIds = associations.map((association) => association.id);
    const createdAt = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
    const scope = { associationId: { in: associationIds } };
    const [beneficiaries, needs, inventory, deliveries, participations, closures, activities, projectClosure] = await prisma.$transaction([
      prisma.beneficiary.groupBy({ by: ['associationId', 'reviewStatus'], where: { ...scope, archivedAt: null, ...(createdAt ? { createdAt } : {}) }, orderBy: { associationId: 'asc' }, _count: { _all: true } }),
      prisma.beneficiaryNeed.groupBy({ by: ['associationId', 'deviceType', 'decisionStatus', 'fulfillmentStatus'], where: { ...scope, ...(createdAt ? { createdAt } : {}) }, orderBy: { associationId: 'asc' }, _count: { _all: true } }),
      prisma.deviceUnit.groupBy({ by: ['associationId', 'deviceType', 'status'], where: scope, orderBy: { associationId: 'asc' }, _count: { _all: true } }),
      prisma.deliveryMission.groupBy({ by: ['associationId', 'status'], where: { ...scope, ...(createdAt ? { createdAt } : {}) }, orderBy: { associationId: 'asc' }, _count: { _all: true } }),
      prisma.projectParticipation.groupBy({ by: ['associationId', 'status'], where: { associationId: { in: associationIds } }, orderBy: { associationId: 'asc' }, _count: { _all: true } }),
      prisma.organizationClosureReport.findMany({ where: { participation: { associationId: { in: associationIds } } }, select: { status: true, generatedAt: true, closedAt: true, participation: { select: { associationId: true } } } }),
      prisma.activity.findMany({ orderBy: [{ phaseOrder: 'asc' }, { mainActivityOrder: 'asc' }], select: { id: true, phaseOrder: true, phaseName: true, mainActivityOrder: true, mainActivityName: true, subActivityName: true, completionPercent: true, status: true, startDate: true, endDate: true, evidenceUrl: true } }),
      prisma.projectClosureReport.findUnique({ where: { projectKey: 'electrical-appliances' }, select: { status: true, updatedAt: true } }),
    ]);
    const byRegion = Object.values(associations.reduce<Record<string, { region: string; associations: number }>>((acc, association) => {
      acc[association.region] ??= { region: association.region, associations: 0 };
      acc[association.region].associations += 1;
      return acc;
    }, {}));
    return {
      filters: { from: query.from ?? null, to: query.to ?? null, associationId: query.associationId ?? null, region: query.region ?? null },
      generatedAt: new Date().toISOString(),
      overall: {
        associations: associations.length,
        beneficiaries: beneficiaries.reduce((sum, row) => sum + aggregateCount(row), 0),
        approvedNeeds: needs.filter((row) => row.decisionStatus === 'APPROVED').reduce((sum, row) => sum + aggregateCount(row), 0),
        devices: inventory.reduce((sum, row) => sum + aggregateCount(row), 0),
        deliveries: deliveries.reduce((sum, row) => sum + aggregateCount(row), 0),
      },
      associations, byRegion,
      beneficiariesAndNeeds: { beneficiaries, needs },
      devicesAndInventory: inventory,
      deliveryAndExecution: deliveries,
      participation: participations,
      associationClosure: closures,
      projectClosure, activities,
      privacy: { beneficiaryPiiIncluded: false },
    };
  }

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
    ] = await reportQuery('DATA', prisma.$transaction([
      prisma.association.findUniqueOrThrow({
        where: { id: associationId },
        select: { id: true, publicCode: true, name: true, region: true, city: true },
      }),
      prisma.beneficiary.count({ where: { associationId, archivedAt: null } }),
      prisma.beneficiary.groupBy({ by: ['reviewStatus'], where: { associationId, archivedAt: null }, _count: { _all: true } }),
      prisma.beneficiaryNeed.count({ where: { associationId } }),
      prisma.beneficiaryNeed.groupBy({ by: ['decisionStatus'], where: { associationId }, _count: { _all: true } }),
      prisma.beneficiaryNeed.groupBy({ by: ['fulfillmentStatus'], where: { associationId }, _count: { _all: true } }),
      prisma.deviceUnit.count({ where: { associationId } }),
      prisma.deviceUnit.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      prisma.deviceUnit.groupBy({ by: ['deviceType'], where: { associationId }, _count: { _all: true } }),
      prisma.receiptBatch.count({ where: { associationId, createdAt: inPeriod } }),
      prisma.receiptBatch.groupBy({ by: ['status'], where: { associationId, createdAt: inPeriod }, _count: { _all: true } }),
      prisma.deliveryMission.count({ where: { associationId } }),
      prisma.deliveryMission.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      prisma.deliveryAttempt.count({ where: { mission: { associationId }, attemptedAt: inPeriod } }),
      prisma.deliveryAttempt.groupBy({ by: ['status'], where: { mission: { associationId }, attemptedAt: inPeriod }, _count: { _all: true } }),
      prisma.deviceMovement.count({ where: { associationId, createdAt: inPeriod } }),
      prisma.auditLog.findMany({
        where: { associationId, createdAt: inPeriod },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { action: true, entityType: true, createdAt: true },
      }),
    ]));

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
