import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { DelegatesService } from './delegates.service';
import { ListDelegatesQueryDto, SaveDelegateDto, SetDelegateStatusDto, UpdateDelegateDto } from './dto/delegate.dto';

/**
 * المناديب — NODE-6 (يوازي Delegates.gs: saveDelegate/listDelegates_/
 * setDelegateStatus/regenerateDelegateCode). تسجيل دخول المندوب نفسه
 * منقول فعلًا منذ NODE-1 (`POST /auth/login` بـtype:'delegate') —
 * هذه الوحدة إدارة الحسابات فقط (ADMIN/ASSOCIATION).
 */
@ApiTags('delegates')
@Controller('delegates')
export class DelegatesController {
  constructor(private readonly delegates: DelegatesService) {}

  @Get()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'قائمة المناديب — ADMIN (أي جمعية) أو ASSOCIATION (جمعيتها فقط)' })
  async list(@CurrentUser() ctx: AuthContext, @Query() query: ListDelegatesQueryDto) {
    return this.delegates.listDelegates(ctx, query);
  }

  @Post()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'إنشاء مندوب + إصدار رمز دخول — يُعاد الرمز الخام مرة واحدة فقط في الاستجابة' })
  async create(@CurrentUser() ctx: AuthContext, @Body() dto: SaveDelegateDto) {
    return this.delegates.createDelegate(ctx, dto);
  }

  @Get(':id')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تفاصيل مندوب' })
  async detail(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.delegates.getDelegateDetail(ctx, id);
  }

  @Patch(':id')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تعديل اسم/جوال مندوب — لا رمز ولا حالة من هنا' })
  async update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDelegateDto) {
    return this.delegates.updateDelegate(ctx, id, dto);
  }

  @Post(':id/status')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تفعيل/تعطيل مندوب — التعطيل يُبطل جلساته فورًا' })
  async setStatus(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDelegateStatusDto) {
    return this.delegates.setDelegateStatus(ctx, id, dto.status);
  }

  @Post(':id/regenerate-code')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'إعادة توليد رمز دخول المندوب — يُبطل الرمز القديم وكل جلساته فورًا، يُعاد الرمز الجديد مرة واحدة فقط' })
  async regenerateCode(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.delegates.regenerateDelegateCode(ctx, id);
  }
}
