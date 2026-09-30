/** Public form labels used consistently in review, completion requests, and email. */
export const APPLICATION_ATTACHMENT_LABELS: Record<string, string> = {
  licenseFile: 'الترخيص',
  previousProjectEvidence: 'شاهد مشروع سابق',
  spendingPolicyFile: 'لائحة الصرف',
  strategicPlanFile: 'الخطة الاستراتيجية',
  operationalPlanFile: 'الخطة التشغيلية',
  initialBeneficiaryFile: 'القائمة الأولية للمستفيدين',
  financialStatementsFile: 'القوائم المالية',
  governanceReportFile: 'تقرير درجة الحوكمة',
};

export const APPLICATION_FIELD_LABELS: Record<string, string> = {
  'organization.name': 'اسم الجمعية',
  'organization.licenseNumber': 'رقم الترخيص',
  'organization.licenseExpiryDate': 'تاريخ انتهاء الترخيص',
  'organization.officialEmail': 'البريد الرسمي',
  'organization.officialPhone': 'رقم التواصل',
  'organization.category': 'تصنيف الجمعية المالي',
  'organization.sectors': 'مجالات عمل الجمعية',
  'organization.hasWebsite': 'وجود موقع إلكتروني',
  'organization.websiteUrl': 'رابط الموقع الإلكتروني',
  'coordinator.name': 'اسم المنسق',
  'coordinator.title': 'صفة المنسق',
  'coordinator.phone': 'جوال المنسق',
  'coordinator.email': 'بريد المنسق',
  'beneficiaries.registeredFamilies': 'عدد الأسر المسجلة',
  'beneficiaries.databaseUpdatedAt': 'تاريخ تحديث بيانات المستفيدين',
  'finance.governanceScore': 'درجة الحوكمة (%)',
  'finance.revenue': 'الإيرادات',
  'finance.expenses': 'المصروفات',
  'finance.currentAssets': 'الأصول المتداولة',
  'finance.currentLiabilities': 'الخصوم المتداولة',
};

export function applicationRequirementLabel(type: string, key: string): string {
  return (type === 'ATTACHMENT' ? APPLICATION_ATTACHMENT_LABELS : APPLICATION_FIELD_LABELS)[key] ?? key;
}

export function applicationRequirementDescription(type: string, key: string, reason: string): string {
  return `${applicationRequirementLabel(type, key)} — ${reason.trim()}`;
}

export const APPLICATION_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const APPLICATION_UPLOAD_SIZE_MESSAGE = 'حجم الملف يتجاوز 8 ميجابايت. اختر ملفًا أصغر.';
