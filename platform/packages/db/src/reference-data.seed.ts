import type { PrismaClient, ReferenceValueType } from '../generated/client';
import {
  LEGACY_REGIONS_CITIES,
  LEGACY_DEVICE_TYPES,
  LEGACY_SOCIAL_STATUSES,
  LEGACY_ASSOCIATION_CATEGORIES,
  LEGACY_ASSOCIATION_SECTORS,
  LEGACY_DEVICE_SPECS,
  LEGACY_DIFFERENCE_REASONS,
  LEGACY_RECEIVER_TITLES,
  LEGACY_SUPPLIERS,
} from '@alzad/shared';

/**
 * بذر idempotent لجدول reference_values — يطابق migrateReferenceData_
 * القديم في المنطق (لا يكرر أي (type, value, parent) موجود أصلًا، يُكمل
 * الترتيب الأعلى الموجود فعليًا لكل مجموعة، لا يحذف ولا يعدّل أي صف
 * قائم). آمن لإعادة التشغيل أي عدد من المرات.
 *
 * فرق تصميمي متعمَّد عن القديم: "يتبع" في الجدول القديم كان عمود نص حر
 * (اسم منطقة/نوع جهاز كنص)، بينما parentId هنا FK حقيقي (uuid) لصف
 * reference_values آخر (Domain Model علائقي — راجع DATA_MODEL.md). لذلك
 * الترتيب هنا مهم: REGION قبل CITY، وDEVICE_TYPE قبل DEVICE_SPEC، فكل
 * دفعة تُدرَج وتُقرأ معرّفاتها الفعلية قبل إدراج ما يعتمد عليها.
 */
export async function seedReferenceData(prisma: PrismaClient): Promise<{ inserted: number }> {
  let insertedTotal = 0;

  async function insertBatch(type: ReferenceValueType, items: { value: string; parentId: string | null }[]): Promise<void> {
    if (!items.length) return;
    const existing = await prisma.referenceValue.findMany({ where: { type }, select: { value: true, parentId: true, sortOrder: true } });
    const existingKeys = new Set(existing.map((r) => `${r.parentId ?? ''}|${r.value}`));
    let maxOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder), 0);

    const toCreate = items
      .filter((item) => !existingKeys.has(`${item.parentId ?? ''}|${item.value}`))
      .map((item) => ({ type, value: item.value, parentId: item.parentId, sortOrder: ++maxOrder }));

    if (toCreate.length) {
      await prisma.referenceValue.createMany({ data: toCreate });
      insertedTotal += toCreate.length;
    }
  }

  async function idsByValue(type: ReferenceValueType): Promise<Map<string, string>> {
    const rows = await prisma.referenceValue.findMany({ where: { type }, select: { id: true, value: true } });
    return new Map(rows.map((r) => [r.value, r.id]));
  }

  // 1) REGION (لا parent) — ثم إعادة قراءة المعرّفات الفعلية لاستخدامها في CITY.
  await insertBatch('REGION' as ReferenceValueType, Object.keys(LEGACY_REGIONS_CITIES).map((region) => ({ value: region, parentId: null })));
  const regionIds = await idsByValue('REGION' as ReferenceValueType);

  // 2) CITY (يتبع REGION الفعلي).
  const cityItems: { value: string; parentId: string | null }[] = [];
  Object.entries(LEGACY_REGIONS_CITIES).forEach(([region, cities]) => {
    const parentId = regionIds.get(region) ?? null;
    cities.forEach((city) => cityItems.push({ value: city, parentId }));
  });
  await insertBatch('CITY' as ReferenceValueType, cityItems);

  // 3) DEVICE_TYPE (كتالوج عرض تاريخي أوسع — لا parent) — ثم قراءة المعرّفات لاستخدامها في DEVICE_SPEC.
  await insertBatch('DEVICE_TYPE' as ReferenceValueType, LEGACY_DEVICE_TYPES.map((v) => ({ value: v, parentId: null })));
  const deviceTypeIds = await idsByValue('DEVICE_TYPE' as ReferenceValueType);

  // 4) DEVICE_SPEC (يتبع نوع جهاز من كتالوج DEVICE_TYPE أعلاه — الأنواع الثلاثة المعتمدة فقط: ثلاجة/فرن/غسالة).
  const specItems: { value: string; parentId: string | null }[] = [];
  Object.entries(LEGACY_DEVICE_SPECS).forEach(([deviceType, specs]) => {
    const parentId = deviceTypeIds.get(deviceType) ?? null;
    specs.forEach((spec) => specItems.push({ value: spec, parentId }));
  });
  await insertBatch('DEVICE_SPEC' as ReferenceValueType, specItems);

  // 5) بقية الأنواع المسطَّحة (لا parent لأي منها).
  await insertBatch('SOCIAL_STATUS' as ReferenceValueType, LEGACY_SOCIAL_STATUSES.map((v) => ({ value: v, parentId: null })));
  await insertBatch('ASSOCIATION_CATEGORY' as ReferenceValueType, LEGACY_ASSOCIATION_CATEGORIES.map((v) => ({ value: v, parentId: null })));
  await insertBatch('ASSOCIATION_SECTOR' as ReferenceValueType, LEGACY_ASSOCIATION_SECTORS.map((v) => ({ value: v, parentId: null })));
  await insertBatch('DIFFERENCE_REASON' as ReferenceValueType, LEGACY_DIFFERENCE_REASONS.map((v) => ({ value: v, parentId: null })));
  await insertBatch('RECEIVER_TITLE' as ReferenceValueType, LEGACY_RECEIVER_TITLES.map((v) => ({ value: v, parentId: null })));
  await insertBatch('SUPPLIER' as ReferenceValueType, LEGACY_SUPPLIERS.map((v) => ({ value: v, parentId: null })));

  return { inserted: insertedTotal };
}
