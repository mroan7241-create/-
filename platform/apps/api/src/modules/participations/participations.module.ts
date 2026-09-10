import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ParticipationsController } from './participations.controller';
import { ParticipationsService } from './participations.service';
import { CovenantDocumentService } from './covenant-document.service';

@Module({
  imports: [FilesModule],
  controllers: [ParticipationsController],
  providers: [ParticipationsService, CovenantDocumentService],
  exports: [ParticipationsService],
})
export class ParticipationsModule {}
