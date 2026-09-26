import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  ApplicationAccessEmailParams,
  EmailService,
  OperationalDigestEmailParams,
  PasswordResetEmailParams,
  SecurityAlertEmailParams,
} from './email.service';

@Injectable()
export class SmtpEmailService implements EmailService {
  private readonly transporter: Transporter;
  private readonly from: { address: string; name: string };

  constructor() {
    const host = required('SMTP_HOST');
    const port = parsePort(required('SMTP_PORT'));
    const secureValue = required('SMTP_SECURE');
    if (secureValue !== 'true' && secureValue !== 'false') throw new Error('Email configuration has an invalid SMTP_SECURE');
    const secure = secureValue === 'true';
    const user = required('SMTP_USER');
    const password = required('SMTP_PASSWORD');
    this.from = { address: required('SMTP_FROM_EMAIL'), name: required('SMTP_FROM_NAME') };
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      logger: false,
      debug: false,
      requireTLS: !secure,
    });
  }

  async sendPasswordResetCode(params: PasswordResetEmailParams): Promise<void> {
    const subject = 'استعادة كلمة المرور — منصة مشروع الأجهزة الكهربائية';
    const code = escapeHtml(params.code);
    await this.send(params.to, subject,
      `مرحبًا ${params.name}\n\nرمز استعادة كلمة المرور: ${params.code}\n\nينتهي الرمز خلال دقائق. إذا لم تطلبه فتجاهل هذه الرسالة.`,
      layout(`مرحبًا ${escapeHtml(params.name)}`, `<p>استخدم الرمز التالي لاستعادة كلمة المرور:</p><p style="font-size:24px;font-weight:700;letter-spacing:2px;direction:ltr;text-align:center">${code}</p><p>ينتهي الرمز خلال دقائق. إذا لم تطلبه فتجاهل هذه الرسالة.</p>`));
  }

  async sendSecurityAlert(params: SecurityAlertEmailParams): Promise<void> {
    await this.send(params.to, params.subject, `${params.name}\n\n${params.body}`,
      layout(`مرحبًا ${escapeHtml(params.name)}`, `<p style="line-height:1.9">${escapeHtml(params.body).replace(/\n/g, '<br>')}</p>`));
  }

  async sendApplicationAccess(params: ApplicationAccessEmailParams): Promise<void> {
    const rows = params.items.map((item) => `${item.label} ${item.code}\n${item.url}`).join('\n\n');
    const htmlRows = params.items.map((item) => `<div style="border:1px solid #eadce1;border-radius:10px;padding:16px;margin:12px 0"><p style="margin:0 0 10px"><strong>${escapeHtml(item.label)} ${escapeHtml(item.code)}</strong></p><a href="${escapeAttribute(item.url)}" style="display:inline-block;background:#65102f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">فتح الطلب بأمان</a></div>`).join('');
    await this.send(params.to, params.subject,
      `مرحبًا ${params.name}\n\n${params.intro}\n\n${rows}\n\nتنتهي الروابط خلال وقت قصير وتُستخدم مرة واحدة.`,
      layout(`مرحبًا ${escapeHtml(params.name)}`, `<p>${escapeHtml(params.intro)}</p>${htmlRows}<p>تنتهي الروابط خلال وقت قصير وتُستخدم مرة واحدة.</p>`));
  }

  async sendOperationalDigest(params: OperationalDigestEmailParams): Promise<void> {
    const content = escapeHtml(params.text).replace(/\n/g, '<br>');
    await this.send(params.to, params.subject, params.text, layout(escapeHtml(params.subject), `<p style="line-height:1.9">${content}</p>`));
  }

  private async send(to: string, subject: string, text: string, html: string): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to, subject, text, html });
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Email configuration is incomplete: ${name}`);
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Email configuration has an invalid SMTP_PORT');
  return port;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body style="margin:0;background:#f8f4f5;font-family:Tahoma,Arial,sans-serif;color:#2b1720"><div style="max-width:620px;margin:0 auto;padding:28px"><div style="background:#fff;border-radius:14px;padding:28px;border:1px solid #eadce1"><h1 style="font-size:20px;color:#65102f">${title}</h1>${body}<p style="margin-top:24px;color:#6d5b62;font-size:13px">منصة مشروع الأجهزة الكهربائية — جمعية الزاد</p></div></div></body></html>`;
}
