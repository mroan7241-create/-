import { jest } from '@jest/globals';
import { AccountRole, OrganizationClosureStatus, ParticipationStatus, prisma } from '@alzad/db';
import { ClosureService } from './closure.service';
import type { ClosureReadinessService } from './closure-readiness.service';
import type { IdempotencyService } from '../../common/idempotency.service';
import type { AuthContext } from '../auth/auth.types';

describe('organization closure transaction safety', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup(status: OrganizationClosureStatus, ready = true) {
    const participation = { id: 'participation-id', associationId: 'association-id', status: ParticipationStatus.CLOSURE_SUBMITTED };
    const report = { id: 'report-id', participationId: participation.id, status, participation, snapshotJson: { source: 'old' } };
    jest.spyOn(prisma.projectParticipation, 'findUnique').mockResolvedValue(participation as never);
    jest.spyOn(prisma.organizationClosureReport, 'findUnique').mockResolvedValue(report as never);
    const lock = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
    jest.spyOn(prisma, '$transaction').mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma) as never);
    const write = jest.spyOn(prisma.organizationClosureReport, 'upsert').mockResolvedValue(report as never);
    const transition = jest.spyOn(prisma.organizationClosureReport, 'update').mockResolvedValue(report as never);
    jest.spyOn(prisma.projectParticipation, 'update').mockResolvedValue(participation as never);
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    const check = jest.fn<() => Promise<unknown>>().mockResolvedValue({ ready, blockers: ready ? [] : [{ code: 'UNRESOLVED_NEEDS', count: 1 }] });
    const idem = { claim: jest.fn<() => Promise<unknown>>().mockResolvedValue({ claimed: true }), complete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) };
    const service = new ClosureService({ check } as unknown as ClosureReadinessService, idem as unknown as IdempotencyService);
    const snapshot = jest.spyOn(service, 'snapshot').mockResolvedValue({ source: 'current' } as never);
    const ctx = { role: AccountRole.ASSOCIATION, accountId: 'account-id', associationId: 'association-id' } as AuthContext;
    return { service, ctx, write, transition, check, idem, snapshot, lock };
  }

  it.each([OrganizationClosureStatus.SUBMITTED, OrganizationClosureStatus.UNDER_REVIEW, OrganizationClosureStatus.APPROVED, OrganizationClosureStatus.CLOSED])('cannot regenerate a %s report', async (status) => {
    const { service, ctx, write } = setup(status);
    await expect(service.generate(ctx, 'participation-id', 'generate-op')).rejects.toMatchObject({ code: 'CLOSURE_REPORT_LOCKED' });
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    [OrganizationClosureStatus.UNDER_REVIEW, OrganizationClosureStatus.APPROVED],
    [OrganizationClosureStatus.APPROVED, OrganizationClosureStatus.CLOSED],
  ])('checks current blockers before %s to %s', async (from, to) => {
    const { service, ctx, transition, check } = setup(from, false);
    await expect(service.transitionOrganization({ ...ctx, role: AccountRole.ADMIN }, 'report-id', to, 'transition-op')).rejects.toMatchObject({ code: 'CLOSURE_NOT_READY' });
    expect(check).toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('replays a completed transition after the report has advanced', async () => {
    const { service, ctx, transition, idem } = setup(OrganizationClosureStatus.APPROVED);
    idem.claim.mockResolvedValue({ claimed: false, existingResponse: { ok: true } });
    await expect(service.transitionOrganization({ ...ctx, role: AccountRole.ADMIN }, 'report-id', OrganizationClosureStatus.UNDER_REVIEW, 'old-op')).resolves.toEqual({ ok: true });
    expect(transition).not.toHaveBeenCalled();
  });

  it('refreshes the reopened report snapshot when it is submitted again', async () => {
    const { service, ctx, transition, snapshot } = setup(OrganizationClosureStatus.REOPENED);
    await service.transitionOrganization(ctx, 'report-id', OrganizationClosureStatus.SUBMITTED, 'submit-op');
    expect(snapshot).toHaveBeenCalledWith('participation-id', prisma);
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ snapshotJson: { source: 'current' } }) }));
  });

  it('takes the participation lock before deciding whether qualitative fields remain editable', async () => {
    const { service, ctx, transition, lock } = setup(OrganizationClosureStatus.GENERATED);
    await service.updateQualitative(ctx, 'report-id', { finalNotes: 'notes' });
    expect(lock).toHaveBeenCalled();
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(transition.mock.invocationCallOrder[0]);
  });
});
