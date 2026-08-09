import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * المصادقة والجلسات — NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد.
 * راجع platform/docs/FEATURE_PARITY.md لحالة الترحيل التفصيلية لكل
 * endpoint من هذه الوحدة.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Get('_module-status')
  @ApiOperation({ summary: 'حالة تأسيس الوحدة (NODE-0 فقط — ليست endpoint أعمال حقيقية)' })
  moduleStatus() {
    return {
      module: 'AuthModule',
      descriptionAr: 'المصادقة والجلسات',
      parityStatus: 'FOUNDATION_READY',
    };
  }
}
