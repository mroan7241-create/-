import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * طلبات انضمام الجمعيات — NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد.
 * راجع platform/docs/FEATURE_PARITY.md لحالة الترحيل التفصيلية لكل
 * endpoint من هذه الوحدة.
 */
@ApiTags('applications')
@Controller('applications')
export class ApplicationsController {
  @Get('_module-status')
  @ApiOperation({ summary: 'حالة تأسيس الوحدة (NODE-0 فقط — ليست endpoint أعمال حقيقية)' })
  moduleStatus() {
    return {
      module: 'ApplicationsModule',
      descriptionAr: 'طلبات انضمام الجمعيات',
      parityStatus: 'FOUNDATION_READY',
    };
  }
}
