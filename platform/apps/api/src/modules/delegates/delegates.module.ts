import { Module } from '@nestjs/common';
import { DelegatesController } from './delegates.controller';

@Module({
  controllers: [DelegatesController],
})
export class DelegatesModule {}
