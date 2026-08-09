import { Module } from '@nestjs/common';
import { ReferenceDataController } from './reference-data.controller';

@Module({
  controllers: [ReferenceDataController],
})
export class ReferenceDataModule {}
