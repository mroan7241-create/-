import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, IsUrl, Max, MaxLength, Min } from 'class-validator';

const ACTIVITY_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'LATE', 'COMPLETED'] as const;

/** يوازي saveActivity القديمة — يُطابَق بـid عند التعديل (PK حقيقي الآن، لا حاجة لمفتاح مركَّب كما في Legacy). */
export class SaveActivityDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsInt()
  @Min(1)
  phaseOrder!: number;

  @IsString()
  @MaxLength(150)
  phaseName!: string;

  @IsInt()
  @Min(1)
  mainActivityOrder!: number;

  @IsString()
  @MaxLength(150)
  mainActivityName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  subActivityName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  responsible?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  completionPercent?: number;

  @IsIn(ACTIVITY_STATUSES)
  status!: (typeof ACTIVITY_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** يوازي "رابط الشاهد" (evidenceUrl) القديمة حرفيًا — رابط نصي، لا رفع ملف. */
  @IsOptional()
  @IsUrl({}, { message: 'رابط الشاهد يجب أن يكون رابطًا صالحًا' })
  @MaxLength(2000)
  evidenceUrl?: string;
}
