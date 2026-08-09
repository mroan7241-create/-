import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * محاضر استلام الأجهزة — NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد.
 * راجع platform/docs/FEATURE_PARITY.md لحالة الترحيل التفصيلية لكل
 * endpoint من هذه الوحدة.
 */
@ApiTags('receipts')
@Controller('receipts')
export class ReceiptsController {
  @Get('_module-status')
  @ApiOperation({ summary: 'حالة تأسيس الوحدة (NODE-0 فقط — ليست endpoint أعمال حقيقية)' })
  moduleStatus() {
    return {
      module: 'ReceiptsModule',
      descriptionAr: 'محاضر استلام الأجهزة',
      parityStatus: 'FOUNDATION_READY',
    };
  }
}
