import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ReferenceDataService } from './reference-data.service';
import { AddReferenceValueDto } from './dto/add-reference-value.dto';

/**
 * البيانات المرجعية — GET /reference-values عام تمامًا مثل
 * getReferenceData(token optional) القديمة؛ لا يشترط جلسة، ولا يعيد أي
 * بيانات حساسة (قوائم عرض فقط).
 */
@ApiTags('reference-data')
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceDataService: ReferenceDataService) {}

  @Public()
  @Get('reference-values')
  @ApiOperation({ summary: 'كل القوائم المرجعية (مناطق/مدن/أنواع أجهزة/حالات اجتماعية/تصنيفات...) — عام، بلا جلسة' })
  async getReferenceValues() {
    return this.referenceDataService.getReferenceData();
  }

  @Post('reference-values')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'REF-008 — إضافة قيمة مرجعية جديدة لنوع موجود مسبقًا — ADMIN فقط' })
  async addReferenceValue(@CurrentUser() ctx: AuthContext, @Body() dto: AddReferenceValueDto) {
    return this.referenceDataService.addReferenceValue(ctx, dto);
  }
}
