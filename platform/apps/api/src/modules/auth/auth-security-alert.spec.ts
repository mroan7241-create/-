import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { AuthService } from './auth.service';
import type { RateLimitService } from '../../common/rate-limit.service';
import type { AuditService } from '../audit/audit.service';
import type { EmailService } from './email/email.service';

describe('Password reset post-commit response after durable notification enqueue', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup() {
    const transaction = jest.spyOn(prisma, '$transaction').mockResolvedValue({ ok: true, account: { id: 'synthetic-account', name: 'synthetic-name', role: AccountRole.ADMIN, associationId: null } } as never);
    const log = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const sendSecurityAlert = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const consume = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const service = new AuthService({ consume } as unknown as RateLimitService, { log } as unknown as AuditService, { sendSecurityAlert } as unknown as EmailService);
    return { service, transaction, log, sendSecurityAlert };
  }

  it('preserves the successful reset response without attempting SMTP after commit', async () => {
    const { service, transaction, log, sendSecurityAlert } = setup();
    await expect(service.confirmPasswordReset('test@example.org', 'synthetic-code', 'synthetic-password')).resolves.toEqual({ ok: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('does not rerun the committed password change or invoke even a failing SMTP provider', async () => {
    const { service, transaction, log, sendSecurityAlert } = setup();
    sendSecurityAlert.mockRejectedValue(new Error('private-SMTP-error'));
    await expect(service.confirmPasswordReset('test@example.org', 'synthetic-code', 'synthetic-password')).resolves.toEqual({ ok: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-SMTP|synthetic-code|synthetic-password|test@example/);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('does not depend on SMTP failure-audit or fallback logger after commit', async () => {
    const { service, transaction, log, sendSecurityAlert } = setup();
    sendSecurityAlert.mockRejectedValue(new Error('private-SMTP-error'));
    log.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('audit unavailable'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => { throw new Error('logger unavailable'); });
    await expect(service.confirmPasswordReset('test@example.org', 'synthetic-code', 'synthetic-password')).resolves.toEqual({ ok: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });
});
