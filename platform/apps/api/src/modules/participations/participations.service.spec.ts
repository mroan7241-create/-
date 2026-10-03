import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
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

describe('participation account producers queue atomically', () => {
  afterEach(() => jest.restoreAllMocks());
  function accountFixture(signed = false) {
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: 'participation' }]),
      projectParticipation: { findUnique: jest.fn(async () => ({ id: 'participation', status: ParticipationStatus.APPROVED_AWAITING_SETUP, setupCompletedAt: new Date(), associationId: null,
        application: { id: 'application', selectionList: AssociationSelectionList.MAIN, email: 'test@example.org', name: 'جمعية', category: '', region: 'الرياض', city: 'الرياض', phone: '0550000000' },
        agreements: [{ id: 'agreement', status: signed ? AgreementStatus.SIGNED : AgreementStatus.SENT, templateVersion: COVENANT_VERSION, templateSha256: COVENANT_SOURCE_SHA256 }] })), update: jest.fn(async () => ({})) },
      authCredential: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})) },
      association: { create: jest.fn(async () => ({ id: 'association' })) },
      account: { create: jest.fn(async () => ({ id: 'account' })) },
      associationApplication: { update: jest.fn(async () => ({})) },
      participationAgreement: { update: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const idem = { claim: jest.fn(async (): Promise<unknown> => ({ claimed: true })), complete: jest.fn(async () => undefined) };
    const sendCredentials = jest.fn(async () => true);
    jest.spyOn(prisma, '$transaction').mockImplementation(async callback => {
      if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
      return callback(tx as never);
    });
    const service = new ParticipationsService({ nextPublicCode: async () => 'test-code' } as unknown as PublicCodeService, idem as unknown as IdempotencyService,
      {} as StorageService, {} as CovenantDocumentService, { sendCredentials } as unknown as OnboardingEmailService);
    return { service, tx, idem, sendCredentials };
  }
  it.each(['prepareSigningAccount', 'activate'] as const)('%s queues after state creation and before idempotency completion, in the same transaction', async method => {
    const { service, tx, idem, sendCredentials } = accountFixture(method === 'activate');
    const result = await service[method](admin, 'participation', 'op');
    expect(result).toMatchObject({ emailQueued: true, emailSent: null, temporaryPasswordPreviouslyIssued: false });
    expect(sendCredentials).toHaveBeenCalledWith('account', result.temporaryPassword, tx);
    expect(tx.authCredential.create.mock.invocationCallOrder[0]).toBeLessThan(sendCredentials.mock.invocationCallOrder[0]);
    expect(tx.projectParticipation.update.mock.invocationCallOrder[0]).toBeLessThan(sendCredentials.mock.invocationCallOrder[0]);
    expect(sendCredentials.mock.invocationCallOrder[0]).toBeLessThan(idem.complete.mock.invocationCallOrder[0]);
  });
  it.each(['prepareSigningAccount', 'activate'] as const)('%s propagates queue failure, not a success response outside the transaction', async method => {
    const { service, idem, sendCredentials } = accountFixture(method === 'activate');
    sendCredentials.mockRejectedValue(new Error('synthetic queue failure'));
    await expect(service[method](admin, 'participation', 'op')).rejects.toThrow('synthetic queue failure');
    expect(idem.complete).not.toHaveBeenCalled();
  });
  it.each(['prepareSigningAccount', 'activate'] as const)('%s replay does not create or queue anything again', async method => {
    const { service, tx, idem, sendCredentials } = accountFixture(method === 'activate');
    idem.claim.mockResolvedValue({ claimed: false, existingResponse: { accountId: 'account', associationId: 'association' } });
    expect(await service[method](admin, 'participation', 'op')).toMatchObject({ emailQueued: false, emailSent: null, temporaryPassword: null });
    expect(tx.authCredential.create).not.toHaveBeenCalled(); expect(sendCredentials).not.toHaveBeenCalled();
  });
});

