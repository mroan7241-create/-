import { jest } from '@jest/globals';
import { AccountRole, prisma } from '@alzad/db';
import type { AuthContext } from '../auth/auth.types';
import { ReportsService } from './reports.service';

describe('association reporting scope and Riyadh date', () => {
  afterEach(() => jest.restoreAllMocks());
  it('uses a Riyadh calendar interval and scopes every read without a sequential transaction', async () => {
    const ctx = { role: AccountRole.ASSOCIATION, associationId: 'tenant-a' } as AuthContext;
    const transaction = jest.spyOn(prisma, '$transaction');
    jest.spyOn(prisma.association, 'findUniqueOrThrow').mockResolvedValue({ id: 'tenant-a' } as never);
    const counts = [prisma.beneficiary, prisma.beneficiaryNeed, prisma.deviceUnit, prisma.receiptBatch, prisma.deliveryMission, prisma.deliveryAttempt, prisma.deviceMovement].map(model => jest.spyOn(model as typeof prisma.beneficiary, 'count').mockResolvedValue(0));
    const groups = [prisma.beneficiary, prisma.beneficiaryNeed, prisma.deviceUnit, prisma.receiptBatch, prisma.deliveryMission, prisma.deliveryAttempt].map(model => jest.spyOn(model as typeof prisma.beneficiary, 'groupBy').mockResolvedValue([] as never));
    const audit = jest.spyOn(prisma.auditLog, 'findMany').mockResolvedValue([]);
    const result = await new ReportsService().associationReport(ctx, { from: '2026-10-25', to: '2026-10-25' });
    const period = { gte: new Date('2026-10-24T21:00:00.000Z'), lt: new Date('2026-10-25T21:00:00.000Z') };
    expect(counts[3]).toHaveBeenCalledWith({ where: { associationId: 'tenant-a', createdAt: period } });
    expect(counts[5]).toHaveBeenCalledWith({ where: { mission: { associationId: 'tenant-a' }, attemptedAt: period } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ where: { associationId: 'tenant-a', createdAt: period } }));
    for (const spy of [...counts, ...groups]) for (const [argument] of spy.mock.calls) expect(JSON.stringify(argument)).toContain('tenant-a');
    expect(result.period.from).toBe('2026-10-25');
    expect(transaction).not.toHaveBeenCalled();
  });
});
