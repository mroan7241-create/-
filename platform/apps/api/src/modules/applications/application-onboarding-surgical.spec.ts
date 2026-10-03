import { jest } from '@jest/globals';
import { ApplicationInformationRequestStatus, ApplicationStatus, AssociationSelectionList, EligibilityStatus, prisma } from '@alzad/db';
import { ApplicationV2Service, isInformationResponseLate } from './application-v2.service';

describe('public application timeline — actual state only', () => {
  afterEach(() => jest.restoreAllMocks());
  const application = { id: 'app', publicCode: 'APP-1', status: ApplicationStatus.UNDER_REVIEW,
    processingStartedAt: new Date(), eligibilityStatus: EligibilityStatus.PENDING,
    selectionList: AssociationSelectionList.NONE, evaluatedAt: null, evaluationScore: null, v2Payload: {} };
  async function status(overrides = {}, request: unknown = null) {
    const service = new ApplicationV2Service({} as never, {} as never, {} as never,
      { consume: async () => undefined } as never,
      { requireSessionDraft: async () => ({ publicCode: 'DRF-1', submittedApplication: { ...application, ...overrides } }) } as never,
      {} as never);
    jest.spyOn(prisma.applicationInformationRequest, 'findFirst').mockResolvedValue(request as never);
    return service.publicStatus('DRF-1', '', 'session');
  }
  it.each([AssociationSelectionList.MAIN, AssociationSelectionList.RESERVE])('marks %s as current, not completed', async selectionList => {
    const result = await status({ selectionList, status: ApplicationStatus.ACCEPTED, eligibilityStatus: EligibilityStatus.PASSED, evaluatedAt: new Date() });
    expect(result.timeline.find(item => item.key === selectionList)?.state).toBe('CURRENT');
    expect(result.timeline.some(item => item.key === 'NEEDS_INFO')).toBe(false);
  });
  it('does not invent completed evaluation for an ineligible application', async () => {
    const result = await status({ eligibilityStatus: EligibilityStatus.FAILED });
    expect(result.timeline.find(item => item.key === 'INELIGIBLE')?.state).toBe('CURRENT');
    expect(result.timeline.some(item => item.key === 'EVALUATION' && item.state === 'COMPLETED')).toBe(false);
  });
  it('keeps submitted completion visible without exposing its form as open', async () => {
    const result = await status({}, { id: 'request', status: ApplicationInformationRequestStatus.SUBMITTED, items: [], submittedAt: new Date() });
    expect(result.stage).toBe('PROCESSING');
    expect(result.needsInfo).toBeNull();
    expect(result.timeline.find(item => item.key === 'NEEDS_INFO')).toMatchObject({ state: 'COMPLETED', label: 'تم إرسال الاستكمال — أعيد للمراجعة' });
  });
  it('open completion is current and evaluation is not completed', async () => {
    const result = await status({}, { id: 'request', status: ApplicationInformationRequestStatus.OPEN, items: [] });
    expect(result.stage).toBe('NEEDS_INFO');
    expect(result.timeline.find(item => item.key === 'NEEDS_INFO')?.state).toBe('CURRENT');
    expect(result.timeline.find(item => item.key === 'EVALUATION')?.state).toBe('UPCOMING');
  });
  it('exposes a requested multi-value field as an array rather than an object', async () => {
    const result = await status({ v2Payload: { organization: { sectors: ['خدمات اجتماعية'] } } }, {
      id: 'request', status: ApplicationInformationRequestStatus.OPEN,
      items: [{ type: 'FIELD', key: 'organization.sectors', reason: 'تصحيح المجالات' }],
    });
    expect(result.needsInfo?.items[0]?.kind).toBe('array');
  });
  it('does not present a closed unanswered completion request as fulfilled', async () => {
    const result = await status({ eligibilityStatus: EligibilityStatus.PASSED }, {
      status: ApplicationInformationRequestStatus.CLOSED, submittedAt: null, items: [],
    });
    expect(result.timeline.some(item => item.key === 'NEEDS_INFO')).toBe(false);
  });
});

