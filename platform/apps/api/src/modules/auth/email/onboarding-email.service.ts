import { Inject, Injectable, Logger } from '@nestjs/common';
import { prisma } from '@alzad/db';
import { EmailService } from './email.service';

/** Post-commit notifications. Never store a temporary credential in audit metadata. */
@Injectable()
export class OnboardingEmailService {
  private readonly logger = new Logger(OnboardingEmailService.name);
  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  async sendCredentials(accountId: string, temporaryPassword: string): Promise<void> {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (!account.email || !account.mustChangePassword) throw new Error('Onboarding account is not ready');
    await this.deliver('ASSOCIATION_CREDENTIALS_EMAIL', 'accounts', accountId, () => this.email.sendSecurityAlert({
      to: account.email!, name: account.name,
      subject: 'بيانات دخول الجمعية — مشروع الأجهزة الكهربائية',
      body: `تم تجهيز حساب جمعيتكم.\nالبريد الإلكتروني: ${account.email}\nكلمة المرور المؤقتة: ${temporaryPassword}\nتسجيل الدخول: ${publicWebUrl()}/login\nيجب تغيير كلمة المرور عند أول دخول، ثم مراجعة الميثاق وتوقيعه. تبقى الخدمات التشغيلية مقيدة حتى اكتمال متطلبات التفعيل.\nيرجى الحفاظ على سرية بيانات الدخول.`,
    }));
  }

  async sendRejection(applicationId: string): Promise<void> {
    const application = await prisma.associationApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (application.status !== 'REJECTED') throw new Error('Application rejection is not committed');
    await this.deliver('APPLICATION_REJECTION_EMAIL', 'association_applications', applicationId, async () => {
      if (!application.email) throw new Error('Application notification email is missing');
      await this.email.sendSecurityAlert({
      to: application.email, name: application.name,
      subject: 'نتيجة طلب المشاركة — مشروع الأجهزة الكهربائية',
      body: `شكرًا لتقديم جمعيتكم. نعتذر عن عدم قبول الطلب ${application.publicCode}.\nالسبب: ${application.rejectReason ?? 'عدم استيفاء متطلبات المشاركة'}\nمتابعة الطلب: ${publicWebUrl()}/apply/status\nنقدّر اهتمامكم بالمشروع.`,
      });
    });
  }

  private async deliver(action: string, entityType: string, entityId: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch {
      await prisma.auditLog.create({ data: { action: `${action}_FAILED`, entityType, entityId } });
      this.logger.warn('Onboarding notification failed; inspect the audit event. No credential or recipient was logged.');
      return;
    }
    await prisma.auditLog.create({ data: { action: `${action}_SENT`, entityType, entityId } });
  }
}

function publicWebUrl(): string {
  const url = new URL(process.env.PUBLIC_WEB_URL?.trim() || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'));
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('PUBLIC_WEB_URL must use HTTPS');
  return url.origin;
}
