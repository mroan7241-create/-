import { Module } from '@nestjs/common';
import { AssociationsController } from './associations.controller';
import { AssociationsService } from './associations.service';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';

@Module({
  controllers: [AssociationsController],
  providers: [AssociationsService, PublicCodeService, IdempotencyService],
})
export class AssociationsModule {}