describe('information response deadline — end of Riyadh date, never a rejection', () => {
  const deadline = new Date('2026-10-03T00:00:00.000Z');
  it('allows the last millisecond of the specified Riyadh date', () => {
    expect(isInformationResponseLate(deadline, null, new Date('2026-10-03T20:59:59.999Z'))).toBe(false);
    expect(isInformationResponseLate(deadline, null, new Date('2026-10-03T21:00:00.000Z'))).toBe(true);
  });
  it('uses actual response time and preserves lateness after future reads', () => {
    expect(isInformationResponseLate(deadline, new Date('2026-10-03T20:59:59Z'), new Date('2027-01-01Z'))).toBe(false);
    expect(isInformationResponseLate(deadline, new Date('2026-10-03T21:01:00Z'), new Date('2027-01-01Z'))).toBe(true);
    expect(isInformationResponseLate(null, null, new Date('2027-01-01Z'))).toBe(false);
  });
});

describe('individual selection and final evaluation guards', () => {
  afterEach(() => jest.restoreAllMocks());
  const ratings = { operationalReadiness: 5, technicalCapability: 5, previousExperience: 5,
    integrityTransparency: 5, participationCommitment: 5, sustainabilityImpact: 5, opId: 'op' };
  function fixture(selectionList: AssociationSelectionList = AssociationSelectionList.NONE, mainCount = 0) {
    const tx = {
      $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn(async () => [{ id: 'app' }]),
      associationApplicationDraft: { findFirst: jest.fn(async () => null) },
      associationApplication: {
        findUnique: jest.fn(async () => ({ id: 'app', status: selectionList === AssociationSelectionList.NONE ? ApplicationStatus.UNDER_REVIEW : ApplicationStatus.ACCEPTED,
          eligibilityStatus: EligibilityStatus.PASSED, selectionList, evaluationScore: 80, schemaVersion: 1 })),
        count: jest.fn(async () => mainCount), update: jest.fn(async () => ({})),
      },
      projectParticipation: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({})) }, auditLog: { create: jest.fn(async () => ({})) },
    };
    jest.spyOn(prisma, '$transaction').mockImplementation((fn: unknown) => Promise.resolve((fn as (transaction: unknown) => unknown)(tx)) as never);
    const access = { sendSelectionDecision: jest.fn(async () => undefined) };
    const service = new ApplicationV2Service({} as never,
      { claim: async () => ({ claimed: true }), complete: async () => undefined } as never,
      {} as never, {} as never, access as never, { selectionMainCapacity: async () => 1 } as never);
    return { tx, service, access };
  }
  it.each([AssociationSelectionList.MAIN, AssociationSelectionList.RESERVE])('does not rewrite evaluation after %s selection', async selection => {
    const { service, tx } = fixture(selection);
    await expect(service.evaluate({ accountId: 'admin' } as never, 'app', ratings)).rejects.toMatchObject({ code: 'APPLICATION_EVALUATION_FINALIZED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });
  it('rejects a new MAIN when existing MAIN occupies capacity', async () => {
    const { service, tx, access } = fixture(AssociationSelectionList.NONE, 1);
    await expect(service.decideSelection({ accountId: 'admin' } as never, 'app', { decision: AssociationSelectionList.MAIN, opId: 'op' })).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_CAPACITY_FULL' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });
  it('same decision with a new operation id keeps actor/date/reason and sends no duplicate mail', async () => {
    const { service, tx, access } = fixture(AssociationSelectionList.MAIN, 1);
    await expect(service.decideSelection({ accountId: 'admin' } as never, 'app', { decision: AssociationSelectionList.MAIN, reason: 'changed', opId: 'new-op' })).resolves.toMatchObject({ decision: 'MAIN', emailSent: null });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });
  it('takes the common selection lock before reading and counts before writing the last seat', async () => {
    const { service, tx } = fixture();
    await service.decideSelection({ accountId: 'admin' } as never, 'app', { decision: AssociationSelectionList.MAIN, opId: 'op' });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.associationApplication.findUnique.mock.invocationCallOrder[0]!);
    expect(tx.associationApplication.count.mock.invocationCallOrder[0]).toBeLessThan(tx.associationApplication.update.mock.invocationCallOrder[0]!);
  });
});
