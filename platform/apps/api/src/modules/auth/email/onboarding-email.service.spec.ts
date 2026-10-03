import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { prisma } from '@alzad/db';
import { EmailService, decryptEmailDelivery, type EmailDeliveryPayload } from './email.service';
import { OnboardingEmailService } from './onboarding-email.service';

describe('Onboarding atomic email queue', () => {
  afterEach(() => jest.restoreAllMocks());
  function fixture() {
    const pdf = Buffer.from('%PDF-synthetic');
    const agreement = { id: 'test-covenant', status: 'SIGNED', fullyExecutedAt: new Date(), reference: 'COV-TEST', finalFile: { id: 'final-file' }, finalSha256: createHash('sha256').update(pdf).digest('hex'), associationAccount: { name: 'جمعية تجريبية', email: 'test@example.org' } };
    const tx = {
      $queryRaw: jest.fn(async () => []),
      outboxEvent: { create: jest.fn(async (input: { data: { id: string; payload: unknown } }) => { void input; return {}; }) },
      participationAgreement: { findUniqueOrThrow: jest.fn(async () => agreement) },
      systemSetting: { findUnique: jest.fn(async (): Promise<unknown> => null), create: jest.fn(async () => ({})) },
      account: { findUniqueOrThrow: jest.fn(async () => ({ id: 'test-account', name: 'جمعية تجريبية', email: 'test@example.org', mustChangePassword: true })) },
      authCredential: { findFirst: jest.fn(async () => ({ secretHash: 'stored-secret-hash' })) },
      associationApplication: { findUniqueOrThrow: jest.fn(async (): Promise<unknown> => ({ status: 'UNDER_REVIEW', eligibilityStatus: 'FAILED', eligibilityNotes: 'المتطلبات غير مكتملة', email: 'test@example.org', publicCode: 'APP-TEST', name: 'جمعية تجريبية' })) },
    };
    const sendSecurityAlert = jest.fn(async () => undefined);
    const service = new OnboardingEmailService({ sendSecurityAlert } as unknown as EmailService);
    jest.spyOn(prisma, '$transaction').mockImplementation(async callback => {
      if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
      return callback(tx as never);
    });
    const queued = () => { const event = tx.outboxEvent.create.mock.calls[0][0].data; return { eventId: event.id, ...decryptEmailDelivery(event.id, event.payload as EmailDeliveryPayload) }; };
    return { service, tx, enqueueEmail: tx.outboxEvent.create, queued, sendSecurityAlert, agreement, pdf };
  }
  it('queues final file identity/SHA in caller transaction, never PDF bytes or SMTP', async () => {
    const { service, tx, enqueueEmail, queued, sendSecurityAlert, pdf } = fixture();
    const result = await service.sendCovenantCompletion('test-covenant', pdf, tx as never);
    expect(result).toMatchObject({ ok: true, emailQueued: true, eventId: expect.any(String) });
    expect(queued()).toMatchObject({ kind: 'NOTICE', params: { to: 'test@example.org', action: { url: expect.stringMatching(/\/association$/) } }, context: { type: 'covenant', agreementId: 'test-covenant', fileId: 'final-file', sha256: createHash('sha256').update(pdf).digest('hex') } });
    expect(JSON.stringify(enqueueEmail.mock.calls)).not.toContain('Buffer');
    expect(sendSecurityAlert).not.toHaveBeenCalled();
    expect(tx.systemSetting.create).toHaveBeenCalledWith({ data: { key: 'COVENANT_COMPLETION_EMAIL:test-covenant', value: { status: 'QUEUED', eventId: result.eventId } } });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.participationAgreement.findUniqueOrThrow.mock.invocationCallOrder[0]);
    expect(enqueueEmail.mock.invocationCallOrder[0]).toBeLessThan(tx.systemSetting.create.mock.invocationCallOrder[0]);
  });
  it.each(['unsigned', 'hash'])('refuses %s covenant before enqueue/marker mutation', async invalid => {
    const { service, tx, enqueueEmail, agreement, pdf } = fixture();
    if (invalid === 'unsigned') agreement.status = 'SENT';
    await expect(service.sendCovenantCompletion('test-covenant', invalid === 'hash' ? Buffer.from('wrong') : pdf, tx as never)).rejects.toMatchObject({ code: 'COVENANT_FINAL_NOT_FOUND' });
    expect(enqueueEmail).not.toHaveBeenCalled(); expect(tx.systemSetting.create).not.toHaveBeenCalled();
  });
  it('preserves legacy SENT without duplicate queue', async () => {
    const { service, tx, enqueueEmail, pdf } = fixture();
    tx.systemSetting.findUnique.mockResolvedValue({ value: { status: 'SENT' } });
    expect(await service.sendCovenantCompletion('test-covenant', pdf, tx as never)).toEqual({ ok: true, alreadySent: true });
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
  it.each(['QUEUED', 'PROCESSING', 'FAILED', 'SMTP_UNCERTAIN'])('returns existing %s ownership without unsafe resend', async status => {
    const { service, tx, enqueueEmail, pdf } = fixture();
    tx.systemSetting.findUnique.mockResolvedValue({ value: { status, eventId: 'original-event' } });
    expect(await service.sendCovenantCompletion('test-covenant', pdf, tx as never)).toMatchObject({ ok: true, alreadyQueued: true, eventId: 'original-event' });
    expect(enqueueEmail).not.toHaveBeenCalled(); expect(tx.systemSetting.create).not.toHaveBeenCalled();
  });
  it.each(['PROCESSING', 'FAILED'])('does not retry ambiguous legacy %s without ownership', async status => {
    const { service, tx, enqueueEmail, pdf } = fixture();
    tx.systemSetting.findUnique.mockResolvedValue({ value: { status, attempts: 1 } });
    expect(await service.sendCovenantCompletion('test-covenant', pdf, tx as never)).toEqual({ ok: false });
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
  it('propagates outbox failure so enclosing covenant transaction rolls back', async () => {
    const { service, tx, enqueueEmail, pdf } = fixture();
    enqueueEmail.mockRejectedValue(new Error('synthetic outbox failure'));
    await expect(service.sendCovenantCompletion('test-covenant', pdf, tx as never)).rejects.toThrow('synthetic outbox failure');
    expect(tx.systemSetting.create).not.toHaveBeenCalled();
  });
  it('marker collision rejects the caller transaction rather than commit an orphaned queue', async () => {
    const { service, tx, pdf } = fixture();
    tx.systemSetting.create.mockRejectedValue(new Error('synthetic collision'));
    await expect(service.sendCovenantCompletion('test-covenant', pdf, tx as never)).rejects.toThrow('synthetic collision');
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
  });
  it('queues credential with current hash in caller transaction, not delivered audit', async () => {
    const { service, tx, enqueueEmail, queued, sendSecurityAlert } = fixture();
    await expect(service.sendCredentials('test-account', 'Synthetic!Temp2026', tx as never)).resolves.toBe(true);
    expect(queued()).toMatchObject({ kind: 'NOTICE', params: { body: expect.stringContaining('Synthetic!Temp2026') }, context: { type: 'credentials', accountId: 'test-account', credentialHash: 'stored-secret-hash' } });
    expect(JSON.stringify(enqueueEmail.mock.calls)).not.toContain('Synthetic!Temp2026');
    expect(JSON.stringify(enqueueEmail.mock.calls)).not.toContain('test@example.org');
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });
  it('queues FAILED eligibility accurately without reversing legacy missing-email decision', async () => {
    const { service, tx, enqueueEmail } = fixture();
    tx.associationApplication.findUniqueOrThrow.mockResolvedValue({ status: 'UNDER_REVIEW', eligibilityStatus: 'FAILED', eligibilityNotes: 'المتطلبات غير مكتملة', email: null, publicCode: 'APP-TEST', name: 'جمعية تجريبية' });
    await expect(service.sendRejection('test-application', tx as never)).resolves.toBe(true);
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    const event = enqueueEmail.mock.calls[0][0].data;
    expect(() => decryptEmailDelivery(event.id, event.payload as EmailDeliveryPayload)).toThrow('MAIL_PAYLOAD_INVALID');
  });
  it('queues the failed eligibility wording and exact expected reason without plaintext in stored rows', async () => {
    const { service, tx, queued, enqueueEmail } = fixture();
    await service.sendRejection('test-application', tx as never);
    expect(queued()).toMatchObject({ params: { body: expect.stringContaining('لم يجتز طلبكم متطلبات الأهلية') }, context: { type: 'rejection', applicationId: 'test-application', expectedReason: 'المتطلبات غير مكتملة' } });
    expect(JSON.stringify(enqueueEmail.mock.calls)).not.toContain('test@example.org');
  });
  it('rejects non-rejection before enqueue and opens one transaction for standalone call', async () => {
    const { service, tx, enqueueEmail } = fixture();
    tx.associationApplication.findUniqueOrThrow.mockResolvedValue({ status: 'UNDER_REVIEW', eligibilityStatus: 'PENDING' });
    await expect(service.sendRejection('test-application')).rejects.toThrow('not committed');
    expect(enqueueEmail).not.toHaveBeenCalled(); expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
