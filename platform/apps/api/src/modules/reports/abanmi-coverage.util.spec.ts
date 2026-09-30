import { abanmiCoverage } from './abanmi-coverage.util';

describe('ABANMI export coverage comparison', () => {
  it.each([
    { from: '2026-09-01' },
    { to: '2026-09-30' },
    { from: '2026-09-01', to: '2026-09-30' },
  ])('suppresses coverage for a bounded period: %j', (period) => {
    const result = abanmiCoverage(80, 10, period);
    expect(result.coverage).toBeNull();
    expect(result.label).toBe('غير قابلة للمقارنة خلال فترة محددة');
    expect(result.methodology).toContain('الاحتياجات مصفّاة بتاريخ إنشائها');
    expect(result.methodology).toContain('الأجهزة المسلّمة لقطة حالية');
  });

  it('preserves the unfiltered coverage percentage and its upper limit', () => {
    expect(abanmiCoverage(2, 3, {})).toMatchObject({ coverage: 67, label: '67%' });
    expect(abanmiCoverage(8, 3, {})).toMatchObject({ coverage: 100, label: '100%' });
    expect(abanmiCoverage(0, 3, { from: '', to: '' })).toMatchObject({ coverage: 0, label: '0%' });
  });

  it('does not fabricate coverage with no approved needs', () => {
    expect(abanmiCoverage(8, 0, {})).toMatchObject({ coverage: null, label: 'غير متاحة' });
    expect(abanmiCoverage(8, 0, { from: '2026-09-01' })).toMatchObject({
      coverage: null, label: 'غير قابلة للمقارنة خلال فترة محددة',
    });
  });
});
