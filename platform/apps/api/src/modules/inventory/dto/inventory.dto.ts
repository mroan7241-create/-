import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DeviceStatus, DeviceType } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';

/** `GET /inventory/devices` — نطاق ADMIN مقابل ASSOCIATION يُحسم من AuthContext حصرًا داخل الخدمة، لا من associationId المُرسَل. */
export class ListDeviceUnitsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  associationId?: string;

  @IsOptional()
  @IsIn(Object.values(DeviceType))
  deviceType?: DeviceType;

  @IsOptional()
  @IsIn(Object.values(DeviceStatus))
  status?: DeviceStatus;
}

/**
 * `PATCH /inventory/devices/:id` — DEV-003..011 (نطاق مصغَّر متعمَّد، راجع
 * inventory.service.ts): تصحيح نوع/مواصفة جهاز لا يزال بالمستودع فقط —
 * لا مساس بجهاز مرتبط بتخصيص/عهدة مندوب/تسليم (تلك حصرًا NODE-5/6).
 */
export class UpdateDeviceUnitDto {
  @IsOptional()
  @IsIn(Object.values(DeviceType))
  deviceType?: DeviceType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  spec?: string;

  @IsString()
  opId!: string;
}

export class MarkDeviceDamagedDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsString()
  opId!: string;
}
