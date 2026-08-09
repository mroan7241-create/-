import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { RateLimitService } from '../../common/rate-limit.service';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, RateLimitService, PublicCodeService, IdempotencyService],
})
export class ApplicationsModule {}
