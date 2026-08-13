import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReferenceValueType } from '@alzad/db';

const REFERENCE_VALUE_TYPES = Object.values(ReferenceValueType) as ReferenceValueType[];

/** يوازي addReferenceValue القديمة (ReferenceData.gs:616-668) — يضيف قيمة واحدة لنوع موجود، لا يخترع نوعًا جديدًا. */
export class AddReferenceValueDto {
  @IsIn(REFERENCE_VALUE_TYPES)
  type!: ReferenceValueType;

  @IsString()
  @MaxLength(150)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  parentValue?: string;

  @IsString()
  opId!: string;
}
