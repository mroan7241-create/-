import { Module } from '@nestjs/common';
import { AllocationController } from './allocation.controller';
import { ALLOCATION_TRIGGER_PORT } from './allocation-trigger.port';
import { AutoAllocationService } from './auto-allocation.service';

/**
 * NODE-5: `ALLOCATION_TRIGGER_PORT` مربوط الآن بالمحرّك الفعلي
 * (`AutoAllocationService`، يوازي `AutoAllocation.gs` القديم) بدل
 * `NoopAllocationTriggerService` — بلا أي تعديل في نقاط الاستدعاء
 * (`beneficiaries.service.ts`/`receipts.service.ts`)، تمامًا كما وثّق
 * العقد في allocation-trigger.port.ts منذ NODE-3.
 */
@Module({
  controllers: [AllocationController],
  providers: [AutoAllocationService, { provide: ALLOCATION_TRIGGER_PORT, useClass: AutoAllocationService }],
  exports: [ALLOCATION_TRIGGER_PORT],
})
export class AllocationModule {}
