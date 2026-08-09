import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';

@Module({
  controllers: [ReceiptsController],
})
export class ReceiptsModule {}
