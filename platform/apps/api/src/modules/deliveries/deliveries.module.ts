import { Module } from '@nestjs/common';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { FilesModule } from '../files/files.module';
import { AllocationModule } from '../allocation/allocation.module';

/** `PublicCodeService`/`IdempotencyService` من `CommonModule` العالمي — لا تُعاد إعلانها هنا. */
@Module({
  imports: [FilesModule, AllocationModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
})
export class DeliveriesModule {}
