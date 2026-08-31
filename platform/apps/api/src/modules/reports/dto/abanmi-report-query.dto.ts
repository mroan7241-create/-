import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AbanmiReportQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() associationId?: string;
  @IsOptional() @IsString() @MaxLength(120) region?: string;
}
