import { Module } from '@nestjs/common';
import { AllocationController } from './allocation.controller';
import { ALLOCATION_TRIGGER_PORT } from './allocation-trigger.port';
import { NoopAllocationTriggerService } from './noop-allocation-trigger.service';

/**
 * NODE-3: الوحدة ما زالت بلا أي منطق تخصيص فعلي (`AutoAllocation.gs` غير
 * مُنقَل — نطاق NODE-5). الجديد هنا فقط هو تصدير بذرة
 * `ALLOCATION_TRIGGER_PORT` بتنفيذ NO-OP، حتى يستطيع مسار مراجعة
 * المستفيدين استدعاء نقطة التخصيص بتوقيتها وتجميعها الصحيحين منذ الآن.
 */
@Module({
  controllers: [AllocationController],
  providers: [{ provide: ALLOCATION_TRIGGER_PORT, useClass: NoopAllocationTriggerService }],
  exports: [ALLOCATION_TRIGGER_PORT],
})
export class AllocationModule {}
