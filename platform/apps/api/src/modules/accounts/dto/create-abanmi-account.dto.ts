import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAbanmiAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}
