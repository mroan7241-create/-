import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * مخزون الأجهزة — NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد.
 * راجع platform/docs/FEATURE_PARITY.md لحالة الترحيل التفصيلية لكل
 * endpoint من هذه الوحدة.
 */
@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  @Get('_module-status')
  @ApiOperation({ summary: 'حالة تأسيس الوحدة (NODE-0 فقط — ليست endpoint أعمال حقيقية)' })
  moduleStatus() {
    return {
      module: 'InventoryModule',
      descriptionAr: 'مخزون الأجهزة',
      parityStatus: 'FOUNDATION_READY',
    };
  }
}
