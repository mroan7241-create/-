import { jest } from '@jest/globals';
import { OutboxEventStatus, OutboxEventType, prisma, type Prisma } from '@alzad/db';
import { ApplicationAccessService } from './application-access.service';
import * as mail from '../auth/email/email.service';
import type { RateLimitService } from '../../common/rate-limit.service';

describe('Applicant access durable email producer', () => {
  afterEach(() => jest.restoreAllMocks());
  function setup() {
    const draft = { id: 'draft-id', publicCode: 'DRF-TEST', status: 'SUBMITTED', expiresAt: new Date(Date.now() + 60_000), contactEmail: 'synthetic@example.org', submittedApplication: { id: 'application-id', name: 'synthetic', email: 'synthetic@example.org', publicCode: 'APP-TEST' } };
    const create = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ id: 'candidate-id' });
    const revoke = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ count: 1 });
    const lock = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const findDraft = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue(draft);
    const queued = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ id: 'event-id' });
    const tx = { $queryRaw: lock, outboxEvent: { create: queued }, associationApplicationDraft: { findUnique: findDraft, findFirst: findDraft }, applicationAccessToken: { create, findMany: jest.fn<(...args: unknown[]) => Promise<object[]>>().mockResolvedValue([{ id: 'previous-id' }]), updateMany: revoke }, auditLog: { createMany: jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ count: 1 }) } };
    const send = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const service = new ApplicationAccessService({ consume: async () => undefined } as unknown as RateLimitService, { sendApplicationAccess: send } as unknown as mail.EmailService);
    return { service, tx, create, revoke, lock, findDraft, send, queued };
  }
  it('persists candidate and delivery in the caller business transaction without sending or revoking predecessors', async () => {
    const { service, tx, create, revoke, lock, send, queued } = setup();
    const nested = jest.spyOn(prisma, '$transaction');
    await expect(service.sendSubmitted('draft-id', tx as unknown as Prisma.TransactionClient)).resolves.toBe(true);
    expect(nested).not.toHaveBeenCalled();
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
    const { data } = queued.mock.calls[0]![0] as { data: { id: string; payload: mail.EmailDeliveryPayload } };
    const delivery = mail.decryptEmailDelivery(data.id, data.payload);
    expect(delivery).toEqual({ kind: 'APPLICATION_ACCESS', params: expect.objectContaining({ to: 'synthetic@example.org', items: [expect.objectContaining({ code: 'APP-TEST', url: expect.stringContaining('/apply/access?token=') })] }), context: { type: 'access', draftTokens: [{ id: 'candidate-id', draftId: 'draft-id', predecessorIds: ['previous-id'] }] } });
    expect(JSON.stringify(data.payload)).not.toContain('synthetic@example.org');
    expect(send).not.toHaveBeenCalled(); expect(revoke).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
  });
  it('does not queue an expired draft or alter its usable predecessors', async () => {
    const { service, tx, create, revoke, findDraft, queued } = setup();
    findDraft.mockResolvedValue({ id: 'draft-id', status: 'SUBMITTED', expiresAt: new Date(0), contactEmail: 'synthetic@example.org' });
    await expect(service.sendSubmitted('draft-id', tx as unknown as Prisma.TransactionClient)).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled(); expect(queued).not.toHaveBeenCalled(); expect(revoke).not.toHaveBeenCalled();
  });
  it('propagates enqueue failure inside the same transaction without invalidating candidate or predecessor', async () => {
    const { service, tx, queued, revoke, send } = setup();
    queued.mockRejectedValue(new Error('synthetic queue unavailable'));
    await expect(service.sendSubmitted('draft-id', tx as unknown as Prisma.TransactionClient)).rejects.toThrow('synthetic queue unavailable');
    expect(revoke).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it('binds a selection notice to the exact committed application and selection', async () => {
    const { service, tx, queued, lock } = setup();
    const findApplication = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ id: 'application-id', publicCode: 'APP-TEST', email: 'synthetic@example.org', name: 'synthetic', selectionList: 'MAIN', status: 'ACCEPTED', selectionApprovedAt: null, sourceDraft: { id: 'draft-id', publicCode: 'DRF-TEST', status: 'SUBMITTED' } });
    const client = { ...tx, associationApplication: { findUnique: findApplication } };
    jest.spyOn(service, 'selectionDelivery').mockResolvedValue({ status: 'NOT_REQUESTED' });
    await expect(service.sendSelectionDecision('application-id', client as unknown as Prisma.TransactionClient)).resolves.toBe(true);
    const { data } = queued.mock.calls[0]![0] as { data: { id: string; payload: mail.EmailDeliveryPayload } };
    expect(mail.decryptEmailDelivery(data.id, data.payload).context).toEqual(expect.objectContaining({ type: 'access', expected: { applicationId: 'application-id', selectionList: 'MAIN', selectionApprovedAt: null } }));
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(findApplication.mock.invocationCallOrder[0]!);
    expect(tx.auditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ metadata: expect.objectContaining({ eventId: data.id, applicationId: 'application-id', selectionList: 'MAIN' }) })] }));
  });
  it('binds the completion notice to the exact open information request', async () => {
    const { service, tx, queued } = setup();
    const client = { ...tx, associationApplication: { findUnique: async () => ({ id: 'application-id', email: 'synthetic@example.org', name: 'synthetic', sourceDraft: { id: 'draft-id', publicCode: 'DRF-TEST', status: 'SUBMITTED' }, informationRequests: [{ id: 'information-id', note: 'synthetic', items: [{ type: 'FIELD', key: 'organization.notes', reason: 'synthetic' }] }] }) } };
    await expect(service.sendNeedsInfo('application-id', client as unknown as Prisma.TransactionClient)).resolves.toBe(true);
    const { data } = queued.mock.calls[0]![0] as { data: { id: string; payload: mail.EmailDeliveryPayload } };
    expect(mail.decryptEmailDelivery(data.id, data.payload).context).toEqual(expect.objectContaining({ type: 'access', expected: { applicationId: 'application-id', informationRequestId: 'information-id' } }));
  });
});

