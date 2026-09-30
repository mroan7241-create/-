import { jest } from '@jest/globals';
import { AccountRole, prisma } from '@alzad/db';
import type { AuthContext } from '../auth/auth.types';
import { ReportsService } from './reports.service';

const context: AuthContext = {
  accountId: 'admin', role: AccountRole.ABANMI, associationId: null,
  sessionId: 'session', mustChangePassword: false,
};

describe('ReportsService abanmiReport association scope', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockReads(hasAssociation: boolean) {
    const association = { id: 'association-1', publicCode: 'A1', name: 'جمعية القصيم', region: 'القصيم', city: 'بريدة', status: 'ACTIVE' };
    const application = {
      id: 'application-1', publicCode: 'APP1', name: 'جمعية متقدمة', region: 'القصيم',
      status: 'SUBMITTED', eligibilityStatus: 'PENDING', selectionList: 'NONE',
      processingStartedAt: new Date('2026-09-10T10:00:00Z'), submittedAt: new Date('2026-09-09T10:00:00Z'),
    };
    const activities = [{ id: 'activity-1', mainActivityName: 'إعداد المشروع', status: 'NOT_STARTED' }];
    const projectClosure = { status: 'DRAFT', updatedAt: new Date('2026-09-10T10:00:00Z') };
    const associationRead = jest.spyOn(prisma.association, 'findMany').mockResolvedValue((hasAssociation ? [association] : []) as never);
    const beneficiaryRead = jest.spyOn(prisma.beneficiary, 'groupBy').mockResolvedValue([{ associationId: association.id, reviewStatus: 'APPROVED', _count: { _all: 4 } }] as never);
    const needsRead = jest.spyOn(prisma.beneficiaryNeed, 'groupBy').mockResolvedValue([{ associationId: association.id, decisionStatus: 'APPROVED', _count: { _all: 5 } }] as never);
    const inventoryRead = jest.spyOn(prisma.deviceUnit, 'groupBy').mockResolvedValue([{ associationId: association.id, _count: { _all: 3 } }] as never);
    const deliveryRead = jest.spyOn(prisma.deliveryMission, 'groupBy').mockResolvedValue([{ associationId: association.id, _count: { _all: 2 } }] as never);
    const participationRead = jest.spyOn(prisma.projectParticipation, 'groupBy').mockResolvedValue([] as never);
    const closureRead = jest.spyOn(prisma.organizationClosureReport, 'findMany').mockResolvedValue([] as never);
    const activityRead = jest.spyOn(prisma.activity, 'findMany').mockResolvedValue(activities as never);
    const projectClosureRead = jest.spyOn(prisma.projectClosureReport, 'findUnique').mockResolvedValue(projectClosure as never);
    const purchaseRead = jest.spyOn(prisma.purchaseOrder, 'groupBy').mockResolvedValue([] as never);
    const shipmentRead = jest.spyOn(prisma.shipment, 'groupBy').mockResolvedValue([] as never);
    const receiptRead = jest.spyOn(prisma.receiptBatch, 'groupBy').mockResolvedValue([] as never);
    const allocationRead = jest.spyOn(prisma.deviceAllocation, 'groupBy').mockResolvedValue([] as never);
    const applicationRead = jest.spyOn(prisma.associationApplication, 'findMany').mockResolvedValue([application] as never);
    const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((async (queries: Promise<unknown>[]) => Promise.all(queries)) as never);
    const reads = [beneficiaryRead, needsRead, inventoryRead, deliveryRead, participationRead, closureRead, activityRead, projectClosureRead, purchaseRead, shipmentRead, receiptRead, allocationRead, applicationRead];
    return { associationRead, applicationRead, beneficiaryRead, allocationRead, activities, projectClosure, transaction, reads };
  }

  it('executes only the three project/application reads for an empty scope and retains applications', async () => {
    const mock = mockReads(false);
    const filters = { region: 'القصيم', from: '2026-09-01', to: '2026-09-30' };
    const report = await new ReportsService().abanmiReport(context, filters);

    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.transaction.mock.calls[0][0]).toEqual([
      mock.reads[6].mock.results[0].value,
      mock.reads[7].mock.results[0].value,
      mock.reads[12].mock.results[0].value,
    ]);
    expect(report).toMatchObject({
      filters: { ...filters, associationId: null },
      overall: { associations: 0, beneficiaries: 0, approvedNeeds: 0, devices: 0, deliveries: 0 },
      associations: [], byRegion: [], beneficiariesAndNeeds: { beneficiaries: [], needs: [] },
      devicesAndInventory: [], deliveryAndExecution: [], participation: [], associationClosure: [],
      procurement: { purchaseOrders: [], shipments: [], receipts: [] }, allocations: [],
      activities: mock.activities, projectClosure: mock.projectClosure,
      applications: [{ id: 'application-1', region: 'القصيم', processingStarted: true, submittedAt: '2026-09-09T10:00:00.000Z' }],
      privacy: { beneficiaryPiiIncluded: false },
    });
    expect(report.applications[0]).not.toHaveProperty('processingStartedAt');
    expect(mock.applicationRead.mock.calls[0][0]?.where).toEqual({
      region: 'القصيم', submittedAt: { gte: new Date('2026-09-01T00:00:00.000Z'), lte: new Date('2026-09-30T23:59:59.999Z') },
    });
  });

  it('keeps all 13 reads, scoped filters and aggregates when an association exists', async () => {
    const mock = mockReads(true);
    const filters = { associationId: 'association-1', region: 'القصيم', from: '2026-09-01', to: '2026-09-30' };
    const report = await new ReportsService().abanmiReport({ ...context, role: AccountRole.ADMIN }, filters);

    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.transaction.mock.calls[0][0]).toEqual(mock.reads.map((read) => read.mock.results[0].value));
    expect(report.overall).toEqual({ associations: 1, beneficiaries: 4, approvedNeeds: 5, devices: 3, deliveries: 2 });
    expect(mock.associationRead.mock.calls[0][0]?.where).toEqual({ archivedAt: null, id: filters.associationId, region: filters.region });
    expect(mock.applicationRead.mock.calls[0][0]?.where).toMatchObject({ resultingAssociationId: filters.associationId, region: filters.region });
    const dateRange = { gte: new Date('2026-09-01T00:00:00.000Z'), lte: new Date('2026-09-30T23:59:59.999Z') };
    expect(mock.beneficiaryRead.mock.calls[0][0]).toMatchObject({ where: { associationId: { in: [filters.associationId] }, archivedAt: null, createdAt: dateRange } });
    expect(mock.allocationRead.mock.calls[0][0]).toMatchObject({ where: { associationId: { in: [filters.associationId] }, allocatedAt: dateRange } });
  });

  it.each([AccountRole.ASSOCIATION, AccountRole.DELEGATE])('rejects role %s before any database reads', async (role) => {
    const mock = mockReads(false);
    await expect(new ReportsService().abanmiReport({ ...context, role }, {})).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(mock.associationRead).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ from: 'invalid' }, 'REPORT_PERIOD_INVALID'],
    [{ to: 'invalid' }, 'REPORT_PERIOD_INVALID'],
    [{ from: '2026-09-30', to: '2026-09-01' }, 'REPORT_PERIOD_INVALID'],
    [{ from: '2025-01-01', to: '2026-09-30' }, 'REPORT_PERIOD_TOO_LONG'],
  ] as const)('rejects invalid period %j before any database reads', async (query, code) => {
    const mock = mockReads(false);
    await expect(new ReportsService().abanmiReport(context, query)).rejects.toMatchObject({ code });
    expect(mock.associationRead).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
  });
});
