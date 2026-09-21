import { IsDateString, IsObject, Matches } from 'class-validator';

export class ScheduleStep1CompletionDto {
  @Matches(/^[0-9a-f]{40}$/i)
  productionCommit!: string;

  @IsDateString()
  verificationCompletedAt!: string;

  @IsObject()
  evidence!: Record<string, unknown>;
}
