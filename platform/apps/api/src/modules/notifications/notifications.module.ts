import { Module } from '@nestjs/common';
import { AllocationModule } from '../allocation/allocation.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailModule } from '../auth/email/email.module';
import { OperationsDigestService } from './operations-digest.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [SettingsModule, AllocationModule, EmailModule, FilesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, OperationsDigestService],
  exports: [NotificationsService, OperationsDigestService],
})
export class NotificationsModule {}
