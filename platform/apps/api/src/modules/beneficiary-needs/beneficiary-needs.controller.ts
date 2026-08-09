import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * احتياجات المستفيدين ومراجعتها.
 *
 * NODE-3: نُقل منطق هذه الوحدة بالكامل فعليًا، لكنه **يعيش في
 * `BeneficiariesModule`** لا هنا. السبب أن الاحتياج في النظام القديم ليس
 * كيانًا مستقلًا بدورة حياة خاصة: `setBeneficiaryNeeds_` جزء من مسار حفظ
 * المستفيد، و`reviewBeneficiaryNeeds_` تكتب صف المستفيد وصفوف احتياجاته
 * في **معاملة واحدة** لا تقبل التجزئة. فصلها إلى خدمتين كان سيقتضي إما
 * معاملة موزَّعة بين وحدتين أو تسريب `tx` عبر حدودهما — وكلاهما تعقيد بلا
 * مقابل.
 *
 * تُركت الوحدة قائمة بنقطة الحالة هذه فقط حتى لا يتغيّر أي مسار قائم،
 * وتُحذف عند أول تنظيف هيكلي مقصود. راجع BENEFICIARIES.md
 * وplatform/docs/FEATURE_PARITY.md.
 */
@ApiTags('beneficiary-needs')
@Controller('beneficiary-needs')
export class BeneficiaryNeedsController {
  @Get('_module-status')
  @ApiOperation({ summary: 'حالة الوحدة — المنطق الفعلي في BeneficiariesModule (NODE-3)' })
  moduleStatus() {
    return {
      module: 'BeneficiaryNeedsModule',
      descriptionAr: 'احتياجات المستفيدين ومراجعتها',
      parityStatus: 'MIGRATED',
      implementedIn: 'BeneficiariesModule',
      endpoints: [
        'PATCH /beneficiaries/:id (مزامنة الاحتياجات عبر deviceTypes)',
        'DELETE /beneficiaries/needs/:needId',
        'POST /beneficiaries/:id/review',
        'POST /beneficiaries/bulk-review',
      ],
    };
  }
}
