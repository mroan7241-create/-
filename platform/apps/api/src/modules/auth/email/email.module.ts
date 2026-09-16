import { Module } from '@nestjs/common';
import { DevEmailService } from './dev-email.service';
import { EmailService } from './email.service';
import { SmtpEmailService } from './smtp-email.service';

@Module({
  providers: [
    {
      provide: EmailService,
      useFactory: () => process.env.EMAIL_PROVIDER?.trim().toUpperCase() === 'SMTP'
        ? new SmtpEmailService()
        : new DevEmailService(),
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
