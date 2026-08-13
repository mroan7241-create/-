import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';

/** يوازي listAuditLog القديمة (NORM-008) — بحث/تصفية بالقسم (entityType) وسجل واحد (entityId). */
export class ListAuditLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  associationId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}
