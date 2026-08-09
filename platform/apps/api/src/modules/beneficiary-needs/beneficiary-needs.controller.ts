import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * احتياجات المستفيدين ومراجعتها — NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد.
 * راجع platform/docs/FEATURE_PARITY.md لحالة الترحيل التفصيلية لكل
 * endpoint من هذه الوحدة.
 */
@ApiTags('beneficiary-needs')
@Controller('beneficiary-needs')
export class BeneficiaryNeedsController {
  @Get('_module-status')
  @ApiOperation({ summary: 'حالة تأسيس الوحدة (NODE-0 فقط — ليست endpoint أعمال حقيقية)' })
  moduleStatus() {
    return {
      module: 'BeneficiaryNeedsModule',
      descriptionAr: 'احتياجات المستفيدين ومراجعتها',
      parityStatus: 'FOUNDATION_READY',
    };
  }
}
