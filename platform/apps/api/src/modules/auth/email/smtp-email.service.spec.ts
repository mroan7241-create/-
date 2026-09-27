import { jest } from '@jest/globals';
import nodemailer from 'nodemailer';
import { SmtpEmailService } from './smtp-email.service';

describe('SMTP Arabic layout and completed Covenant attachment', () => {
  const previous = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, { NODE_ENV: 'test', SMTP_HOST: 'smtp.test.invalid', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'synthetic', SMTP_PASSWORD: 'synthetic-only', SMTP_FROM_EMAIL: 'sender@example.org', SMTP_FROM_NAME: 'جمعية الزاد', PUBLIC_WEB_URL: 'https://web.example.org' });
  });
  afterEach(() => { process.env = { ...previous }; jest.restoreAllMocks(); });

  it('uses inline RTL/right alignment, approved logo, escaped content, and the actual PDF attachment', async () => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({});
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const pdf = Buffer.from('%PDF-synthetic');
    await new SmtpEmailService().sendSecurityAlert({ to: 'test@example.org', name: '<script>test</script>', subject: 'اكتمال الميثاق', body: '<script>unsafe</script>\nرسالة عربية', action: { label: 'بوابة الجمعية', url: 'https://web.example.org/association' }, pdfAttachment: { filename: 'covenant-test.pdf', content: pdf } });
    const sent = sendMail.mock.calls[0][0] as { html: string; attachments: unknown[] };
    expect(sent.html).toContain('dir="rtl"'); expect(sent.html).toContain('direction:rtl;text-align:right');
    expect(sent.html).toContain('align="right"'); expect(sent.html).toContain('https://web.example.org/brand/zadLogo.png');
    expect(sent.html).toContain('width="96"'); expect(sent.html).not.toContain('<script>');
    expect(sent.html).toContain('السلام عليكم');
    expect(sent.attachments).toEqual([{ filename: 'covenant-test.pdf', content: pdf, contentType: 'application/pdf' }]);
  });

  it('applies the same branded Arabic template to tracking, password-reset and operational reports', async () => {
    const sendMail = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({});
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const service = new SmtpEmailService();
    await service.sendPasswordResetCode({ to: 'test@example.org', name: 'تجريبي', code: '123456' });
    await service.sendApplicationAccess({ to: 'test@example.org', name: 'جمعية', subject: 'الطلب', intro: 'تم التقديم', items: [{ label: 'طلب', code: 'APP-TEST', url: 'https://web.example.org/apply' }] });
    await service.sendOperationalDigest({ to: 'test@example.org', subject: 'التقرير', text: 'اختبار' });
    expect(sendMail).toHaveBeenCalledTimes(3);
    for (const [value] of sendMail.mock.calls) {
      const sent = value as { html: string; attachments?: unknown[] };
      expect(sent.html).toContain('align="right"'); expect(sent.html).toContain('/brand/zadLogo.png');
      expect(sent.attachments).toBeUndefined();
    }
  });
});
