import { IsIn, IsNotEmpty, ValidateIf } from 'class-validator';
import { SETTING_KEYS, type SettingKey } from '../settings.service';
export class UpdateSettingDto {
  @IsIn(SETTING_KEYS) key!: SettingKey;
  @ValidateIf((input: UpdateSettingDto) => !['application.intakeClosesAt', 'selection.mainTargetCount'].includes(input.key))
  @IsNotEmpty() value!: unknown;
}
