import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { RateLimitService } from '../../common/rate-limit.service';
import { EmailService } from './email/email.service';
import { DevEmailService } from './email/dev-email.service';

/**
 * SessionAuthGuard مُسجَّل هنا كـAPP_GUARD عالمي — يُطبَّق على كل
 * endpoint في التطبيق تلقائيًا ما لم يُعلَّم @Public() صراحة (لا حاجة
 * لتكرار @UseGuards في أي controller آخر).
 *
 * EmailService: DevEmailService هو التطبيق الافتراضي (آمن، لا إرسال
 * فعلي — راجع email/dev-email.service.ts). الاختبارات تستبدله بـ
 * FakeEmailService عبر .overrideProvider في TestingModule، بلا أي
 * تغيير على AuthService نفسها.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    RateLimitService,
    { provide: EmailService, useClass: DevEmailService },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
