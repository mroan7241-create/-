import type { AbanmiReport } from './api';

type CountRow = { _count: { _all: number } };
const count = <T extends CountRow>(rows: T[], predicate: (row: T) => boolean) => rows.filter(predicate).reduce((sum, row) => sum + row._count._all, 0);
const percent = (part: number, whole: number) => whole > 0 ? Math.min(100, Math.round(part / whole * 100)) : null;

export type ApplicationStage = 'new' | 'processing' | 'needsInfo' | 'evaluation' | 'main' | 'reserve' | 'unclassified' | 'rejected';
export type ApplicationSummary = AbanmiReport['applications'][number];

export function applicationStage(row: ApplicationSummary): ApplicationStage {
  if (row.status === 'REJECTED' || row.eligibilityStatus === 'FAILED') return 'rejected';
  if (row.selectionList === 'MAIN') return 'main';
  if (row.selectionList === 'RESERVE') return 'reserve';
  if (row.status === 'ACCEPTED') return 'unclassified';
  if (row.eligibilityStatus === 'NEEDS_INFO') return 'needsInfo';
  if (row.eligibilityStatus === 'PASSED') return 'evaluation';
  return row.processingStarted ? 'processing' : 'new';
}

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  new: 'وصلت حديثًا', processing: 'قيد المراجعة', needsInfo: 'بانتظار الاستكمال',
  evaluation: 'مجتازة الأهلية', main: 'مختارة أساسية', reserve: 'مختارة احتياطية', unclassified: 'مقبولة دون تصنيف', rejected: 'غير مجتازة / مرفوضة',
};

