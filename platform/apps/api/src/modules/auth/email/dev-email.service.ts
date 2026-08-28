import { Injectable, Logger } from '@nestjs/common';
import { EmailService, PasswordResetEmailParams, SecurityAlertEmailParams } from './email.service';

/**
 * تطبيق تطوير آمن: لا يرسل أي بريد فعلي، ولا يطبع رمز الاستعادة في
 * السجلات (ممنوع صراحة) — يكتفي بتسجيل أن "بريدًا كان سيُرسَل" بلا أي
 * محتوى حساس. كافٍ لتشغيل النظام محليًا دون ربط مزوّد Production.
 */
@Injectable()
export class DevEmailService implements EmailService {
  private readonly logger = new Logger('DevEmailService');

  async sendPasswordResetCode(params: PasswordResetEmailParams): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Production email delivery is not configured');
    }
    this.logger.log(`[dev] كان سيُرسَل بريد استعادة كلمة مرور إلى حساب (بلا طباعة الرمز أو البريد الكامل).`);
    void params;
  }

  async sendSecurityAlert(params: SecurityAlertEmailParams): Promise<void> {
    this.logger.log(`[dev] كان سيُرسَل تنبيه أمني: ${params.subject} (بلا طباعة محتوى حساس).`);
  }
}
