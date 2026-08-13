import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { AccountStatus } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';

/** إنشاء/تعديل مندوب — يوازي saveDelegate القديمة (Delegates.gs). */
export class SaveDelegateDto {
  @IsString()
  name!: string;

  @IsString()
  phone!: string;

  /** إلزامي لـADMIN فقط (يختار الجمعية)؛ ASSOCIATION تُجبَر دائمًا على جمعيتها من الجلسة، أي قيمة هنا تُتجاهَل لها. */
  @IsOptional()
  @IsUUID()
  associationId?: string;

  @IsString()
  opId!: string;
}

export class UpdateDelegateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class SetDelegateStatusDto {
  @IsIn([AccountStatus.ACTIVE, AccountStatus.SUSPENDED])
  status!: typeof AccountStatus.ACTIVE | typeof AccountStatus.SUSPENDED;
}

export class ListDelegatesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  associationId?: string;

  @IsOptional()
  @IsIn(Object.values(AccountStatus))
  status?: AccountStatus;
}
