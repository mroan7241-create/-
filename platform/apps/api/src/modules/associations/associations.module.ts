import { Module } from '@nestjs/common';
import { AssociationsController } from './associations.controller';

@Module({
  controllers: [AssociationsController],
})
export class AssociationsModule {}
