import { jest } from '@jest/globals';
import { prisma } from '@alzad/db';
import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('requires custody movement only after a device leaves the warehouse', async () => {
    const queryRaw = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([] as never);
    jest.spyOn(prisma.deviceUnit, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.shipmentReconciliationIssue, 'findMany').mockResolvedValue([] as never);

    await expect(new ReconciliationService().reconcile('10000000-0000-4000-8000-000000000001')).resolves.toMatchObject({ ok: true, violations: [] });

    const movementQuery = Array.from(queryRaw.mock.calls[1][0] as unknown as string[]).join('?');
    expect(movementQuery).toContain('du.current_location_type<>\'WAREHOUSE\'');
    expect(movementQuery).not.toContain('du.status<>\'WAREHOUSE\'');
  });
});
