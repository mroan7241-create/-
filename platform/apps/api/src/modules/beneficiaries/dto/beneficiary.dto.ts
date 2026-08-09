import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BeneficiaryReviewStatus, DeviceType } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';
import { BENEFICIARY_SORT_FIELDS, type BeneficiarySortField } from '../beneficiary-sort.util';

const DEVICE_TYPE_VALUES = Object.values(DeviceType);

/**
 * NODE-3 — معاملات `GET /beneficiaries` بتحقق زمن تشغيل حقيقي (نفس نمط
 * NODE-2.1/2.2): كل قيمة enum عبر `@IsIn`، والترقيم يرث حدود
 * `PaginationQueryDto` (بما فيها سقف `MAX_PAGE` من NODE-2.2).
 *
 * `associationId` هنا **مُصفّي عرض لِADMIN فقط**. فاعل ASSOCIATION لا
 * يستطيع استخدامه لرؤية جمعية أخرى إطلاقًا: الخدمة تتجاهله كليًا وتفرض
 * `ctx.associationId` من الجلسة (راجع `resolveTenantScope`) — التحقق
 * خادمي، لا يعتمد على الواجهة.
 */
export class ListBeneficiariesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  associationId?: string;

  @IsOptional()
  @IsIn(Object.values(BeneficiaryReviewStatus))
  reviewStatus?: BeneficiaryReviewStatus;

  @IsOptional()
  @IsIn(BENEFICIARY_SORT_FIELDS)
  sortBy?: BeneficiarySortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  /**
   * NODE-3.1 — مُصفّي "تأكيد الموقع" المشتق، مطابقًا لِ
   * `Validation.gs::beneficiaryLocationConfirmed_` حرفيًا: الحالة **لا
   * تُخزَّن كعمود**، بل تُستنتج من وجود الإحداثيتين معًا.
   *  - `PENDING`  = "بانتظار تحديد الموقع" (`!locationConfirmed`) —
   *    `Beneficiaries.gs::listBeneficiaries_` سطر 37-38.
   *  - `CONFIRMED` = "موقع مؤكد".
   *
   * مُصفّي "جاهز للإحالة" القديم **غير مُنفَّذ عمدًا** هنا: شرطه في Legacy
   * (سطر 45) يجمع `locationConfirmed` مع `حالة التسليم = 'لم يبدأ'` ومع
   * وجود جهاز "مخصص" فعليًا — وكلاهما بيانات مخزون/تسليم لم تُهاجَر بعد
   * (NODE-4/NODE-6). راجع BENEFICIARIES.md.
   */
  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED'])
  locationStatus?: 'PENDING' | 'CONFIRMED';
}

