import { IsDateString, Matches } from 'class-validator';

export class AssociationReportQueryDto {
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}
