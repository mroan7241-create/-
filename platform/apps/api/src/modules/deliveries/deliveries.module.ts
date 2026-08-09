import { Module } from '@nestjs/common';
import { DeliveriesController } from './deliveries.controller';

@Module({
  controllers: [DeliveriesController],
})
export class DeliveriesModule {}
