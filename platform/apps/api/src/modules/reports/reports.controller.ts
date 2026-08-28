import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AssociationReportQueryDto } from './dto/association-report-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('association')
  @Roles(AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تقرير تشغيلي للجمعية صاحبة الجلسة' })
  associationReport(@CurrentUser() ctx: AuthContext, @Query() query: AssociationReportQueryDto) {
    return this.reports.associationReport(ctx, query);
  }
}
