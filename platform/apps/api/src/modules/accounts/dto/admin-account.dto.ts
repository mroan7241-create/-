import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ADMIN_PERMISSION_CATALOG, type AdminPermission } from '@alzad/shared';

const keys = ADMIN_PERMISSION_CATALOG.map((item) => item.key);

export class CreateAdminAccountDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsEmail() @MaxLength(180)
  email!: string;

  @IsArray() @ArrayUnique() @ArrayMaxSize(keys.length) @IsIn(keys, { each: true })
  adminPermissions!: AdminPermission[];
}

export class UpdateAdminAccountDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(keys.length) @IsIn(keys, { each: true })
  adminPermissions?: AdminPermission[];
}

export class SetAdminAccountStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';
}
