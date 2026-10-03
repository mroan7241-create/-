import { jest } from '@jest/globals';
import { AccountRole, DeliveryApprovalDecision, DeliveryApprovalStage, NotificationSeverity, prisma } from '@alzad/db';
import type { AllocationTriggerPort } from '../allocation/allocation-trigger.port';
import type { SettingsService } from '../settings/settings.service';
import { NotificationsService } from './notifications.service';
import { encryptEmailDelivery, type EmailDeliveryContext, type EmailDeliveryPayload, type EmailService } from '../auth/email/email.service';
import { Logger } from '@nestjs/common';
import type { StorageService } from '../files/storage.service';
import { createHash } from 'node:crypto';
import { storageConfig } from '../../config/storage.config';

describe('NotificationsService SLA', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('warns after one business day and escalates only after one additional business day without association action', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    const settings = { getValue: jest.fn(async (key: string) => key === 'calendar.workingDays' ? [0, 1, 2, 3, 4, 5, 6] : []) } as unknown as SettingsService;
    const allocation = { triggerForAssociation: jest.fn() } as unknown as AllocationTriggerPort;
    const service = new NotificationsService(settings, allocation);
    jest.spyOn(prisma.deliveryMission, 'findMany').mockResolvedValue([
      { id: '10000000-0000-4000-8000-000000000001', publicCode: 'DEL-OLD', associationId: '20000000-0000-4000-8000-000000000001', updatedAt: new Date('2026-08-28T11:00:00.000Z'), approvals: [] },
      { id: '10000000-0000-4000-8000-000000000002', publicCode: 'DEL-WARN', associationId: '20000000-0000-4000-8000-000000000002', updatedAt: new Date('2026-08-29T11:00:00.000Z'), approvals: [] },
      { id: '10000000-0000-4000-8000-000000000003', publicCode: 'DEL-ACTED', associationId: '20000000-0000-4000-8000-000000000003', updatedAt: new Date('2026-08-25T11:00:00.000Z'), approvals: [{ createdAt: new Date('2026-08-26T11:00:00.000Z'), stage: DeliveryApprovalStage.ASSOCIATION, decision: DeliveryApprovalDecision.APPROVED }] },
    ] as never);
    const upsert = jest.spyOn(prisma.notification, 'upsert').mockResolvedValue({} as never);

    const result = await service.scanDeliverySla();

    expect(result).toEqual({ scanned: 3, emitted: 3 });
    expect(upsert).toHaveBeenCalledTimes(3);
    const dedupeKeys = upsert.mock.calls.map(([input]) => input.create.dedupeKey);
    expect(dedupeKeys).toEqual(expect.arrayContaining([
      'sla:10000000-0000-4000-8000-000000000001:association-warning',
      'sla:10000000-0000-4000-8000-000000000001:zaad-escalation',
      'sla:10000000-0000-4000-8000-000000000002:association-warning',
    ]));
    expect(upsert.mock.calls.every(([input]) => input.create.type === 'DELIVERY_APPROVAL_SLA')).toBe(true);
    expect(upsert.mock.calls.some(([input]) => input.create.audienceRole === AccountRole.ADMIN && input.create.severity === NotificationSeverity.CRITICAL)).toBe(true);
  });

  it('skips SLA emission until the business calendar is configured', async () => {
    const settings = { getValue: jest.fn(async () => null) } as unknown as SettingsService;
    const service = new NotificationsService(settings, { triggerForAssociation: jest.fn() } as unknown as AllocationTriggerPort);
    const findMany = jest.spyOn(prisma.deliveryMission, 'findMany');
    await expect(service.scanDeliverySla()).resolves.toEqual({ skipped: 'required business calendar settings missing' });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('NotificationsService email delivery phases', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });
  afterEach(() => jest.restoreAllMocks());
  it('quarantines a claimed SMTP_STARTED event without resending or consuming predecessors', async () => {
    const service = new NotificationsService({} as SettingsService, {} as AllocationTriggerPort);
    const update = jest.spyOn(prisma.outboxEvent, 'updateMany').mockResolvedValue({ count: 1 });
    const consume = jest.spyOn(prisma.passwordResetToken, 'updateMany');
    const payload = encryptEmailDelivery('id', 'PASSWORD_RESET', { to: 'recipient@example.org', name: 'n', code: 'secret' }, { type: 'reset', tokenId: 'token', accountId: 'account', credentialHash: 'hash', predecessorIds: ['old'] });
    const result = await (service as unknown as { processEmailEvent(event: unknown): Promise<string> }).processEmailEvent({ id: 'id', attempts: 0, payload: { ...payload, phase: 'SMTP_STARTED' } });
    expect(result).toBe('failed');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', lastError: 'MAIL_DELIVERY_UNCERTAIN' }) }));
    expect(consume).not.toHaveBeenCalled();
  });

  function harness(context: EmailDeliveryContext = { type: 'reset', tokenId: 'candidate', accountId: 'account', credentialHash: 'hash', predecessorIds: ['old', 'candidate'] }, phase: EmailDeliveryPayload['phase'] = 'READY') {
    const mutate = () => jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ count: 1 });
    const send = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const mail = { sendPasswordResetCode: send, sendApplicationAccess: send, sendSecurityAlert: send } as unknown as EmailService;
    const pdf = Buffer.from('%PDF-test-private'), sha256 = createHash('sha256').update(pdf).digest('hex');
    const storage = { getPrivateObject: jest.fn<(...args: unknown[]) => Promise<Buffer>>().mockResolvedValue(pdf) };
    const service = new NotificationsService({} as SettingsService, {} as AllocationTriggerPort, mail, storage as unknown as StorageService);
    const params = context.type === 'access' ? { to: 'recipient@example.org', name: 'n', subject: 's', intro: 'b', items: [{ label: 'l', code: 'c', url: 'https://web.invalid/apply/access?token=private' }] } : context.type === 'reset' ? { to: 'recipient@example.org', name: 'n', code: 'secret' } : { to: 'recipient@example.org', name: 'n', subject: 's', body: 'secret-body' };
    const kind = context.type === 'access' ? 'APPLICATION_ACCESS' : context.type === 'reset' ? 'PASSWORD_RESET' : 'NOTICE';
    const event = { id: '00000000-0000-4000-8000-000000000001', type: 'EMAIL_DELIVERY', attempts: 0, nextAttemptAt: new Date(), lockedAt: new Date(), status: 'PROCESSING', payload: { ...encryptEmailDelivery('00000000-0000-4000-8000-000000000001', kind, params as never, context), phase } };
    const stored = { ...event, lastError: null as string | null };
    const update = jest.spyOn(prisma.outboxEvent, 'update').mockImplementation((async ({ data }: { data: Record<string, unknown> }) => { Object.assign(stored, data); return stored; }) as never);
    const updateMany = jest.spyOn(prisma.outboxEvent, 'updateMany').mockImplementation((async ({ where, data }: { where: { status?: string; lockedAt?: Date; payload?: { equals: string }; OR?: Array<{ status: string; lockedAt?: Date; lastError?: string }> }; data: object }) => {
      const owns = (condition: { status?: string; lockedAt?: Date; lastError?: string }) => (!condition.status || condition.status === stored.status) && (!condition.lockedAt || condition.lockedAt.getTime() === stored.lockedAt?.getTime()) && (!condition.lastError || condition.lastError === stored.lastError);
      if (!owns(where) || (where.payload && where.payload.equals !== stored.payload.phase) || (where.OR && !where.OR.some(owns))) return { count: 0 };
      Object.assign(stored, data); return { count: 1 };
    }) as never);
    const tx = {
      $queryRaw: mutate(),
      outboxEvent: { update, findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockImplementation(async () => stored), updateMany },
      account: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'account', status: 'ACTIVE', email: params.to, mustChangePassword: true }) },
      authCredential: { findFirst: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ secretHash: 'hash' }) },
      passwordResetToken: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'candidate', accountId: 'account', emailNormalized: params.to, expiresAt: new Date(Date.now() + 60_000), consumedAt: null }), updateMany: mutate() },
      applicationAccessToken: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'candidate', draftId: 'draft', expiresAt: new Date(Date.now() + 60_000), consumedAt: null, draft: { contactEmail: params.to, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), submittedApplicationId: 'application' } }), updateMany: mutate() },
      associationApplication: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'application', email: params.to, status: 'REJECTED', eligibilityStatus: 'FAILED', rejectReason: 'reason', selectionList: 'MAIN' }) },
      applicationInformationRequest: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'request', applicationId: 'application', status: 'OPEN' }) },
      participationAgreement: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'agreement', status: 'SIGNED', fullyExecutedAt: new Date(), finalFileId: 'file', finalSha256: sha256, associationAccount: { email: params.to } }) },
      systemSetting: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ value: { status: 'QUEUED', eventId: event.id } }), updateMany: mutate() },
      auditLog: { create: mutate() },
    };
    jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) as never);
    jest.spyOn(prisma.fileObject, 'findUnique').mockResolvedValue({ bucket: storageConfig.bucket, objectKey: 'private-key', sha256, mimeType: 'application/pdf', sizeBytes: BigInt(pdf.length) } as never);
    const run = () => {
      if (event.status === 'PENDING') { event.status = 'PROCESSING'; event.lockedAt = new Date(); Object.assign(stored, { status: event.status, lockedAt: event.lockedAt }); }
      return (service as unknown as { processEmailEvent(input: unknown): Promise<string> }).processEmailEvent(event);
    };
    return { service, send, storage, tx, event, stored, update, updateMany, run, sha256, pdf };
  }

  it('persists STARTED before SMTP, then ACCEPTED before atomic predecessor/audit/processed finalization', async () => {
    const h = harness();
    h.send.mockImplementationOnce(async () => { expect(h.stored.payload.phase).toBe('SMTP_STARTED'); expect(h.tx.passwordResetToken.updateMany).not.toHaveBeenCalled(); });
    expect(await h.run()).toBe('processed');
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'secret' }), { messageId: `<${h.event.id}@alzad-mail.invalid>` });
    expect(h.tx.passwordResetToken.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['old'] }, accountId: 'account', consumedAt: null }, data: { consumedAt: expect.any(Date) } });
    expect(h.stored).toMatchObject({ status: 'PROCESSED', payload: { phase: 'SMTP_ACCEPTED' } });
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PASSWORD_RESET_EMAIL_SENT' }) }));
    const acceptedWrite = h.updateMany.mock.calls.findIndex(([input]) => (input.data.payload as unknown as EmailDeliveryPayload)?.phase === 'SMTP_ACCEPTED');
    expect(acceptedWrite).toBeGreaterThanOrEqual(0);
  });

  it('resumes accepted mail after failed DB finalization without another SMTP attempt', async () => {
    const h = harness();
    h.tx.auditLog.create.mockRejectedValueOnce(new Error('private database URL/password'));
    expect(await h.run()).toBe('retried');
    expect(h.stored).toMatchObject({ status: 'PENDING', lastError: 'MAIL_FINALIZATION_FAILED', payload: { phase: 'SMTP_ACCEPTED' } });
    Object.assign(h.event, h.stored);
    expect(await h.run()).toBe('processed');
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(jest.mocked(Logger.prototype.error).mock.calls)).not.toContain('private');
  });

  it('acceptance persistence failure retains accepted phase in durable retry state', async () => {
    const h = harness(); const original = h.updateMany.getMockImplementation()!;
    h.updateMany.mockImplementationOnce(original).mockRejectedValueOnce(new Error('private persistence error'));
    expect(await h.run()).toBe('retried');
    expect(h.stored.payload.phase).toBe('SMTP_ACCEPTED');
    Object.assign(h.event, h.stored);
    expect(await h.run()).toBe('processed'); expect(h.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { error: { code: 'ETIMEDOUT', command: 'CONN' }, result: 'retried', phase: 'READY', code: 'MAIL_TEMPORARY_FAILURE' },
    { error: { code: 'ETIMEDOUT', command: 'DATA' }, result: 'failed', phase: 'SMTP_STARTED', code: 'MAIL_DELIVERY_UNCERTAIN' },
    { error: { code: 'EAUTH', command: 'AUTH PLAIN' }, result: 'failed', phase: 'SMTP_STARTED', code: 'MAIL_DELIVERY_REJECTED' },
    { error: { code: 'unrecognized-secret' }, result: 'failed', phase: 'SMTP_STARTED', code: 'MAIL_DELIVERY_UNCERTAIN' },
  ])('preserves every old reset token on $code', async ({ error, result, phase, code }) => {
    const h = harness(); h.send.mockRejectedValue(Object.assign(new Error('private recipient/code/URL'), error));
    expect(await h.run()).toBe(result);
    expect(h.tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(h.stored).toMatchObject({ payload: { phase }, lastError: code });
    expect(JSON.stringify(jest.mocked(Logger.prototype.error).mock.calls)).not.toContain('private');
  });

  it('bounds definite pre-acceptance retries at five attempts', async () => {
    const h = harness(); h.event.attempts = 4; h.send.mockRejectedValue({ code: 'ETIMEDOUT', command: 'CONN' });
    expect(await h.run()).toBe('failed'); expect(h.stored).toMatchObject({ status: 'FAILED', attempts: 5 });
  });

  it('does not send when it loses its READY claim', async () => {
    const h = harness(); h.tx.outboxEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await h.run()).toBe('retried'); expect(h.send).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });

  it('never lets an old lease failure clobber a newer processed acceptance', async () => {
    const h = harness();
    h.tx.passwordResetToken.findUnique.mockImplementationOnce(async () => {
      Object.assign(h.stored, { status: 'PROCESSED', lockedAt: new Date(Date.now() + 1), payload: { ...h.stored.payload, phase: 'SMTP_ACCEPTED' } });
      throw new Error('late private database failure');
    });
    await h.run();
    expect(h.stored).toMatchObject({ status: 'PROCESSED', payload: { phase: 'SMTP_ACCEPTED' } });
    expect(h.send).not.toHaveBeenCalled();
  });

  it('never suppresses a candidate from an old invalid-state lease after a newer acceptance', async () => {
    const h = harness();
    h.tx.passwordResetToken.findUnique.mockImplementationOnce(async () => {
      Object.assign(h.stored, { status: 'PROCESSED', lockedAt: new Date(Date.now() + 1), payload: { ...h.stored.payload, phase: 'SMTP_ACCEPTED' } });
      return { id: 'candidate', accountId: 'account', consumedAt: new Date() };
    });
    await h.run();
    expect(h.tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(h.stored.status).toBe('PROCESSED'); expect(h.send).not.toHaveBeenCalled();
  });

  it('uses account/context then outbox lock order during accepted finalization and respects the lease', async () => {
    const h = harness(undefined, 'SMTP_ACCEPTED');
    expect(await h.run()).toBe('processed');
    const locks = h.tx.$queryRaw.mock.calls.map(([sql]) => String(sql));
    expect(locks[0]).toContain('FROM accounts'); expect(locks[1]).toContain('FROM outbox_events');
    expect(h.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'PROCESSING', lockedAt: h.event.lockedAt, payload: { path: ['phase'], equals: 'SMTP_ACCEPTED' } }) }));
    expect(h.send).not.toHaveBeenCalled();
  });

  it('does not finalize a newer owner accepted lease from a stale invocation', async () => {
    const h = harness(undefined, 'SMTP_ACCEPTED'); h.stored.lockedAt = new Date(h.event.lockedAt.getTime() + 1);
    expect(await h.run()).toBe('retried');
    expect(h.tx.passwordResetToken.updateMany).not.toHaveBeenCalled(); expect(h.tx.auditLog.create).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });

  it.each(['expired', 'password-changed', 'already-consumed', 'wrong-recipient'])('suppresses only the stale candidate: %s', async reason => {
    const h = harness();
    if (reason === 'expired') h.tx.passwordResetToken.findUnique.mockResolvedValue({ accountId: 'account', emailNormalized: 'recipient@example.org', expiresAt: new Date(0), consumedAt: null });
    if (reason === 'password-changed') h.tx.authCredential.findFirst.mockResolvedValue({ secretHash: 'new-hash' });
    if (reason === 'already-consumed') h.tx.passwordResetToken.findUnique.mockResolvedValue({ accountId: 'account', emailNormalized: 'recipient@example.org', expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date() });
    if (reason === 'wrong-recipient') h.tx.account.findUnique.mockResolvedValue({ status: 'ACTIVE', email: 'other@example.org' });
    expect(await h.run()).toBe('failed'); expect(h.send).not.toHaveBeenCalled();
    expect(h.tx.passwordResetToken.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.passwordResetToken.updateMany).toHaveBeenCalledWith({ where: { id: 'candidate', accountId: 'account', consumedAt: null }, data: { consumedAt: expect.any(Date) } });
  });

  it('does not revoke old tokens if the accepted candidate was consumed while SMTP was in progress', async () => {
    const h = harness();
    h.send.mockImplementationOnce(async () => { h.tx.passwordResetToken.findUnique.mockResolvedValue({ accountId: 'account', emailNormalized: 'recipient@example.org', expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date() }); });
    expect(await h.run()).toBe('processed');
    expect(h.tx.passwordResetToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'candidate' }) }));
    expect(h.tx.passwordResetToken.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ['old'] } }) }));
  });

  it('checks current selection and information request, never changing the application', async () => {
    const h = harness({ type: 'access', draftTokens: [{ id: 'candidate', draftId: 'draft', predecessorIds: ['old'] }], expected: { applicationId: 'application', selectionList: 'RESERVE', informationRequestId: 'request' } });
    expect(await h.run()).toBe('failed'); expect(h.send).not.toHaveBeenCalled();
    expect(h.tx.applicationAccessToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'candidate', draftId: 'draft', consumedAt: null } }));
  });

  it('consumes only captured access predecessors after acceptance', async () => {
    const h = harness({ type: 'access', draftTokens: [{ id: 'candidate', draftId: 'draft', predecessorIds: ['old', 'candidate'] }], expected: { applicationId: 'application', selectionList: 'MAIN', informationRequestId: 'request' } });
    expect(await h.run()).toBe('processed');
    expect(h.tx.applicationAccessToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['old'] }, draftId: 'draft', consumedAt: null } }));
  });

  it.each([
    { expected: '2026-10-04T08:00:00.000Z', actual: '2026-10-04T08:00:00.000Z', result: 'processed' },
    { expected: '2026-10-04T08:00:00.000Z', actual: '2026-10-04T09:00:00.000Z', result: 'failed' },
    { expected: '2026-10-04T08:00:00.000Z', actual: null, result: 'failed' },
    { expected: null, actual: null, result: 'processed' },
  ])('binds the automatic selection email to its exact decision time: $result', async ({ expected, actual, result }) => {
    const h = harness({ type: 'access', draftTokens: [{ id: 'candidate', draftId: 'draft', predecessorIds: ['old'] }], expected: { applicationId: 'application', selectionList: 'MAIN', selectionApprovedAt: expected } });
    h.tx.associationApplication.findUnique.mockResolvedValue({ id: 'application', email: 'recipient@example.org', selectionList: 'MAIN', selectionApprovedAt: actual ? new Date(actual) : null });
    expect(await h.run()).toBe(result);
    expect(h.send).toHaveBeenCalledTimes(result === 'processed' ? 1 : 0);
  });

  it('suppresses an obsolete rejection without undoing the decision', async () => {
    const h = harness({ type: 'rejection', applicationId: 'application', expectedReason: 'previous-reason' });
    expect(await h.run()).toBe('failed'); expect(h.send).not.toHaveBeenCalled();
    expect(h.tx.associationApplication.findUnique).toHaveBeenCalled();
  });

  it('loads the approved private PDF and marks covenant SENT with the outbox completion', async () => {
    const pdf = Buffer.from('%PDF-test-private'), sha256 = createHash('sha256').update(pdf).digest('hex');
    const h = harness({ type: 'covenant', agreementId: 'agreement', fileId: 'file', sha256, markerKey: 'COVENANT_COMPLETION_EMAIL:agreement', filename: 'covenant.pdf' });
    expect(await h.run()).toBe('processed');
    expect(h.storage.getPrivateObject).toHaveBeenCalledWith('private-key');
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ pdfAttachment: { filename: 'covenant.pdf', content: pdf } }), expect.any(Object));
    expect(h.tx.systemSetting.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { value: { status: 'SENT', eventId: h.event.id, sentAt: expect.any(String) } } }));
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'COVENANT_COMPLETION_EMAIL_SENT' }) }));
  });

  it('fails closed on covenant PDF tampering without sending or marking SENT', async () => {
    const sha256 = createHash('sha256').update(Buffer.from('%PDF-test-private')).digest('hex');
    const h = harness({ type: 'covenant', agreementId: 'agreement', fileId: 'file', sha256, markerKey: 'COVENANT_COMPLETION_EMAIL:agreement', filename: 'covenant.pdf' });
    h.storage.getPrivateObject.mockResolvedValue(Buffer.from('tampered'));
    expect(await h.run()).toBe('failed'); expect(h.send).not.toHaveBeenCalled(); expect(h.tx.systemSetting.updateMany).not.toHaveBeenCalled();
    expect(h.stored.lastError).toBe('MAIL_ATTACHMENT_INVALID');
  });

  it('requeues stale READY/ACCEPTED only and quarantines all remaining stale mail phases', async () => {
    const h = harness(); const updateMany = jest.spyOn(prisma.outboxEvent, 'updateMany').mockResolvedValue({ count: 0 });
    jest.spyOn(h.service as unknown as { claimNextEvent(): Promise<null> }, 'claimNextEvent').mockResolvedValue(null);
    expect(await h.service.processOutbox()).toEqual({ processed: 0, retried: 0, failed: 0 });
    expect(updateMany).toHaveBeenCalledTimes(4);
    expect(updateMany.mock.calls[0]![0].where!.type).toEqual({ not: 'EMAIL_DELIVERY' });
    expect(updateMany.mock.calls.slice(1, 3).map(([input]) => input.where!.payload)).toEqual([{ path: ['phase'], equals: 'READY' }, { path: ['phase'], equals: 'SMTP_ACCEPTED' }]);
    expect(updateMany.mock.calls[3]![0].data).toMatchObject({ status: 'FAILED', lastError: 'MAIL_DELIVERY_UNCERTAIN' });
  });

  it('exposes durable mail failures through the existing admin monitor without encrypted payloads', async () => {
    const h = harness(); jest.spyOn(prisma.outboxEvent, 'count').mockResolvedValue(1);
    const failed = { id: h.event.id, type: 'EMAIL_DELIVERY', status: 'FAILED', lastError: 'MAIL_DELIVERY_UNCERTAIN', attempts: 1 };
    const find = jest.spyOn(prisma.outboxEvent, 'findMany').mockResolvedValue([failed] as never);
    expect(await h.service.monitorOutbox()).toEqual({ summary: { pending: 1, processing: 1, failed: 1 }, items: [failed] });
    expect(find.mock.calls[0]![0]!.select).not.toHaveProperty('payload');
  });
});
