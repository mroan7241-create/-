import { prisma, ReferenceValueType } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { requiredText } from '../../common/validation/text.util';

/**
 * `ReferenceData.gs::validateSocialStatus_` — الحالة الاجتماعية إلزامية،
 * ويجب أن تكون قيمة نشطة في `SOCIAL_STATUS`، مع نفس grandfathering
 * القديم (`isGrandfatheredValue_` = القيمة المخزَّنة نفسها تُقبَل حتى لو
 * لم تعد ضمن القائمة المعتمدة؛ أي قيمة **مختلفة** يجب أن تكون معتمدة).
 *
 * `previous` تُمرَّر فقط في مسار التعديل (القيمة المخزَّنة للسجل)، وتبقى
 * فارغة عند الإنشاء تمامًا كما في Legacy.
 */
export async function validateSocialStatus(value: unknown, previous?: string): Promise<string> {
  const cleaned = requiredText(value, 'الحالة الاجتماعية', 80);

  const row = await prisma.referenceValue.findFirst({
    where: { type: ReferenceValueType.SOCIAL_STATUS, value: cleaned, active: true },
  });
  if (row) return cleaned;

  // grandfathering: نفس القيمة المخزَّنة حرفيًا تُقبَل كما هي.
  if (previous && cleaned === previous) return cleaned;

  throw new ApiError('BENEFICIARY_INVALID_REFERENCE', `الحالة الاجتماعية "${cleaned}" غير معروفة. اختر من القائمة المعتمدة`, 400);
}
