import { IsIn, IsOptional, IsUUID } from 'class-validator';
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
