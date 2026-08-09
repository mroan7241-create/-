import type { Prisma } from '@alzad/db';

/**
 * NODE-2.1 — ترتيب قائمة الجمعيات (parity حقيقي مع Legacy).
 *
 * المصدر السلوكي المُتحقَّق منه في الفرع القديم:
 *  - `DevicesAssociations.gs::listAssociations_` يستدعي فعلًا
 *    `applySort_(items, options.sortBy, options.sortDir)` — أي أن الترتيب
 *    ميزة خادمية حقيقية لا زخرفة واجهة.
 *  - `Index.html::renderAssociations` يمرّر
 *    `sortFields: [['name','الاسم'], ['city','المدينة'], ['progress','نسبة الإنجاز']]`
 *    إلى `toolbar` → `sortSelect` فيُرسم `<select data-act="set-sort">`
 *    حقيقي، و`lazyFetchOptions` يمرّر `sortBy/sortDir` إلى الخادم.
 *  - `Pagination.gs::applySort_` يقبل `sortDir === 'desc'` وإلا تصاعدي.
 *
 * القائمة البيضاء هنا = حقلا Legacy القابلان للترتيب والمتاحان فعلًا في
 * نموذج البيانات الحالي. `progress` (نسبة الأجهزة المسلَّمة) مؤجَّل عمدًا:
 * يُحتسب في Legacy من جدول الأجهزة، وهو نطاق لم يُهاجَر بعد (كل عدّادات
 * الأجهزة تساوي صفرًا اليوم) — ترتيب بحقل صفري دائمًا سيكون ميزة وهمية.
 * موثَّق في ASSOCIATIONS.md.
 *
 * أي قيمة خارج هذه القائمة تُرفض بـ400 من ValidationPipe عبر `@IsIn` —
 * لا يُبنى أي مرجع عمود من نص العميل إطلاقًا.
 */
export const ASSOCIATION_SORT_FIELDS = ['name', 'city'] as const;

export type AssociationSortField = (typeof ASSOCIATION_SORT_FIELDS)[number];

/** الترتيب الافتراضي عند غياب sortBy — يطابق سلوك NODE-2 القائم (name تصاعديًا). */
export function associationOrderBy(
  sortBy: AssociationSortField | undefined,
  sortDir: 'asc' | 'desc' | undefined,
): Prisma.AssociationOrderByWithRelationInput {
  if (!sortBy) return { name: 'asc' };
  const direction: Prisma.SortOrder = sortDir === 'desc' ? 'desc' : 'asc';
  // مفتاح مأخوذ حصرًا من ASSOCIATION_SORT_FIELDS بعد تحقق @IsIn — لا نص عميل خام.
  return sortBy === 'city' ? { city: direction } : { name: direction };
}
