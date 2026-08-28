import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { AgreementStatus, CoordinatorChangeStatus } from '@alzad/db';
export class CreateAgreementDto {
  @IsInt() @Min(1) version!: number;
  @IsString() templateVersion!: string;
  @IsOptional() @IsUUID() fileId?: string;
  @IsOptional() @IsString() reference?: string;
}
export class AgreementTransitionDto {
  @IsIn([AgreementStatus.SENT, AgreementStatus.SIGNED_BY_ORG, AgreementStatus.SIGNED, AgreementStatus.CANCELLED, AgreementStatus.SUPERSEDED]) status!: AgreementStatus;
  @IsOptional() @IsString() signerName?: string;
  @IsString() opId!: string;
}
export class OperationDto { @IsString() opId!: string; }
export class CoordinatorChangeDto {
  @IsString() proposedName!: string; @IsString() proposedPhone!: string;
  @IsOptional() @IsString() proposedEmail?: string; @IsOptional() @IsString() proposedTitle?: string;
  @IsString() reason!: string; @IsString() opId!: string;
}
export class CoordinatorDecisionDto {
  @IsIn([CoordinatorChangeStatus.APPROVED, CoordinatorChangeStatus.REJECTED]) decision!: CoordinatorChangeStatus;
  @IsOptional() @IsString() notes?: string; @IsString() opId!: string;
}
