import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { RateLimitService } from '../../common/rate-limit.service';
import { FilesModule } from '../files/files.module';
import { SettingsModule } from '../settings/settings.module';
import { ApplicationV2Service } from './application-v2.service';
import { ApplicationAccessService } from './application-access.service';
import { EmailModule } from '../auth/email/email.module';

@Module({
  imports: [FilesModule, SettingsModule, EmailModule],
  controllers: [ApplicationsController],
  // PublicCodeService/IdempotencyService يأتيان من CommonModule العالمي (نسخة واحدة مشتركة).
  providers: [ApplicationsService, ApplicationV2Service, ApplicationAccessService, RateLimitService],
})
export class ApplicationsModule {}
