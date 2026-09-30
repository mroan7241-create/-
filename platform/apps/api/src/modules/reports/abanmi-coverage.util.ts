type CoveragePeriod = { from?: string; to?: string };

/** A period-filtered need total cannot be compared with the current device snapshot. */
export function abanmiCoverage(deliveredDevices: number, approvedNeeds: number, period: CoveragePeriod) {
  if (period.from || period.to) {
    return {
      coverage: null,
      label: 'غير قابلة للمقارنة خلال فترة محددة',
      methodology: 'الاحتياجات مصفّاة بتاريخ إنشائها، بينما الأجهزة المسلّمة لقطة حالية؛ لا تُحتسب نسبة التغطية عند تحديد فترة لعدم تطابق نطاق المقارنة.',
    };
  }

  const coverage = approvedNeeds > 0 ? Math.min(100, Math.round(deliveredDevices / approvedNeeds * 100)) : null;
  return {
    coverage,
    label: coverage === null ? 'غير متاحة' : `${coverage}%`,
    methodology: 'الأجهزة المسلّمة ÷ الاحتياجات المعتمدة؛ لا تقيس سرعة التنفيذ الزمنية',
  };
}
