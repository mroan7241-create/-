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
} as const;

export type BeneficiaryImportField = keyof typeof BENEFICIARY_IMPORT_HEADER_LABELS;

export const REQUIRED_BENEFICIARY_IMPORT_FIELDS: BeneficiaryImportField[] = [
  'name', 'region', 'city', 'district', 'phone', 'familyCount', 'socialStatus', 'deviceTypes',
];

export const ALL_BENEFICIARY_IMPORT_FIELDS: BeneficiaryImportField[] = [
  ...REQUIRED_BENEFICIARY_IMPORT_FIELDS, 'phone2', 'socialSecurity', 'income', 'notes', 'lat', 'lng',
];

const HEADER_TO_FIELD = new Map<string, BeneficiaryImportField>(
  ALL_BENEFICIARY_IMPORT_FIELDS.flatMap((field) => [
    [field, field] as const,
    [BENEFICIARY_IMPORT_HEADER_LABELS[field], field] as const,
  ]),
);

/** يقبل رؤوس القالب العربي الحالي والمفاتيح الإنجليزية للقوالب القديمة. */
export function beneficiaryImportFieldForHeader(header: string): BeneficiaryImportField | undefined {
  return HEADER_TO_FIELD.get(header.replace(/^\uFEFF/, '').trim());
}

export function beneficiaryImportHeaderLabel(field: BeneficiaryImportField): string {
  return BENEFICIARY_IMPORT_HEADER_LABELS[field];
}
