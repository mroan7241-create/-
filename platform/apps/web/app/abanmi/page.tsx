'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Building2, CheckCircle2, Clock3, Package, Truck, Users } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { ErrorState, LoadingState } from '../components/States';
import { getAbanmiReport, type AbanmiReport } from '../lib/api';
import { reportValueLabel } from '../lib/report-labels';
import { useRoleGuard } from '../lib/use-role-guard';
import { cardStyle, primaryButtonStyle, tableStyle, tdStyle, thStyle } from '../lib/ui';

type CountRow = { _count: { _all: number } };
const count = <T extends CountRow>(rows: T[], predicate: (row: T) => boolean) => rows.filter(predicate).reduce((sum, row) => sum + row._count._all, 0);

export default function AbanmiDashboardPage() {
  const { user, loading } = useRoleGuard(['ABANMI']);
  const [report, setReport] = useState<AbanmiReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (user) getAbanmiReport().then(setReport).catch(() => setError('تعذّر تحميل لوحة المشروع.')); }, [user]);
  const metrics = useMemo(() => report ? buildMetrics(report) : null, [report]);
  if (loading || !user) return null;
  return <AppShell user={user}>
    <header className="zad-hero2"><div className="zad-hero2-text"><h1>لوحة مشروع الأجهزة الكهربائية</h1><div className="zad-hero2-fresh">مركز متابعة تنفيذي مباشر — للقراءة فقط</div></div></header>
    {error && <ErrorState message={error} />}{!report && !error && <LoadingState />}
    {report && metrics && <>
      <section className="executive-meta">
        <div><span>حالة المشروع</span><strong>{report.projectClosure?.status === 'CLOSED' ? 'مغلق' : 'قيد التنفيذ'}</strong></div>
        <div><span>المرحلة الحالية</span><strong>{metrics.currentStage}</strong></div>
        <div><span>الجمعيات المشاركة</span><strong>{report.overall.associations}</strong></div>
        <div><span>المناطق المغطاة</span><strong>{report.byRegion.length}</strong></div>
        <div><span>آخر تحديث للبيانات</span><strong>{new Date(report.generatedAt).toLocaleString('ar-SA')}</strong></div>
      </section>

      <SectionTitle>المؤشرات الرئيسية</SectionTitle>
      <div className="zad-modules2">
        <Kpi icon={Building2} title="الجمعيات" value={report.overall.associations} details={`نشطة ${metrics.activeAssociations} · تحتاج انتباه ${metrics.attentionAssociations}`} />
        <Kpi icon={Users} title="المستفيدون" value={report.overall.beneficiaries} details={`معتمدون ${metrics.approvedBeneficiaries} · قيد المراجعة ${metrics.pendingBeneficiaries} · مرفوضون ${metrics.rejectedBeneficiaries}`} />
        <Kpi icon={Package} title="الأجهزة" value={report.overall.devices} details={`بالمستودع ${metrics.warehouseDevices} · مخصصة ${metrics.allocatedDevices} · مع مندوب ${metrics.withDelegateDevices} · مسلمة ${metrics.deliveredDevices}`} />
        <Kpi icon={Truck} title="التسليمات" value={report.overall.deliveries} details={`مغلقة ${metrics.closedDeliveries} · بانتظار اعتماد ${metrics.pendingApprovalDeliveries} · متعذرة ${metrics.failedDeliveries}`} />
      </div>

      <SectionTitle>رحلة تنفيذ المشروع</SectionTitle>
      <div className="journey-grid">{metrics.journey.map((stage) => <article key={stage.label} style={cardStyle}><span className="journey-state" data-tone={stage.done > 0 ? 'active' : 'neutral'}>{stage.done > 0 ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}{stage.label}</span><strong>{stage.done}</strong><small>{stage.caption}</small></article>)}</div>

      <SectionTitle>تنبيهات التنفيذ</SectionTitle>
      <section style={cardStyle}>{metrics.alerts.length ? metrics.alerts.map((alert) => <div className="executive-alert" key={alert.label}><AlertTriangle size={18} /><strong>{alert.count}</strong><span>{alert.label}</span><small>{alert.action}</small></div>) : <p className="no-critical"><CheckCircle2 size={20} /> لا توجد تعثرات حرجة حاليًا</p>}</section>

      <SectionTitle>ملخص الجمعيات</SectionTitle>
      <div className="table-scroll"><table style={tableStyle}><thead><tr><th style={thStyle}>الجمعية</th><th style={thStyle}>المنطقة</th><th style={thStyle}>المستفيدون</th><th style={thStyle}>الأجهزة</th><th style={thStyle}>تم التسليم</th><th style={thStyle}>المتبقي</th><th style={thStyle}>التقدم</th><th style={thStyle}>الحالة</th></tr></thead><tbody>{metrics.associations.map((row) => <tr key={row.id}><td style={tdStyle}>{row.name}</td><td style={tdStyle}>{row.region}</td><td style={tdStyle}>{row.beneficiaries}</td><td style={tdStyle}>{row.devices}</td><td style={tdStyle}>{row.delivered}</td><td style={tdStyle}>{Math.max(0, row.devices - row.delivered)}</td><td style={tdStyle}>{row.devices ? `${Math.round(row.delivered / row.devices * 100)}٪` : '—'}</td><td style={tdStyle}>{reportValueLabel(row.status)}</td></tr>)}</tbody></table></div>

      <SectionTitle>التغطية الإقليمية</SectionTitle>
      <div className="zad-summary-strip2">{metrics.regions.length ? metrics.regions.map((row) => <span className="zad-sum-card2" key={row.region}><b className="zad-sv2b">{row.associations}</b><span className="zad-sl2b">{row.region}</span><small>{row.beneficiaries} مستفيد · {row.devices} جهاز · {row.delivered} مسلّم</small></span>) : <p>لا توجد بيانات مناطق ضمن النطاق الحالي.</p>}</div>

      <SectionTitle>متابعة مراحل المشروع</SectionTitle>
      <div className="table-scroll"><table style={tableStyle}><thead><tr><th style={thStyle}>المرحلة</th><th style={thStyle}>النشاط</th><th style={thStyle}>الإنجاز</th><th style={thStyle}>الحالة</th></tr></thead><tbody>{report.activities.map((activity) => <tr key={activity.id}><td style={tdStyle}>{activity.phaseName}</td><td style={tdStyle}>{activity.mainActivityName}{activity.subActivityName ? ` — ${activity.subActivityName}` : ''}</td><td style={tdStyle}>{activity.completionPercent}٪</td><td style={tdStyle}>{reportValueLabel(activity.status)}</td></tr>)}</tbody></table></div>

      <div className="button-row" style={{ marginTop: 24 }}><Link style={{ ...primaryButtonStyle, textDecoration: 'none' }} href="/abanmi/reports">فتح التقارير والتصدير</Link></div>
      <p className="zad-section-meta2" style={{ marginTop: 20 }}>لا تتضمن هذه البوابة بيانات الاتصال أو العناوين أو التواقيع أو بيانات دخول المستفيدين.</p>
    </>}
  </AppShell>;
}

