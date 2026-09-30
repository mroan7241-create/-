'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '../../components/AppShell';
import { ErrorState, LoadingState } from '../../components/States';
import { OfficialReportHeader } from '../../components/OfficialReportHeader';
import { downloadAbanmiReport, getAbanmiReport, type AbanmiReport } from '../../lib/api';
import { analyzeAbanmi, applicationStage, APPLICATION_STAGE_LABELS, type ApplicationStage } from '../../lib/abanmi-analytics';
import { reportValueLabel } from '../../lib/report-labels';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, inputStyle, labelStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui';
import { fetchScopedReport, type ReportFilters } from './report-scope';

type Filters = ReportFilters;
const emptyFilters: Filters = { from: '', to: '', associationId: '', region: '' };
const stages = Object.keys(APPLICATION_STAGE_LABELS) as ApplicationStage[];
const total = (rows: Array<{ _count: { _all: number } }>) => rows.reduce((sum, row) => sum + row._count._all, 0);

export default function AbanmiReportsPage() {
  const { user, loading } = useRoleGuard(['ABANMI']);
  const [catalog, setCatalog] = useState<AbanmiReport | null>(null);
  const [report, setReport] = useState<AbanmiReport | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [selectedStage, setSelectedStage] = useState<ApplicationStage | ''>('');
  const [busy, setBusy] = useState(false);
  const [printRequested, setPrintRequested] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const initial = { from: params.get('from') ?? '', to: params.get('to') ?? '', associationId: params.get('associationId') ?? '', region: params.get('region') ?? '' };
    const stage = params.get('stage');
    setFilters(initial);
    setApplied(initial);
    setSelectedStage(stages.includes(stage as ApplicationStage) ? stage as ApplicationStage : '');
    const baseRequest = getAbanmiReport();
    const filteredRequest = Object.values(initial).some(Boolean) ? fetchScopedReport(initial, getAbanmiReport) : baseRequest;
    Promise.all([baseRequest, filteredRequest]).then(([base, filtered]) => {
      if (!cancelled) { setCatalog(base); setReport(filtered); }
    }).catch(() => { if (!cancelled) setError('تعذّر تحميل التقرير.'); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!report || !window.location.hash) return;
    const id = window.location.hash.slice(1);
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [report]);

  useEffect(() => {
    if (!printRequested || !report) return;
    // Printing after commit ensures the PDF contains the newly filtered report.
    const frame = requestAnimationFrame(() => {
      window.print();
      setPrintRequested(false);
      setBusy(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [printRequested, report]);

  const analysis = useMemo(() => report ? analyzeAbanmi(report) : null, [report]);
  if (loading || !user) return null;

  async function load(nextFilters = filters) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = await fetchScopedReport(nextFilters, getAbanmiReport);
      setReport(next); setApplied(nextFilters); setSelectedStage('');
    } catch { setError('تعذّر تطبيق المرشحات؛ بقي التقرير السابق دون تغيير.'); }
    finally { setBusy(false); }
  }

  async function printCurrentSelection() {
    if (busy) return;
    const selected = { ...filters };
    setBusy(true); setError('');
    try {
      const next = await fetchScopedReport(selected, getAbanmiReport);
      setFilters(selected); setApplied(selected); setReport(next);
      setPrintRequested(true);
    } catch {
      setError('تعذّر تجهيز PDF بالنطاق المختار؛ لم تُطبع بيانات من منطقة أخرى.');
      setBusy(false);
    }
  }

  const selectedAssociation = catalog?.associations.find((row) => row.id === applied.associationId);
  const context = selectedAssociation ? selectedAssociation.name : applied.region ? `منطقة ${applied.region}` : 'المشروع كاملًا';
  const visibleApplications = analysis?.applications.filter((row) => !selectedStage || applicationStage(row) === selectedStage) ?? [];

  const regionOptions = [...new Set([...(catalog?.byRegion.map((row) => row.region) ?? []), ...(catalog?.applications?.map((row) => row.region) ?? [])])].sort();
  return <AppShell user={user}><div className="abanmi-report-page">
    <header className="zad-hero2"><div className="zad-hero2-text"><h1>تقرير تقدم المشروع</h1><div className="zad-hero2-fresh">تحليل التقديم والاحتياجات والتنفيذ حسب الجمعية أو المنطقة</div></div></header>
    <section className="abanmi-print-controls" style={{ ...cardStyle, marginBottom: 20 }}>
      <div className="form-grid">
        <label style={labelStyle}>من<input style={inputStyle} type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label style={labelStyle}>إلى<input style={inputStyle} type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <label style={labelStyle}>الجمعية<select style={inputStyle} value={filters.associationId} onChange={(event) => setFilters({ ...filters, associationId: event.target.value, region: '' })}><option value="">كل الجمعيات</option>{catalog?.associations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label style={labelStyle}>المنطقة<select style={inputStyle} value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value, associationId: '' })}><option value="">كل المناطق</option>{regionOptions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
      </div>
      <div className="button-row"><button style={primaryButtonStyle} disabled={busy} onClick={() => void load()}>{busy ? 'جارٍ إعداد التقرير…' : 'تطبيق المرشحات'}</button><button style={secondaryButtonStyle} disabled={busy} onClick={() => void downloadAbanmiReport(filters).catch(() => setError('تعذّر تصدير التقرير.'))}>تصدير XLSX</button><button style={secondaryButtonStyle} disabled={busy} onClick={() => void printCurrentSelection()}>حفظ PDF / طباعة</button></div>
      <small>التصدير والطباعة يستخدمان الاختيار الحالي للمنطقة والجمعية. اختيار مرحلة الطلب يصفّي الجدول على الشاشة والطباعة فقط.</small>
    </section>
    {error && <ErrorState message={error} />}{!report && !error && <LoadingState />}
    {report && analysis && <div className="abanmi-report-print" dir="rtl">
      <OfficialReportHeader title={`تقرير تقدم ${context}`} audience="مؤسسة سليمان أبانمي الأهلية" generatedAt={report.generatedAt} period={applied.from || applied.to ? `${applied.from || 'البداية'} — ${applied.to || 'الآن'}` : 'جميع البيانات'} />

      <section id="analysis" className="abanmi-report-lead">
        <div><span className="abanmi-eyebrow">القراءة التنفيذية</span><h2>{context}</h2><p>يعرض التقرير أين وصل المشروع، وما الذي يحتاج متابعة، والأعداد التي تستند إليها هذه القراءة.</p></div>
        <div className="abanmi-progress-panel"><span>تغطية الاحتياجات المعتمدة بالتسليم</span><strong>{analysis.progressPercent === null ? '—' : `${analysis.progressPercent}٪`}</strong><div className="abanmi-progress-track"><span style={{ width: `${analysis.progressPercent ?? 0}%` }} /></div><small>{analysis.deliveredDevices} جهاز مسلّم من أصل {analysis.approvedNeeds} احتياج معتمد</small></div>
      </section>
      <div className="abanmi-report-metrics">
        <Metric label="طلبات الانضمام" value={analysis.applications.length} />
        <Metric label="الجمعيات المشاركة" value={report.overall.associations} />
        <Metric label="المستفيدون المعتمدون" value={analysis.approvedBeneficiaries} />
        <Metric label="الاحتياجات المعتمدة" value={analysis.approvedNeeds} />
        <Metric label="الأجهزة المسلّمة" value={analysis.deliveredDevices} />
      </div>
      <section className="abanmi-report-section" aria-label="تفسير المؤشرات"><h2>ماذا تقول الأرقام؟</h2><div className="abanmi-insights">{analysis.insights.map((insight) => <p key={insight}>{insight}</p>)}</div></section>

      <section id="applications" className="abanmi-report-section"><h2>تقديم الجمعيات والاختيار</h2><p>طلبات الانضمام ليست هي عدد الجمعيات المشاركة؛ تُحسب المشاركة بعد إنشاء الجمعية في المنصة.</p>
        <div className="abanmi-stage-grid">{stages.map((stage) => <button type="button" key={stage} className="abanmi-stage-card" aria-pressed={selectedStage === stage} onClick={() => setSelectedStage(selectedStage === stage ? '' : stage)}><strong>{analysis.stages[stage]}</strong><span>{APPLICATION_STAGE_LABELS[stage]}</span><small>{selectedStage === stage ? 'إظهار الجميع' : 'عرض الأسماء'}</small></button>)}</div>
        <ReportTable title={selectedStage ? APPLICATION_STAGE_LABELS[selectedStage] : 'جميع الطلبات'} headers={['الطلب', 'الجمعية المتقدمة', 'المنطقة', 'مرحلة الطلب', 'تاريخ التقديم']} rows={visibleApplications.map((row) => [row.publicCode, row.name, row.region, APPLICATION_STAGE_LABELS[applicationStage(row)], new Date(row.submittedAt).toLocaleDateString('ar-SA')])} />
      </section>

      <section id="associations" className="abanmi-report-section"><h2>تقدم الجمعيات المشاركة</h2><p>التقدم = الأجهزة المسلّمة ÷ الاحتياجات المعتمدة لكل جمعية، وليس تقييمًا لسرعتها الزمنية.</p>
        <div className="table-scroll"><table><thead><tr><th>الجمعية</th><th>المنطقة</th><th>المستفيدون</th><th>الاحتياجات</th><th>الأجهزة</th><th>المسلّم</th><th>التقدم</th><th>الحالة</th></tr></thead><tbody>{analysis.associations.length ? analysis.associations.map((row) => <tr key={row.id}><td><Link className="abanmi-print-link" href={`/abanmi/reports?associationId=${row.id}#analysis`}>{row.name}</Link></td><td>{row.region}</td><td>{row.beneficiaries}</td><td>{row.approvedNeeds}</td><td>{row.devices}</td><td>{row.delivered}</td><td>{row.progressPercent === null ? '—' : `${row.progressPercent}٪`}</td><td>{row.failedDeliveries ? `${row.failedDeliveries} تسليم متعذر` : reportValueLabel(row.status)}</td></tr>) : <tr><td colSpan={8}>لا توجد جمعيات ضمن النطاق المحدد.</td></tr>}</tbody></table></div>
      </section>

      <section id="beneficiaries" className="abanmi-report-section"><h2>مراجعة المستفيدين</h2><div className="abanmi-report-metrics"><Metric label="معتمدون" value={analysis.approvedBeneficiaries} /><Metric label="قيد المراجعة" value={analysis.pendingBeneficiaries} /><Metric label="مرفوضون" value={analysis.rejectedBeneficiaries} /></div><p>هذه أعداد مجمعة فقط؛ لا يعرض التقرير أسماء المستفيدين أو بيانات اتصالهم.</p></section>
      <section id="needs" className="abanmi-report-section"><h2>الاحتياجات والأجهزة</h2><div className="abanmi-report-metrics"><Metric label="احتياجات معتمدة" value={analysis.approvedNeeds} /><Metric label="بانتظار القرار" value={analysis.pendingNeeds} /><Metric label="احتياجات مرفوضة" value={analysis.rejectedNeeds} /><Metric label="أجهزة بالمستودع" value={analysis.warehouseDevices} /><Metric label="أجهزة مع المندوب" value={analysis.withDelegateDevices} /></div>
        <ReportTable title="تفصيل الاحتياجات حسب نوع الجهاز" headers={['الجمعية', 'نوع الجهاز', 'القرار', 'العدد']} rows={report.beneficiariesAndNeeds.needs.map((row) => [associationName(report, row.associationId), reportValueLabel(row.deviceType), reportValueLabel(row.decisionStatus), row._count._all])} />
        <ReportTable title="موضع الأجهزة الفعلية" headers={['الجمعية', 'نوع الجهاز', 'الحالة', 'العدد']} rows={report.devicesAndInventory.map((row) => [associationName(report, row.associationId), reportValueLabel(row.deviceType), reportValueLabel(row.status), row._count._all])} />
      </section>
      <section id="deliveries" className="abanmi-report-section"><h2>التسليم ومواطن المتابعة</h2><div className="abanmi-report-metrics"><Metric label="مهمات التسليم" value={total(report.deliveryAndExecution)} /><Metric label="أُغلقت نهائيًا" value={analysis.closedDeliveries} /><Metric label="بانتظار الاعتماد" value={analysis.pendingApprovalDeliveries} /><Metric label="تعذّر التسليم" value={analysis.failedDeliveries} /></div>
        {analysis.alerts.length ? <div className="abanmi-report-alerts">{analysis.alerts.map((alert) => <p key={alert.label}><strong>{alert.count} {alert.label}</strong><span>{alert.action}</span></p>)}</div> : <p>لا تظهر تعثرات تشغيلية في المؤشرات المتاحة.</p>}
        <ReportTable title="تفصيل مهمات التسليم" headers={['الجمعية', 'الحالة', 'العدد']} rows={report.deliveryAndExecution.map((row) => [associationName(report, row.associationId), reportValueLabel(row.status), row._count._all])} />
      </section>
      {!applied.associationId && <section className="abanmi-report-section"><h2>المناطق</h2><div className="abanmi-region-grid">{analysis.regions.map((row) => <article key={row.region}><Link className="abanmi-print-link" href={`/abanmi/reports?region=${encodeURIComponent(row.region)}#analysis`}>{row.region}</Link><strong>{row.associations} جمعيات</strong><span>{row.beneficiaries} مستفيد · {row.approvedNeeds} احتياج · {row.delivered} مسلّم</span><small>التغطية: {row.progressPercent === null ? '—' : `${row.progressPercent}٪`}</small></article>)}</div></section>}
      <section className="abanmi-report-method"><h2>أساس القراءة</h2><p>نسبة التغطية هي عدد الأجهزة المسلّمة إلى الاحتياجات المعتمدة، بحد أقصى ١٠٠٪. لا تصف هذه النسبة سرعة الجمعية أو تأخرها؛ يلزم هدف زمني معتمد للمقارنة. عند تحديد فترة، تُصفّى الطلبات والمستفيدون والاحتياجات ومهمات التسليم بتاريخ إنشاء سجلاتها، بينما حالة الجمعيات والأجهزة لقطة وقت إعداد التقرير.</p><p>المصدر: سجلات منصة جمعية الزاد. أُعدّ التقرير في {new Date(report.generatedAt).toLocaleString('ar-SA')}.</p></section>
    </div>}
  </div></AppShell>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="abanmi-report-metric"><strong>{value}</strong><span>{label}</span></div>; }
function associationName(report: AbanmiReport, id: string) { return report.associations.find((row) => row.id === id)?.name ?? '—'; }
function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: Array<Array<string | number>> }) { return <div className="abanmi-report-table"><h3>{title}</h3><div className="table-scroll"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}>لا توجد بيانات ضمن النطاق المحدد.</td></tr>}</tbody></table></div></div>; }
