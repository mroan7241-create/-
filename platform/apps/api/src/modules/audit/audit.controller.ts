import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { ListAuditLogQueryDto } from './dto/audit.dto';

/**
 * سجل العمليات — NODE-7 (يوازي listAuditLog/listDelegateAuditLog القديمتين).
 * الكتابة تعمل فعليًا منذ NODE-1 (`AuditService.log`، مستخدَمة من 5+
 * خدمات) — هذا الملف يضيف القراءة فقط.
 */
@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  @ApiOperation({ summary: 'سجل العمليات — ADMIN الكل (اختياريًا مصفّى)، ASSOCIATION جمعيته فقط، DELEGATE سجله الشخصي بإجراءات مرئية محدودة فقط' })
  async list(@CurrentUser() ctx: AuthContext, @Query() query: ListAuditLogQueryDto) {
    return this.audit.listAuditLog(ctx, query);
  }
}