/** حقول المستفيد المشتركة بين الإنشاء والتعديل — مطابقة لِ`buildBeneficiaryFieldValues_`. */
class BeneficiaryFieldsDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(80)
  region!: string;

  @IsString()
  @MaxLength(80)
  city!: string;

  @IsString()
  @MaxLength(120)
  district!: string;

  // NODE-3.1 — `address` و`landmark` **ليسا حقلَي إدخال بعد الآن**
  // (قرار مستخدم صريح، وهو انحراف مقصود عن Legacy الذي كان يقبلهما حيَّين
  // في `buildBeneficiaryFieldValues_`). العمودان باقيان في القاعدة
  // للقراءة التاريخية فقط، ولا يُكتَب إليهما من أي مسار REST. حذفهما من
  // هنا يعني أن إرسالهما في الجسم يُرفض بـ400 عبر
  // `ValidationPipe({whitelist:true, forbidNonWhitelisted:true})` العام.
  // راجع docs/BENEFICIARIES.md.

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  phone2?: string;

  @IsInt()
  familyCount!: number;

  @IsOptional()
  @IsBoolean()
  socialSecurity?: boolean;

  @IsString()
  @MaxLength(80)
  socialStatus!: string;

  @IsOptional()
  @IsNumber()
  income?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * NODE-3.1 — إحداثيات اختيارية بالكامل، مطابقة لِ
   * `Validation.gs::optionalCoordinate_`:
   *  - غيابهما معًا (`undefined`) ⇒ **لا يُمسّ الموقع المخزَّن إطلاقًا**.
   *  - `null` لكليهما معًا ⇒ مسح الموقع (زر "✕ مسح الموقع" في
   *    `Index.html::clearLocationFields`).
   *  - قيمة واحدة دون الأخرى ⇒ 400 صريح (both-or-neither).
   *  - المدى: خط العرض [-90, 90]، خط الطول [-180, 180].
   *
   * `@IsOptional()` في class-validator يتخطّى التحقق لِ`null` و`undefined`
   * معًا، فيمرّ المسح الصريح بلا خطأ ويُفرَّق بينهما في الخدمة.
   */
  @IsOptional()
  @IsNumber()
  lat?: number | null;

  @IsOptional()
  @IsNumber()
  lng?: number | null;

  /**
   * وصفي بحت. Legacy (`validateLocationSource_`) **متساهل عمدًا**: قيمة
   * غير معروفة تُصحَّح إلى "يدوي" بدل رفض الطلب، ولذلك لا `@IsIn` هنا —
   * التصحيح يتم في الخدمة بنفس السلوك حرفيًا.
   */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  locationSource?: string;

  @IsString()
  @MaxLength(120)
  opId!: string;
}

export class CreateBeneficiaryDto extends BeneficiaryFieldsDto {
  /** ADMIN فقط — يُتجاهَل تمامًا لفاعل ASSOCIATION (جمعيته من الجلسة حصرًا). */
  @IsOptional()
  @IsUUID()
  associationId?: string;

  /** إلزامي عند الإنشاء: لا مستفيد بلا احتياج واحد صالح على الأقل. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(3)
  @IsIn(DEVICE_TYPE_VALUES, { each: true })
  deviceTypes!: DeviceType[];
}

export class UpdateBeneficiaryDto extends BeneficiaryFieldsDto {
  @IsOptional()
  @IsUUID()
  associationId?: string;

  /**
   * غائبة تمامًا ⇒ لا تُمسّ قائمة الاحتياجات إطلاقًا.
   * مُرسَلة ⇒ قائمة نهائية كاملة (وفارغة صراحةً مرفوضة دائمًا).
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(DEVICE_TYPE_VALUES, { each: true })
  deviceTypes?: DeviceType[];
}

export class NeedDecisionDto {
  @IsUUID()
  needId!: string;

  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  /** اختياري دائمًا — لا يُرفض القرار لغيابه (Phase 3.1 القسم 0). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectReason?: string;
}

export class ReviewBeneficiaryDto {
  @IsIn(['APPROVED', 'REJECTED'])
  beneficiaryDecision!: 'APPROVED' | 'REJECTED';

  /** إلزامي فعليًا عند الرفض — الإلزام مفروض في الخدمة برسالة عربية واضحة. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  beneficiaryRejectReason?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NeedDecisionDto)
  needDecisions?: NeedDecisionDto[];

  @IsString()
  @MaxLength(120)
  opId!: string;
}

export class BulkReviewItemDto extends ReviewBeneficiaryDto {
  @IsUUID()
  beneficiaryId!: string;
}

export class BulkReviewDto {
  /**
   * سقف 100 عنصر لكل دفعة — نفس `MAX_PAGE_SIZE` القائم. الدفعة تُنفَّذ
   * عنصرًا عنصرًا بمعاملة مستقلة لكل واحد، فالسقف يمنع طلبًا واحدًا يحتجز
   * الاتصال لزمن غير محدود، لا أكثر.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkReviewItemDto)
  items!: BulkReviewItemDto[];
}

export class RemoveNeedDto {
  @IsString()
  @MaxLength(120)
  opId!: string;
}
