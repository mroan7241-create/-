import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/validation/pagination-query.dto";
export class CountProposalQueryDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) total!: number;
  @IsUUID() associationId!: string;
}
export class WorkspaceQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() associationId?: string;
  @IsOptional() @IsString() @MaxLength(100) region?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional()
  @IsIn([
    "ALL",
    "REVIEW",
    "NEEDS",
    "APPROVED",
    "REJECTED",
    "INFORMATION",
    "REPLIED",
    "INCOMPLETE",
  ])
  bucket?: string;
  @IsOptional()
  @IsIn(["REFRIGERATOR", "OVEN", "WASHING_MACHINE"])
  deviceType?: string;
  @IsOptional() @IsIn(["1", "2", "3"]) requestedCount?: string;
  @IsOptional() @IsIn(["1", "2", "3"]) approvedCount?: string;
  @IsOptional() @IsIn(["true"]) topTen?: string;
  @IsOptional() @IsIn(["true"]) includeDemo?: string;
  @IsOptional()
  @IsIn([
    "PENDING",
    "APPROVED",
    "REJECTED",
    "ALLOCATED",
    "WITH_DELEGATE",
    "DELIVERED",
  ])
  needStatus?: string;
}
export class WorkspaceNeedDecisionDto {
  @IsUUID() needId!: string;
  @IsIn(["APPROVED", "REJECTED"]) decision!: "APPROVED" | "REJECTED";
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
export class WorkspaceDecisionDto {
  @IsString() @MaxLength(100) opId!: string;
  @IsISO8601() version!: string;
  @IsOptional() @IsIn(["APPROVED", "REJECTED"]) familyDecision?:
    | "APPROVED"
    | "REJECTED";
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WorkspaceNeedDecisionDto)
  needs!: WorkspaceNeedDecisionDto[];
}
export class WorkspaceReviewDto extends WorkspaceDecisionDto {
  /** Navigation is optional and never part of the saved decision/idempotency payload. */
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkspaceQueryDto)
  nextQuery?: WorkspaceQueryDto;
}
export class WorkspaceBulkItemDto extends WorkspaceDecisionDto {
  @IsUUID() id!: string;
}
export class WorkspaceBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WorkspaceBulkItemDto)
  items!: WorkspaceBulkItemDto[];
}
export class InformationTargetDto {
  @IsUUID() id!: string;
  @IsISO8601() version!: string;
}
export class InformationCreateDto {
  @IsString() @MaxLength(100) opId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InformationTargetDto)
  targets!: InformationTargetDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(9) items!: unknown[];
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsISO8601() dueAt?: string;
}
export class InformationReplyDto {
  @IsString() @MaxLength(100) opId!: string;
  @IsISO8601() version!: string;
  @IsObject() values!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class InformationResolveDto {
  @IsString() @MaxLength(100) opId!: string;
  @IsISO8601() version!: string;
  @IsBoolean() accept!: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class PlanningDto {
  @IsObject() limits!: Record<string, unknown>;
  @IsOptional() @IsString() version?: string;
  @IsOptional() @IsString() @MaxLength(100) opId?: string;
}
