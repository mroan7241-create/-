import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMAIL_LOGO_CID, emailLayout } from './email-layout';
import {
  ApplicationAccessEmailParams,
  EmailService,
  OperationalDigestEmailParams,
  PasswordResetEmailParams,
  SecurityAlertEmailParams,
} from './email.service';

@Injectable()
export class SmtpEmailService implements EmailService {
  private readonly logger = new Logger(SmtpEmailService.name);
  private readonly transporter: Transporter;
  private readonly from: { address: string; name: string };
  private readonly logo: Buffer;

  constructor() {
    const logoPath = [join(process.cwd(), 'apps', 'api', 'dist', 'assets', 'alzad-email-logo.png'), join(process.cwd(), 'dist', 'assets', 'alzad-email-logo.png'), join(process.cwd(), 'apps', 'api', 'src', 'assets', 'alzad-email-logo.png'), join(process.cwd(), 'src', 'assets', 'alzad-email-logo.png')].find(existsSync);
    if (!logoPath) throw new Error('Email branding asset is missing');
    this.logo = readFileSync(logoPath);
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
    await this.send('PASSWORD_RESET', params.to, subject,
      `مرحبًا ${params.name}\n\nرمز استعادة كلمة المرور: ${params.code}\n\nينتهي الرمز خلال دقائق. إذا لم تطلبه فتجاهل هذه الرسالة.`,
      layout(`مرحبًا ${escapeHtml(params.name)}`, `<p>استخدم الرمز التالي لاستعادة كلمة المرور:</p><p style="font-size:24px;font-weight:700;letter-spacing:2px;direction:ltr;text-align:center">${code}</p><p>ينتهي الرمز خلال دقائق. إذا لم تطلبه فتجاهل هذه الرسالة.</p>`));
  }

  async sendSecurityAlert(params: SecurityAlertEmailParams): Promise<void> {
    const action = params.action ? `<p><a href="${escapeAttribute(params.action.url)}" style="display:inline-block;background:#65102f;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px">${escapeHtml(params.action.label)}</a></p>` : '';
    await this.send('NOTICE', params.to, params.subject, `${params.name}\n\n${params.body}`,
      layout(`السادة/ ${escapeHtml(params.name)} المحترمون`, `<p style="line-height:1.9;direction:rtl;text-align:right">${escapeHtml(params.body).replace(/\n/g, '<br>')}</p>${action}`),
      params.pdfAttachment ? [{ filename: params.pdfAttachment.filename, content: params.pdfAttachment.content, contentType: 'application/pdf' }] : undefined);
  }

  async sendApplicationAccess(params: ApplicationAccessEmailParams): Promise<void> {
    const rows = params.items.map((item) => `${item.label} ${item.code}\n${item.url}`).join('\n\n');
    const htmlRows = params.items.map((item) => `<div style="border:1px solid #eadce1;border-radius:10px;padding:16px;margin:12px 0"><p style="margin:0 0 10px"><strong>${escapeHtml(item.label)} ${escapeHtml(item.code)}</strong></p><a href="${escapeAttribute(item.url)}" style="display:inline-block;background:#65102f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">فتح الطلب بأمان</a></div>`).join('');
    await this.send('APPLICATION_ACCESS', params.to, params.subject,
      `مرحبًا ${params.name}\n\n${params.intro}\n\n${rows}\n\nتنتهي الروابط خلال وقت قصير وتُستخدم مرة واحدة.`,
      layout(`مرحبًا ${escapeHtml(params.name)}`, `<p style="line-height:1.9;direction:rtl;text-align:right">${escapeHtml(params.intro).replace(/\n/g, '<br>')}</p>${htmlRows}<p>تنتهي الروابط خلال وقت قصير وتُستخدم مرة واحدة.</p>`));
  }

  async sendOperationalDigest(params: OperationalDigestEmailParams): Promise<void> {
    const content = escapeHtml(params.text).replace(/\n/g, '<br>');
    await this.send('OPERATIONAL_DIGEST', params.to, params.subject, params.text, layout(escapeHtml(params.subject), `<p style="line-height:1.9">${content}</p>`));
  }

  private async send(kind: 'PASSWORD_RESET' | 'NOTICE' | 'APPLICATION_ACCESS' | 'OPERATIONAL_DIGEST', to: string, subject: string, text: string, html: string, attachments?: Array<{ filename: string; content: Buffer; contentType: string }>): Promise<void> {
    const traceId = randomUUID();
    const startedAt = Date.now();
    try {
      const info = await this.transporter.sendMail({ from: this.from, to, subject, text, html, attachments: [{ filename: 'alzad-logo.png', content: this.logo, contentType: 'image/png', cid: EMAIL_LOGO_CID }, ...(attachments ?? [])] });
      // SMTP acceptance is not proof of inbox delivery. Do not log recipients,
      // response text, subjects, message bodies, links or attachment contents.
      this.record('log', { event: 'SMTP_ACCEPTED', kind, traceId, durationMs: Date.now() - startedAt,
        messageId: typeof info?.messageId === 'string' && /^<[A-Za-z0-9._-]{1,100}@[A-Za-z0-9.-]{1,100}>$/.test(info.messageId) ? info.messageId : undefined,
        acceptedCount: Array.isArray(info?.accepted) ? info.accepted.length : undefined,
        rejectedCount: Array.isArray(info?.rejected) ? info.rejected.length : undefined });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      this.record('warn', { event: 'SMTP_FAILED', kind, traceId, durationMs: Date.now() - startedAt,
        code: typeof code === 'string' && ['EAUTH', 'ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EDNS', 'EENVELOPE', 'EMESSAGE', 'ESTREAM'].includes(code) ? code : 'UNSPECIFIED' });
      throw error;
    }
  }

  private record(level: 'log' | 'warn', metadata: Record<string, unknown>): void {
    try { this.logger[level](JSON.stringify(metadata)); } catch {
      // Observability must not change the outcome or cause a second send.
    }
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
  return emailLayout(title, body);
}
