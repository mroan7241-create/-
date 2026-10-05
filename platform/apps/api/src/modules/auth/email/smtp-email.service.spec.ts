import { jest } from '@jest/globals';
import nodemailer from 'nodemailer';
import { SmtpEmailService } from './smtp-email.service';
import { Logger } from '@nestjs/common';

describe('SMTP Arabic layout and completed Covenant attachment', () => {
  const previous = { ...process.env };
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    Object.assign(process.env, { NODE_ENV: 'test', SMTP_HOST: 'smtp.test.invalid', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'synthetic', SMTP_PASSWORD: 'synthetic-only', SMTP_FROM_EMAIL: 'sender@example.org', SMTP_FROM_NAME: 'جمعية الزاد', PUBLIC_WEB_URL: 'https://web.example.org' });
  });
  afterEach(() => { process.env = { ...previous }; jest.restoreAllMocks(); });

  it('sends an Abanmi activation button with secrets in the fragment, not URL query or logs', async () => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ accepted: ['test@example.org'] });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const code = `INV-${'A'.repeat(32)}`;
    await new SmtpEmailService().sendPasswordResetCode({ to: 'test@example.org', name: 'مدعو', code, invitation: true });
    const sent = sendMail.mock.calls[0]![0] as { html: string; text: string; subject: string };
    expect(sent.subject).toContain('دعوة'); expect(sent.html).toContain('تفعيل حسابي');
    const url = new URL(sent.text.split('\n').find((line) => line.startsWith('https://'))!);
    expect(url.pathname).toBe('/forgot-password'); expect(url.search).toBe('');
    expect(new URLSearchParams(url.hash.slice(1)).get('code')).toBe(code);
    expect(JSON.stringify((Logger.prototype.log as jest.Mock).mock.calls)).not.toContain(code);
  });

  it('uses inline RTL/right alignment, approved logo, escaped content, and the actual PDF attachment', async () => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ accepted: ['test@example.org'] });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const pdf = Buffer.from('%PDF-synthetic');
    await new SmtpEmailService().sendSecurityAlert({ to: 'test@example.org', name: '<script>test</script>', subject: 'اكتمال الميثاق', body: '<script>unsafe</script>\nرسالة عربية', action: { label: 'بوابة الجمعية', url: 'https://web.example.org/association' }, pdfAttachment: { filename: 'covenant-test.pdf', content: pdf } });
    const sent = sendMail.mock.calls[0][0] as { html: string; attachments: unknown[] };
    expect(sent.html).toContain('dir="rtl"'); expect(sent.html).toContain('direction:rtl;text-align:right');
    expect(sent.html).toContain('align="right"'); expect(sent.html).toContain('cid:alzad-approved-logo');
    expect(sent.html).toContain('width="96"'); expect(sent.html).not.toContain('<script>');
    expect(sent.html).toContain('السلام عليكم');
    expect(sent.attachments).toHaveLength(2);
    const logo = sent.attachments[0] as { content: Buffer; cid: string; contentType: string };
    expect(logo.cid).toBe('alzad-approved-logo'); expect(logo.contentType).toBe('image/png');
    expect(logo.content.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(sent.attachments[1]).toEqual({ filename: 'covenant-test.pdf', content: pdf, contentType: 'application/pdf' });
  });

  it.each([{ accepted: [] }, { accepted: ['other@example.org'] }, { accepted: ['test@example.org.attacker.invalid'] }])('rejects SMTP acceptance that excludes the exact requested recipient', async ({ accepted }) => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ accepted });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    await expect(new SmtpEmailService().sendPasswordResetCode({ to: 'test@example.org', name: 'test', code: 'synthetic' })).rejects.toThrow('MAIL_RECIPIENT_NOT_ACCEPTED');
  });

  it('applies the same branded Arabic template to tracking, password-reset and operational reports', async () => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ accepted: ['test@example.org'] });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const service = new SmtpEmailService();
    await service.sendPasswordResetCode({ to: 'test@example.org', name: 'تجريبي', code: '123456' });
    await service.sendApplicationAccess({ to: 'test@example.org', name: 'جمعية', subject: 'الطلب', intro: 'تم التقديم', items: [{ label: 'طلب', code: 'APP-TEST', url: 'https://web.example.org/apply' }] });
    await service.sendOperationalDigest({ to: 'test@example.org', subject: 'التقرير', text: 'اختبار' });
    expect(sendMail).toHaveBeenCalledTimes(3);
    for (const [value] of sendMail.mock.calls) {
      const sent = value as { html: string; attachments?: unknown[] };
      expect(sent.html).toContain('align="right"'); expect(sent.html).toContain('cid:alzad-approved-logo');
      expect(sent.attachments).toHaveLength(1);
    }
  });

  it('uses the event message ID and accepts the exact recipient with normalized casing only', async () => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ accepted: ['TEST@example.org'] });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    await new SmtpEmailService().sendPasswordResetCode({ to: 'test@example.org', name: 'n', code: 'secret' }, { messageId: '<event@alzad-mail.invalid>' });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ messageId: '<event@alzad-mail.invalid>' }));
  });

  it('records SMTP acceptance and correlation without recipients, codes, links, bodies or provider response', async () => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ messageId: '<synthetic-123@mail.test.invalid>', accepted: ['private@example.org'], rejected: [], response: 'private-provider-response' });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    await new SmtpEmailService().sendPasswordResetCode({ to: 'private@example.org', name: 'private-name', code: 'private-code' });
    const log = jest.mocked(Logger.prototype.log);
    const raw = String(log.mock.calls[0][0]);
    expect(JSON.parse(raw)).toMatchObject({ event: 'SMTP_ACCEPTED', kind: 'PASSWORD_RESET', messageId: '<synthetic-123@mail.test.invalid>', acceptedCount: 1, rejectedCount: 0, durationMs: expect.any(Number), traceId: expect.any(String) });
    for (const secret of ['private@example.org', 'private-name', 'private-code', 'private-provider-response', 'synthetic-only']) expect(raw).not.toContain(secret);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it.each(['EAUTH', 'ETIMEDOUT'])('logs safe %s diagnostics and propagates the original failure without retrying', async (code) => {
    const failure = Object.assign(new Error('private-provider-response'), { code, response: 'private-server-response' });
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockRejectedValue(failure);
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    await expect(new SmtpEmailService().sendOperationalDigest({ to: 'private@example.org', subject: 'private-subject', text: 'private-body' })).rejects.toBe(failure);
    const raw = String(jest.mocked(Logger.prototype.warn).mock.calls[0][0]);
    expect(JSON.parse(raw)).toMatchObject({ event: 'SMTP_FAILED', code, kind: 'OPERATIONAL_DIGEST' });
    expect(raw).not.toContain('private');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('does not turn an accepted message into a failed send when logging throws', async () => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ messageId: '<test@mail.test.invalid>', accepted: ['private@example.org'] });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    jest.mocked(Logger.prototype.log).mockImplementation(() => { throw new Error('logger unavailable'); });
    await expect(new SmtpEmailService().sendApplicationAccess({ to: 'private@example.org', name: 'test', subject: 'test', intro: 'test', items: [] })).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('does not leak unrecognized error codes or unsafe message IDs and preserves failures if logging is unavailable', async () => {
    const failure = Object.assign(new Error('private-detail'), { code: 'private-error-code' });
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValueOnce({ messageId: 'private-id\nprivate-header', accepted: ['private@example.org'] }).mockRejectedValue(failure);
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const service = new SmtpEmailService();
    const params = { to: 'private@example.org', subject: 'private-subject', text: 'private-body' };
    await service.sendOperationalDigest(params);
    expect(JSON.parse(String(jest.mocked(Logger.prototype.log).mock.calls[0][0]))).not.toHaveProperty('messageId');
    await expect(service.sendOperationalDigest(params)).rejects.toBe(failure);
    expect(JSON.parse(String(jest.mocked(Logger.prototype.warn).mock.calls[0][0]))).toMatchObject({ code: 'UNSPECIFIED' });
    jest.mocked(Logger.prototype.warn).mockImplementation(() => { throw new Error('logger unavailable'); });
    await expect(service.sendOperationalDigest(params)).rejects.toBe(failure);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });
});
