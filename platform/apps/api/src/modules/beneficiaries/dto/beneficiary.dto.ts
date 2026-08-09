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

  @IsString()
  @MaxLength(250)
  address!: string;

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
  @MaxLength(200)
  landmark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

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
