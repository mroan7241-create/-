import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { RateLimitService } from '../../common/rate-limit.service';
import { FilesModule } from '../files/files.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [FilesModule, SettingsModule],
  controllers: [ApplicationsController],
  // PublicCodeService/IdempotencyService يأتيان من CommonModule العالمي (نسخة واحدة مشتركة).
  providers: [ApplicationsService, RateLimitService],
})
export class ApplicationsModule {}
