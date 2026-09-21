import { Module } from '@nestjs/common';
import { AllocationModule } from '../allocation/allocation.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailModule } from '../auth/email/email.module';
import { OperationsDigestService } from './operations-digest.service';

@Module({
  imports: [SettingsModule, AllocationModule, EmailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, OperationsDigestService],
  exports: [NotificationsService, OperationsDigestService],
})
export class NotificationsModule {}
