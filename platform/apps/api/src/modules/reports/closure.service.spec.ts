import { jest } from '@jest/globals';
import { AccountRole, OrganizationClosureStatus, ParticipationStatus, ProjectClosureStatus, prisma } from '@alzad/db';
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

describe('project closure snapshot safety', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup(status: ProjectClosureStatus = ProjectClosureStatus.GENERATED) {
    const organization = { id: 'organization-report', status: OrganizationClosureStatus.CLOSED, snapshotJson: { total: 2 } };
    const participation = { id: 'participation', status: ParticipationStatus.CLOSED, closureReport: organization };
    const report = { id: 'project-report', status, snapshotJson: { organizationReports: [{ id: organization.id, snapshotJson: organization.snapshotJson }] }, donorFeedbackNotes: 'feedback' };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma) as never);
    const rowLock = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
    const admissionLock = jest.spyOn(prisma, '$executeRaw').mockResolvedValue(1);
    const current = jest.spyOn(prisma.projectClosureReport, 'findUnique').mockResolvedValue(report as never);
    const roster = jest.spyOn(prisma.projectParticipation, 'findMany').mockResolvedValue([participation] as never);
    jest.spyOn(prisma.projectParticipation, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.organizationClosureReport, 'findMany').mockResolvedValue([organization] as never);
    const generate = jest.spyOn(prisma.projectClosureReport, 'upsert').mockResolvedValue(report as never);
    const transition = jest.spyOn(prisma.projectClosureReport, 'update').mockResolvedValue(report as never);
    const audit = jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    const service = new ClosureService({} as ClosureReadinessService, {} as IdempotencyService);
    const ctx = { role: AccountRole.ADMIN, accountId: 'owner' } as AuthContext;
    return { service, ctx, current, report, participation, organization, roster, generate, transition, audit, rowLock, admissionLock };
  }

  it.each([ProjectClosureStatus.SUBMITTED_TO_DONOR, ProjectClosureStatus.RESUBMITTED, ProjectClosureStatus.DONOR_APPROVED, ProjectClosureStatus.PROJECT_CLOSED])('does not replace an externally submitted or final %s snapshot', async (status) => {
    const { service, ctx, generate } = setup(status);
    await expect(service.generateProject(ctx)).rejects.toMatchObject({ code: 'PROJECT_CLOSURE_REPORT_LOCKED' });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([ProjectClosureStatus.GENERATED, ProjectClosureStatus.UNDER_INTERNAL_REVIEW, ProjectClosureStatus.APPROVED_INTERNAL])('an explicit pre-submission refresh of %s starts internal review again', async (status) => {
    const { service, ctx, generate, audit } = setup(status);
    await service.generateProject(ctx);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: ProjectClosureStatus.GENERATED }) }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PROJECT_CLOSURE_GENERATED', metadata: expect.objectContaining({ previousStatus: status }) }) }));
  });

  it('keeps donor feedback available during the existing feedback refresh path', async () => {
    const { service, ctx, generate } = setup(ProjectClosureStatus.DONOR_FEEDBACK);
    await service.generateProject(ctx);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: ProjectClosureStatus.DONOR_FEEDBACK }) }));
    expect(generate.mock.calls[0][0].update).not.toHaveProperty('donorFeedbackNotes');
  });

  it('still records donor feedback when a participation has reopened', async () => {
    const { service, ctx, roster, participation, transition } = setup(ProjectClosureStatus.SUBMITTED_TO_DONOR);
    roster.mockResolvedValue([{ ...participation, status: ParticipationStatus.EXECUTING }] as never);
    await service.transitionProject(ctx, ProjectClosureStatus.DONOR_FEEDBACK, 'تصحيح التقرير');
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ donorFeedbackNotes: 'تصحيح التقرير' }) }));
  });

  it('rejects approval when a newly admitted participation is still open', async () => {
    const { service, ctx, roster, participation, transition } = setup(ProjectClosureStatus.UNDER_INTERNAL_REVIEW);
    roster.mockResolvedValue([participation, { ...participation, id: 'new', status: ParticipationStatus.APPROVED_AWAITING_SETUP, closureReport: null }] as never);
    await expect(service.transitionProject(ctx, ProjectClosureStatus.APPROVED_INTERNAL)).rejects.toMatchObject({ code: 'PROJECT_CLOSURE_ORGANIZATIONS_OPEN' });
    expect(transition).not.toHaveBeenCalled();
  });

  it('rejects a closed participation that has no closed organization report', async () => {
    const { service, ctx, roster, participation, generate } = setup();
    roster.mockResolvedValue([{ ...participation, closureReport: null }] as never);
    await expect(service.generateProject(ctx)).rejects.toMatchObject({ code: 'PROJECT_CLOSURE_ORGANIZATIONS_OPEN' });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(['missing', 'changed', 'malformed'] as const)('does not advance a %s reviewed snapshot', async (kind) => {
    const { service, ctx, report, current, transition } = setup();
    current.mockResolvedValue({ ...report, snapshotJson: kind === 'malformed' ? { old: true } : { organizationReports: kind === 'missing' ? [] : [{ id: 'organization-report', snapshotJson: { total: 1 } }] } } as never);
    await expect(service.transitionProject(ctx, ProjectClosureStatus.UNDER_INTERNAL_REVIEW)).rejects.toMatchObject({ code: 'PROJECT_CLOSURE_SNAPSHOT_STALE' });
    expect(transition).not.toHaveBeenCalled();
  });

  it('accepts a current snapshot independent of JSON object key order', async () => {
    const { service, ctx, report, current, transition, rowLock, admissionLock } = setup();
    current.mockResolvedValue({ ...report, snapshotJson: { organizationReports: [{ snapshotJson: { total: 2 }, id: 'organization-report' }] } } as never);
    await expect(service.transitionProject(ctx, ProjectClosureStatus.UNDER_INTERNAL_REVIEW)).resolves.toEqual({ ok: true });
    expect(transition).toHaveBeenCalled();
    expect(admissionLock.mock.invocationCallOrder[0]).toBeLessThan(rowLock.mock.invocationCallOrder[0]);
  });
});
