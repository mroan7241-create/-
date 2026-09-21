import { Injectable } from '@nestjs/common';
import { ApplicationAccessEmailParams, EmailService, OperationalDigestEmailParams, PasswordResetEmailParams, SecurityAlertEmailParams } from './email.service';

/**
 * تطبيق للاختبارات فقط — يلتقط آخر رسالة (والرمز) في الذاكرة ليقرأها
 * الاختبار مباشرة، بدل أي تحايل على SMTP حقيقي أو التقاط سجلات. لا
 * يُستخدم خارج بيئة الاختبار إطلاقًا (AuthModule.forTest فقط).
 */
@Injectable()
export class FakeEmailService implements EmailService {
  lastPasswordReset: PasswordResetEmailParams | null = null;
  lastSecurityAlert: SecurityAlertEmailParams | null = null;
  lastApplicationAccess: ApplicationAccessEmailParams | null = null;
  lastOperationalDigest: OperationalDigestEmailParams | null = null;

  async sendPasswordResetCode(params: PasswordResetEmailParams): Promise<void> {
    this.lastPasswordReset = params;
  }

  async sendSecurityAlert(params: SecurityAlertEmailParams): Promise<void> {
    this.lastSecurityAlert = params;
  }

  async sendApplicationAccess(params: ApplicationAccessEmailParams): Promise<void> {
    this.lastApplicationAccess = params;
  }

  async sendOperationalDigest(params: OperationalDigestEmailParams): Promise<void> {
    this.lastOperationalDigest = params;
  }

  reset(): void {
    this.lastPasswordReset = null;
    this.lastSecurityAlert = null;
    this.lastApplicationAccess = null;
    this.lastOperationalDigest = null;
  }
}
