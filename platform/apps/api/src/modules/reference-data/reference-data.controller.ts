import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ReferenceDataService } from './reference-data.service';

/**
 * البيانات المرجعية — GET /reference-values عام تمامًا مثل
 * getReferenceData(token optional) القديمة؛ لا يشترط جلسة، ولا يعيد أي
 * بيانات حساسة (قوائم عرض فقط).
 */
@ApiTags('reference-data')
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceDataService: ReferenceDataService) {}

  @Public()
  @Get('reference-values')
  @ApiOperation({ summary: 'كل القوائم المرجعية (مناطق/مدن/أنواع أجهزة/حالات اجتماعية/تصنيفات...) — عام، بلا جلسة' })
  async getReferenceValues() {
    return this.referenceDataService.getReferenceData();
  }
}
