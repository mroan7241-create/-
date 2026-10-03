import { jest } from '@jest/globals';
import { AccountRole, AccountStatus, prisma } from '@alzad/db';
import { AuthService } from './auth.service';
import * as mail from './email/email.service';
import type { AuditService } from '../audit/audit.service';
import type { RateLimitService } from '../../common/rate-limit.service';
import { resetTokenHash } from '../../common/crypto.util';

describe('Password reset durable delivery', () => {
  afterEach(() => jest.restoreAllMocks());
  function setup() {
    const account = { id: 'account-id', name: 'synthetic', role: AccountRole.ADMIN, status: AccountStatus.ACTIVE, associationId: null };
    const credential = { id: 'credential-id', accountId: account.id, account, type: 'EMAIL_PASSWORD', identifier: 'synthetic@example.org', secretHash: 'synthetic-hash', previousSecretHash: null };
    const send = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const queued = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ id: 'event-id' });
    const log = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const mutate = () => jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ count: 1 });
    const lock = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const tokenCreate = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ id: 'candidate-id' });
    const tx = { $queryRaw: lock, outboxEvent: { create: queued }, authCredential: { findUnique: jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue(credential), findFirst: jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue(credential), update: mutate() }, account: { findUnique: jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue(account), update: mutate() }, authSession: { updateMany: mutate() }, passwordResetToken: { create: tokenCreate, findMany: jest.fn<(...args: unknown[]) => Promise<object[]>>().mockResolvedValue([{ id: 'old-id' }]), update: mutate(), updateMany: mutate() }, auditLog: { create: mutate() } };
    jest.spyOn(prisma.authCredential, 'findUnique').mockResolvedValue(credential as never);
    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => { if (typeof callback !== 'function') throw new Error('expected interactive tx'); return callback(tx as never); });
    const service = new AuthService({ consume: async () => undefined } as unknown as RateLimitService, { log } as unknown as AuditService, { sendPasswordResetCode: send, sendSecurityAlert: send } as unknown as mail.EmailService);
    return { service, account, credential, tx, queued, send, tokenCreate, lock };
  }
  it('queues the secret alongside its active hash and does not consume a previously usable code', async () => {
    const { service, tx, queued, send, tokenCreate, lock } = setup();
    const result = await service.requestPasswordReset('synthetic@example.org');
    expect(result.ok).toBe(true); expect(send).not.toHaveBeenCalled(); expect(tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(tokenCreate.mock.invocationCallOrder[0]!);
    const { data } = queued.mock.calls[0]![0] as { data: { id: string; payload: mail.EmailDeliveryPayload } };
    const delivery = mail.decryptEmailDelivery(data.id, data.payload);
    expect(delivery).toEqual({ kind: 'PASSWORD_RESET', params: expect.objectContaining({ code: expect.stringMatching(/^RST-/) }), context: { type: 'reset', tokenId: 'candidate-id', accountId: 'account-id', credentialHash: 'synthetic-hash', predecessorIds: ['old-id'] } });
    const params = delivery.params as mail.PasswordResetEmailParams;
    expect(JSON.stringify(data.payload)).not.toContain(params.code);
    expect(tokenCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenHash: resetTokenHash(params.code) }) }));
  });
  it('selects the provided still-valid predecessor before a newer pending token and queues notice inside the password transaction', async () => {
    const { service, tx, queued, send, lock } = setup();
    lock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'old-id', account_id: 'account-id', token_hash: resetTokenHash('RST-OLDTEST1'), attempt_count: 0, expires_at: new Date(Date.now() + 60_000), consumed_at: null }]);
    await expect(service.confirmPasswordReset('synthetic@example.org', 'RST-OLDTEST1', 'SyntheticPassword123')).resolves.toEqual({ ok: true });
    expect(String(lock.mock.calls[1]![0])).toContain('CASE WHEN token_hash');
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({ where: { accountId: 'account-id', consumedAt: null }, data: { consumedAt: expect.any(Date) } });
    const { data } = queued.mock.calls[0]![0] as { data: { id: string; payload: mail.EmailDeliveryPayload } };
    expect(mail.decryptEmailDelivery(data.id, data.payload)).toEqual({ kind: 'NOTICE', params: expect.objectContaining({ subject: expect.stringContaining('تنبيه أمني') }), context: { type: 'notice', accountId: 'account-id' } });
    expect(send).not.toHaveBeenCalled();
  });
  it('continues counting invalid-code attempts without changing credentials or queuing a notice', async () => {
    const { service, tx, queued, lock } = setup();
    lock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'candidate-id', account_id: 'account-id', token_hash: resetTokenHash('RST-VALID001'), attempt_count: 2, expires_at: new Date(Date.now() + 60_000), consumed_at: null }]);
    await expect(service.confirmPasswordReset('synthetic@example.org', 'RST-INVALID1', 'synthetic-password')).rejects.toMatchObject({ code: 'AUTH_VALIDATION_FAILED' });
    expect(tx.passwordResetToken.update).toHaveBeenCalledWith({ where: { id: 'candidate-id' }, data: { attemptCount: 3, consumedAt: undefined } });
    expect(tx.authCredential.update).not.toHaveBeenCalled(); expect(queued).not.toHaveBeenCalled();
  });
  it('keeps the public response generic when the atomic delivery enqueue fails', async () => {
    const { service, tx, queued, send } = setup();
    queued.mockRejectedValue(new Error('synthetic queue unavailable'));
    const audit = jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    await expect(service.requestPasswordReset('synthetic@example.org')).resolves.toMatchObject({ ok: true });
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PASSWORD_RESET_EMAIL_QUEUE_FAILED' }) });
    expect(tx.passwordResetToken.updateMany).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(audit.mock.calls)).not.toContain('synthetic queue unavailable');
  });
});
