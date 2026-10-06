import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { EligibilityStatus } from '@alzad/db';

export class EligibilityDecisionDto {
  @IsIn([EligibilityStatus.PASSED, EligibilityStatus.FAILED, EligibilityStatus.NEEDS_INFO]) decision!: EligibilityStatus;
  @IsOptional() @IsString() notes?: string;
  @IsString() opId!: string;
}
export class EvaluationDto {
  @IsInt() @Min(1) @Max(5) operationalReadiness!: number;
  @IsInt() @Min(1) @Max(5) technicalCapability!: number;
  @IsInt() @Min(1) @Max(5) previousExperience!: number;
  @IsInt() @Min(1) @Max(5) integrityTransparency!: number;
  @IsInt() @Min(1) @Max(5) participationCommitment!: number;
  @IsInt() @Min(1) @Max(5) sustainabilityImpact!: number;
  @IsOptional() @IsString() overrideReason?: string;
  @IsString() opId!: string;
}
export class SelectionCommitDto {
  @IsIn([2]) workflowVersion!: 2;
  @IsIn(['SEND_MAIN', 'DECLINE']) operation!: 'SEND_MAIN' | 'DECLINE';
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(250) @ArrayUnique() @IsUUID('all', { each: true }) applicationIds!: string[];
  @IsOptional() @IsString() reason?: string;
  @IsString() opId!: string;
}
export class SelectionSendDto {
  @IsIn([2]) workflowVersion!: 2;
  @IsString() opId!: string;
}
