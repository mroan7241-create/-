import { jest } from '@jest/globals';
import { prisma } from '@alzad/db';
import { FakeEmailService } from './fake-email.service';
import { OnboardingEmailService } from './onboarding-email.service';

describe('Onboarding notification privacy and delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the temporary credential and records only a non-secret success event', async () => {
    const email = new FakeEmailService();
    jest.spyOn(prisma.account, 'findUniqueOrThrow').mockResolvedValue({ id: 'test-account', name: 'جمعية تجريبية', email: 'test@example.org', mustChangePassword: true } as never);
    const audit = jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    await new OnboardingEmailService(email).sendCredentials('test-account', 'Synthetic!Temp2026');
    expect(email.lastSecurityAlert?.body).toContain('Synthetic!Temp2026');
    expect(email.lastSecurityAlert?.body).toContain('تغيير كلمة المرور');
    expect(audit).toHaveBeenCalledWith({ data: { action: 'ASSOCIATION_CREDENTIALS_EMAIL_SENT', entityType: 'accounts', entityId: 'test-account' } });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('Synthetic!Temp2026');
    expect(JSON.stringify(audit.mock.calls)).not.toContain('test@example.org');
  });

  it('SMTP failure does not undo an already-created account and is audited without the provider error', async () => {
    const email = new FakeEmailService();
    jest.spyOn(prisma.account, 'findUniqueOrThrow').mockResolvedValue({ id: 'test-account', name: 'جمعية تجريبية', email: 'test@example.org', mustChangePassword: true } as never);
    jest.spyOn(email, 'sendSecurityAlert').mockRejectedValue(new Error('sensitive-provider-error'));
    const audit = jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    await expect(new OnboardingEmailService(email).sendCredentials('test-account', 'Synthetic!Temp2026')).resolves.toBeUndefined();
    expect(audit).toHaveBeenCalledWith({ data: { action: 'ASSOCIATION_CREDENTIALS_EMAIL_FAILED', entityType: 'accounts', entityId: 'test-account' } });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('sensitive-provider-error');
  });

  it('does not email a rejection before its decision is committed', async () => {
    const email = new FakeEmailService();
    jest.spyOn(prisma.associationApplication, 'findUniqueOrThrow').mockResolvedValue({ status: 'UNDER_REVIEW' } as never);
    const audit = jest.spyOn(prisma.auditLog, 'create');
    await expect(new OnboardingEmailService(email).sendRejection('test-application')).rejects.toThrow('not committed');
    expect(email.lastSecurityAlert).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });
});
