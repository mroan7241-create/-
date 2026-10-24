import { normalizeSaudiPhone } from './phone.util';

describe('Saudi phone normalization', () => {
  it.each(['0501234567', '501234567', '+966501234567', '966501234567', '٠٥٠١٢٣٤٥٦٧', '+٩٦٦٥٠١٢٣٤٥٦٧', '۰۵۰۱۲۳۴۵۶۷'])('preserves the same identity for %s', phone => {
    expect(normalizeSaudiPhone(phone)).toBe('0501234567');
  });
  it.each(['', '٠١٢٣', '0601234567', '+15501234567'])('rejects malformed phone %s', phone => {
    expect(() => normalizeSaudiPhone(phone)).toThrow('رقم الجوال غير صحيح');
  });
});
