import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateAbanmiAccountDto {
  @ValidateIf((dto: CreateAbanmiAccountDto) => dto.invite !== true)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  invite?: boolean;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}
