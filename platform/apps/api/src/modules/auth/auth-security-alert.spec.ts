import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { AuthService } from './auth.service';
import type { RateLimitService } from '../../common/rate-limit.service';
import type { AuditService } from '../audit/audit.service';
import type { EmailService } from './email/email.service';

describe('Password reset post-commit security notification', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup() {
    const transaction = jest.spyOn(prisma, '$transaction').mockResolvedValue({ ok: true, account: { id: 'synthetic-account', name: 'synthetic-name', role: AccountRole.ADMIN, associationId: null } } as never);
    const log = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const sendSecurityAlert = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const consume = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const service = new AuthService({ consume } as unknown as RateLimitService, { log } as unknown as AuditService, { sendSecurityAlert } as unknown as EmailService);
    return { service, transaction, log, sendSecurityAlert };
  }

  it('preserves the successful reset response and emits no failure event when the alert succeeds', async () => {
    const { service, transaction, log, sendSecurityAlert } = setup();
    await expect(service.confirmPasswordReset('test@example.org', 'synthetic-code', 'synthetic-password')).resolves.toEqual({ ok: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(sendSecurityAlert).toHaveBeenCalledTimes(1);
  });

  it('audits a failed alert without rerunning or failing the committed password change', async () => {
    const { service, transaction, log, sendSecurityAlert } = setup();
    sendSecurityAlert.mockRejectedValue(new Error('private-SMTP-error'));
    await expect(service.confirmPasswordReset('test@example.org', 'synthetic-code', 'synthetic-password')).resolves.toEqual({ ok: true });
    expect(log).toHaveBeenNthCalledWith(2, { id: 'synthetic-account', role: AccountRole.ADMIN, associationId: null }, 'PASSWORD_RESET_SECURITY_ALERT_EMAIL_FAILED', 'accounts', 'synthetic-account');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-SMTP|synthetic-code|synthetic-password|test@example/);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(sendSecurityAlert).toHaveBeenCalledTimes(1);
  });

  it('still returns success if both the failure audit and fallback logger fail', async () => {
    const { service, transaction, log, sendSecurityAlert } = setup();
    sendSecurityAlert.mockRejectedValue(new Error('private-SMTP-error'));
    log.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('audit unavailable'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => { throw new Error('logger unavailable'); });
    await expect(service.confirmPasswordReset('test@example.org', 'synthetic-code', 'synthetic-password')).resolves.toEqual({ ok: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(sendSecurityAlert).toHaveBeenCalledTimes(1);
  });
});
