import { Module } from '@nestjs/common';
import { DevEmailService } from './dev-email.service';
import { EmailService } from './email.service';
import { SmtpEmailService } from './smtp-email.service';
import { assertProductionEmailConfigured } from '../../../config/email.config';

export function createEmailService(): EmailService {
  assertProductionEmailConfigured();
  return process.env.EMAIL_PROVIDER?.trim().toUpperCase() === 'SMTP'
    ? new SmtpEmailService()
    : new DevEmailService();
}

@Module({
  providers: [
    {
      provide: EmailService,
      useFactory: createEmailService,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
