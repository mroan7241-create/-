import { Module } from '@nestjs/common';
import { BeneficiaryNeedsController } from './beneficiary-needs.controller';

@Module({
  controllers: [BeneficiaryNeedsController],
})
export class BeneficiaryNeedsModule {}
