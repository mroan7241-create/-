import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DeliveryFailureReason, DeliveryStatus } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';

/** يوازي assignDelegate القديمة — يشترط اكتمال كل احتياجات المستفيد المعتمدة (NODE-5) أولًا. */
export class AssignDelegateDto {
  @IsUUID()
  beneficiaryId!: string;

  @IsUUID()
  delegateId!: string;

  @IsString()
  opId!: string;
}

export class ConfirmHandoverDto {
  @IsString()
  opId!: string;
}

export class ConfirmDeliveryDto {
  @IsString()
  opId!: string;
}

/** يوازي updateDeliveryStatus (تسجيل فشل التسليم) القديمة — نفس ست الأسباب المغلَقة حرفيًا. */
export class FailDeliveryDto {
  @IsIn(Object.values(DeliveryFailureReason))
  failureReason!: DeliveryFailureReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsString()
  opId!: string;
}

export class RetryDeliveryDto {
  @IsString()
  opId!: string;
}

/**
 * تخلٍّ نهائي عن مهمة تسليم — يوازي الانتقال القديم "خرج مع المندوب" →
 * "بانتظار تأكيد الإرجاع" → "أعيد للجمعية/المستودع" (STATE_MAPPING.md)،
 * مُبسَّطًا لخطوة ذرّية واحدة (معاملة DB حقيقية تُغني عن تأكيد بشري
 * من مرحلتين كان يعوّض غياب الذرّية في Sheets — rule B). خلافًا لـ
 * "تعذّر" (يبقي الجهاز مع المندوب لإعادة محاولة)، هذا يُعيد الجهاز
 * فعليًا للمستودع ويُعيد الاحتياج لبداية طابور التخصيص.
 */
export class ReturnDeliveryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsString()
  opId!: string;
}

export class ListDeliveriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  associationId?: string;

  @IsOptional()
  @IsUUID()
  delegateId?: string;

  @IsOptional()
  @IsUUID()
  beneficiaryId?: string;

  @IsOptional()
  @IsIn(Object.values(DeliveryStatus))
  status?: DeliveryStatus;
}
