import { DeviceType } from '@alzad/db';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class SetCentralContractDto {
  @IsIn(Object.values(DeviceType)) deviceType!: DeviceType;
  @IsInt() @Min(0) @Max(2_147_483_647) contractedQty!: number;
  @IsString() opId!: string;
}

export class RecordCentralReceiptDto {
  @IsIn(Object.values(DeviceType)) deviceType!: DeviceType;
  @IsInt() @Min(1) @Max(2_147_483_647) quantity!: number;
  @IsString() @MaxLength(200) reference!: string;
  @IsString() opId!: string;
}