describe('Unsent MAIN selection email cancellation', () => {
  const applicationId = 'application-id', draftId = 'draft-id';
  const decisionAt = new Date('2026-10-04T08:00:00.000Z');
  const firstId = '00000000-0000-4000-8000-000000000001';
  const secondId = '00000000-0000-4000-8000-000000000002';
  type Event = { id: string; type: OutboxEventType; status: OutboxEventStatus; payload: mail.EmailDeliveryPayload; lastError: string | null; lockedAt: Date | null };
  function event(id = firstId, context: mail.EmailDeliveryContext = {
    type: 'access', draftTokens: [{ id: `candidate-${id}`, draftId, predecessorIds: ['previous-usable-token'] }],
    expected: { applicationId, selectionList: 'MAIN', selectionApprovedAt: decisionAt.toISOString() },
  }): Event {
    return { id, type: OutboxEventType.EMAIL_DELIVERY, status: OutboxEventStatus.PENDING, lastError: null, lockedAt: null,
      payload: mail.encryptEmailDelivery(id, 'APPLICATION_ACCESS', { to: 'synthetic@example.org', name: 'synthetic', subject: 'synthetic', intro: 'synthetic', items: [] }, context) };
  }
  function setup(events: Event[] = [event()], auditIds: unknown[] = events.map(item => item.id)) {
    const rows = new Map(events.map(item => [item.id, item]));
    const records = jest.fn<(...args: unknown[]) => Promise<object[]>>().mockResolvedValue(auditIds.map(eventId => ({ metadata: { eventId, applicationId, selectionList: 'MAIN' } })));
    const lock = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const update = jest.fn<(args: { where: { id: string }; data: Partial<Event> }) => Promise<{ count: number }>>()
      .mockImplementation(async ({ where, data }) => { Object.assign(rows.get(where.id)!, data); return { count: 1 }; });
    const revoke = jest.fn<(...args: unknown[]) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const tx = { auditLog: { findMany: records, findFirst: jest.fn<(...args: unknown[]) => Promise<object | null>>().mockResolvedValue({ id: 'original-decision' }) }, $queryRaw: lock,
      outboxEvent: { findMany: async () => [...rows.values()], findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null, updateMany: update },
      applicationAccessToken: { updateMany: revoke } };
    const send = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const service = new ApplicationAccessService({ consume: async () => undefined } as unknown as RateLimitService, { sendApplicationAccess: send } as unknown as mail.EmailService);
    const cancel = () => service.cancelUnsentMainDecision(tx as unknown as Prisma.TransactionClient, applicationId, draftId, decisionAt);
    return { cancel, service, tx, records, lock, update, revoke, send, rows };
  }
  async function expectBlocked(current: ReturnType<typeof setup>) {
    await expect(current.cancel()).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_EMAIL_STARTED' });
    expect(current.update).not.toHaveBeenCalled(); expect(current.revoke).not.toHaveBeenCalled(); expect(current.send).not.toHaveBeenCalled();
  }

  it.each([OutboxEventStatus.PENDING, OutboxEventStatus.PROCESSING, OutboxEventStatus.FAILED])('cancels READY %s under the event lease and consumes only its own candidate', async status => {
    const row = event(); row.status = status;
    if (status === OutboxEventStatus.PROCESSING) row.lockedAt = new Date('2026-10-03T01:00:00Z');
    if (status === OutboxEventStatus.FAILED) row.lastError = 'MAIL_DELIVERY_REJECTED';
    const current = setup([row]); const originalLease = row.lockedAt;
    await expect(current.cancel()).resolves.toBeUndefined();
    expect(current.lock.mock.invocationCallOrder[0]).toBeLessThan(current.update.mock.invocationCallOrder[0]!);
    expect(current.update).toHaveBeenCalledWith({ where: { id: firstId, status, lockedAt: originalLease, payload: { path: ['phase'], equals: 'READY' } },
      data: { status: OutboxEventStatus.FAILED, failedAt: expect.any(Date), lockedAt: null, lastError: 'MAIL_STATE_INVALID' } });
    expect(current.revoke).toHaveBeenCalledWith({ where: { id: { in: [`candidate-${firstId}`] }, draftId, consumedAt: null }, data: { consumedAt: expect.any(Date) } });
    expect(JSON.stringify(current.revoke.mock.calls)).not.toContain('previous-usable-token');
    expect(current.send).not.toHaveBeenCalled();
  });
  it.each(['MAIL_TEMPORARY_FAILURE', 'MAIL_STATE_UNAVAILABLE', 'MAIL_STATE_INVALID', 'MAIL_EXPIRED', 'MAIL_ATTACHMENT_INVALID', 'MAIL_CONFIGURATION_INVALID', 'MAIL_DELIVERY_REJECTED'])('allows a confirmed READY failure %s', async lastError => {
    const row = event(); row.status = OutboxEventStatus.FAILED; row.lastError = lastError;
    await expect(setup([row]).cancel()).resolves.toBeUndefined();
  });
  it.each(['SMTP_STARTED', 'SMTP_ACCEPTED'] as const)('rejects %s regardless of status', async phase => {
    for (const status of Object.values(OutboxEventStatus)) {
      const row = event(); row.status = status; row.payload.phase = phase;
      await expectBlocked(setup([row]));
    }
  });
  it.each(['MAIL_DELIVERY_UNCERTAIN', 'UNKNOWN_FAILURE'])('rejects ambiguous READY error %s without consuming tokens', async lastError => {
    const row = event(); row.lastError = lastError; row.status = OutboxEventStatus.FAILED;
    await expectBlocked(setup([row]));
  });
  it('rejects even an inconsistent PROCESSED/READY event', async () => {
    const row = event(); row.status = OutboxEventStatus.PROCESSED;
    await expectBlocked(setup([row]));
  });
  it('requires a decision-specific audit receipt rather than guessing historical SMTP delivery', async () => {
    const current = setup([], []);
    await expectBlocked(current);
    expect(current.records).toHaveBeenCalledWith(expect.objectContaining({ where: {
      action: 'APPLICATION_ACCESS_EMAIL_QUEUED', entityId: draftId,
      AND: [{ metadata: { path: ['applicationId'], equals: applicationId } }, { metadata: { path: ['selectionList'], equals: 'MAIN' } }],
    } }));
    expect(current.lock).not.toHaveBeenCalled();
  });
  it('never makes a historical MAIN decision reversible merely because a new resend is READY', async () => {
    const current = setup(); current.tx.auditLog.findFirst.mockResolvedValue(null);
    await expectBlocked(current);
    expect(current.records).not.toHaveBeenCalled(); expect(current.lock).not.toHaveBeenCalled();
  });
  it('allows a newly recorded internal MAIN with no queued notice', async () => {
    const current = setup([], []);
    current.tx.auditLog.findFirst.mockResolvedValue({ id: 'internal-decision', metadata: { workflowVersion: 2 } });
    await expect(current.cancel()).resolves.toBeUndefined(); expect(current.update).not.toHaveBeenCalled();
  });
  it('does not confuse an earlier accepted SMTP receipt with a later unsent internal MAIN', async () => {
    const old = event(firstId, { type: 'access', draftTokens: [{ id: 'old-candidate', draftId, predecessorIds: [] }], expected: { applicationId, selectionList: 'MAIN', selectionApprovedAt: new Date(decisionAt.getTime() - 1000).toISOString() } });
    old.payload.phase = 'SMTP_ACCEPTED'; old.status = OutboxEventStatus.PROCESSED;
    const current = setup([old]); current.tx.auditLog.findFirst.mockResolvedValue({ id: 'internal-decision', metadata: { workflowVersion: 2 } });
    await expect(current.cancel()).resolves.toBeUndefined(); expect(current.update).not.toHaveBeenCalled(); expect(current.revoke).not.toHaveBeenCalled();
  });
  it('never describes a legacy MAIN without a decision stamp as not requested', async () => {
    const current = setup([], []);
    await expect(current.service.selectionDelivery(current.tx as unknown as Prisma.TransactionClient, applicationId, null)).resolves.toMatchObject({ status: 'UNKNOWN' });
  });
  it('requires proof of the original individual or bulk MAIN decision at its exact stored time', async () => {
    const current = setup(); await current.cancel();
    expect(current.tx.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([
      { metadata: { path: ['selectionApprovedAt'], equals: decisionAt.toISOString() } },
      { OR: [
        { action: 'APPLICATION_SELECTION_DECIDED', entityId: applicationId, metadata: { path: ['decision'], equals: 'MAIN' } },
        { action: 'APPLICATION_SELECTION_COMMITTED', metadata: { path: ['mainIds'], array_contains: [applicationId] } },
      ] },
    ]) }) }));
  });
  it.each([undefined, 123, 'not-a-uuid'])('rejects malformed audit event ID %s before SQL', async id => {
    const current = setup([], [id]); await expectBlocked(current); expect(current.lock).not.toHaveBeenCalled();
  });
  it('rejects a deleted/missing event referenced by the audit receipt', async () => { await expectBlocked(setup([], [firstId])); });
  it('rejects a non-mail outbox event', async () => {
    const row = event(); row.type = Object.values(OutboxEventType).find(type => type !== OutboxEventType.EMAIL_DELIVERY)!;
    await expectBlocked(setup([row]));
  });
  it('rejects ciphertext tampering before canceling or consuming any token', async () => {
    const row = event(); row.payload.tag = Buffer.alloc(16, 0).toString('base64'); await expectBlocked(setup([row]));
  });
  it.each([
    { type: 'access', draftTokens: [{ id: 'candidate', draftId, predecessorIds: [] }], expected: { applicationId: 'other-application', selectionList: 'MAIN' } },
    { type: 'access', draftTokens: [{ id: 'candidate', draftId, predecessorIds: [] }], expected: { applicationId, selectionList: 'RESERVE' } },
    { type: 'access', draftTokens: [{ id: 'candidate', draftId: 'other-draft', predecessorIds: [] }], expected: { applicationId, selectionList: 'MAIN' } },
    { type: 'access', draftTokens: [], expected: { applicationId, selectionList: 'MAIN' } },
    { type: 'access', draftTokens: [{ id: 'candidate', draftId, predecessorIds: [] }] },
  ] as mail.EmailDeliveryContext[])('rejects mismatched access context %#', async context => { await expectBlocked(setup([event(firstId, context)])); });
  it('rejects an authenticated NOTICE payload substituted for the selection notice', async () => {
    const row = event(); row.payload = mail.encryptEmailDelivery(firstId, 'NOTICE', { to: 'synthetic@example.org', name: 'synthetic', subject: 'synthetic', body: 'synthetic' }, { type: 'notice', accountId: 'account-id' });
    await expectBlocked(setup([row]));
  });
  it('locks all distinct events in stable order and cancels every MAIN candidate, never its predecessors', async () => {
    const current = setup([event(secondId), event(firstId)], [secondId, firstId, secondId]);
    await current.cancel();
    expect(current.lock.mock.calls.map(call => call[1])).toEqual([firstId, secondId]);
    expect(current.update).toHaveBeenCalledTimes(2); expect(current.revoke).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(current.revoke.mock.calls)).not.toContain('previous-usable-token');
  });
  it('rejects the entire operation when any historical MAIN event already started SMTP', async () => {
    const started = event(firstId); started.payload.phase = 'SMTP_STARTED';
    await expectBlocked(setup([event(secondId), started], [secondId, firstId]));
  });
  it('rejects a lost event lease without revoking candidate or predecessor', async () => {
    const current = setup(); current.update.mockResolvedValue({ count: 0 });
    await expect(current.cancel()).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_EMAIL_STARTED' });
    expect(current.revoke).not.toHaveBeenCalled(); expect(current.send).not.toHaveBeenCalled();
  });
  it('can replay an already-canceled READY event without SMTP or predecessor revocation', async () => {
    const current = setup(); await current.cancel(); await current.cancel();
    expect(current.rows.get(firstId)).toMatchObject({ status: OutboxEventStatus.FAILED, lastError: 'MAIL_STATE_INVALID', payload: { phase: 'READY' } });
    expect(current.revoke).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(current.revoke.mock.calls)).not.toContain('previous-usable-token');
    expect(current.send).not.toHaveBeenCalled();
  });
});
