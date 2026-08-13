import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { BeneficiariesService } from './beneficiaries.service';
import { XLSX_MAX_BYTES, generateXlsxTemplate } from './xlsx-import.util';
import {
  BulkReviewDto,
  CreateBeneficiaryDto,
  ImportBeneficiariesDto,
  ListBeneficiariesQueryDto,
  RemoveNeedDto,
  ReviewBeneficiaryDto,
  UpdateBeneficiaryDto,
  UpdateBeneficiaryLocationDto,
} from './dto/beneficiary.dto';

/**
 * المستفيدون واحتياجاتهم — NODE-3.
 *
 * التحكم بالأدوار مطابق لِLegacy حرفيًا:
 *  - `listBeneficiaries` / `saveBeneficiary` / `saveBeneficiaryWithNeeds` /
 *    `setBeneficiaryNeeds` / `removePendingBeneficiaryNeed`:
 *    `requireSession_(token, ['ADMIN','ASSOCIATION'])`.
 *  - `reviewBeneficiaryNeeds` / `bulkReviewBeneficiaries`:
 *    `requireSession_(token, ['ADMIN'])` — **ADMIN وحده**.
 *  - `DELEGATE` لا يملك أي وصول لأي من هذه الدوال في النظام القديم.
 *
 * كل `:id` يمرّ عبر `ParseUUIDPipe` (تحصين NODE-2.1 — لا تراجع عنه).
 */
@ApiTags('beneficiaries')
@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly beneficiaries: BeneficiariesService) {}

  // ترتيب المسارات: 'bulk-review'/'import'/'import/preview-xlsx' يجب أن تسبق ':id/...' حتى لا تُلتقَط كـid.
  @Post('import')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({
    summary:
      'BEN-013 — استيراد مستفيدين بالجملة (JSON/CSV-row) — ذرّي بالكامل: أي خطأ في أي صف يُسقط الدفعة كاملة قبل أي كتابة، حتى 50 خطأً تُعاد',
  })
  async import(@CurrentUser() ctx: AuthContext, @Body() dto: ImportBeneficiariesDto) {
    return this.beneficiaries.importBeneficiaries(ctx, dto);
  }

  @Post('import/preview-xlsx')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'file', maxCount: 1 }], { limits: { fileSize: XLSX_MAX_BYTES + 1024 } }))
  @ApiOperation({
    summary:
      'BEN-014 — معاينة ملف Excel (.xlsx) لاستيراد المستفيدين — قراءة وتحقق فقط، لا كتابة أبدًا (يوازي inspectBeneficiaryExcel). الالتزام الفعلي عبر POST /beneficiaries/import بالصفوف الصالحة المُعادة هنا',
  })
  async previewXlsx(@CurrentUser() ctx: AuthContext, @UploadedFiles() files?: { file?: Express.Multer.File[] }) {
    const file = files?.file?.[0];
    if (!file || !file.buffer.length) throw new ApiError('BENEFICIARY_IMPORT_XLSX_REQUIRED', 'ملف Excel مطلوب', 400);
    return this.beneficiaries.previewXlsxImport(ctx, file.buffer);
  }

  @Get('import/template.xlsx')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'BEN-014 — قالب Excel لاستيراد المستفيدين (رأس الأعمدة + صف مثال)' })
  async downloadXlsxTemplate(): Promise<StreamableFile> {
    const buffer = await generateXlsxTemplate();
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="beneficiary-import-template.xlsx"',
    });
  }

  @Post('bulk-review')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({
    summary:
      'مراجعة مستفيدين بالجملة — ADMIN فقط؛ كل عنصر معاملة ذرّية مستقلة (فشل عنصر لا يُسقط الباقي)، وإشارة التخصيص مرة واحدة لكل جمعية فريدة',
  })
  async bulkReview(@CurrentUser() ctx: AuthContext, @Body() dto: BulkReviewDto) {
    return this.beneficiaries.bulkReview(ctx, dto.items);
  }

  @Get()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'قائمة المستفيدين — ADMIN يرى الكل، ASSOCIATION مقيَّدة بجمعيتها من الجلسة حصرًا' })
  async list(@CurrentUser() ctx: AuthContext, @Query() query: ListBeneficiariesQueryDto) {
    return this.beneficiaries.listBeneficiaries(ctx, query);
  }

  @Post()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'إنشاء مستفيد + احتياجاته في معاملة ذرّية واحدة — يشترط احتياجًا صالحًا واحدًا على الأقل' })
  async create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateBeneficiaryDto) {
    return this.beneficiaries.createBeneficiary(ctx, dto);
  }

  @Get(':id')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تفاصيل مستفيد مع احتياجاته' })
  async detail(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.beneficiaries.getBeneficiaryDetail(ctx, id);
  }

  @Patch(':id')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تعديل مستفيد (+ مزامنة احتياجاته) — الاحتياجات قابلة للتعديل قبل القرار النهائي فقط' })
  async update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBeneficiaryDto) {
    return this.beneficiaries.updateBeneficiary(ctx, id, dto);
  }

  @Patch(':id/location')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  @ApiOperation({
    summary:
      'BEN-016/017 — تعديل/تأكيد موقع المستفيد فقط (لا حقول أخرى) — المسار الوحيد المفتوح لِDELEGATE، ولمستفيده المُسنَد حاليًا حصرًا',
  })
  async updateLocation(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBeneficiaryLocationDto) {
    return this.beneficiaries.updateBeneficiaryLocation(ctx, id, dto);
  }

  @Post(':id/review')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({
    summary:
      'مراجعة مستفيد فردية — ADMIN فقط؛ قرار المستفيد وقرارات احتياجاته في معاملة واحدة، نهائية بلا إعادة فتح',
  })
  async review(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewBeneficiaryDto) {
    return this.beneficiaries.reviewBeneficiary(ctx, id, dto);
  }

  @Delete('needs/:needId')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'إزالة احتياج معلَّق قبل القرار النهائي فقط — لا يجوز ترك المستفيد بلا احتياج' })
  async removeNeed(@CurrentUser() ctx: AuthContext, @Param('needId', ParseUUIDPipe) needId: string, @Body() dto: RemoveNeedDto) {
    return this.beneficiaries.removePendingNeed(ctx, needId, dto.opId);
  }
}
