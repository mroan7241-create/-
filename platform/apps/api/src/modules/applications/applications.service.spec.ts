import { jest } from '@jest/globals';
import { AccountRole, ApplicationStatus, AssociationSelectionList, EligibilityStatus, prisma } from '@alzad/db';
import { LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';
import type { AuthContext } from '../auth/auth.types';
import { ApplicationsService } from './applications.service';

describe('legacy evaluation and shared selection capacity', () => {
  const ctx = { accountId: '10000000-0000-4000-8000-000000000001', role: AccountRole.ADMIN, associationId: null } as AuthContext;
  const ratings = { operationalReadiness: 5, technicalCapability: 5, previousExperience: 5, integrityTransparency: 5, participationCommitment: 5, sustainabilityImpact: 5 };
  let tx: ReturnType<typeof transactionFixture>;
  let service: ApplicationsService;
  let capacity: ReturnType<typeof jest.fn<() => Promise<number | undefined>>>;
  const access = { sendSelectionDecision: jest.fn(async () => undefined) };
  const onboarding = { sendRejection: jest.fn(async () => true) };

  function transactionFixture() {
    return {
      account: { findUnique: jest.fn(async () => ({ role: 'ADMIN', status: 'ACTIVE', archivedAt: null, adminFullAccess: true, adminApplicationScope: null })) },
      $executeRaw: jest.fn(async (sql: TemplateStringsArray) => { void sql; return 1; }),
      $queryRaw: jest.fn(async (sql: TemplateStringsArray): Promise<Array<{ id: string; status: ApplicationStatus }>> => { void sql; return [{ id: 'application', status: ApplicationStatus.UNDER_REVIEW }]; }),
      associationApplication: {
        findUnique: jest.fn(async (): Promise<{ id: string; status: ApplicationStatus; selectionList: AssociationSelectionList; eligibilityStatus: EligibilityStatus }> => ({ id: 'application', status: ApplicationStatus.UNDER_REVIEW, selectionList: AssociationSelectionList.NONE, eligibilityStatus: EligibilityStatus.PASSED })),
        findUniqueOrThrow: jest.fn(async (): Promise<{ id: string; status: ApplicationStatus; schemaVersion: number; answers: unknown[] }> => ({ id: 'application', status: ApplicationStatus.UNDER_REVIEW, schemaVersion: 1, answers: [...LEGACY_APPLICATION_QUESTIONS] })),
        count: jest.fn(async () => 2),
        findMany: jest.fn(async () => [1, 2, 3].map((value) => ({ id: `candidate-${value}`, publicCode: `APP-00000${value}`, evaluationScore: 100 - value, evaluationBreakdown: null }))),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      projectParticipation: { create: jest.fn(async () => ({})) },
      applicationInformationRequest: { findFirst: jest.fn(async () => null) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tx = transactionFixture();
    jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) as never);
    const idempotency = { claim: jest.fn(async () => ({ claimed: true })), complete: jest.fn(async () => undefined) };
    capacity = jest.fn<() => Promise<number | undefined>>().mockResolvedValue(3);
    const settings = { selectionMainCapacity: capacity };
    service = new ApplicationsService({} as never, {} as never, idempotency as never, { log: jest.fn(async () => undefined) } as never, {} as never, settings as never, onboarding as never, access as never);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it.each([AssociationSelectionList.MAIN, AssociationSelectionList.RESERVE])('does not change evaluation after final %s selection', async (selectionList) => {
    tx.associationApplication.findUnique.mockResolvedValue({ id: 'application', status: ApplicationStatus.UNDER_REVIEW, selectionList, eligibilityStatus: EligibilityStatus.PASSED });
    await expect(service.evaluate(ctx, 'application', ratings, 'evaluate-final')).rejects.toMatchObject({ code: 'APPLICATION_EVALUATION_LOCKED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not evaluate an already accepted application even when its legacy selection is NONE', async () => {
    tx.associationApplication.findUnique.mockResolvedValue({ id: 'application', status: ApplicationStatus.ACCEPTED, selectionList: AssociationSelectionList.NONE, eligibilityStatus: EligibilityStatus.PASSED });
    await expect(service.evaluate(ctx, 'application', ratings, 'evaluate-accepted')).rejects.toMatchObject({ code: 'APPLICATION_EVALUATION_LOCKED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('keeps the current rating scale and acquires the shared lock before the application row', async () => {
    await expect(service.evaluate(ctx, 'application', ratings, 'evaluate-open')).resolves.toEqual({ ok: true, score: 100 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain('association-selection:electrical-appliances');
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR SHARE');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]);
    expect(tx.associationApplication.update).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])('keeps failed eligibility internal for schema %i, without preparing rejection mail', async (schemaVersion) => {
    tx.associationApplication.findUniqueOrThrow.mockResolvedValue({ id: 'application', status: ApplicationStatus.UNDER_REVIEW, schemaVersion, answers: [...LEGACY_APPLICATION_QUESTIONS] });
    await expect(service.decideEligibility(ctx, 'application', EligibilityStatus.FAILED, 'سبب', 'eligibility-internal')).resolves.toEqual({ ok: true, emailQueued: false, emailSent: null });
    expect(tx.associationApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eligibilityStatus: EligibilityStatus.FAILED, eligibilityNotes: 'سبب', eligibilityReviewedById: ctx.accountId, selectionList: AssociationSelectionList.NONE, evaluationScore: null }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'APPLICATION_ELIGIBILITY_DECIDED', metadata: expect.objectContaining({ decision: EligibilityStatus.FAILED }) }) }));
    expect(onboarding.sendRejection).not.toHaveBeenCalled();
  });

  it('retains explicit rejection notification separately from the internal eligibility decision', async () => {
    await expect(service.resendRejection('application', ctx)).resolves.toEqual({ ok: true, emailQueued: true, emailSent: null });
    expect(onboarding.sendRejection).toHaveBeenCalledWith('application', tx);
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('serializes an eligibility decision with selection before acquiring its application row', async () => {
    await expect(service.decideEligibility(ctx, 'application', EligibilityStatus.PASSED, undefined, 'eligibility-open')).resolves.toEqual({ ok: true });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR SHARE');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]);
    expect(tx.associationApplication.update).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite an eligibility decision after final acceptance', async () => {
    tx.associationApplication.findUniqueOrThrow.mockResolvedValue({ id: 'application', status: ApplicationStatus.ACCEPTED, schemaVersion: 1, answers: [...LEGACY_APPLICATION_QUESTIONS] });
    await expect(service.decideEligibility(ctx, 'application', EligibilityStatus.FAILED, 'سبب', 'eligibility-final')).rejects.toMatchObject({ code: 'APPLICATION_ALREADY_REVIEWED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('serializes the retained review rejection path with selection, before locking the row', async () => {
    await expect(service.reviewApplication(ctx, 'application', 'reject', 'سبب رفض موثق', 'reject-open')).resolves.toEqual({ ok: true });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR SHARE');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]);
    expect(tx.associationApplication.update).toHaveBeenCalledTimes(1);
  });

  it('keeps an already accepted decision protected from the review rejection path', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'application', status: ApplicationStatus.ACCEPTED }]);
    await expect(service.reviewApplication(ctx, 'application', 'reject', 'سبب رفض موثق', 'reject-final')).rejects.toMatchObject({ code: 'APPLICATION_ALREADY_REVIEWED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it.each([2, 3, 4])('refuses obsolete implicit batch selection with %i existing MAIN decisions, without writes or email', async (existingMain) => {
    tx.associationApplication.count.mockResolvedValue(existingMain);
    await expect(service.commitSelection(ctx, 3, 'select-open')).rejects.toMatchObject({ code: 'APPLICATION_WORKFLOW_VERSION' });
    expect(tx.associationApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.projectParticipation.create).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });

  it('refuses obsolete implicit selection even when capacity is unlimited', async () => {
    capacity.mockResolvedValue(undefined);
    await expect(service.commitSelection(ctx, undefined, 'select-unlimited')).rejects.toMatchObject({ code: 'APPLICATION_WORKFLOW_VERSION' });
    expect(tx.projectParticipation.create).not.toHaveBeenCalled();
  });

  it('refuses obsolete implicit selection when capacity is configured', async () => {
    await expect(service.commitSelection(ctx, undefined, 'select-configured')).rejects.toMatchObject({ code: 'APPLICATION_WORKFLOW_VERSION' });
    expect(tx.projectParticipation.create).not.toHaveBeenCalled();
  });

  it('does not permit obsolete batch requests to override configured capacity', async () => {
    await expect(service.commitSelection(ctx, 4, 'select-mismatch')).rejects.toMatchObject({ code: 'APPLICATION_WORKFLOW_VERSION' });
    expect(tx.associationApplication.updateMany).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });
});
