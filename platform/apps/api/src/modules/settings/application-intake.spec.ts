import { applicationIntakeStatus, validateSetting, SettingsService } from './settings.service';
import { jest } from '@jest/globals';
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

describe('optional MAIN selection capacity', () => {
  it.each([undefined, null])('keeps capacity open for %s without inventing a number', async value => {
    const tx = { systemSetting: { findUnique: jest.fn(async () => value === undefined ? null : { value }) } };
    expect(await new SettingsService().selectionMainCapacity(tx as never)).toBeUndefined();
    expect(validateSync(plainToInstance(UpdateSettingDto, { key: 'selection.mainTargetCount', value: null }))).toHaveLength(0);
  });
  it('retains the approved numeric capacity', async () => {
    const tx = { systemSetting: { findUnique: jest.fn(async () => ({ value: 12 })) } };
    expect(await new SettingsService().selectionMainCapacity(tx as never)).toBe(12);
  });
  it.each([0, -1, 1.5, '12', true, {}, 1000001])('fails closed for malformed capacity %j', async value => {
    const tx = { systemSetting: { findUnique: jest.fn(async () => ({ value })) } };
    await expect(new SettingsService().selectionMainCapacity(tx as never)).rejects.toMatchObject({ code: 'SETTING_VALUE_INVALID' });
  });
});
