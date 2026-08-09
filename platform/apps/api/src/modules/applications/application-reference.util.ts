import { prisma, ReferenceValueType } from '@alzad/db';
import { ApiError } from '../../common/api-error';

/** ReferenceData.gs → REFERENCE_LEGACY_CATEGORY_SYNONYMS */
const CATEGORY_SYNONYMS: Record<string, string> = { بر: 'جمعية بر' };

function invalidReference(message: string): ApiError {
  return new ApiError('APPLICATION_INVALID_REFERENCE', message, 400);
}

/**
 * region/city يجب أن يكونا قيمتين نشطتين في reference_values مع علاقة
 * أب/ابن صحيحة — يطابق validateRegionCity_ القديم (submitAssociationApplication_
 * لا يمرّر previous أبدًا؛ لا grandfathering لطلب جديد).
 */
export async function validateRegionCity(regionRaw: string, cityRaw: string): Promise<{ region: string; city: string }> {
  const region = String(regionRaw ?? '').trim();
  const city = String(cityRaw ?? '').trim();
  if (!region) throw invalidReference('المنطقة مطلوبة');
  if (!city) throw invalidReference('المدينة مطلوبة');

  const regionRow = await prisma.referenceValue.findFirst({
    where: { type: ReferenceValueType.REGION, value: region, active: true, parentId: null },
  });
  if (!regionRow) throw invalidReference('المنطقة المُختارة غير معروفة');

  const cityRow = await prisma.referenceValue.findFirst({
    where: { type: ReferenceValueType.CITY, value: city, active: true, parentId: regionRow.id },
  });
  if (!cityRow) throw invalidReference('المدينة المُختارة لا تتبع المنطقة المُحدَّدة');

  return { region, city };
}

/**
 * تطبيع اسم التصنيف التاريخي إلى اسمه الرسمي ("بر" → "جمعية بر") بلا أي
 * تحقق — يطابق سطر `REFERENCE_LEGACY_CATEGORY_SYNONYMS[value] || value`
 * في validateAssociationCategory_ القديمة. مُصدَّر لأن مسار
 * grandfathering في تعديل الجمعية (NODE-2.1) يحتاج القيمة الرسمية نفسها
 * التي كانت Legacy تُعيدها حتى في فرع القيمة التاريخية المقبولة.
 */
export function canonicalizeAssociationCategory(categoryRaw?: string): string {
  const raw = String(categoryRaw ?? '').trim();
  if (!raw) return '';
  return CATEGORY_SYNONYMS[raw] ?? raw;
}

/** category اختياري — إن أُرسل يجب أن يكون قيمة نشطة (بعد تطبيق مرادفات Legacy) في ASSOCIATION_CATEGORY. */
export async function validateAssociationCategory(categoryRaw?: string): Promise<string | undefined> {
  const raw = String(categoryRaw ?? '').trim();
  if (!raw) return undefined;
  const canonical = CATEGORY_SYNONYMS[raw] ?? raw;
  const row = await prisma.referenceValue.findFirst({
    where: { type: ReferenceValueType.ASSOCIATION_CATEGORY, value: canonical, active: true },
  });
  if (!row) throw invalidReference('تصنيف الجمعية غير معروف');
  return canonical;
}

/** sector إلزامي — يجب أن يكون قيمة نشطة في ASSOCIATION_SECTOR. */
export async function validateAssociationSector(sectorRaw: string): Promise<string> {
  const raw = String(sectorRaw ?? '').trim();
  if (!raw) throw invalidReference('مجال عمل الجمعية مطلوب');
  const row = await prisma.referenceValue.findFirst({
    where: { type: ReferenceValueType.ASSOCIATION_SECTOR, value: raw, active: true },
  });
  if (!row) throw invalidReference('مجال عمل الجمعية غير معروف');
  return raw;
}
