import { Module } from '@nestjs/common';
import { AssociationsController } from './associations.controller';
import { AssociationsService } from './associations.service';

@Module({
  controllers: [AssociationsController],
  // PublicCodeService/IdempotencyService يأتيان من CommonModule العالمي (نسخة واحدة مشتركة).
  providers: [AssociationsService],
})
export class AssociationsModule {}
