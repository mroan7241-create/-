import { jest } from '@jest/globals';
import { prisma } from '@alzad/db';
import { DashboardService } from './dashboard.service';

describe('Admin dashboard count aggregation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves exact totals and status counts using grouped database reads', async () => {
    const transaction = jest.spyOn(prisma, '$transaction');
    jest.spyOn(prisma.associationApplication, 'count').mockResolvedValue(2);
    jest.spyOn(prisma.association, 'groupBy').mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 4 } }, { status: 'INACTIVE', _count: { _all: 1 } }] as never);
    jest.spyOn(prisma.beneficiary, 'groupBy').mockResolvedValue([{ reviewStatus: 'APPROVED', _count: { _all: 7 } }, { reviewStatus: 'REJECTED', _count: { _all: 1 } }] as never);
    jest.spyOn(prisma.deviceUnit, 'groupBy').mockResolvedValue([{ status: 'WAREHOUSE', _count: { _all: 3 } }, { status: 'WITH_DELEGATE', _count: { _all: 2 } }, { status: 'DELIVERED', _count: { _all: 5 } }] as never);
    jest.spyOn(prisma.receiptBatch, 'count').mockResolvedValue(1);
    jest.spyOn(prisma.account, 'count').mockResolvedValue(2);
    jest.spyOn(prisma.deliveryMission, 'groupBy').mockResolvedValue([{ status: 'PREPARING', _count: { _all: 2 } }, { status: 'DELIVERY_FAILED', _count: { _all: 1 } }] as never);
    jest.spyOn(prisma.activity, 'findMany').mockResolvedValue([]);
    jest.spyOn(prisma.auditLog, 'findMany').mockResolvedValue([]);

    const result = await new DashboardService().admin();
    expect(result.counts).toEqual({
      pendingApplications: 2,
      associations: 5, activeAssociations: 4, inactiveAssociations: 1,
      totalBeneficiaries: 8, approvedBeneficiaries: 7, beneficiariesPendingReview: 0, rejectedBeneficiaries: 1,
      warehouseDevices: 3, allocatedDevices: 0, damagedDevices: 0, receiptsAwaitingConfirmation: 1,
      delegates: 2, devicesWithDelegate: 2, devicesDelivered: 5,
      deliveriesPreparing: 2, deliveriesOutWithDelegate: 0, deliveriesFailed: 1,
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
