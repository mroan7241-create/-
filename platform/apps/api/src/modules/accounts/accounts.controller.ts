import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * الحسابات (ADMIN/ASSOCIATION/DELEGATE) — NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد.
 * راجع platform/docs/FEATURE_PARITY.md لحالة الترحيل التفصيلية لكل
 * endpoint من هذه الوحدة.
 */
@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  @Get('_module-status')
  @ApiOperation({ summary: 'حالة تأسيس الوحدة (NODE-0 فقط — ليست endpoint أعمال حقيقية)' })
  moduleStatus() {
    return {
      module: 'AccountsModule',
      descriptionAr: 'الحسابات (ADMIN/ASSOCIATION/DELEGATE)',
      parityStatus: 'FOUNDATION_READY',
    };
  }
}
