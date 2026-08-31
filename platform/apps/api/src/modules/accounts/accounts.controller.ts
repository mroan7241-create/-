import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AccountsService } from './accounts.service';
import { CreateAbanmiAccountDto } from './dto/create-abanmi-account.dto';

/**
 * إدارة حسابات الأدوار غير التابعة لجمعية. حساب أبانمي مستقل ومقيد
 * بالقراءة عبر RBAC الخادمي، ولا يقبل associationId.
 */
@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

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
