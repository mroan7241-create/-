export const BENEFICIARY_IMPORT_HEADER_LABELS = {
  needPriority: 'ترتيب الحاجة (1 = الأشد حاجة)',
  threeDeviceReason: 'مبرر الحاجة إلى ثلاثة أجهزة (إلزامي عند طلبها)',
  name: 'اسم المستفيد كاملًا',
  region: 'منطقة المستفيد',
  city: 'مدينة المستفيد',
  district: 'حي المستفيد',
  phone: 'رقم جوال المستفيد',
  familyCount: 'عدد أفراد أسرة المستفيد (شامل المستفيد)',
  socialStatus: 'الحالة الاجتماعية للمستفيد',
  deviceTypes: 'الأجهزة المطلوبة',
  phone2: 'رقم جوال إضافي (اختياري)',
  socialSecurity: 'هل يستفيد من الضمان الاجتماعي؟ (نعم/لا)',
  income: 'كم دخل المستفيد؟ (ريال)',
  notes: 'ملاحظات (اختياري)',
  lat: 'موقع منزل المستفيد: خط العرض (اختياري)',
  lng: 'موقع منزل المستفيد: خط الطول (اختياري)',
  refrigerator: 'هل يحتاج إلى ثلاجة؟ (نعم/لا)',
  oven: 'هل يحتاج إلى فرن؟ (نعم/لا)',
  washingMachine: 'هل يحتاج إلى غسالة؟ (نعم/لا)',
} as const;

export type BeneficiaryImportField = keyof typeof BENEFICIARY_IMPORT_HEADER_LABELS;

export const REQUIRED_BENEFICIARY_IMPORT_FIELDS: BeneficiaryImportField[] = [
  'name', 'region', 'city', 'district', 'phone', 'familyCount', 'socialStatus', 'deviceTypes', 'socialSecurity', 'income',
];

export const ALL_BENEFICIARY_IMPORT_FIELDS: BeneficiaryImportField[] = [
  'name', 'region', 'city', 'district', 'phone', 'familyCount', 'socialStatus', 'deviceTypes',
  'phone2', 'socialSecurity', 'income', 'notes', 'lat', 'lng', 'needPriority', 'threeDeviceReason',
];

const HEADER_TO_FIELD = new Map<string, BeneficiaryImportField>(
  (Object.keys(BENEFICIARY_IMPORT_HEADER_LABELS) as BeneficiaryImportField[]).flatMap((field) => [
    [field, field] as const,
    [BENEFICIARY_IMPORT_HEADER_LABELS[field], field] as const,
  ]),
);

// Keep previously downloaded Arabic templates readable after clarifying the labels.
const LEGACY_ARABIC_HEADERS: Partial<Record<BeneficiaryImportField, string>> = {
  needPriority: 'ترتيب الحاجة', threeDeviceReason: 'مبرر طلب ثلاثة أجهزة',
  name: 'الاسم', region: 'المنطقة', city: 'المدينة', district: 'الحي',
  phone: 'رقم الجوال', familyCount: 'عدد أفراد الأسرة', socialStatus: 'الحالة الاجتماعية',
  phone2: 'جوال إضافي', socialSecurity: 'الضمان الاجتماعي', income: 'الدخل', notes: 'ملاحظات',
  lat: 'خط العرض', lng: 'خط الطول', refrigerator: 'ثلاجة؟', oven: 'فرن؟', washingMachine: 'غسالة؟',
};
for (const [field, label] of Object.entries(LEGACY_ARABIC_HEADERS)) HEADER_TO_FIELD.set(label, field as BeneficiaryImportField);
HEADER_TO_FIELD.set('هل يستفيد من الضمان الاجتماعي؟ (نعم/لا — اختياري)', 'socialSecurity');
HEADER_TO_FIELD.set('كم دخل المستفيد؟ (ريال — اختياري)', 'income');

export const DEVICE_IMPORT_FIELDS = ['refrigerator', 'oven', 'washingMachine'] as const;
export const SIMPLE_BENEFICIARY_IMPORT_FIELDS: BeneficiaryImportField[] = [
  'needPriority', 'name', 'region', 'city', 'district', 'phone', 'familyCount', 'socialStatus', ...DEVICE_IMPORT_FIELDS, 'threeDeviceReason',
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
  if (!raw.socialSecurity?.trim()) throw new Error('أجب عن سؤال الاستفادة من الضمان الاجتماعي بنعم أو لا');
  if (!raw.income?.trim()) throw new Error('أدخل دخل المستفيد بالريال، واكتب 0 إذا لم يكن له دخل');
  for (const field of ['phone', 'phone2', 'familyCount', 'income', 'lat', 'lng', 'needPriority']) if (result[field]) result[field] = normalizeImportDigits(result[field]);
  if (raw.socialSecurity?.trim()) {
    const value = normalizeImportDigits(raw.socialSecurity).trim().toLowerCase();
    if (['نعم', 'yes', 'true', '1'].includes(value)) result.socialSecurity = 'نعم';
    else if (['لا', 'no', 'false', '0'].includes(value)) result.socialSecurity = 'لا';
    else throw new Error('عمود «الضمان الاجتماعي»: اختر نعم أو لا');
  }
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
