import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReconciliationService } from './reconciliation.service';
import { ClosureReadinessService } from './closure-readiness.service';
import { ClosureService } from './closure.service';
import { FilesModule } from '../files/files.module';
import { AbanmiReaderController } from './abanmi-reader.controller';
import { AbanmiReaderService } from './abanmi-reader.service';

@Module({
  imports: [FilesModule],
  controllers: [ReportsController, AbanmiReaderController],
  providers: [ReportsService, ReconciliationService, ClosureReadinessService, ClosureService, AbanmiReaderService],
})
export class ReportsModule {}
