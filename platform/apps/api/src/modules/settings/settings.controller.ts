import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/auth.types';
import { UpdateSettingDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

/**
 * إعدادات النظام — NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد.
 * راجع platform/docs/FEATURE_PARITY.md لحالة الترحيل التفصيلية لكل
 * endpoint من هذه الوحدة.
 */
@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Roles(AccountRole.ADMIN)
  list() { return this.settings.list(); }

  @Put()
  @Roles(AccountRole.ADMIN)
  update(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateSettingDto) {
    return this.settings.set(ctx, dto.key, dto.value);
  }

  @Get('_module-status')
  @ApiOperation({ summary: 'حالة تأسيس الوحدة (NODE-0 فقط — ليست endpoint أعمال حقيقية)' })
  moduleStatus() {
    return {
      module: 'SettingsModule',
      descriptionAr: 'إعدادات النظام',
      parityStatus: 'IMPLEMENTED',
    };
  }
}
