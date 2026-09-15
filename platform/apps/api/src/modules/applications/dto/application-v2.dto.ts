import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { AssociationSelectionList, ApplicationInformationItemType } from '@alzad/db';

export class CreateApplicationDraftDto {
  @IsOptional() @IsString() clientRequestId?: string;
  @IsOptional() @IsString() website?: string;
}

export class SaveApplicationDraftDto {
  @IsInt() @Min(0) revision!: number;
  @IsObject() payload!: Record<string, unknown>;
}

export class SubmitApplicationDraftDto {
  @IsInt() @Min(0) revision!: number;
}

export class ApplicationAttachmentDto {
  @IsString() fieldKey!: string;
}

export class BulkStartProcessingDto {
  @IsArray() @IsString({ each: true }) applicationIds!: string[];
  @IsString() opId!: string;
}

export class InformationRequestItemDto {
  @IsIn(Object.values(ApplicationInformationItemType)) type!: ApplicationInformationItemType;
  @IsString() key!: string;
  @IsString() reason!: string;
}

export class CreateInformationRequestDto {
  @IsArray() items!: InformationRequestItemDto[];
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() deadline?: string;
  @IsString() opId!: string;
}

export class SubmitInformationResponseDto {
  @IsObject() payload!: Record<string, unknown>;
  @IsString() opId!: string;
}

export class EvaluationV2Dto {
  @IsInt() @Min(1) @Max(5) operationalReadiness!: number;
  @IsInt() @Min(1) @Max(5) technicalCapability!: number;
  @IsInt() @Min(1) @Max(5) previousExperience!: number;
  @IsInt() @Min(1) @Max(5) integrityTransparency!: number;
  @IsInt() @Min(1) @Max(5) participationCommitment!: number;
  @IsInt() @Min(1) @Max(5) sustainabilityImpact!: number;
  @IsOptional() @IsString() overrideReason?: string;
  @IsString() opId!: string;
}

export class SelectionDecisionDto {
  @IsIn([AssociationSelectionList.MAIN, AssociationSelectionList.RESERVE]) decision!: AssociationSelectionList;
  @IsOptional() @IsString() reason?: string;
  @IsString() opId!: string;
}
