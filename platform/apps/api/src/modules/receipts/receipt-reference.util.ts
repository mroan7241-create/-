import { prisma, ReferenceValueType } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { requiredText } from '../../common/validation/text.util';

function invalidReference(message: string): ApiError {
  return new ApiError('RECEIPT_INVALID_REFERENCE', message, 400);
}

/**
 * نمط `ReferenceData.gs` لأربعة أنواع مرجعية Phase 3.1 (مورد/مواصفة/سبب
 * فرق/صفة مستلم): **نص حر إن لم تُبذَر أي قيمة نشطة من هذا النوع بعد**،
 * وإلا يجب أن تكون القيمة ضمن القائمة النشطة — لا grandfathering هنا (لا
 * `previous` تُمرَّر في أيٍّ من الأربعة في القديم، خلافًا لِ`validateSupplier_`
 * التي تدعم `previous` نظريًا لكنها غير مستخدَمة في NODE-4 — كل بند/محضر
 * جديد هنا إنشاء لا تعديل قيمة تاريخية).
 */
async function validateFreeOrListed(value: unknown, label: string, max: number, type: ReferenceValueType): Promise<string> {
  const cleaned = requiredText(value, label, max);
  const anyActive = await prisma.referenceValue.findFirst({ where: { type, active: true } });
  if (!anyActive) return cleaned;
  const row = await prisma.referenceValue.findFirst({ where: { type, value: cleaned, active: true } });
  if (!row) throw invalidReference(`${label} "${cleaned}" غير معروف. اختر من القائمة المعتمدة`);
  return cleaned;
}

/** `validateSupplier_` — اسم مورد مرجعي فقط (بلا نظام مشتريات) — نص حر ما لم تُبذَر قائمة معتمدة. */
export function validateSupplier(value: unknown): Promise<string> {
  return validateFreeOrListed(value, 'اسم المورد', 150, ReferenceValueType.SUPPLIER);
}

/** `validateDeviceSpec_` — مواصفة تتبع نوعًا محدَّدًا؛ NODE-4 تبسّط الربط بـdeviceType دون فحص تبعية صارمة بعد (القائمة عامة عبر جميع الأنواع إن وُجدت). */
export function validateDeviceSpec(value: unknown): Promise<string> {
  return validateFreeOrListed(value, 'المواصفة', 120, ReferenceValueType.DEVICE_SPEC);
}

/** `validateDifferenceReason_` — سبب فرق كمية استلام؛ مطلوب فقط عند وجود فرق فعلي في بند المحضر. */
export function validateDifferenceReason(value: unknown): Promise<string> {
  return validateFreeOrListed(value, 'سبب الفرق', 150, ReferenceValueType.DIFFERENCE_REASON);
}

/** `validateReceiverTitle_` — صفة مستلم محضر الاستلام لدى الجمعية. */
export function validateReceiverTitle(value: unknown): Promise<string> {
  return validateFreeOrListed(value, 'صفة المستلم', 100, ReferenceValueType.RECEIVER_TITLE);
}
