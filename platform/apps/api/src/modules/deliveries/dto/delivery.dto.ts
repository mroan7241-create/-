import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { DeliveryFailureReason, DeliveryStatus } from '@alzad/db';
import { DeliveryApprovalDecision, ReturnCondition } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';
import { MAX_PAGE, MAX_PAGE_SIZE } from '../../../common/pagination.util';

export class DelegatePortalQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  activePage?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  historyPage?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

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
  @IsIn(['true'])
  acknowledgement!: string;

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

export class ApproveDeliveryDto {
  @IsIn(Object.values(DeliveryApprovalDecision)) decision!: DeliveryApprovalDecision;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsString() opId!: string;
}
export class RescheduleDeliveryDto {
  @IsString() reason!: string; @IsString() scheduledFor!: string; @IsString() opId!: string;
}
export class ConfirmReturnDto {
  @IsIn(Object.values(ReturnCondition)) condition!: ReturnCondition;
  @IsString() @MaxLength(1000) notes!: string;
  @IsString() opId!: string;
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
