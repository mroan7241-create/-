import type { Prisma } from '@alzad/db';

/**
 * NODE-3 — ترتيب قائمة المستفيدين (parity حقيقي، لا ميزة مخترعة).
 *
 * المصدر السلوكي المُتحقَّق منه على الـbaseline القديم:
 *  - `Beneficiaries.gs::listBeneficiaries_` يستدعي فعلًا
 *    `applySort_(items, options.sortBy, options.sortDir)` — الترتيب ميزة
 *    خادمية حقيقية هنا (بخلاف `listApplications_` التي لا تستدعيها
 *    إطلاقًا، ولذلك لم يُضَف `sortBy` لطلبات الانضمام في NODE-2.1).
 *  - `Index.html::renderBeneficiaries` يمرّر
 *    `sortFields: [['name','الاسم'], ['city','المدينة'], ['createdAt','تاريخ الإضافة']]`
 *    فيُرسم `<select data-act="set-sort">` حقيقي يُرسل `sortBy/sortDir`.
 *  - `Pagination.gs::applySort_`: `sortDir === 'desc'` تنازلي، وإلا تصاعدي.
 *
 * القائمة البيضاء أدناه = حقول Legacy الثلاثة نفسها بلا زيادة ولا نقصان.
 * أي قيمة خارجها يرفضها `@IsIn` بـ400 قبل أي استعلام — لا يُبنى مرجع
 * عمود من نص عميل خام إطلاقًا.
 */
export const BENEFICIARY_SORT_FIELDS = ['name', 'city', 'createdAt'] as const;

export type BeneficiarySortField = (typeof BENEFICIARY_SORT_FIELDS)[number];

/**
 * الترتيب الافتراضي عند غياب `sortBy`: الأحدث أولًا.
 *
 * في Legacy، غياب `sortBy` يعني عدم استدعاء أي ترتيب فعلي فيبقى ترتيب
 * صفوف الورقة (ترتيب الإدراج = الأقدم أولًا). اعتُمد هنا `createdAt desc`
 * عمدًا لأن شاشة مراجعة الإدارة تحتاج الأحدث أولًا، ولأن ترتيب "صفوف
 * جدول" غير معرَّف أصلًا في PostgreSQL بلا `ORDER BY` — ترك الترتيب
 * للصدفة كان سيجعل الترقيم نفسه غير مستقر بين الصفحات (سجل يظهر مرتين
 * أو يختفي). موثَّق كانحراف مقصود في BENEFICIARIES.md.
 */
export function beneficiaryOrderBy(
  sortBy: BeneficiarySortField | undefined,
  sortDir: 'asc' | 'desc' | undefined,
): Prisma.BeneficiaryOrderByWithRelationInput[] {
  const direction: Prisma.SortOrder = sortDir === 'desc' ? 'desc' : 'asc';
  // مفتاح مأخوذ حصرًا من BENEFICIARY_SORT_FIELDS بعد تحقق @IsIn.
  // `id` مضاف دائمًا ككاسر تعادل حتمي — بدونه، صفوف متساوية في مفتاح
  // الترتيب (نفس المدينة مثلًا) قد ترتّب عشوائيًا بين استعلامَي صفحتين
  // متتاليتين فيتكرّر/يختفي سجل عبر حدود الصفحات.
  if (!sortBy) return [{ createdAt: 'desc' }, { id: 'desc' }];
  if (sortBy === 'city') return [{ city: direction }, { id: 'asc' }];
  if (sortBy === 'createdAt') return [{ createdAt: direction }, { id: direction }];
  return [{ name: direction }, { id: 'asc' }];
}
