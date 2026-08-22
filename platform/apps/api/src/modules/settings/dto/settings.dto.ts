import { IsIn, IsNotEmpty } from 'class-validator';
import { SETTING_KEYS, type SettingKey } from '../settings.service';
export class UpdateSettingDto {
  @IsIn(SETTING_KEYS) key!: SettingKey;
  @IsNotEmpty() value!: unknown;
}
