import { jest } from '@jest/globals';
import { AccountRole, AgreementStatus, ApplicationInformationItemType, ApplicationStatus, AssociationSelectionList, EligibilityStatus, ParticipationStatus, prisma } from '@alzad/db';
import type { AuthContext } from '../auth/auth.types';
import { ApplicationV2Service } from './application-v2.service';

describe('final selection and information-request serialization', () => {
  const ctx = { accountId: '10000000-0000-4000-8000-000000000001', role: AccountRole.ADMIN, associationId: null } as AuthContext;
  let record: { id: string; status: ApplicationStatus; selectionList: AssociationSelectionList; eligibilityStatus: EligibilityStatus; evaluationScore: number; schemaVersion: number; sourceDraft: { id: string }; resultingAssociationId?: string; selectionApprovedAt?: Date };
  let draftRow: { id: string } | null;
  type Agreement = { status: AgreementStatus; associationAccountId?: string; signedByOrgAt?: Date; signedByZaadAt?: Date; orgSignatureFileId?: string; partyOneSignatureFileId?: string; fullyExecutedAt?: Date; finalFileId?: string };
  let participation: { id: string; status: ParticipationStatus; associationId?: string; activatedAt?: Date; closedAt?: Date; agreements: Agreement[] } | null;
  let tx: ReturnType<typeof clientFixture>;
  let service: ApplicationV2Service;
  let afterRowLock: () => void;
  let idempotency: { claim: ReturnType<typeof jest.fn<() => Promise<{ claimed: boolean; existingResponse?: { ok: true; requestId: string } | { ok: true; decision: AssociationSelectionList } }>>>; complete: ReturnType<typeof jest.fn> };
  const access = { sendNeedsInfo: jest.fn(async () => true), sendSelectionDecision: jest.fn(async () => true), cancelUnsentMainDecision: jest.fn(async () => undefined) };

  function clientFixture() {
    return {
      $executeRaw: jest.fn(async () => 1),
      $queryRaw: jest.fn(async (sql: TemplateStringsArray) => { void sql; afterRowLock(); return [{ id: record.id }]; }),
      associationApplicationDraft: { findFirst: jest.fn(async () => draftRow) },
      associationApplication: {
        findUnique: jest.fn(async () => ({ ...record })),
        count: jest.fn(async () => 2),
        update: jest.fn(async () => ({})),
      },
      applicationInformationRequest: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'information-request' })) },
      projectParticipation: { findUnique: jest.fn(async () => participation), upsert: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    record = { id: 'application', status: ApplicationStatus.UNDER_REVIEW, selectionList: AssociationSelectionList.NONE, eligibilityStatus: EligibilityStatus.PASSED, evaluationScore: 90, schemaVersion: 2, sourceDraft: { id: 'draft' } };
    draftRow = { id: 'draft' };
    participation = null;
    afterRowLock = () => undefined;
    tx = clientFixture();
    jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) as never);
    idempotency = { claim: jest.fn(async () => ({ claimed: true })), complete: jest.fn(async () => undefined) };
    service = new ApplicationV2Service({} as never, idempotency as never, {} as never, {} as never, access as never, { selectionMainCapacity: jest.fn(async () => 3) } as never);
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
    await expect(service.requestInformation(ctx, record.id, information)).resolves.toEqual({ ok: true, requestId: 'information-request', emailQueued: true, emailSent: null });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.associationApplication.findUnique.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('association_application_drafts');
    expect(tx.$queryRaw.mock.calls[1][0].join('')).toContain('association_applications');
    expect(access.sendNeedsInfo).toHaveBeenCalledWith(record.id, tx);
    expect(access.sendNeedsInfo.mock.invocationCallOrder[0]).toBeLessThan(idempotency.complete.mock.invocationCallOrder[0]);
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
    await expect(service.decideSelection(ctx, record.id, { decision: AssociationSelectionList.MAIN, opId: 'select-same' })).resolves.toEqual({ ok: true, decision: AssociationSelectionList.MAIN, emailQueued: false, emailSent: null });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.projectParticipation.upsert).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });

  it('preserves an approved RESERVE upgrade to MAIN when a seat is available', async () => {
    record.status = ApplicationStatus.ACCEPTED;
    record.selectionList = AssociationSelectionList.RESERVE;
    await expect(service.decideSelection(ctx, record.id, { decision: AssociationSelectionList.MAIN, opId: 'upgrade-reserve' })).resolves.toEqual({ ok: true, decision: AssociationSelectionList.MAIN, emailQueued: true, emailSent: null });
    expect(tx.associationApplication.update).toHaveBeenCalledTimes(1);
    expect(tx.projectParticipation.upsert).toHaveBeenCalledTimes(1);
    expect(access.sendSelectionDecision).toHaveBeenCalledWith(record.id, tx);
    expect(access.sendSelectionDecision.mock.invocationCallOrder[0]).toBeLessThan(idempotency.complete.mock.invocationCallOrder[0]);
  });

  it('does not issue another information email on an idempotency replay', async () => {
    idempotency.claim.mockResolvedValue({ claimed: false, existingResponse: { ok: true, requestId: 'information-request' } });
    await expect(service.requestInformation(ctx, record.id, information)).resolves.toMatchObject({ emailQueued: false, emailSent: null });
    expect(access.sendNeedsInfo).not.toHaveBeenCalled();
    expect(tx.applicationInformationRequest.create).not.toHaveBeenCalled();
  });

  it('does not commit a decision if its durable email cannot be queued', async () => {
    access.sendSelectionDecision.mockRejectedValueOnce(new Error('synthetic queue unavailable'));
    await expect(service.decideSelection(ctx, record.id, { decision: AssociationSelectionList.MAIN, opId: 'queue-failed' })).rejects.toThrow('synthetic queue unavailable');
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  function pendingMain(agreements: Agreement[] = []) {
    record.status = ApplicationStatus.ACCEPTED;
    record.selectionList = AssociationSelectionList.MAIN;
    record.selectionApprovedAt = new Date('2026-10-04T08:00:00.000Z');
    participation = { id: 'participation', status: ParticipationStatus.APPROVED_AWAITING_SETUP, agreements };
  }
  const demotion = { decision: AssociationSelectionList.RESERVE, opId: 'demote-main', reason: 'مراجعة ترتيب الاختيار' };

  it.each([{ agreements: [] as Agreement[] }, { agreements: [{ status: AgreementStatus.DRAFT }] }, { agreements: [{ status: AgreementStatus.SENT }] }])('allows an unused MAIN with unsigned agreement history %j to become RESERVE', async ({ agreements }) => {
    pendingMain(agreements);
    await expect(service.decideSelection(ctx, record.id, demotion)).resolves.toEqual({ ok: true, decision: AssociationSelectionList.RESERVE, emailQueued: true, emailSent: null });
    expect(access.cancelUnsentMainDecision).toHaveBeenCalledWith(tx, record.id, 'draft', record.selectionApprovedAt);
    expect(tx.associationApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ selectionList: AssociationSelectionList.RESERVE, status: ApplicationStatus.ACCEPTED }) }));
    expect(tx.projectParticipation.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ previousDecision: AssociationSelectionList.MAIN, decision: AssociationSelectionList.RESERVE }) }) }));
    expect(access.cancelUnsentMainDecision.mock.invocationCallOrder[0]).toBeLessThan(tx.associationApplication.update.mock.invocationCallOrder[0]);
    expect(tx.associationApplication.update.mock.invocationCallOrder[0]).toBeLessThan(access.sendSelectionDecision.mock.invocationCallOrder[0]);
    expect(access.sendSelectionDecision).toHaveBeenCalledWith(record.id, tx);
  });

  it('blocks a historical application without a draft because no unsent-main-email proof is available', async () => {
    pendingMain(); draftRow = null;
    await expect(service.decideSelection(ctx, record.id, demotion)).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_EMAIL_STARTED', status: 409 });
    expect(access.cancelUnsentMainDecision).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it.each(['application', 'participation', 'agreement'])('blocks an existing association/account reference on %s before any cancellation or decision', async (owner) => {
    pendingMain();
    if (owner === 'application') record.resultingAssociationId = 'association';
    if (owner === 'participation') participation!.associationId = 'association';
    if (owner === 'agreement') participation!.agreements = [{ status: AgreementStatus.SENT, associationAccountId: 'account' }];
    await expect(service.decideSelection(ctx, record.id, demotion)).rejects.toMatchObject({ code: 'APPLICATION_MAIN_ALREADY_STARTED' });
    expect(access.cancelUnsentMainDecision).not.toHaveBeenCalled();
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });

  it.each([
    { status: AgreementStatus.SIGNED_BY_ORG }, { status: AgreementStatus.SIGNED },
    { status: AgreementStatus.CANCELLED, signedByOrgAt: new Date() },
    { status: AgreementStatus.SUPERSEDED, signedByZaadAt: new Date() },
    { status: AgreementStatus.SUPERSEDED, orgSignatureFileId: 'signature' },
    { status: AgreementStatus.CANCELLED, partyOneSignatureFileId: 'signature' },
    { status: AgreementStatus.SUPERSEDED, fullyExecutedAt: new Date() },
    { status: AgreementStatus.SUPERSEDED, finalFileId: 'final' },
  ])('blocks a used earlier agreement %j even if the newest one is unsigned', async (usedAgreement) => {
    pendingMain([usedAgreement, { status: AgreementStatus.DRAFT }]);
    await expect(service.decideSelection(ctx, record.id, demotion)).rejects.toMatchObject({ code: 'APPLICATION_MAIN_ALREADY_STARTED' });
    expect(tx.projectParticipation.findUnique).toHaveBeenLastCalledWith({ where: { applicationId: record.id }, include: { agreements: true } });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(access.cancelUnsentMainDecision).not.toHaveBeenCalled();
  });

  it.each([ParticipationStatus.ACTIVE, ParticipationStatus.EXECUTING, ParticipationStatus.CLOSED])('does not demote an operational participation %s', async (status) => {
    pendingMain(); participation!.status = status;
    await expect(service.decideSelection(ctx, record.id, demotion)).rejects.toMatchObject({ code: 'APPLICATION_MAIN_ALREADY_STARTED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('locks draft, participation, then application before checking an account created by the lock holder', async () => {
    pendingMain();
    afterRowLock = () => { participation!.associationId = 'concurrently-created-association'; };
    await expect(service.decideSelection(ctx, record.id, demotion)).rejects.toMatchObject({ code: 'APPLICATION_MAIN_ALREADY_STARTED' });
    expect(tx.$queryRaw.mock.calls.map(([sql]) => sql.join(''))).toEqual([
      expect.stringContaining('association_application_drafts'),
      expect.stringContaining('project_participations'),
      expect.stringContaining('association_applications'),
    ]);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(tx.associationApplication.findUnique.mock.invocationCallOrder[0]);
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('preserves demotion idempotency without cancelling or queuing email again', async () => {
    pendingMain();
    idempotency.claim.mockResolvedValue({ claimed: false, existingResponse: { ok: true, decision: AssociationSelectionList.RESERVE } });
    await expect(service.decideSelection(ctx, record.id, demotion)).resolves.toEqual({ ok: true, decision: AssociationSelectionList.RESERVE, emailQueued: false, emailSent: null });
    expect(tx.projectParticipation.findUnique).not.toHaveBeenCalled();
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(access.cancelUnsentMainDecision).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
  });

  it('rejects demotion when the main decision email may already have been sent', async () => {
    pendingMain();
    access.cancelUnsentMainDecision.mockRejectedValueOnce(Object.assign(new Error('already started'), { code: 'APPLICATION_SELECTION_EMAIL_STARTED' }));
    await expect(service.decideSelection(ctx, record.id, demotion)).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_EMAIL_STARTED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(access.sendSelectionDecision).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('fails the demotion transaction rather than marking it complete when reserve email queueing fails', async () => {
    pendingMain();
    access.sendSelectionDecision.mockRejectedValueOnce(new Error('synthetic reserve queue unavailable'));
    await expect(service.decideSelection(ctx, record.id, demotion)).rejects.toThrow('synthetic reserve queue unavailable');
    expect(access.cancelUnsentMainDecision).toHaveBeenCalledTimes(1);
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
