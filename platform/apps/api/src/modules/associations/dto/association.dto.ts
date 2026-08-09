import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateAssociationDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  region!: string;

  @IsString()
  city!: string;

  @IsString()
  phone!: string;

  @IsString()
  email!: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsString()
  temporaryPassword!: string;

  @IsString()
  opId!: string;
}

export class UpdateAssociationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class AssociationSelfSettingsDto {
  @IsString()
  phone!: string;

  @IsString()
  email!: string;
}
