'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { ErrorState, LoadingState } from '../../components/States';
import { downloadAbanmiReport, getAbanmiReport, type AbanmiReport } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, inputStyle, labelStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui';

export default function AbanmiReportsPage() {
  const { user, loading } = useRoleGuard(['ABANMI']);
  const [report, setReport] = useState<AbanmiReport | null>(null);
  const [filters, setFilters] = useState({ from: '', to: '', associationId: '', region: '' });
  const [error, setError] = useState('');
  const load = () => getAbanmiReport(filters).then(setReport).catch(() => setError('تعذّر تحميل التقرير.'));
  useEffect(() => { if (user) void load(); /* initial authenticated load only */ }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading || !user) return null;
  return <AppShell user={user}>
    <header className="zad-hero2"><div className="zad-hero2-text"><h1>تقارير المشروع</h1><div className="zad-hero2-fresh">تقارير تجميعية قابلة للتصفية والتصدير والطباعة</div></div></header>
    <section className="abanmi-print-controls" style={{ ...cardStyle, marginBottom: 20 }}><div className="form-grid">
      <label style={labelStyle}>من<input style={inputStyle} type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label style={labelStyle}>إلى<input style={inputStyle} type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <label style={labelStyle}>الجمعية<select style={inputStyle} value={filters.associationId} onChange={(event) => setFilters({ ...filters, associationId: event.target.value })}><option value="">كل الجمعيات</option>{report?.associations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label style={labelStyle}>المنطقة<select style={inputStyle} value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })}><option value="">كل المناطق</option>{[...new Set(report?.associations.map((row) => row.region) ?? [])].map((region) => <option key={region}>{region}</option>)}</select></label>
    </div><div className="button-row"><button style={primaryButtonStyle} onClick={load}>تطبيق المرشحات</button><button style={secondaryButtonStyle} onClick={() => void downloadAbanmiReport(filters).catch(() => setError('تعذّر تصدير التقرير.'))}>تصدير XLSX</button><button style={secondaryButtonStyle} onClick={() => window.print()}>طباعة التقرير</button></div></section>
    {error && <ErrorState message={error} />}{!report && !error && <LoadingState />}
    {report && <div className="abanmi-report-print">
      <h2>الملخص العام</h2><div className="zad-summary-strip2"><Metric label="الجمعيات" value={report.overall.associations} /><Metric label="المستفيدون" value={report.overall.beneficiaries} /><Metric label="الاحتياجات المعتمدة" value={report.overall.approvedNeeds} /><Metric label="الأجهزة" value={report.overall.devices} /><Metric label="التسليمات" value={report.overall.deliveries} /></div>
      <ReportTable title="حسب الجمعية" headers={['الرمز', 'الجمعية', 'المنطقة', 'المدينة', 'الحالة']} rows={report.associations.map((row) => [row.publicCode, row.name, row.region, row.city, row.status])} />
      <ReportTable title="المخزون والأجهزة" headers={['الجمعية', 'نوع الجهاز', 'الحالة', 'العدد']} rows={report.devicesAndInventory.map((row) => [associationName(report, row.associationId), row.deviceType, row.status, row._count._all])} />
      <ReportTable title="التسليم والتنفيذ" headers={['الجمعية', 'الحالة', 'العدد']} rows={report.deliveryAndExecution.map((row) => [associationName(report, row.associationId), row.status, row._count._all])} />
      <ReportTable title="إغلاق الجمعيات" headers={['الجمعية', 'حالة التقرير', 'تاريخ الإغلاق']} rows={report.associationClosure.map((row) => [associationName(report, row.participation.associationId ?? ''), row.status, row.closedAt ? new Date(row.closedAt).toLocaleDateString('ar-SA') : '—'])} />
      <p className="zad-section-meta2">أُنشئ التقرير: {new Date(report.generatedAt).toLocaleString('ar-SA')} — بيانات المستفيدين الشخصية غير مضمنة.</p>
    </div>}
  </AppShell>;
}

function Metric({ label, value }: { label: string; value: number }) { return <span className="zad-sum-card2"><span className="zad-sv2b">{value}</span><span className="zad-sl2b">{label}</span></span>; }
function associationName(report: AbanmiReport, id: string) { return report.associations.find((row) => row.id === id)?.name ?? '—'; }
function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: Array<Array<string | number>> }) { return <section style={{ ...cardStyle, marginTop: 20, minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}><h2>{title}</h2><div className="table-scroll"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}>لا توجد بيانات ضمن النطاق المحدد.</td></tr>}</tbody></table></div></section>; }
