import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { BeneficiaryListType } from '@alzad/db';
export class SetBeneficiaryListDto {
  @IsIn([BeneficiaryListType.MAIN, BeneficiaryListType.RESERVE, BeneficiaryListType.REJECTED]) listType!: BeneficiaryListType;
  @IsOptional() @IsInt() @Min(1) listRank?: number;
  @IsString() reason!: string; @IsString() opId!: string;
}
export class PromoteReserveDto { @IsOptional() @IsInt() @Min(1) listRank?: number; @IsString() reason!: string; @IsString() opId!: string; }
export class ReplaceBeneficiaryDto { @IsUUID() newBeneficiaryId!: string; @IsUUID() escalationCaseId!: string; @IsString() reason!: string; @IsString() opId!: string; }
