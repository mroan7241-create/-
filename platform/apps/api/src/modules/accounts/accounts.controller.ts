import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AccountsService } from './accounts.service';
import { CreateAbanmiAccountDto } from './dto/create-abanmi-account.dto';
import { CreateAdminAccountDto, SetAdminAccountStatusDto, UpdateAdminAccountDto } from './dto/admin-account.dto';

/**
 * إدارة حسابات الأدوار غير التابعة لجمعية. حساب أبانمي مستقل ومقيد
 * بالقراءة عبر RBAC الخادمي، ولا يقبل associationId.
 */
@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('admins')
  @Roles(AccountRole.ADMIN)
  listAdmins(@CurrentUser() ctx: AuthContext) { return this.accounts.listAdmins(ctx); }

  @Post('admins')
  @Roles(AccountRole.ADMIN)
  createAdmin(@CurrentUser() ctx: AuthContext, @Body() dto: CreateAdminAccountDto) { return this.accounts.createAdmin(ctx, dto); }

  @Patch('admins/:id')
  @Roles(AccountRole.ADMIN)
  updateAdmin(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminAccountDto) { return this.accounts.updateAdmin(ctx, id, dto); }

  @Patch('admins/:id/status')
  @Roles(AccountRole.ADMIN)
  setAdminStatus(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAdminAccountStatusDto) { return this.accounts.setAdminStatus(ctx, id, dto.status); }

  @Post('admins/:id/reset-password')
  @Roles(AccountRole.ADMIN)
  resetAdminPassword(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) { return this.accounts.resetAdminPassword(ctx, id); }

  @Get('abanmi')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'حسابات بوابة أبانمي — ADMIN فقط' })
  listAbanmi() {
    return this.accounts.listAbanmi();
  }

  @Post('abanmi')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'إنشاء حساب أبانمي للقراءة فقط — تُعاد كلمة المرور المؤقتة مرة واحدة' })
  createAbanmi(@CurrentUser() ctx: AuthContext, @Body() dto: CreateAbanmiAccountDto) {
    return this.accounts.createAbanmi(ctx, dto);
  }
}
