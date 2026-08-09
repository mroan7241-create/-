import { ApiError } from './api-error';

/** يطابق paginate_ القديم — pageSize محصور [1,100]، افتراضي 25. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * NODE-2.2 — حدّ تشغيلي أعلى لرقم الصفحة.
 *
 * ليس ادّعاءً بأن عمق الترقيم الحقيقي قد يبلغ 100,000 صفحة يومًا ما —
 * بل حاجز ضد حساب `skip` غير محدود/منحلّ: `skip = (page - 1) * pageSize`.
 * بدون حدّ أعلى، `page=1e308` يجتاز `@IsInt`/`@Min(1)` ثم ينتج `skip`
 * لانهائيًا أو أكبر من `Number.MAX_SAFE_INTEGER`، فيصل خامًا إلى Prisma
 * ويظهر كـ500 مع احتمال تسريب تفاصيل Prisma/Postgres، بدلًا من 400 نظيف.
 *
 * القيمة محافِظة عمدًا: عند أقصى `pageSize` (100) تغطي 10,000,000 سجل،
 * أي أضعاف أي حجم بيانات متوقَّع، وتُبقي `skip` ضمن نطاق آمن تمامًا.
 */
export const MAX_PAGE = 100_000;

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * يرفض أي قيمة ليست عددًا صحيحًا آمنًا داخل [min,max].
 * لا قصّ صامت ولا قيمة افتراضية بديلة — المُدخَل الخاطئ يفشل بصوت عالٍ.
 */
function requireBoundedInt(value: number, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError('PAGINATION_OUT_OF_RANGE', `${field} يجب أن يكون عددًا صحيحًا بين ${min} و${max}`, 400);
  }
  return value;
}

/**
 * NODE-2.2 — تحصين دفاعي متعدد الطبقات.
 *
 * `PaginationQueryDto` يمنع المُدخَل الخاطئ عند حدود HTTP، لكن هذه الدالة
 * قابلة للاستدعاء داخليًا دون المرور بالـDTO. لذلك تتحقق بنفسها: أي
 * `page`/`pageSize` غير منتهٍ (NaN/Infinity) أو غير صحيح أو خارج الحدود
 * يُرمى كـApiError صريح (يتحوّل إلى 400 نظيف عبر HttpExceptionFilter)
 * بدلًا من قصّه بصمت إلى قيمة «تبدو سليمة» وإرجاع نتيجة خاطئة مقنعة.
 * القيم غير المُمرَّرة (undefined) تأخذ الافتراضيات — هذا ليس مُدخَلًا خاطئًا.
 */
export function normalizePagination(params: PaginationParams): { page: number; pageSize: number; skip: number; take: number } {
  const page = requireBoundedInt(params.page ?? 1, 1, MAX_PAGE, 'page');
  const pageSize = requireBoundedInt(params.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'pageSize');

  const skip = (page - 1) * pageSize;
  // حزام أمان أخير: مستحيل الوصول إليه بالحدود أعلاه، لكنه يضمن ألّا يصل
  // إلى Prisma أي skip غير آمن مهما تغيّرت الثوابت لاحقًا.
  if (!Number.isSafeInteger(skip)) {
    throw new ApiError('PAGINATION_OUT_OF_RANGE', 'معاملات الترقيم خارج النطاق المسموح', 400);
  }

  return { page, pageSize, skip, take: pageSize };
}

export function toPaginatedResult<T>(items: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
