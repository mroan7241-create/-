import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole, prisma } from '@alzad/db';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AssociationReportQueryDto } from './dto/association-report-query.dto';
import { ReportsService } from './reports.service';
import { ApiError } from '../../common/api-error';
import { ReconciliationService } from './reconciliation.service'; import { ClosureReadinessService } from './closure-readiness.service'; import { ClosureService } from './closure.service'; import { OrganizationTransitionDto, ParticipationOperationDto, ProjectTransitionDto, QualitativeReportDto, ReopenDto } from './dto/closure.dto';
import { AbanmiReportQueryDto } from './dto/abanmi-report-query.dto';
import type { Response } from 'express';
import ExcelJS from 'exceljs';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly reconciliation: ReconciliationService, private readonly readiness: ClosureReadinessService, private readonly closure: ClosureService) {}

  @Get('abanmi/export.xlsx')
  @Roles(AccountRole.ABANMI)
  @ApiOperation({ summary: 'تصدير تقرير أبانمي التجميعي إلى XLSX' })
  async abanmiExport(@CurrentUser() ctx: AuthContext, @Query() query: AbanmiReportQueryDto, @Res() res: Response) {
    const report = await this.reports.abanmiReport(ctx, query);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'منصة الزاد';
    const summary = workbook.addWorksheet('ملخص المشروع', { views: [{ rightToLeft: true }] });
    summary.addRows([
      ['المؤشر', 'القيمة'], ['الجمعيات', report.overall.associations],
      ['المستفيدون', report.overall.beneficiaries], ['الاحتياجات المعتمدة', report.overall.approvedNeeds],
      ['الأجهزة', report.overall.devices], ['عمليات التسليم', report.overall.deliveries],
    ]);
    summary.getRow(1).font = { bold: true };
    summary.columns = [{ width: 28 }, { width: 18 }];
    const associations = workbook.addWorksheet('حسب الجمعية', { views: [{ rightToLeft: true }] });
    associations.addRow(['الرمز', 'الجمعية', 'المنطقة', 'المدينة', 'الحالة']);
    for (const row of report.associations) associations.addRow([row.publicCode, row.name, row.region, row.city, row.status]);
    associations.getRow(1).font = { bold: true };
    associations.columns = [{ width: 16 }, { width: 34 }, { width: 20 }, { width: 20 }, { width: 16 }];
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="abanmi-project-report.xlsx"');
    res.send(Buffer.from(buffer));
  }

  @Get('abanmi')
  @Roles(AccountRole.ABANMI)
  @ApiOperation({ summary: 'تقرير أبانمي التجميعي للقراءة فقط، بلا بيانات شخصية للمستفيدين' })
  abanmi(@CurrentUser() ctx: AuthContext, @Query() query: AbanmiReportQueryDto) {
    return this.reports.abanmiReport(ctx, query);
  }

  @Get('association')
  @Roles(AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تقرير تشغيلي للجمعية صاحبة الجلسة' })
  associationReport(@CurrentUser() ctx: AuthContext, @Query() query: AssociationReportQueryDto) {
    return this.reports.associationReport(ctx, query);
  }

  @Get('reconciliation/:associationId') @Roles(AccountRole.ADMIN,AccountRole.ASSOCIATION) reconciliationReport(@CurrentUser()ctx:AuthContext,@Param('associationId',ParseUUIDPipe)associationId:string){return this.reconciliation.reconcile(ctx.role===AccountRole.ASSOCIATION?ctx.associationId!:associationId)}
  @Get('closure/readiness/:participationId') @Roles(AccountRole.ADMIN,AccountRole.ASSOCIATION) async closureReadiness(@CurrentUser()ctx:AuthContext,@Param('participationId',ParseUUIDPipe)id:string){if(ctx.role===AccountRole.ASSOCIATION){const p=await prisma.projectParticipation.findUnique({where:{id},select:{associationId:true}});if(!p||p.associationId!==ctx.associationId)return{ready:false,blockers:[{code:'PARTICIPATION_NOT_FOUND',count:1,severity:'BLOCKING',route:'/participations'}],generatedAt:new Date()}}return this.readiness.check(id)}
  @Post('closure/organization/generate') @Roles(AccountRole.ASSOCIATION) async generate(@CurrentUser()ctx:AuthContext,@Body()dto:ParticipationOperationDto){if(ctx.role===AccountRole.ASSOCIATION){const p=await prisma.projectParticipation.findUnique({where:{id:dto.participationId},select:{associationId:true}});if(!p||p.associationId!==ctx.associationId)throw new ApiError('PARTICIPATION_NOT_FOUND','المشاركة غير موجودة',404)}return this.closure.generate(ctx,dto.participationId,dto.opId)}
  @Patch('closure/organization/:id') @Roles(AccountRole.ASSOCIATION) qualitative(@CurrentUser()ctx:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()dto:QualitativeReportDto){return this.closure.updateQualitative(ctx,id,dto)}
  @Post('closure/organization/:id/transition') @Roles(AccountRole.ADMIN,AccountRole.ASSOCIATION) orgTransition(@CurrentUser()ctx:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()dto:OrganizationTransitionDto){return this.closure.transitionOrganization(ctx,id,dto.status,dto.opId)}
  @Post('closure/organization/:id/reopen') @Roles(AccountRole.ADMIN) reopen(@CurrentUser()ctx:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()dto:ReopenDto){return this.closure.reopen(ctx,id,dto.reason)}
  @Post('closure/project/generate') @Roles(AccountRole.ADMIN) project(@CurrentUser()ctx:AuthContext){return this.closure.generateProject(ctx)}
  @Get('closure/project') @Roles(AccountRole.ADMIN) projectReport(){return this.closure.getProjectReport()}
  @Post('closure/project/transition') @Roles(AccountRole.ADMIN) projectTransition(@CurrentUser()ctx:AuthContext,@Body()dto:ProjectTransitionDto){return this.closure.transitionProject(ctx,dto.status,dto.donorFeedbackNotes)}
}
