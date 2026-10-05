import { jest } from '@jest/globals';
import { ParticipationStatus, prisma } from '@alzad/db';
import { ClosureReadinessService } from './closure-readiness.service';
import type { ReconciliationService } from './reconciliation.service';

describe('damage closure gate', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(Object.values(ParticipationStatus))('uses the actual participation state %s without adding a transition', async (status) => {
    jest.spyOn(prisma.projectParticipation, 'findUnique').mockResolvedValue({ associationId: 'association-a', status } as never);
    for (const delegate of [prisma.beneficiary, prisma.beneficiaryNeed, prisma.deliveryMission, prisma.damageCase,
      prisma.shipmentReconciliationIssue, prisma.escalationCase, prisma.deliveryAttempt]) {
      jest.spyOn(delegate, 'count').mockResolvedValue(0);
    }
    const readiness = new ClosureReadinessService({ reconcile: jest.fn<() => Promise<unknown>>().mockResolvedValue({ violations: [] }) } as unknown as ReconciliationService);
    const result = await readiness.check('participation-id');
    const allowed: ParticipationStatus[] = [ParticipationStatus.ACTIVE, ParticipationStatus.EXECUTING, ParticipationStatus.READY_TO_CLOSE, ParticipationStatus.CLOSURE_SUBMITTED];
    expect(result.ready).toBe(allowed.includes(status));
  });

  it('blocks final association reporting until every damage case is CLOSED', async () => {
    jest.spyOn(prisma.projectParticipation, 'findUnique').mockResolvedValue({ associationId: 'association-a', status: ParticipationStatus.EXECUTING } as never);
    jest.spyOn(prisma.beneficiary, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.beneficiaryNeed, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.deliveryMission, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.shipmentReconciliationIssue, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.escalationCase, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.deliveryAttempt, 'count').mockResolvedValue(0);
    const damageCount = jest.spyOn(prisma.damageCase, 'count').mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const readiness = new ClosureReadinessService({ reconcile: jest.fn<() => Promise<unknown>>().mockResolvedValue({ violations: [] }) } as unknown as ReconciliationService);

    const blocked = await readiness.check('participation-id');
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNRESOLVED_DAMAGE', count: 1 })]));
    expect(damageCount).toHaveBeenCalledWith({ where: { associationId: 'association-a', status: { not: 'CLOSED' } } });

    const ready = await readiness.check('participation-id');
    expect(ready.ready).toBe(true);
    expect(ready.blockers).toEqual([]);
  });
});
