export const BENEFICIARY_IMPORT_HEADER_LABELS = {
  name: 'الاسم',
  region: 'المنطقة',
  city: 'المدينة',
  district: 'الحي',
  phone: 'رقم الجوال',
  familyCount: 'عدد أفراد الأسرة',
  socialStatus: 'الحالة الاجتماعية',
  deviceTypes: 'الأجهزة المطلوبة',
  phone2: 'جوال إضافي',
  socialSecurity: 'الضمان الاجتماعي',
  income: 'الدخل',
  notes: 'ملاحظات',
  lat: 'خط العرض',
  lng: 'خط الطول',
  refrigerator: 'ثلاجة؟',
  oven: 'فرن؟',
  washingMachine: 'غسالة؟',
} as const;

export type BeneficiaryImportField = keyof typeof BENEFICIARY_IMPORT_HEADER_LABELS;

export const REQUIRED_BENEFICIARY_IMPORT_FIELDS: BeneficiaryImportField[] = [
  'name', 'region', 'city', 'district', 'phone', 'familyCount', 'socialStatus', 'deviceTypes',
];

export const ALL_BENEFICIARY_IMPORT_FIELDS: BeneficiaryImportField[] = [
  ...REQUIRED_BENEFICIARY_IMPORT_FIELDS, 'phone2', 'socialSecurity', 'income', 'notes', 'lat', 'lng',
];

const HEADER_TO_FIELD = new Map<string, BeneficiaryImportField>(
  (Object.keys(BENEFICIARY_IMPORT_HEADER_LABELS) as BeneficiaryImportField[]).flatMap((field) => [
    [field, field] as const,
    [BENEFICIARY_IMPORT_HEADER_LABELS[field], field] as const,
  ]),
);

export const DEVICE_IMPORT_FIELDS = ['refrigerator', 'oven', 'washingMachine'] as const;
export const SIMPLE_BENEFICIARY_IMPORT_FIELDS: BeneficiaryImportField[] = [
  ...REQUIRED_BENEFICIARY_IMPORT_FIELDS.filter(f => f !== 'deviceTypes'), ...DEVICE_IMPORT_FIELDS,
  'phone2', 'socialSecurity', 'income', 'notes', 'lat', 'lng',
];
export function missingBeneficiaryImportFields(headers: string[]): BeneficiaryImportField[] {
  return REQUIRED_BENEFICIARY_IMPORT_FIELDS.filter(f => !headers.includes(f) && !(f === 'deviceTypes' && DEVICE_IMPORT_FIELDS.every(d => headers.includes(d))));
}
export function normalizeImportDigits(value: string): string {
  return value.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0));
}
/** Old combined-device templates and new yes/no columns remain compatible. */
export function normalizeBeneficiaryImportRaw(raw: Record<string, string>): Record<string, string> {
  const result = { ...raw };
  for (const field of ['phone', 'phone2', 'familyCount', 'income', 'lat', 'lng']) if (result[field]) result[field] = normalizeImportDigits(result[field]);
  if (DEVICE_IMPORT_FIELDS.some(f => Object.hasOwn(raw, f))) {
    const names = ['ثلاجة', 'فرن', 'غسالة'];
    const selected = DEVICE_IMPORT_FIELDS.flatMap((field, i) => {
      const value = normalizeImportDigits(raw[field] ?? '').trim().toLowerCase();
      if (!value || ['لا', 'no', 'false', '0'].includes(value)) return [];
      if (['نعم', 'yes', 'true', '1'].includes(value)) return [names[i]];
      throw new Error(`عمود «${BENEFICIARY_IMPORT_HEADER_LABELS[field]}»: اختر نعم أو لا`);
    });
    if (raw.deviceTypes?.trim()) {
      const old = [...new Set(raw.deviceTypes.split(/[،,]/).map(s => s.trim()).filter(Boolean))].sort();
      if (JSON.stringify(old) !== JSON.stringify([...selected].sort())) throw new Error('تعارض بين الأجهزة المطلوبة وأعمدة نعم/لا');
    }
    result.deviceTypes = selected.join('،');
  }
  return result;
}

/** يقبل رؤوس القالب العربي الحالي والمفاتيح الإنجليزية للقوالب القديمة. */
export function beneficiaryImportFieldForHeader(header: string): BeneficiaryImportField | undefined {
  return HEADER_TO_FIELD.get(header.replace(/^\uFEFF/, '').trim());
}

export function beneficiaryImportHeaderLabel(field: BeneficiaryImportField): string {
  return BENEFICIARY_IMPORT_HEADER_LABELS[field];
}
