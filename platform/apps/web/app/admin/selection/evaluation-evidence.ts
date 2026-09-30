import type { ApplicationSummary } from '../../lib/api';

export type EvaluationAxis = 'operationalReadiness' | 'technicalCapability' | 'previousExperience' | 'integrityTransparency' | 'participationCommitment' | 'sustainabilityImpact';

/** The fields already supplied by the applicant, grouped beside the existing six scores. */
export const EVALUATION_EVIDENCE: Record<EvaluationAxis, Array<[string, string]>> = {
  operationalReadiness: [['team.fullTime', 'الموظفون المتفرغون'], ['readiness.fieldTeamCount', 'الفريق الميداني'], ['readiness.weeklyDeliveryCapacity', 'القدرة الأسبوعية'], ['beneficiaries.registeredFamilies', 'الأسر المسجلة']],
  technicalCapability: [['beneficiaries.hasSystem', 'نظام إلكتروني للمستفيدين'], ['beneficiaries.systemName', 'اسم النظام'], ['beneficiaries.capabilities.search', 'البحث'], ['beneficiaries.capabilities.update', 'تحديث البيانات'], ['beneficiaries.capabilities.reports', 'التقارير']],
  previousExperience: [['experience.hasRecentInKindProject', 'مشروع دعم عيني حديث'], ['experience.projectName', 'اسم المشروع'], ['experience.recentProjectsCount', 'عدد المشاريع الحديثة'], ['experience.recentBeneficiariesCount', 'مستفيدو المشاريع الحديثة']],
  integrityTransparency: [['finance.governanceScore', 'درجة الحوكمة (%)'], ['finance.hasAccountingSystem', 'نظام محاسبي'], ['finance.hasSpendingPolicy', 'لائحة صرف'], ['finance.revenue', 'الإيرادات'], ['finance.expenses', 'المصروفات'], ['finance.currentAssets', 'الأصول المتداولة'], ['finance.currentLiabilities', 'الخصوم المتداولة']],
  participationCommitment: [['coordinator.name', 'منسق المشروع'], ['coordinator.title', 'صفة المنسق'], ['covenantRepresentative.name', 'ممثل الميثاق'], ['readiness.fieldTeamCount', 'الفريق الميداني']],
  sustainabilityImpact: [['planning.hasStrategicPlan', 'خطة استراتيجية'], ['planning.hasOperationalPlan', 'خطة تشغيلية'], ['planning.hasPostAidFollowUp', 'متابعة ما بعد المساعدة'], ['planning.measuresSatisfaction', 'قياس الرضا'], ['planning.lastYearProgramsCount', 'برامج العام الماضي']],
};

export function evaluationFacts(application: Pick<ApplicationSummary, 'v2Payload'>, axis: EvaluationAxis): Array<{ label: string; value: string }> {
  return EVALUATION_EVIDENCE[axis].map(([path, label]) => ({ label, value: displayValue(valueAt(application.v2Payload, path)) }));
}

function valueAt(root: Record<string, unknown> | null, path: string): unknown {
  let value: unknown = root;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function displayValue(value: unknown): string {
  if (value === true) return 'نعم';
  if (value === false) return 'لا';
  if (value == null || value === '') return 'لم يُقدّم';
  if (Array.isArray(value)) return value.map(String).join('، ') || 'لم يُقدّم';
  if (typeof value === 'number') return new Intl.NumberFormat('ar-SA').format(value);
  return String(value);
}
