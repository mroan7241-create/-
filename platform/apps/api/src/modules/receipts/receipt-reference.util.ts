import { prisma, DeviceType, ReferenceValueType } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { requiredText } from '../../common/validation/text.util';

function invalidReference(message: string): ApiError {
  return new ApiError('RECEIPT_INVALID_REFERENCE', message, 400);
}

/** `Config.gs` → NEW_NEED_DEVICE_TYPES — القيمة العربية التاريخية المقابلة لكل عضو من enum DeviceType الحالي (يُستخدَم فقط لإيجاد صف DEVICE_TYPE الأب في reference_values). */
const DEVICE_TYPE_LEGACY_VALUE: Record<DeviceType, string> = {
  REFRIGERATOR: 'ثلاجة',
  OVEN: 'فرن',
  WASHING_MACHINE: 'غسالة',
};

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

/**
 * `validateDeviceSpec_(deviceType, value, previous)` — مواصفة تتبع نوع
 * جهاز محدَّد (نفس مبدأ المدينة تتبع المنطقة): تُحلّ صف `DEVICE_TYPE` الأب
 * المطابق للنوع المُختار عبر `reference_values.parentId`، ثم يُقيَّد
 * البحث بأبناء `DEVICE_SPEC` **النشطين لهذا الأب فقط**. إن وُجدت قيم
 * نشطة لهذا النوع تحديدًا يجب أن تكون المواصفة إحداها (رفض صريح لمواصفة
 * نشطة تخص نوعًا آخر)؛ وإن لم توجد أي قائمة معتمدة لهذا النوع تحديدًا
 * (حتى لو وُجدت لأنواع أخرى)، يبقى السلوك الحرّ التاريخي كما في
 * Legacy — لا رفض بسبب قوائم أنواع أخرى.
 */
export async function validateDeviceSpec(value: unknown, deviceType: DeviceType): Promise<string> {
  const cleaned = requiredText(value, 'المواصفة', 120);

  const legacyTypeValue = DEVICE_TYPE_LEGACY_VALUE[deviceType];
  const parent = await prisma.referenceValue.findFirst({
    where: { type: ReferenceValueType.DEVICE_TYPE, value: legacyTypeValue, active: true },
  });
  if (!parent) return cleaned; // لا صف نوع أب مبذور أصلًا — نفس سقوط Legacy لِ«القوائم غير جاهزة».

  const activeSpecsForType = await prisma.referenceValue.findMany({
    where: { type: ReferenceValueType.DEVICE_SPEC, parentId: parent.id, active: true },
    select: { value: true },
  });
  if (activeSpecsForType.length === 0) return cleaned; // لا قائمة معتمدة لهذا النوع تحديدًا — نص حر.

  if (!activeSpecsForType.some((row) => row.value === cleaned)) {
    throw invalidReference(`المواصفة "${cleaned}" غير معروفة لنوع الجهاز المُختار. اختر من القائمة المعتمدة`);
  }
  return cleaned;
}

/** `validateDifferenceReason_` — سبب فرق كمية استلام؛ مطلوب فقط عند وجود فرق فعلي في بند المحضر. */
export function validateDifferenceReason(value: unknown): Promise<string> {
  return validateFreeOrListed(value, 'سبب الفرق', 150, ReferenceValueType.DIFFERENCE_REASON);
}

/** `validateReceiverTitle_` — صفة مستلم محضر الاستلام لدى الجمعية. */
export function validateReceiverTitle(value: unknown): Promise<string> {
  return validateFreeOrListed(value, 'صفة المستلم', 100, ReferenceValueType.RECEIVER_TITLE);
}
