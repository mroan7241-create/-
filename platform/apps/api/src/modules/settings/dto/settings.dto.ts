import { IsIn, IsNotEmpty, ValidateIf } from 'class-validator';
import { SETTING_KEYS, type SettingKey } from '../settings.service';
export class UpdateSettingDto {
  @IsIn(SETTING_KEYS) key!: SettingKey;
  @ValidateIf((input: UpdateSettingDto) => input.key !== 'application.intakeClosesAt')
  @IsNotEmpty() value!: unknown;
}