function buildMetrics(report: AbanmiReport) {
  const beneficiaries = report.beneficiariesAndNeeds.beneficiaries;
  const devices = report.devicesAndInventory;
  const deliveries = report.deliveryAndExecution;
  const activeAssociations = report.associations.filter((row) => row.status === 'ACTIVE').length;
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
    const beneficiariesCount = count(beneficiaries, (row) => row.associationId === association.id);
    const deviceCount = count(devices, (row) => row.associationId === association.id);
    const delivered = count(devices, (row) => row.associationId === association.id && row.status === 'DELIVERED');
    return { ...association, beneficiaries: beneficiariesCount, devices: deviceCount, delivered };
  });
  const regions = report.byRegion.map((region) => {
    const ids = new Set(report.associations.filter((association) => association.region === region.region).map((association) => association.id));
    return { ...region, beneficiaries: count(beneficiaries, (row) => ids.has(row.associationId)), devices: count(devices, (row) => ids.has(row.associationId)), delivered: count(devices, (row) => ids.has(row.associationId) && row.status === 'DELIVERED') };
  });
  const currentActivity = report.activities.find((activity) => activity.status !== 'COMPLETED') ?? report.activities.at(-1);
  return {
    activeAssociations, attentionAssociations: report.associations.length - activeAssociations,
    approvedBeneficiaries: count(beneficiaries, (row) => row.reviewStatus === 'APPROVED'), pendingBeneficiaries: count(beneficiaries, (row) => row.reviewStatus === 'UNDER_REVIEW'), rejectedBeneficiaries: count(beneficiaries, (row) => row.reviewStatus === 'REJECTED'),
    warehouseDevices: count(devices, (row) => row.status === 'WAREHOUSE'), allocatedDevices: count(devices, (row) => row.status === 'ALLOCATED'), withDelegateDevices: count(devices, (row) => row.status === 'WITH_DELEGATE'), deliveredDevices: count(devices, (row) => row.status === 'DELIVERED'),
    closedDeliveries: count(deliveries, (row) => row.status === 'DELIVERY_CLOSED'), pendingApprovalDeliveries, failedDeliveries,
    currentStage: currentActivity?.phaseName ?? 'لم تبدأ الأنشطة بعد', alerts, associations: associationRows, regions,
    journey: [
      { label: 'اعتماد الجمعيات', done: report.participation.reduce((sum, row) => sum + row._count._all, 0), caption: 'مشاركات مسجلة' },
      { label: 'مراجعة المستفيدين', done: count(beneficiaries, (row) => row.reviewStatus === 'APPROVED'), caption: 'مستفيدون معتمدون' },
      { label: 'المشتريات', done: report.procurement.purchaseOrders.reduce((sum, row) => sum + row._count._all, 0), caption: 'أوامر شراء' },
      { label: 'التوريد والاستلام', done: report.procurement.receipts.reduce((sum, row) => sum + row._count._all, 0), caption: 'محاضر استلام' },
      { label: 'التخصيص', done: count(report.allocations, (row) => row.status === 'ACTIVE'), caption: 'تخصيصات نشطة' },
      { label: 'التسليم', done: count(deliveries, (row) => row.status === 'DELIVERY_CLOSED' || row.status === 'DELIVERED'), caption: 'تسليمات مكتملة' },
      { label: 'الإغلاق', done: report.associationClosure.filter((row) => row.status === 'CLOSED').length, caption: 'جمعيات مغلقة' },
    ],
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) { return <div className="zad-section-head2"><div className="zad-framed-title2"><div className="zad-rule2" /><h2>{children}</h2></div></div>; }
function Kpi({ icon: Icon, title, value, details }: { icon: typeof Building2; title: string; value: number; details: string }) { return <article className="zad-module2"><div className="zad-module2-head"><span className="zad-module2-icon"><Icon size={18} /></span><strong>{title}</strong></div><div className="zad-primary-block2"><span className="zad-fig2">{value}</span><small>{details}</small></div></article>; }
