import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from '../pagination.util';

/**
 * NODE-2.1 — تحقق **زمن تشغيل** حقيقي لمعاملات الترقيم، لا مجرد نوع
 * TypeScript. قبل هذا التصحيح كان الـcontroller يمرّر `Number(page)`
 * مباشرة: `page=abc` يصبح `NaN` فيُبتلع بصمت داخل `normalizePagination`
 * (Math.floor(NaN) → NaN → Math.max(1, NaN) → NaN) وينتهي إلى `skip: NaN`
 * الذي ترفضه Prisma بخطأ خام يظهر كـ500. الآن أي قيمة غير رقمية/سالبة/
 * صفرية/فوق الحد الأقصى تُرفض بـ400 نظيف عبر ValidationPipe العامة قبل
 * ملامسة أي استعلام.
 *
 * ملاحظة مقصودة: لا يُسكَت الخطأ ولا يُستبدَل بقيمة افتراضية صامتة —
 * المستدعي يجب أن يعرف أن معاملاته مرفوضة (راجع ASSOCIATIONS.md).
 */
export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt({ message: 'page يجب أن يكون عددًا صحيحًا موجبًا' })
  @Min(1, { message: 'page يجب أن يكون عددًا صحيحًا موجبًا' })
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt({ message: 'pageSize يجب أن يكون عددًا صحيحًا موجبًا' })
  @Min(1, { message: 'pageSize يجب أن يكون عددًا صحيحًا موجبًا' })
  @Max(MAX_PAGE_SIZE, { message: `pageSize يجب ألّا يتجاوز ${MAX_PAGE_SIZE}` })
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
}