/** All interpretations use the same aggregated, PII-free report returned by the API. */
export function analyzeAbanmi(report: AbanmiReport) {
  const applications = report.applications ?? [];
  const stages = { new: 0, processing: 0, needsInfo: 0, evaluation: 0, main: 0, reserve: 0, unclassified: 0, rejected: 0 };
  for (const application of applications) stages[applicationStage(application)] += 1;

  const beneficiaries = report.beneficiariesAndNeeds.beneficiaries;
  const needs = report.beneficiariesAndNeeds.needs;
  const devices = report.devicesAndInventory;
  const deliveries = report.deliveryAndExecution;
  const approvedBeneficiaries = count(beneficiaries, (row) => row.reviewStatus === 'APPROVED');
  const pendingBeneficiaries = count(beneficiaries, (row) => row.reviewStatus === 'UNDER_REVIEW');
  const rejectedBeneficiaries = count(beneficiaries, (row) => row.reviewStatus === 'REJECTED');
  const approvedNeeds = count(needs, (row) => row.decisionStatus === 'APPROVED');
  const pendingNeeds = count(needs, (row) => row.decisionStatus === 'PENDING');
  const rejectedNeeds = count(needs, (row) => row.decisionStatus === 'REJECTED');
  const deliveredDevices = count(devices, (row) => row.status === 'DELIVERED');
  const failedDeliveries = count(deliveries, (row) => row.status === 'DELIVERY_FAILED');
  const pendingApprovalDeliveries = count(deliveries, (row) => row.status === 'PENDING_DELIVERY_APPROVAL');
  const damagedDevices = count(devices, (row) => row.status === 'DAMAGED');
  const pendingReturns = count(deliveries, (row) => row.status === 'PENDING_RETURN_APPROVAL');
  const receiptDiscrepancies = count(report.procurement.receipts, (row) => row.status === 'RECEIVED_WITH_DISCREPANCIES');
  const alerts = [
    { label: 'تسليمات متعذرة', count: failedDeliveries, action: 'تحت متابعة فرق التنفيذ لإعادة الجدولة أو الإرجاع' },
    { label: 'تسليمات بانتظار الاعتماد', count: pendingApprovalDeliveries, action: 'بانتظار استكمال سلسلة الاعتماد' },
    { label: 'طلبات إرجاع بانتظار الاستلام الفعلي', count: pendingReturns, action: 'بانتظار تأكيد مستودع الجمعية' },
    { label: 'فروقات في محاضر الاستلام', count: receiptDiscrepancies, action: 'قيد المطابقة والتسوية' },
    { label: 'أجهزة تالفة', count: damagedDevices, action: 'قيد معالجة التلف أو الاستبدال' },
  ].filter((item) => item.count > 0);

  const associationRows = report.associations.map((association) => {
    const associationId = association.id;
    const approved = count(needs, (row) => row.associationId === associationId && row.decisionStatus === 'APPROVED');
    const delivered = count(devices, (row) => row.associationId === associationId && row.status === 'DELIVERED');
    return {
      ...association,
      beneficiaries: count(beneficiaries, (row) => row.associationId === associationId),
      approvedNeeds: approved,
      devices: count(devices, (row) => row.associationId === associationId),
      delivered,
      progressPercent: percent(delivered, approved),
      failedDeliveries: count(deliveries, (row) => row.associationId === associationId && row.status === 'DELIVERY_FAILED'),
    };
  });
  const regions = report.byRegion.map((region) => {
    const ids = new Set(report.associations.filter((association) => association.region === region.region).map((association) => association.id));
    const approved = count(needs, (row) => ids.has(row.associationId) && row.decisionStatus === 'APPROVED');
    const delivered = count(devices, (row) => ids.has(row.associationId) && row.status === 'DELIVERED');
    return { ...region, beneficiaries: count(beneficiaries, (row) => ids.has(row.associationId)), approvedNeeds: approved,
      devices: count(devices, (row) => ids.has(row.associationId)), delivered, progressPercent: percent(delivered, approved) };
  });
  const currentActivity = report.activities.find((activity) => activity.status !== 'COMPLETED') ?? report.activities.at(-1);
  const progressPercent = percent(deliveredDevices, approvedNeeds);
  const insights = [
    applications.length ? `استُقبل ${applications.length} طلب انضمام؛ ${stages.new + stages.processing} منها بانتظار بدء المراجعة أو إكمالها، و${stages.needsInfo} بانتظار استكمال البيانات.` : 'لم تُسجّل طلبات انضمام ضمن النطاق المختار.',
    approvedNeeds ? `اعتُمد ${approvedNeeds} احتياجًا، وسُجّل تسليم ${deliveredDevices} جهازًا؛ تغطية الاحتياجات المعتمدة ${progressPercent}٪.` : 'لم تُعتمد احتياجات ضمن النطاق؛ لا يمكن احتساب نسبة إنجاز التسليم بعد.',
    alerts.length ? `توجد ${alerts.reduce((sum, alert) => sum + alert.count, 0)} حالة متابعة موزعة على ${alerts.length} مؤشرات تشغيلية؛ راجع تفاصيلها أدناه.` : 'لا تظهر حالات متابعة تشغيلية في المؤشرات المتاحة.',
  ];

  return {
    applications, stages, approvedBeneficiaries, pendingBeneficiaries, rejectedBeneficiaries,
    approvedNeeds, pendingNeeds, rejectedNeeds, deliveredDevices, progressPercent,
    warehouseDevices: count(devices, (row) => row.status === 'WAREHOUSE'),
    allocatedDevices: count(devices, (row) => row.status === 'ALLOCATED'),
    withDelegateDevices: count(devices, (row) => row.status === 'WITH_DELEGATE'),
    closedDeliveries: count(deliveries, (row) => row.status === 'DELIVERY_CLOSED'),
    pendingApprovalDeliveries, failedDeliveries,
    activeAssociations: report.associations.filter((row) => row.status === 'ACTIVE').length,
    attentionAssociations: report.associations.filter((row) => row.status !== 'ACTIVE').length,
    currentStage: currentActivity?.phaseName ?? 'لم تبدأ الأنشطة بعد', alerts, associations: associationRows, regions, insights,
    journey: [
      { label: 'اعتماد الجمعيات', done: report.participation.reduce((sum, row) => sum + row._count._all, 0), caption: 'مشاركات مسجلة' },
      { label: 'مراجعة المستفيدين', done: approvedBeneficiaries, caption: 'مستفيدون معتمدون' },
      { label: 'المشتريات', done: report.procurement.purchaseOrders.reduce((sum, row) => sum + row._count._all, 0), caption: 'أوامر شراء' },
      { label: 'التوريد والاستلام', done: report.procurement.receipts.reduce((sum, row) => sum + row._count._all, 0), caption: 'محاضر استلام' },
      { label: 'التخصيص', done: count(report.allocations, (row) => row.status === 'ACTIVE'), caption: 'تخصيصات نشطة' },
      { label: 'التسليم', done: count(deliveries, (row) => row.status === 'DELIVERY_CLOSED' || row.status === 'DELIVERED'), caption: 'تسليمات مكتملة' },
      { label: 'الإغلاق', done: report.associationClosure.filter((row) => row.status === 'CLOSED').length, caption: 'جمعيات مغلقة' },
    ],
  };
}
