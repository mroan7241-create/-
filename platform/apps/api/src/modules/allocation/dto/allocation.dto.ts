import { IsString, IsUUID } from 'class-validator';

/** طلب تشغيل المطابقة اليدوي. المحرك نفسه يبقى هو مصدر الحقيقة الوحيد. */
export class RunAllocationDto {
  @IsUUID()
  associationId!: string;

  @IsString()
  opId!: string;
}
