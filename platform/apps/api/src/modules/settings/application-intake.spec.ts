import { applicationIntakeStatus, validateSetting } from './settings.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateSettingDto } from './dto/settings.dto';

describe('association application intake deadline', () => {
  const key = 'application.intakeClosesAt';
  it('remains open by default and accepts a precise UTC deadline', () => {
    expect(applicationIntakeStatus(undefined, new Date('2026-09-28T06:00:00.000Z')).open).toBe(true);
    expect(validateSetting(key, '2026-09-28T06:00:00.000Z')).toBe('2026-09-28T06:00:00.000Z');
    expect(applicationIntakeStatus('2026-09-28T06:00:00.000Z', new Date('2026-09-28T05:59:59.999Z')).open).toBe(true);
    expect(applicationIntakeStatus('2026-09-28T06:00:00.000Z', new Date('2026-09-28T06:00:00.000Z')).open).toBe(false);
  });
  it('rejects invalid dates and allows the administrator to reopen intake', () => {
    expect(() => validateSetting(key, '2026-02-30T06:00:00.000Z')).toThrow();
    expect(() => validateSetting(key, '2026-09-28T09:00:00+03:00')).toThrow();
    expect(validateSetting(key, null)).toBeNull();
    expect(validateSync(plainToInstance(UpdateSettingDto, { key, value: null }))).toHaveLength(0);
  });
});
