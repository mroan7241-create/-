import { jest } from '@jest/globals';
import { classifyEmailFailure, decryptEmailDelivery, encryptEmailDelivery, enqueueEmail } from './email.service';
import type { Prisma } from '@alzad/db';

describe('encrypted email outbox', () => {
  const previous = process.env.EMAIL_DELIVERY_ENCRYPTION_KEY;
  const params = { to: 'recipient@example.org', name: 'name', code: 'secret-code' };
  const context = { type: 'reset' as const, tokenId: 'token', accountId: 'account', credentialHash: 'private-hash', predecessorIds: ['old'] };
  beforeEach(() => { process.env.EMAIL_DELIVERY_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64'); });
  afterAll(() => { if (previous === undefined) delete process.env.EMAIL_DELIVERY_ENCRYPTION_KEY; else process.env.EMAIL_DELIVERY_ENCRYPTION_KEY = previous; });
  it('encrypts secrets with fresh nonces and binds ciphertext to the stable event id', () => {
    const first = encryptEmailDelivery('id', 'PASSWORD_RESET', params, context);
    const second = encryptEmailDelivery('id', 'PASSWORD_RESET', params, context);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(JSON.stringify(first)).not.toMatch(/secret-code|recipient@example|private-hash/);
    expect(decryptEmailDelivery('id', first)).toEqual({ kind: 'PASSWORD_RESET', params, context });
    expect(() => decryptEmailDelivery('other-id', first)).toThrow('MAIL_PAYLOAD_INVALID');
    expect(() => decryptEmailDelivery('id', { ...first, ciphertext: `${first.ciphertext.slice(0, -4)}AAAA` })).toThrow('MAIL_PAYLOAD_INVALID');
    process.env.EMAIL_DELIVERY_ENCRYPTION_KEY = Buffer.alloc(32, 18).toString('base64');
    expect(() => decryptEmailDelivery('id', first)).toThrow('MAIL_PAYLOAD_INVALID');
  });
  it('never serializes PDF bytes into the durable queue', () => {
    expect(() => encryptEmailDelivery('id', 'NOTICE', { to: params.to, name: 'n', subject: 's', body: 'b', pdfAttachment: { content: Buffer.from('pdf') } } as never, { type: 'notice', accountId: 'a' })).toThrow('MAIL_PAYLOAD_INVALID');
  });
  it('persists exactly one encrypted event through the caller transaction', async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({});
    const queued = await enqueueEmail({ outboxEvent: { create } } as unknown as Prisma.TransactionClient, 'PASSWORD_RESET', params, context);
    expect(queued).toEqual({ eventId: expect.any(String), emailQueued: true });
    const data = (create.mock.calls[0]![0] as { data: { id: string; type: string; payload: ReturnType<typeof encryptEmailDelivery> } }).data;
    expect(data.type).toBe('EMAIL_DELIVERY'); expect(data.id).toBe(queued.eventId);
    expect(decryptEmailDelivery(data.id, data.payload).params).toEqual(params);
    create.mockRejectedValueOnce(new Error('transaction rollback'));
    await expect(enqueueEmail({ outboxEvent: { create } } as unknown as Prisma.TransactionClient, 'PASSWORD_RESET', params, context)).rejects.toThrow('transaction rollback');
  });
  it.each([
    { error: { code: 'ETIMEDOUT', command: 'CONN' }, retryable: true, code: 'MAIL_TEMPORARY_FAILURE' },
    { error: { responseCode: 450, command: 'RCPT TO' }, retryable: true, code: 'MAIL_TEMPORARY_FAILURE' },
    { error: { code: 'EAUTH', command: 'AUTH PLAIN' }, retryable: false, code: 'MAIL_DELIVERY_REJECTED' },
    { error: { code: 'ETIMEDOUT', command: 'DATA' }, retryable: false, code: 'MAIL_DELIVERY_UNCERTAIN' },
    { error: { code: 'ECONNRESET' }, retryable: false, code: 'MAIL_DELIVERY_UNCERTAIN' },
  ])('classifies only definite pre-accept failures as retryable: $code', ({ error, retryable, code }) => {
    expect(classifyEmailFailure(error)).toEqual({ retryable, code });
  });
});
