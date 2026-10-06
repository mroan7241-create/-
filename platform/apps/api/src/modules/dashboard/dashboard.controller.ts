import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/auth.types';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('admin')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'ملخص لوحة الإدارة في طلب واحد' })
  admin(@CurrentUser() ctx: AuthContext) { return this.dashboard.admin(ctx); }

  @Get('association')
  @Roles(AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'ملخص لوحة الجمعية المعزول في طلب واحد' })
  association(@CurrentUser() ctx: AuthContext) { return this.dashboard.association(ctx); }
}