describe('final covenant queue and uploaded-file compensation', () => {
  afterEach(() => jest.restoreAllMocks());
  function signingFixture() {
    const token = 'synthetic-signing-token-long-enough-for-validation';
    const current = { id: 'agreement', createdById: 'admin', status: AgreementStatus.SIGNED_BY_ORG,
      partyOneSigningTokenHash: createHash('sha256').update(token).digest('hex'), partyOneSigningExpiresAt: new Date(Date.now() + 60_000), partyOneSigningConsumedAt: null,
      participationId: 'participation', participation: { associationId: 'association', association: { name: 'جمعية' } },
      orgSignatureFile: { objectKey: 'org-signature', mimeType: 'image/png' }, signedByOrgAt: new Date(), orgSignerName: 'ممثل', orgSignerTitle: 'مدير', reference: 'COV-TEST' };
    const tx = {
      $queryRaw: jest.fn(async () => []), participationAgreement: { findUnique: jest.fn(async () => current), update: jest.fn(async () => ({})) },
      projectParticipation: { update: jest.fn(async () => ({})) },
      fileObject: { create: jest.fn(async () => ({ id: 'file' })) }, auditLog: { createMany: jest.fn(async () => ({})) },
    };
    const storage = { getPrivateObject: jest.fn(async () => Buffer.from('signature')), uploadPrivateObject: jest.fn(async (key: string) => { void key; }), deleteObjectBestEffort: jest.fn(async (key: string) => { void key; }) };
    const idem = { claim: jest.fn(async (): Promise<unknown> => ({ claimed: true })), complete: jest.fn(async () => undefined) };
    const sendCovenantCompletion = jest.fn(async () => ({ ok: true, emailQueued: true, eventId: 'event' }));
    const finalPdf = Buffer.from('%PDF-synthetic');
    jest.spyOn(prisma.participationAgreement, 'findUnique').mockResolvedValue(current as never);
    jest.spyOn(prisma, '$transaction').mockImplementation(async callback => {
      if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
      return callback(tx as never);
    });
    const service = new ParticipationsService({} as PublicCodeService, idem as unknown as IdempotencyService,
      storage as unknown as StorageService, { generateFinal: async () => finalPdf } as unknown as CovenantDocumentService,
      { sendCovenantCompletion } as unknown as OnboardingEmailService);
    const buffer = Buffer.alloc(800); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer); buffer.writeUInt32BE(200, 16); buffer.writeUInt32BE(80, 20);
    return { service, tx, storage, idem, sendCovenantCompletion, finalPdf, token, signature: { buffer, declaredMimeType: 'image/png' } };
  }
  it('queues after SIGNED/ACTIVE writes in the signing transaction, before completing idempotency', async () => {
    const { service, tx, storage, idem, sendCovenantCompletion, finalPdf, token, signature } = signingFixture();
    expect(await service.signPartyOne(token, 'op', signature)).toMatchObject({ status: AgreementStatus.SIGNED, emailQueued: true, emailSent: null });
    expect(sendCovenantCompletion).toHaveBeenCalledWith('agreement', finalPdf, tx);
    expect(tx.participationAgreement.update.mock.invocationCallOrder[0]).toBeLessThan(sendCovenantCompletion.mock.invocationCallOrder[0]);
    expect(tx.projectParticipation.update.mock.invocationCallOrder[0]).toBeLessThan(sendCovenantCompletion.mock.invocationCallOrder[0]);
    expect(sendCovenantCompletion.mock.invocationCallOrder[0]).toBeLessThan(idem.complete.mock.invocationCallOrder[0]);
    expect(storage.deleteObjectBestEffort).not.toHaveBeenCalled();
  });
  it('queue failure propagates through existing catch and removes exactly its two uploaded objects', async () => {
    const { service, storage, idem, sendCovenantCompletion, token, signature } = signingFixture();
    sendCovenantCompletion.mockRejectedValue(new Error('synthetic queue failure'));
    await expect(service.signPartyOne(token, 'op', signature)).rejects.toThrow('synthetic queue failure');
    expect(idem.complete).not.toHaveBeenCalled();
    expect(storage.deleteObjectBestEffort.mock.calls.map(([key]) => key)).toEqual(storage.uploadPrivateObject.mock.calls.map(([key]) => key));
  });
  it('an unowned legacy mail marker cannot pretend the new signing notification was queued', async () => {
    const { service, storage, idem, sendCovenantCompletion, token, signature } = signingFixture();
    sendCovenantCompletion.mockResolvedValue({ ok: false, emailQueued: false, eventId: '' });
    await expect(service.signPartyOne(token, 'op', signature)).rejects.toMatchObject({ code: 'COVENANT_EMAIL_DELIVERY_FAILED' });
    expect(idem.complete).not.toHaveBeenCalled();
    expect(storage.deleteObjectBestEffort).toHaveBeenCalledTimes(2);
  });
  it('replay still cleans only losing uploads and never queues or rewrites agreement', async () => {
    const { service, tx, storage, idem, sendCovenantCompletion, token, signature } = signingFixture();
    idem.claim.mockResolvedValue({ claimed: false, existingResponse: { ok: true, status: AgreementStatus.SIGNED, finalSha256: 'existing' } });
    expect(await service.signPartyOne(token, 'op', signature)).toMatchObject({ emailQueued: false, emailSent: null });
    expect(sendCovenantCompletion).not.toHaveBeenCalled(); expect(tx.participationAgreement.update).not.toHaveBeenCalled();
    expect(storage.deleteObjectBestEffort.mock.calls.map(([key]) => key)).toEqual(storage.uploadPrivateObject.mock.calls.map(([key]) => key));
  });
});
