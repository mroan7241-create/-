import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { EligibilityStatus } from '@alzad/db';

export class EligibilityDecisionDto {
  @IsIn([EligibilityStatus.PASSED, EligibilityStatus.FAILED, EligibilityStatus.NEEDS_INFO]) decision!: EligibilityStatus;
  @IsOptional() @IsString() notes?: string;
  @IsString() opId!: string;
}
export class EvaluationDto {
  @IsNumber() @Min(0) @Max(100) operationalReadiness!: number;
  @IsNumber() @Min(0) @Max(100) technicalCapability!: number;
  @IsNumber() @Min(0) @Max(100) previousExperience!: number;
  @IsNumber() @Min(0) @Max(100) integrityTransparency!: number;
  @IsNumber() @Min(0) @Max(100) participationCommitment!: number;
  @IsNumber() @Min(0) @Max(100) sustainabilityImpact!: number;
  @IsString() opId!: string;
}
export class SelectionCommitDto {
  @IsInt() @Min(1) mainTargetCount!: number;
  @IsString() opId!: string;
}
