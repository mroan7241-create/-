import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ParticipationsController } from './participations.controller';
import { ParticipationsService } from './participations.service';
import { CovenantDocumentService } from './covenant-document.service';
import { EmailModule } from '../auth/email/email.module';

@Module({
  imports: [FilesModule, EmailModule],
  controllers: [ParticipationsController],
  providers: [ParticipationsService, CovenantDocumentService],
  exports: [ParticipationsService],
})
export class ParticipationsModule {}
