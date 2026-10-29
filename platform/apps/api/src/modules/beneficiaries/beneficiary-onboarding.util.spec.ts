import { validateNeedPriority, validateThreeDeviceReason } from './beneficiary-onboarding.util';

describe('beneficiary need priority and three-device rule', () => {
  it.each([undefined, null, 0, -1, 51, 1.5, NaN])('rejects invalid priority %s', value => {
    expect(() => validateNeedPriority(value)).toThrow('ترتيب الحاجة');
  });
  it.each([1, 50])('accepts priority boundary %s', value => expect(validateNeedPriority(value)).toBe(value));
  it.each(['', '   ', '...', '\u200b'])('rejects non-explanations for three devices', reason => expect(() => validateThreeDeviceReason(3, reason)).toThrow('مبرر'));
  it('accepts one or two needs without a reason, and preserves an explanation', () => {
    expect(validateThreeDeviceReason(1, '')).toBeNull();
    expect(validateThreeDeviceReason(2, undefined)).toBeNull();
    expect(validateThreeDeviceReason(3, '  جميع الأجهزة مفقودة  ')).toBe('جميع الأجهزة مفقودة');
  });
});
