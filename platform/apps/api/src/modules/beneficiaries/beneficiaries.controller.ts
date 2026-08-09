import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { BeneficiariesService } from './beneficiaries.service';
import {
  BulkReviewDto,
  CreateBeneficiaryDto,
  ListBeneficiariesQueryDto,
  RemoveNeedDto,
  ReviewBeneficiaryDto,
  UpdateBeneficiaryDto,
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

  // ترتيب المسارات: 'bulk-review' يجب أن يسبق ':id/...' حتى لا يُلتقَط كـid.
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
