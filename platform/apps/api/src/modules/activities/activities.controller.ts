import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ActivitiesService } from './activities.service';
import { SaveActivityDto } from './dto/activity.dto';

/** متابعة المشروع — NODE-7 (يوازي getActivitiesBundle/saveActivity). القراءة لِADMIN+ASSOCIATION، الكتابة ADMIN فقط. */
@ApiTags('activities')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.ABANMI)
  @ApiOperation({ summary: 'قائمة أنشطة المشروع مع حالة أدلتها' })
  async list() {
    return this.activities.listActivities();
  }

  @Post('catalog/import')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'استيراد أنشطة خطة المشروع المفقودة دون تعديل الموجود — ADMIN فقط' })
  async importCatalog(@CurrentUser() ctx: AuthContext) {
    return this.activities.importProjectCatalog(ctx);
  }

  @Post()
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'إنشاء/تعديل نشاط — ADMIN فقط' })
  async save(@CurrentUser() ctx: AuthContext, @Body() dto: SaveActivityDto) {
    return this.activities.saveActivity(ctx, dto);
  }
}
