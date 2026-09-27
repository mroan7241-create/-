import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { prisma } from '@alzad/db';
import { FakeEmailService } from './fake-email.service';
import { OnboardingEmailService } from './onboarding-email.service';

describe('Onboarding notification privacy and delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  function completedAgreement(pdf: Buffer) {
    return { id: 'test-covenant', status: 'SIGNED', fullyExecutedAt: new Date(), reference: 'COV-TEST', finalFile: { id: 'final-file' }, finalSha256: createHash('sha256').update(pdf).digest('hex'), associationAccount: { name: 'جمعية تجريبية', email: 'test@example.org' } };
  }

  it('emails only the committed final PDF to the associated account with a non-secret audit', async () => {
    const pdf = Buffer.from('%PDF-synthetic'); const email = new FakeEmailService();
    jest.spyOn(prisma.participationAgreement, 'findUniqueOrThrow').mockResolvedValue(completedAgreement(pdf) as never);
    jest.spyOn(prisma.systemSetting, 'createMany').mockResolvedValue({ count: 1 });
    const transaction = jest.spyOn(prisma, '$transaction').mockResolvedValue([] as never);
    const audit = jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    jest.spyOn(prisma.systemSetting, 'update').mockResolvedValue({} as never);
    await expect(new OnboardingEmailService(email).sendCovenantCompletion('test-covenant', pdf)).resolves.toEqual({ ok: true, alreadySent: false });
    expect(email.lastSecurityAlert?.pdfAttachment?.content).toEqual(pdf);
    expect(email.lastSecurityAlert?.to).toBe('test@example.org');
    expect(email.lastSecurityAlert?.action?.url).toMatch(/\/association$/);
    expect(email.lastSecurityAlert?.body).toContain('اكتمل توقيع');
    expect(audit).toHaveBeenCalledWith({ data: { action: 'COVENANT_COMPLETION_EMAIL_SENT', entityType: 'participation_agreements', entityId: 'test-covenant' } });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('test@example.org');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses unsigned or hash-mismatched files before SMTP or claiming a mail marker', async () => {
    const pdf = Buffer.from('%PDF-synthetic'); const email = new FakeEmailService();
    const agreement = jest.spyOn(prisma.participationAgreement, 'findUniqueOrThrow').mockResolvedValue({ ...completedAgreement(pdf), status: 'SENT' } as never);
    const claim = jest.spyOn(prisma.systemSetting, 'createMany');
    const service = new OnboardingEmailService(email);
    await expect(service.sendCovenantCompletion('test-covenant', pdf)).rejects.toMatchObject({ code: 'COVENANT_FINAL_NOT_FOUND' });
    agreement.mockResolvedValue(completedAgreement(pdf) as never);
    await expect(service.sendCovenantCompletion('test-covenant', Buffer.from('wrong'))).rejects.toMatchObject({ code: 'COVENANT_FINAL_NOT_FOUND' });
    expect(claim).not.toHaveBeenCalled(); expect(email.lastSecurityAlert).toBeNull();
  });

  it('does not resend a completed notification or send while a current worker owns its marker', async () => {
    const pdf = Buffer.from('%PDF-synthetic'); const email = new FakeEmailService();
    jest.spyOn(prisma.participationAgreement, 'findUniqueOrThrow').mockResolvedValue(completedAgreement(pdf) as never);
    jest.spyOn(prisma.systemSetting, 'createMany').mockResolvedValue({ count: 0 });
    const marker = jest.spyOn(prisma.systemSetting, 'findUniqueOrThrow').mockResolvedValue({ value: { status: 'SENT' }, updatedAt: new Date() } as never);
    const service = new OnboardingEmailService(email);
    expect(await service.sendCovenantCompletion('test-covenant', pdf)).toEqual({ ok: true, alreadySent: true });
    marker.mockResolvedValue({ value: { status: 'PROCESSING' }, updatedAt: new Date() } as never);
    expect(await service.sendCovenantCompletion('test-covenant', pdf)).toEqual({ ok: false });
    expect(email.lastSecurityAlert).toBeNull();
  });

  it('retries a failed delivery only after an atomic claim and respects concurrent claims and the retry cap', async () => {
    const pdf = Buffer.from('%PDF-synthetic'); const email = new FakeEmailService();
    jest.spyOn(prisma.participationAgreement, 'findUniqueOrThrow').mockResolvedValue(completedAgreement(pdf) as never);
    jest.spyOn(prisma.systemSetting, 'createMany').mockResolvedValue({ count: 0 });
    const marker = jest.spyOn(prisma.systemSetting, 'findUniqueOrThrow').mockResolvedValue({ value: { status: 'FAILED', attempts: 1 }, updatedAt: new Date(0) } as never);
    const claim = jest.spyOn(prisma.systemSetting, 'updateMany').mockResolvedValue({ count: 0 });
    jest.spyOn(prisma, '$transaction').mockResolvedValue([] as never);
    jest.spyOn(prisma.systemSetting, 'update').mockResolvedValue({} as never);
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    const service = new OnboardingEmailService(email);
    expect(await service.sendCovenantCompletion('test-covenant', pdf)).toEqual({ ok: false });
    expect(email.lastSecurityAlert).toBeNull();
    claim.mockResolvedValue({ count: 1 });
    expect(await service.sendCovenantCompletion('test-covenant', pdf)).toEqual({ ok: true, alreadySent: false });
    expect(claim).toHaveBeenLastCalledWith(expect.objectContaining({ where: { key: 'COVENANT_COMPLETION_EMAIL:test-covenant', value: { equals: { status: 'FAILED', attempts: 1 } } } }));
    email.lastSecurityAlert = null;
    marker.mockResolvedValue({ value: { status: 'FAILED', attempts: 5 }, updatedAt: new Date(0) } as never);
    expect(await service.sendCovenantCompletion('test-covenant', pdf)).toEqual({ ok: false });
    expect(email.lastSecurityAlert).toBeNull();
  });

  it('audits delivery failure without leaking a provider error or changing the signed agreement', async () => {
    const pdf = Buffer.from('%PDF-synthetic'); const email = new FakeEmailService();
    jest.spyOn(prisma.participationAgreement, 'findUniqueOrThrow').mockResolvedValue(completedAgreement(pdf) as never);
    const agreementUpdate = jest.spyOn(prisma.participationAgreement, 'update');
    jest.spyOn(prisma.systemSetting, 'createMany').mockResolvedValue({ count: 1 });
    jest.spyOn(email, 'sendSecurityAlert').mockRejectedValue(new Error('private SMTP detail'));
    jest.spyOn(prisma, '$transaction').mockResolvedValue([] as never);
    const audit = jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    jest.spyOn(prisma.systemSetting, 'update').mockResolvedValue({} as never);
    expect(await new OnboardingEmailService(email).sendCovenantCompletion('test-covenant', pdf)).toEqual({ ok: false });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('private SMTP detail');
    expect(agreementUpdate).not.toHaveBeenCalled();
  });

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

  it('reports failed eligibility accurately without pretending the legacy status changed', async () => {
    const email = new FakeEmailService();
    jest.spyOn(prisma.associationApplication, 'findUniqueOrThrow').mockResolvedValue({ status: 'UNDER_REVIEW', eligibilityStatus: 'FAILED', eligibilityNotes: 'المتطلبات غير مكتملة', email: 'test@example.org', publicCode: 'APP-TEST', name: 'جمعية تجريبية' } as never);
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    await new OnboardingEmailService(email).sendRejection('test-application');
    expect(email.lastSecurityAlert?.body).toContain('لم يجتز طلبكم متطلبات الأهلية');
    expect(email.lastSecurityAlert?.body).toContain('المتطلبات غير مكتملة');
  });
});
