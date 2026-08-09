import { IsString, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsString()
  email!: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  email!: string;

  @IsString()
  code!: string;

  @IsString()
  @MinLength(1)
  newPassword!: string;
}
