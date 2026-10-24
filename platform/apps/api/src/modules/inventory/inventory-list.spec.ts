import { jest } from '@jest/globals';
import { AccountRole, DeviceStatus, prisma } from '@alzad/db';
import { InventoryService } from './inventory.service';
import type { AuthContext } from '../auth/auth.types';

describe('inventory list and consolidated counts', () => {
  const ctx = { role: AccountRole.ASSOCIATION, associationId: 'tenant-a' } as AuthContext;
  afterEach(() => jest.restoreAllMocks());
  it('ignores a supplied tenant and retains all-status counts when filtering the list', async () => {
    const rows = jest.spyOn(prisma.deviceUnit, 'findMany').mockResolvedValue([]);
    const count = jest.spyOn(prisma.deviceUnit, 'count').mockResolvedValue(0);
    const groups = jest.spyOn(prisma.deviceUnit, 'groupBy').mockResolvedValue([{ status: 'DELIVERED', _count: { _all: 7 } }] as never);
    const result = await new InventoryService(null!, null!).listDeviceUnits(ctx, { associationId: 'tenant-b', status: DeviceStatus.ALLOCATED, includeCounts: 'true' });
    expect(rows).toHaveBeenCalledWith(expect.objectContaining({ where: { associationId: 'tenant-a', status: 'ALLOCATED' } }));
    expect(count).toHaveBeenCalledWith({ where: { associationId: 'tenant-a', status: 'ALLOCATED' } });
    expect(groups).toHaveBeenCalledWith({ by: ['status'], where: { associationId: 'tenant-a' }, _count: { _all: true } });
    expect(result.counts).toMatchObject({ DELIVERED: 7, ALLOCATED: 0, WAREHOUSE: 0 });
  });
  it('does not add a query or change the response for existing callers', async () => {
    jest.spyOn(prisma.deviceUnit, 'findMany').mockResolvedValue([]);
    jest.spyOn(prisma.deviceUnit, 'count').mockResolvedValue(0);
    const groups = jest.spyOn(prisma.deviceUnit, 'groupBy');
    const result = await new InventoryService(null!, null!).listDeviceUnits(ctx, {});
    expect(result).not.toHaveProperty('counts');
    expect(groups).not.toHaveBeenCalled();
  });
  it('rejects missing association scope before reading', async () => {
    const rows = jest.spyOn(prisma.deviceUnit, 'findMany');
    await expect(new InventoryService(null!, null!).listDeviceUnits({ ...ctx, associationId: null }, {})).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(rows).not.toHaveBeenCalled();
  });
});
