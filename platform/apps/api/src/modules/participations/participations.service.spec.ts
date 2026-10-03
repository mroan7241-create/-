import { jest } from '@jest/globals';
import { AccountRole, AgreementStatus, AssociationSelectionList, ParticipationStatus, prisma } from '@alzad/db';
import type { IdempotencyService } from '../../common/idempotency.service';
import type { PublicCodeService } from '../../common/public-code.service';
import type { AuthContext } from '../auth/auth.types';
import type { OnboardingEmailService } from '../auth/email/onboarding-email.service';
import type { StorageService } from '../files/storage.service';
import { COVENANT_SOURCE_SHA256, COVENANT_VERSION, CovenantDocumentService } from './covenant-document.service';
import { ParticipationsService } from './participations.service';

const admin: AuthContext = { accountId: 'admin-id', associationId: null, role: AccountRole.ADMIN, sessionId: 'session', mustChangePassword: false };

function fixture() {
  const participation = {
    id: 'participation-id', status: ParticipationStatus.APPROVED_AWAITING_SETUP as ParticipationStatus,
    setupCompletedAt: null as Date | null, setupCompletedById: null as string | null,
    application: { selectionList: AssociationSelectionList.MAIN as AssociationSelectionList },
    agreements: [{ status: AgreementStatus.SENT as AgreementStatus, templateVersion: COVENANT_VERSION, templateSha256: COVENANT_SOURCE_SHA256 }],
  };
  const tx = {
    $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ id: participation.id }]),
    projectParticipation: {
      findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(participation),
      updateMany: jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}) },
  };
  const idem = {
    claim: jest.fn<() => Promise<unknown>>().mockResolvedValue({ claimed: true }),
    complete: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
  };
  jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
    if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
    return callback(tx as never);
  });
  const service = new ParticipationsService({} as PublicCodeService, idem as unknown as IdempotencyService,
    {} as StorageService, {} as CovenantDocumentService, {} as OnboardingEmailService);
  return { service, tx, idem, participation };
}

describe('participation data-readiness ordering', () => {
  afterEach(() => jest.restoreAllMocks());

  it('locks the participation before checking MAIN and the sent canonical covenant', async () => {
    const { service, tx, idem, participation } = fixture();
    await expect(service.completeSetup(admin, participation.id, 'op-id')).resolves.toEqual({ ok: true });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.projectParticipation.findUnique.mock.invocationCallOrder[0]);
    expect(tx.projectParticipation.findUnique).toHaveBeenCalledWith({
      where: { id: participation.id },
      include: { application: { select: { selectionList: true } }, agreements: { orderBy: { version: 'desc' }, take: 1 } },
    });
    expect(tx.projectParticipation.updateMany).toHaveBeenCalledWith({
      where: { id: participation.id, status: ParticipationStatus.APPROVED_AWAITING_SETUP, setupCompletedAt: null },
      data: { setupCompletedAt: expect.any(Date), setupCompletedById: admin.accountId },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(idem.complete).toHaveBeenCalledWith(tx, admin.accountId, 'participation-setup', 'op-id', { ok: true });
  });

  it.each([AssociationSelectionList.NONE, AssociationSelectionList.RESERVE])('rejects %s before readiness mutation', async (selectionList) => {
    const { service, tx, participation } = fixture();
    participation.application.selectionList = selectionList;
    await expect(service.completeSetup(admin, participation.id, 'op-id')).rejects.toMatchObject({ code: 'PARTICIPATION_NOT_MAIN' });
    expect(tx.projectParticipation.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([AgreementStatus.DRAFT, AgreementStatus.CANCELLED, AgreementStatus.SIGNED_BY_ORG, AgreementStatus.SIGNED])('rejects covenant %s before first readiness', async (status) => {
    const { service, tx, participation } = fixture();
    participation.agreements[0].status = status;
    await expect(service.completeSetup(admin, participation.id, 'op-id')).rejects.toMatchObject({ code: 'COVENANT_NOT_READY' });
    expect(tx.projectParticipation.updateMany).not.toHaveBeenCalled();
  });

  it.each(['missing', 'version', 'hash'])('rejects a %s canonical covenant', async (invalid) => {
    const { service, tx, participation } = fixture();
    if (invalid === 'missing') participation.agreements = [];
    if (invalid === 'version') participation.agreements[0].templateVersion = 'obsolete';
    if (invalid === 'hash') participation.agreements[0].templateSha256 = 'obsolete';
    await expect(service.completeSetup(admin, participation.id, 'op-id')).rejects.toMatchObject({ code: 'COVENANT_NOT_READY' });
    expect(tx.projectParticipation.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a missing or non-awaiting participation without mutation', async () => {
    const { service, tx, participation } = fixture();
    tx.projectParticipation.findUnique.mockResolvedValueOnce(null);
    await expect(service.completeSetup(admin, participation.id, 'op-1')).rejects.toMatchObject({ code: 'PARTICIPATION_SETUP_INVALID' });
    participation.status = ParticipationStatus.ACTIVE;
    await expect(service.completeSetup(admin, participation.id, 'op-2')).rejects.toMatchObject({ code: 'PARTICIPATION_SETUP_INVALID' });
    expect(tx.projectParticipation.updateMany).not.toHaveBeenCalled();
  });

  it('preserves historical readiness and its original actor even without current covenant prerequisites', async () => {
    const { service, tx, idem, participation } = fixture();
    const oldDate = new Date('2026-09-01T12:00:00Z');
    participation.setupCompletedAt = oldDate;
    participation.setupCompletedById = 'original-admin';
    participation.status = ParticipationStatus.ACTIVE;
    participation.application.selectionList = AssociationSelectionList.RESERVE;
    participation.agreements = [];
    await expect(service.completeSetup(admin, participation.id, 'new-op')).resolves.toEqual({ ok: true });
    expect(tx.projectParticipation.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(participation.setupCompletedAt).toBe(oldDate);
    expect(participation.setupCompletedById).toBe('original-admin');
    expect(idem.complete).toHaveBeenCalledTimes(1);
  });

  it('returns an idempotent replay without locking, mutation, or a duplicate audit', async () => {
    const { service, tx, idem, participation } = fixture();
    idem.claim.mockResolvedValue({ claimed: false, existingResponse: { ok: true } });
    await expect(service.completeSetup(admin, participation.id, 'same-op')).resolves.toEqual({ ok: true });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.projectParticipation.findUnique).not.toHaveBeenCalled();
    expect(tx.projectParticipation.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
