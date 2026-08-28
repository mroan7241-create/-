import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReconciliationService } from './reconciliation.service';
import { ClosureReadinessService } from './closure-readiness.service';
import { ClosureService } from './closure.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReconciliationService, ClosureReadinessService, ClosureService],
})
export class ReportsModule {}
