import { jest } from '@jest/globals';
import { AccountRole, ApplicationStatus, AssociationSelectionList, EligibilityStatus, prisma } from '@alzad/db';
import { LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';
import type { AuthContext } from '../auth/auth.types';
import { ApplicationsService } from './applications.service';

describe('application list projection compatibility', () => {
  const date = new Date('2026-10-10T09:00:00Z');
  const row = {
    id: 'application', publicCode: 'APP-000001', name: 'جمعية اختبار', category: null, sector: null,
    region: 'الرياض', city: 'الرياض', phone: '0500000000', email: null, contactName: 'منسق', notes: null,
    licenseNumber: '1', licenseExpiryDate: date, status: ApplicationStatus.UNDER_REVIEW, rejectReason: null,
    resultingAssociationId: null, submittedAt: date, reviewedAt: null, pledgeAccepted: true, pledgeAcceptedAt: date,
    eligibilityStatus: EligibilityStatus.PASSED, selectionList: AssociationSelectionList.NONE,
    selectionApprovedAt: null, processingStartedAt: date, schemaVersion: 2, evaluationScore: 90, evaluationRank: 1,
    regionOfficialCode: '0001', governorateOfficialCode: '0100', centerOfficialCode: null,
    currentAssets: 12_000_000, currentLiabilities: null, financialResult: null, netWorkingCapital: null,
    v2Payload: { privateDetail: 'detail only' }, eligibilityNotes: 'مستوفية', evaluationBreakdown: { raw: {} },
    answers: [], attachments: [{ fieldKey: 'strategicPlan' }], licenseFile: { id: 'license' },
    informationRequests: [{ id: 'info', status: 'SUBMITTED', note: 'ملاحظة', deadline: null, requestedAt: date, submittedAt: date, items: [] }],
  };
  const access = { selectionDeliveries: jest.fn(async () => new Map()) };
  const service = () => new ApplicationsService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, access as never);

  beforeEach(() => {
    access.selectionDeliveries.mockReset().mockResolvedValue(new Map());
    jest.spyOn(prisma.associationApplication, 'findMany').mockImplementation((async (args: { select?: Record<string, unknown> }) => {
      if (!args.select) return [row];
      return [Object.fromEntries(Object.keys(args.select).map((key) => [key, key === 'informationRequests' ? row.informationRequests.map(({ status }) => ({ status })) : row[key as keyof typeof row]]))];
    }) as never);
    jest.spyOn(prisma.associationApplication, 'count').mockResolvedValue(1);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses a minimal select and never represents missing application details as empty answers', async () => {
    const result = await service().listApplications({ view: 'list', includeCounts: 'false' } as never);
    const query = jest.mocked(prisma.associationApplication.findMany).mock.calls[0][0];
    expect(query).toHaveProperty('select');
    expect(query).not.toHaveProperty('include');
    for (const key of ['v2Payload', 'answers', 'attachments', 'licenseFile', 'reviewedBy', 'eligibilityEvidence', 'evaluationEvidence', 'evaluationBreakdown']) {
      expect(query?.select).not.toHaveProperty(key);
      expect(result.items[0]).not.toHaveProperty(key);
    }
    expect(result.items[0]).toMatchObject({ id: row.id, evaluationScore: 90, financialPriority: 'HIGHER_CAPACITY_LOWER_AID_PRIORITY', latestInformationRequest: { status: 'SUBMITTED' }, selectionEditable: true });
    expect(result.counts).toEqual({});
  });

  it('preserves each list field against the existing full response without changing its default contract', async () => {
    const full = (await service().listApplications({ includeCounts: 'false' })).items[0] as Record<string, unknown>;
    const compact = (await service().listApplications({ view: 'list', includeCounts: 'false' } as never)).items[0] as Record<string, unknown>;
    expect(full).toHaveProperty('v2Payload', row.v2Payload);
    expect(full).toHaveProperty('attachmentKeys', ['strategicPlan']);
    for (const [key, value] of Object.entries(compact)) {
      if (key === 'latestInformationRequest') expect(value).toEqual({ status: (full.latestInformationRequest as { status: string }).status });
      else expect(value).toEqual(full[key]);
    }
  });

  it('keeps pagination and filters on the scoped query for list reads', async () => {
    await service().listApplications({ view: 'list', includeCounts: 'false', page: 2, pageSize: 100, eligibilityStatus: EligibilityStatus.PASSED } as never);
    expect(prisma.associationApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 100, where: expect.objectContaining({ eligibilityStatus: 'PASSED' }), orderBy: { submittedAt: 'desc' } }));
    expect(prisma.associationApplication.count).toHaveBeenCalledWith({ where: { eligibilityStatus: 'PASSED' } });
  });

  it('applies the same server-side region scope to the compact rows and their total', async () => {
    const ctx = { accountId: 'staff', role: AccountRole.ADMIN, adminFullAccess: false, adminApplicationScope: { regionCodes: ['0001'] } } as AuthContext;
    await service().listApplications({ view: 'list', includeCounts: 'false' }, ctx);
    expect(prisma.associationApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { regionOfficialCode: { in: ['0001'] } } }));
    expect(prisma.associationApplication.count).toHaveBeenCalledWith({ where: { regionOfficialCode: { in: ['0001'] } } });
  });

  it.each(['NOT_REQUESTED', 'PENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN'])('retains selection protection for MAIN delivery %s', async (status) => {
    const selected = { ...row, status: ApplicationStatus.ACCEPTED, selectionList: AssociationSelectionList.MAIN, selectionApprovedAt: date };
    jest.mocked(prisma.associationApplication.findMany).mockImplementation((async (args: { select?: Record<string, unknown> }) => {
      if (!args.select) return [selected];
      return [Object.fromEntries(Object.keys(args.select).map(key => [key, key === 'informationRequests' ? [{ status: 'SUBMITTED' }] : selected[key as keyof typeof selected]]))];
    }) as never);
    access.selectionDeliveries.mockResolvedValue(new Map([[row.id, { status }]]));
    jest.spyOn(prisma.projectParticipation, 'findMany').mockResolvedValue([]);
    const full = (await service().listApplications({ includeCounts: 'false' })).items[0] as Record<string, unknown>;
    const compact = (await service().listApplications({ view: 'list', includeCounts: 'false' })).items[0] as Record<string, unknown>;
    expect(compact.selectionEditable).toBe(['NOT_REQUESTED', 'PENDING', 'FAILED'].includes(status));
    for (const key of ['selectionDelivery', 'selectionEditable', 'ownerCanCorrect']) expect(compact[key]).toEqual(full[key]);
  });
});

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
        update: jest.fn(async (input: { data: Record<string, unknown> }) => { void input; return {}; }),
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

  it('corrects internal failed eligibility through the existing decision path without mail or restoring old scores', async () => {
    tx.associationApplication.findUniqueOrThrow.mockResolvedValue({ id: 'application', status: ApplicationStatus.UNDER_REVIEW, schemaVersion: 2, answers: [], eligibilityStatus: EligibilityStatus.FAILED } as never);
    await expect(service.decideEligibility(ctx, 'application', EligibilityStatus.PASSED, 'تصحيح قرار داخلي', 'eligibility-correction')).resolves.toEqual({ ok: true });
    const data = tx.associationApplication.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ eligibilityStatus: EligibilityStatus.PASSED, eligibilityNotes: 'تصحيح قرار داخلي', eligibilityReviewedById: ctx.accountId });
    expect(data).not.toHaveProperty('evaluationScore');
    expect(data).not.toHaveProperty('selectionList');
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'APPLICATION_ELIGIBILITY_DECIDED', actorAccountId: ctx.accountId, metadata: expect.objectContaining({ decision: EligibilityStatus.PASSED }) }) }));
    expect(onboarding.sendRejection).not.toHaveBeenCalled();
  });

  it.each([ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED])('does not reopen final %s requests by correcting failed eligibility', async (status) => {
    tx.associationApplication.findUniqueOrThrow.mockResolvedValue({ id: 'application', status, schemaVersion: 2, answers: [] });
    await expect(service.decideEligibility(ctx, 'application', EligibilityStatus.PASSED, 'تصحيح', 'eligibility-final-correction')).rejects.toMatchObject({ code: 'APPLICATION_ALREADY_REVIEWED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(onboarding.sendRejection).not.toHaveBeenCalled();
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
