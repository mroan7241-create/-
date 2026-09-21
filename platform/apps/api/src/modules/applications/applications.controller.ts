import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ApiError } from '../../common/api-error';
import { LICENSE_FILE_MAX_BYTES } from '../files/file-validation.util';
import { ApplicationsService } from './applications.service';
import { ReviewApplicationDto, SubmitApplicationDto } from './dto/submit-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';
import { EligibilityDecisionDto, EvaluationDto, SelectionCommitDto } from './dto/application-workflow.dto';
import { ApplicationV2Service } from './application-v2.service';
import { ApplicationAttachmentDto, BulkStartProcessingDto, CreateApplicationDraftDto, CreateInformationRequestDto, ExchangeApplicationAccessDto, RequestApplicationAccessDto, SaveApplicationDraftDto, SelectionDecisionDto, SubmitApplicationDraftDto, SubmitInformationResponseDto } from './dto/application-v2.dto';
import { APPLICANT_SESSION_COOKIE, ApplicationAccessService } from './application-access.service';
import { PublicSourceLimit } from '../../common/public-source-limit.guard';

@ApiTags('applications')
@Controller()
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService, private readonly applicationV2: ApplicationV2Service, private readonly applicationAccess: ApplicationAccessService) {}

  @Public()
  @Get('association-applications/geography')
  geography(@Query('parent') parent?: string) { return this.applicationV2.geography(parent?.trim() || undefined); }

  @Public()
  @Post('association-applications/drafts')
  @PublicSourceLimit('application-draft-create', 60, 3600)
  createDraft(@Body() dto: CreateApplicationDraftDto, @Req() req: Request) {
    return this.applicationV2.createDraft(dto.clientRequestId, dto.website, req.ip || req.socket.remoteAddress || 'unknown');
  }

  @Public()
  @Get('association-applications/drafts/:draftCode')
  @PublicSourceLimit('application-draft-read', 240, 3600)
  loadDraft(@Param('draftCode') draftCode: string, @Headers('x-application-resume-token') token = '', @Req() req: Request) { return this.applicationV2.loadDraft(draftCode, token, req.cookies?.[APPLICANT_SESSION_COOKIE] ?? ''); }

  @Public()
  @Put('association-applications/drafts/:draftCode')
  @PublicSourceLimit('application-draft-save', 360, 3600)
  saveDraft(@Param('draftCode') draftCode: string, @Headers('x-application-resume-token') token: string = '', @Body() dto: SaveApplicationDraftDto, @Req() req: Request) { return this.applicationV2.saveDraft(draftCode, token, dto.revision, dto.payload, req.cookies?.[APPLICANT_SESSION_COOKIE] ?? ''); }

  @Public()
  @Post('association-applications/drafts/:draftCode/attachments')
  @PublicSourceLimit('application-draft-attachment', 120, 3600)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LICENSE_FILE_MAX_BYTES + 1024 } }))
  uploadDraftAttachment(@Param('draftCode') draftCode: string, @Headers('x-application-resume-token') token: string = '', @Body() dto: ApplicationAttachmentDto, @Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ApiError('APPLICATION_ATTACHMENT_REQUIRED', 'الملف مطلوب', 400);
    return this.applicationV2.uploadAttachment(draftCode, token, dto.fieldKey, file, req.cookies?.[APPLICANT_SESSION_COOKIE] ?? '');
  }

  @Public()
  @Post('association-applications/drafts/:draftCode/submit')
  @PublicSourceLimit('application-draft-submit', 60, 3600)
  submitDraft(@Param('draftCode') draftCode: string, @Headers('x-application-resume-token') token: string = '', @Body() dto: SubmitApplicationDraftDto, @Req() req: Request) { return this.applicationV2.submitDraft(draftCode, token, dto.revision, req.cookies?.[APPLICANT_SESSION_COOKIE] ?? ''); }

  @Public()
  @Get('association-applications/track/:draftCode')
  @PublicSourceLimit('application-track', 240, 3600)
  trackV2(@Param('draftCode') draftCode: string, @Headers('x-application-resume-token') token: string = '', @Req() req: Request) { return this.applicationV2.publicStatus(draftCode, token, req.cookies?.[APPLICANT_SESSION_COOKIE] ?? ''); }

  @Public()
  @Post('association-applications/track/:draftCode/information/:requestId')
  @PublicSourceLimit('application-information-submit', 60, 3600)
  submitInformation(@Param('draftCode') draftCode: string, @Param('requestId', ParseUUIDPipe) requestId: string, @Headers('x-application-resume-token') token: string = '', @Body() dto: SubmitInformationResponseDto, @Req() req: Request) { return this.applicationV2.submitInformation(draftCode, token, requestId, dto, req.cookies?.[APPLICANT_SESSION_COOKIE] ?? ''); }

  @Public()
  @Post('association-applications/access/request')
  @PublicSourceLimit('application-access-request', 30, 3600)
  @HttpCode(HttpStatus.OK)
  requestAccess(@Body() dto: RequestApplicationAccessDto, @Req() req: Request) {
    return this.applicationAccess.requestAccess(dto.email, req.ip || req.socket.remoteAddress || 'unknown');
  }

  @Public()
  @Post('association-applications/access/exchange')
  @PublicSourceLimit('application-access-exchange', 60, 3600)
  @HttpCode(HttpStatus.OK)
  async exchangeAccess(@Body() dto: ExchangeApplicationAccessDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.applicationAccess.exchange(dto.token);
    res.cookie(APPLICANT_SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
    return { ok: true, draftCode: result.draftCode, destination: result.destination };
  }

  @Public()
  @Post('association-applications')
  @PublicSourceLimit('application-legacy-submit', 60, 3600)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'licenseFile', maxCount: 1 }, { name: 'initialBeneficiaryFile', maxCount: 1 }], { limits: { fileSize: LICENSE_FILE_MAX_BYTES + 1024 } }))
  @ApiOperation({ summary: 'تقديم طلب انضمام جمعية — عام، multipart/form-data' })
  async submit(@Body() dto: SubmitApplicationDto, @UploadedFiles() files?: { licenseFile?: Express.Multer.File[]; initialBeneficiaryFile?: Express.Multer.File[] }) {
    const file = files?.licenseFile?.[0];
    if (!file && !(dto.website && dto.website.trim())) {
      throw new ApiError('APPLICATION_LICENSE_INVALID', 'أرفق صورة الترخيص بصيغة JPG أو PNG أو WEBP', 400);
    }

    let answers: Record<string, boolean> = {};
    try {
      answers = dto.answers ? JSON.parse(dto.answers) : {};
    } catch {
      throw new BadRequestException('صيغة إجابات أسئلة القبول غير صالحة');
    }

    return this.applications.submitApplication(
      {
        clientRequestId: dto.clientRequestId,
        name: dto.name,
        category: dto.category,
        sector: dto.sector,
        region: dto.region,
        city: dto.city,
        phone: dto.phone,
        email: dto.email,
        contactName: dto.contactName,
        address: dto.address,
        serviceScope: dto.serviceScope,
        coordinatorPhone: dto.coordinatorPhone,
        coordinatorEmail: dto.coordinatorEmail,
        coordinatorTitle: dto.coordinatorTitle,
        beneficiaryDatabaseUpdatedAt: dto.beneficiaryDatabaseUpdatedAt,
        approxBeneficiaryCount: dto.approxBeneficiaryCount,
        approxNeedCount: dto.approxNeedCount,
        notes: dto.notes,
        licenseNumber: dto.licenseNumber,
        licenseExpiryDate: dto.licenseExpiryDate,
        answers,
        pledgeAccepted: dto.pledgeAccepted === 'true',
        website: dto.website,
      },
      file?.buffer ?? Buffer.alloc(0),
      file?.mimetype,
      files?.initialBeneficiaryFile?.[0],
    );
  }

  @Public()
  @Get('association-applications/status/:clientRequestId')
  @PublicSourceLimit('application-legacy-status', 240, 3600)
  @ApiOperation({ summary: 'متابعة حالة طلب انضمام — عام، بلا أي PII، عبر clientRequestId فقط' })
  async status(@Param('clientRequestId') clientRequestId: string) {
    return this.applications.getApplicationStatus(clientRequestId);
  }

  @Get('association-applications')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'قائمة طلبات الانضمام — ADMIN فقط، مع pagination/search/filter' })
  async list(@Query() query: ListApplicationsQueryDto) {
    return this.applications.listApplications(query);
  }

  @Post('association-applications/processing/start')
  @Roles(AccountRole.ADMIN)
  startProcessing(@CurrentUser() ctx: AuthContext, @Body() dto: BulkStartProcessingDto) { return this.applicationV2.bulkStartProcessing(ctx, dto); }

  @Get('association-applications/:id')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'تفاصيل طلب انضمام — ADMIN فقط' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.applications.getApplicationDetail(id);
  }

  @Get('association-applications/:id/license-file')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'رابط موقَّع قصير العمر لعرض ملف الترخيص — ADMIN فقط، Audit عند كل عرض' })
  async licenseFile(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.getLicenseSignedUrl(ctx, id);
  }

  @Post('association-applications/:id/review')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'قبول/رفض طلب انضمام — ADMIN فقط، نهائي، idempotent عبر opId' })
  async review(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewApplicationDto) {
    return this.applications.reviewApplication(ctx, id, dto.decision, dto.reason, dto.opId);
  }

  @Post('association-applications/:id/eligibility')
  @Roles(AccountRole.ADMIN)
  async eligibility(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EligibilityDecisionDto) {
    const evidence = await this.applicationV2.eligibilityEvidence(id);
    return this.applications.decideEligibility(ctx, id, dto.decision, dto.notes, dto.opId, evidence);
  }

  @Get('association-applications/:id/eligibility-evidence')
  @Roles(AccountRole.ADMIN)
  eligibilityEvidence(@Param('id', ParseUUIDPipe) id: string) { return this.applicationV2.eligibilityEvidence(id); }

  @Post('association-applications/:id/information-request')
  @Roles(AccountRole.ADMIN)
  informationRequest(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateInformationRequestDto) { return this.applicationV2.requestInformation(ctx, id, dto); }

  @Post('association-applications/:id/information-request/resend')
  @Roles(AccountRole.ADMIN)
  async resendInformationRequest(@Param('id', ParseUUIDPipe) id: string) {
    await this.applicationAccess.sendNeedsInfo(id);
    return { ok: true };
  }

  @Post('association-applications/:id/evaluation')
  @Roles(AccountRole.ADMIN)
  evaluation(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EvaluationDto) {
    return this.applicationV2.evaluate(ctx, id, dto);
  }

  @Post('association-applications/:id/selection-decision')
  @Roles(AccountRole.ADMIN)
  selectionDecision(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SelectionDecisionDto) { return this.applicationV2.decideSelection(ctx, id, dto); }

  @Post('association-applications/selection/preview')
  @Roles(AccountRole.ADMIN)
  selectionPreview() { return this.applications.previewSelection(); }

  @Post('association-applications/selection/commit')
  @Roles(AccountRole.ADMIN)
  selectionCommit(@CurrentUser() ctx: AuthContext, @Body() dto: SelectionCommitDto) {
    return this.applications.commitSelection(ctx, dto.mainTargetCount, dto.opId);
  }
}
