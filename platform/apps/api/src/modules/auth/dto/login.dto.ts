import { IsIn, IsString, ValidateIf } from 'class-validator';

export class LoginDto {
  @IsIn(['user', 'delegate'])
  type!: 'user' | 'delegate';

  @ValidateIf((dto: LoginDto) => dto.type === 'user')
  @IsString()
  email?: string;

  @ValidateIf((dto: LoginDto) => dto.type === 'user')
  @IsString()
  password?: string;

  @ValidateIf((dto: LoginDto) => dto.type === 'delegate')
  @IsString()
  code?: string;
}
