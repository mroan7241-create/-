import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

@ApiTags('applications')
@Controller()
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Public()
  @Post('association-applications')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('licenseFile', { limits: { fileSize: LICENSE_FILE_MAX_BYTES + 1024 } }))
  @ApiOperation({ summary: 'تقديم طلب انضمام جمعية — عام، multipart/form-data' })
  async submit(@Body() dto: SubmitApplicationDto, @UploadedFile() file?: Express.Multer.File) {
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
        notes: dto.notes,
        licenseNumber: dto.licenseNumber,
        licenseExpiryDate: dto.licenseExpiryDate,
        answers,
        pledgeAccepted: dto.pledgeAccepted === 'true',
        website: dto.website,
      },
      file?.buffer ?? Buffer.alloc(0),
      file?.mimetype,
    );
  }

  @Public()
  @Get('association-applications/status/:clientRequestId')
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
}
