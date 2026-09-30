'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Building2, CheckCircle2, Clock3, Package, Truck, Users } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { ErrorState, LoadingState } from '../components/States';
import { getAbanmiReport, type AbanmiReport } from '../lib/api';
import { analyzeAbanmi, APPLICATION_STAGE_LABELS, type ApplicationStage } from '../lib/abanmi-analytics';
import { reportValueLabel } from '../lib/report-labels';
import { useRoleGuard } from '../lib/use-role-guard';
import { cardStyle, primaryButtonStyle, tableStyle, tdStyle, thStyle } from '../lib/ui';

export default function AbanmiDashboardPage() {
  const { user, loading } = useRoleGuard(['ABANMI']);
  const [report, setReport] = useState<AbanmiReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (user) getAbanmiReport().then(setReport).catch(() => setError('تعذّر تحميل لوحة المشروع.')); }, [user]);
  const metrics = useMemo(() => report ? analyzeAbanmi(report) : null, [report]);
  if (loading || !user) return null;
  return <AppShell user={user}>
    <header className="zad-hero2"><div className="zad-hero2-text"><h1>لوحة مشروع الأجهزة الكهربائية</h1><div className="zad-hero2-fresh">صورة مباشرة للتقديم والتنفيذ ومواطن المتابعة</div></div></header>
    {error && <ErrorState message={error} />}{!report && !error && <LoadingState />}
    {report && metrics && <>
      <section className="executive-meta">
        <div><span>حالة المشروع</span><strong>{report.projectClosure?.status === 'CLOSED' ? 'مغلق' : 'قيد التنفيذ'}</strong></div>
        <div><span>المرحلة الحالية</span><strong>{metrics.currentStage}</strong></div>
        <div><span>طلبات الانضمام</span><strong>{metrics.applications.length}</strong></div>
        <div><span>الجمعيات المشاركة</span><strong>{report.overall.associations}</strong></div>
        <div><span>المناطق المغطاة</span><strong>{report.byRegion.length}</strong></div>
        <div><span>آخر تحديث للبيانات</span><strong>{new Date(report.generatedAt).toLocaleString('ar-SA')}</strong></div>
      </section>

      <SectionTitle>من التقديم إلى الاختيار</SectionTitle>
      <div className="abanmi-stage-grid">{(Object.keys(APPLICATION_STAGE_LABELS) as ApplicationStage[]).map((stage) => <Link key={stage} className="abanmi-stage-card" href={`/abanmi/reports?stage=${stage}#applications`}><strong>{metrics.stages[stage]}</strong><span>{APPLICATION_STAGE_LABELS[stage]}</span><small>عرض الجمعيات ←</small></Link>)}</div>

      <SectionTitle>المؤشرات الرئيسية</SectionTitle>
      <div className="zad-modules2 abanmi-module-grid">
        <Kpi icon={Building2} title="الجمعيات المشاركة" value={report.overall.associations} details={`نشطة ${metrics.activeAssociations} · تحتاج انتباه ${metrics.attentionAssociations}`} href="/abanmi/reports#associations" />
        <Kpi icon={Users} title="المستفيدون" value={report.overall.beneficiaries} details={`معتمدون ${metrics.approvedBeneficiaries} · قيد المراجعة ${metrics.pendingBeneficiaries} · مرفوضون ${metrics.rejectedBeneficiaries}`} href="/abanmi/reports#beneficiaries" />
        <Kpi icon={Package} title="الاحتياجات المعتمدة" value={metrics.approvedNeeds} details={`بانتظار القرار ${metrics.pendingNeeds} · مرفوضة ${metrics.rejectedNeeds} · تغطية التسليم ${metrics.progressPercent === null ? '—' : `${metrics.progressPercent}٪`}`} href="/abanmi/reports#needs" />
        <Kpi icon={Truck} title="التسليمات" value={report.overall.deliveries} details={`مغلقة ${metrics.closedDeliveries} · بانتظار اعتماد ${metrics.pendingApprovalDeliveries} · متعذرة ${metrics.failedDeliveries}`} href="/abanmi/reports#deliveries" />
      </div>

      <SectionTitle>قراءة تنفيذية</SectionTitle>
      <section className="abanmi-insights" aria-label="قراءة المؤشرات">{metrics.insights.map((insight) => <p key={insight}>{insight}</p>)}</section>

      <SectionTitle>رحلة تنفيذ المشروع</SectionTitle>
      <div className="journey-grid">{metrics.journey.map((stage) => <article key={stage.label} style={cardStyle}><span className="journey-state" data-tone={stage.done > 0 ? 'active' : 'neutral'}>{stage.done > 0 ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}{stage.label}</span><strong>{stage.done}</strong><small>{stage.caption}</small></article>)}</div>

      <SectionTitle>تنبيهات التنفيذ</SectionTitle>
      <section style={cardStyle}>{metrics.alerts.length ? metrics.alerts.map((alert) => <div className="executive-alert" key={alert.label}><AlertTriangle size={18} /><strong>{alert.count}</strong><span>{alert.label}</span><small>{alert.action}</small></div>) : <p className="no-critical"><CheckCircle2 size={20} /> لا توجد تعثرات حرجة حاليًا</p>}</section>

      <SectionTitle>ملخص الجمعيات</SectionTitle>
      <p className="zad-section-meta2">اضغط اسم الجمعية لعرض تقدمها واحتياجاتها وتسليماتها.</p>
      <div className="table-scroll"><table style={tableStyle}><thead><tr><th style={thStyle}>الجمعية</th><th style={thStyle}>المنطقة</th><th style={thStyle}>المستفيدون</th><th style={thStyle}>الاحتياجات المعتمدة</th><th style={thStyle}>الأجهزة</th><th style={thStyle}>تم التسليم</th><th style={thStyle}>التقدم</th><th style={thStyle}>الحالة</th></tr></thead><tbody>{metrics.associations.map((row) => <tr key={row.id}><td style={tdStyle}><Link href={`/abanmi/reports?associationId=${row.id}#analysis`}>{row.name}</Link></td><td style={tdStyle}>{row.region}</td><td style={tdStyle}>{row.beneficiaries}</td><td style={tdStyle}>{row.approvedNeeds}</td><td style={tdStyle}>{row.devices}</td><td style={tdStyle}>{row.delivered}</td><td style={tdStyle}>{row.progressPercent === null ? '—' : `${row.progressPercent}٪`}</td><td style={tdStyle}>{reportValueLabel(row.status)}</td></tr>)}</tbody></table></div>

      <SectionTitle>التغطية الإقليمية</SectionTitle>
      <div className="zad-summary-strip2">{metrics.regions.length ? metrics.regions.map((row) => <Link className="zad-sum-card2 abanmi-region-link" key={row.region} href={`/abanmi/reports?region=${encodeURIComponent(row.region)}#analysis`}><b className="zad-sv2b">{row.associations}</b><span className="zad-sl2b">{row.region}</span><small>{row.beneficiaries} مستفيد · {row.approvedNeeds} احتياج معتمد · {row.delivered} جهاز مسلّم</small><small>عرض تحليل المنطقة ←</small></Link>) : <p>لا توجد بيانات مناطق ضمن النطاق الحالي.</p>}</div>

      <SectionTitle>متابعة مراحل المشروع</SectionTitle>
      <div className="table-scroll"><table style={tableStyle}><thead><tr><th style={thStyle}>المرحلة</th><th style={thStyle}>النشاط</th><th style={thStyle}>الإنجاز</th><th style={thStyle}>الحالة</th></tr></thead><tbody>{report.activities.map((activity) => <tr key={activity.id}><td style={tdStyle}>{activity.phaseName}</td><td style={tdStyle}>{activity.mainActivityName}{activity.subActivityName ? ` — ${activity.subActivityName}` : ''}</td><td style={tdStyle}>{activity.completionPercent}٪</td><td style={tdStyle}>{reportValueLabel(activity.status)}</td></tr>)}</tbody></table></div>

      <div className="button-row" style={{ marginTop: 24 }}><Link style={{ ...primaryButtonStyle, textDecoration: 'none' }} href="/abanmi/reports">فتح التقارير والتصدير</Link></div>
    </>}
  </AppShell>;
}

function SectionTitle({ children }: { children: React.ReactNode }) { return <div className="zad-section-head2"><div className="zad-framed-title2"><div className="zad-rule2" /><h2>{children}</h2></div></div>; }
function Kpi({ icon: Icon, title, value, details, href }: { icon: typeof Building2; title: string; value: number; details: string; href: string }) { return <Link className="zad-module2 abanmi-kpi-link" href={href}><div className="zad-module2-head"><span className="zad-module2-icon"><Icon size={18} /></span><strong>{title}</strong></div><div className="zad-primary-block2"><span className="zad-fig2">{value}</span><small>{details}</small></div><span className="abanmi-detail-cue">عرض التفاصيل ←</span></Link>; }
