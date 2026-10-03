import { jest } from '@jest/globals';
import { AccountRole, ApplicationInformationItemType, ApplicationStatus, AssociationSelectionList, EligibilityStatus, prisma } from '@alzad/db';
import type { AuthContext } from '../auth/auth.types';
import { ApplicationV2Service } from './application-v2.service';

describe('final selection and information-request serialization', () => {
  const ctx = { accountId: '10000000-0000-4000-8000-000000000001', role: AccountRole.ADMIN, associationId: null } as AuthContext;
  let record: { id: string; status: ApplicationStatus; selectionList: AssociationSelectionList; eligibilityStatus: EligibilityStatus; evaluationScore: number; schemaVersion: number; sourceDraft: { id: string } };
  let tx: ReturnType<typeof clientFixture>;
  let service: ApplicationV2Service;
  let afterRowLock: () => void;
  const access = { sendNeedsInfo: jest.fn(async () => undefined), sendSelectionDecision: jest.fn(async () => undefined) };

  function clientFixture() {
    return {
      $executeRaw: jest.fn(async () => 1),
      $queryRaw: jest.fn(async () => { afterRowLock(); return [{ id: record.id }]; }),
      associationApplication: {
        findUnique: jest.fn(async () => ({ ...record })),
        count: jest.fn(async () => 2),
        update: jest.fn(async () => ({})),
      },
      applicationInformationRequest: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'information-request' })) },
      projectParticipation: { upsert: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    record = { id: 'application', status: ApplicationStatus.UNDER_REVIEW, selectionList: AssociationSelectionList.NONE, eligibilityStatus: EligibilityStatus.PASSED, evaluationScore: 90, schemaVersion: 2, sourceDraft: { id: 'draft' } };
    afterRowLock = () => undefined;
    tx = clientFixture();
    jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) as never);
    const idempotency = { claim: jest.fn(async () => ({ claimed: true })), complete: jest.fn(async () => undefined) };
    service = new ApplicationV2Service({} as never, idempotency as never, {} as never, {} as never, access as never, { requireNumber: jest.fn(async () => 3) } as never);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  const information = { items: [{ type: ApplicationInformationItemType.FIELD, key: 'organization.notes', reason: 'صحح الوصف' }], opId: 'request-information' };

  it('reads the committed final decision after acquiring the application row, and does not reset its evaluation', async () => {
    afterRowLock = () => { record.status = ApplicationStatus.ACCEPTED; record.selectionList = AssociationSelectionList.MAIN; };
    await expect(service.requestInformation(ctx, record.id, information)).rejects.toMatchObject({ code: 'APPLICATION_NOT_REVIEWABLE' });
    expect(tx.applicationInformationRequest.create).not.toHaveBeenCalled();
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(access.sendNeedsInfo).not.toHaveBeenCalled();
  });

  it('keeps information requests available for an under-review application, with row lock before read', async () => {
    await expect(service.requestInformation(ctx, record.id, information)).resolves.toEqual({ ok: true, requestId: 'information-request', emailSent: true });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.associationApplication.findUnique.mock.invocationCallOrder[0]);
  });

  it.each([ApplicationStatus.REJECTED, ApplicationStatus.ACCEPTED])('does not make a new selection from NONE for status %s', async (status) => {
    record.status = status;
    await expect(service.decideSelection(ctx, record.id, { decision: AssociationSelectionList.MAIN, opId: 'select-final' })).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_NOT_READY' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(tx.projectParticipation.upsert).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });

  it('preserves same-decision MAIN replay without another decision, participation, or email', async () => {
    record.status = ApplicationStatus.ACCEPTED;
    record.selectionList = AssociationSelectionList.MAIN;
    await expect(service.decideSelection(ctx, record.id, { decision: AssociationSelectionList.MAIN, opId: 'select-same' })).resolves.toEqual({ ok: true, decision: AssociationSelectionList.MAIN, emailSent: null });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.projectParticipation.upsert).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });

  it('preserves an approved RESERVE upgrade to MAIN when a seat is available', async () => {
    record.status = ApplicationStatus.ACCEPTED;
    record.selectionList = AssociationSelectionList.RESERVE;
    await expect(service.decideSelection(ctx, record.id, { decision: AssociationSelectionList.MAIN, opId: 'upgrade-reserve' })).resolves.toEqual({ ok: true, decision: AssociationSelectionList.MAIN, emailSent: true });
    expect(tx.associationApplication.update).toHaveBeenCalledTimes(1);
    expect(tx.projectParticipation.upsert).toHaveBeenCalledTimes(1);
  });
});
