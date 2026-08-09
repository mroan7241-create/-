import { Module } from '@nestjs/common';
import { AllocationController } from './allocation.controller';

@Module({
  controllers: [AllocationController],
})
export class AllocationModule {}
