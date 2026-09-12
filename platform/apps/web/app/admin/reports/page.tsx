'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { ErrorState, LoadingState } from '../../components/States';
import { downloadAdminReport, getAdminReport, type AbanmiReport } from '../../lib/api';
import { reportValueLabel } from '../../lib/report-labels';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, inputStyle, labelStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui';

export default function AdminReportsPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [report, setReport] = useState<AbanmiReport | null>(null);
  const [filters, setFilters] = useState({ from: '', to: '', associationId: '', region: '' });
  const [error, setError] = useState('');
  const load = () => { setError(''); getAdminReport(filters).then(setReport).catch(() => setError('تعذّر تحميل التقرير.')); };
  useEffect(() => { if (user) void load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading || !user) return null;
  return <AppShell user={user}>
    <header className="zad-hero2"><div className="zad-hero2-text"><h1>التقارير</h1><div className="zad-hero2-fresh">ملخص تنفيذي موحّد لبيانات المشروع</div></div></header>
    <section className="abanmi-print-controls" style={{ ...cardStyle, marginBottom: 20 }}><div className="form-grid">
      <label style={labelStyle}>من<input style={inputStyle} type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
      <label style={labelStyle}>إلى<input style={inputStyle} type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
      <label style={labelStyle}>الجمعية<select style={inputStyle} value={filters.associationId} onChange={e => setFilters({ ...filters, associationId: e.target.value })}><option value="">كل الجمعيات</option>{report?.associations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label style={labelStyle}>المنطقة<select style={inputStyle} value={filters.region} onChange={e => setFilters({ ...filters, region: e.target.value })}><option value="">كل المناطق</option>{[...new Set(report?.associations.map(row => row.region) ?? [])].map(region => <option key={region}>{region}</option>)}</select></label>
    </div><div className="button-row"><button type="button" style={primaryButtonStyle} onClick={load}>تطبيق المرشحات</button><button type="button" style={secondaryButtonStyle} onClick={() => void downloadAdminReport(filters).catch(() => setError('تعذّر تصدير التقرير.'))}>تصدير XLSX</button><button type="button" style={secondaryButtonStyle} onClick={() => window.print()}>طباعة التقرير</button></div></section>
    {error && <ErrorState message={error} />}{!report && !error && <LoadingState />}
    {report && <div className="abanmi-report-print"><h2>ملخص المشروع</h2><div className="zad-summary-strip2"><Metric label="الجمعيات" value={report.overall.associations} /><Metric label="المستفيدون" value={report.overall.beneficiaries} /><Metric label="الاحتياجات المعتمدة" value={report.overall.approvedNeeds} /><Metric label="الأجهزة والمخزون" value={report.overall.devices} /><Metric label="التسليم والتنفيذ" value={report.overall.deliveries} /></div>
      <ReportTable title="الجمعيات والمناطق" headers={['الرمز', 'الجمعية', 'المنطقة', 'المدينة', 'الحالة']} rows={report.associations.map(row => [row.publicCode, row.name, row.region, row.city, reportValueLabel(row.status)])} />
      <ReportTable title="المستفيدون والاحتياجات" headers={['الجمعية', 'الجهاز', 'قرار الاحتياج', 'التنفيذ', 'العدد']} rows={report.beneficiariesAndNeeds.needs.map(row => [associationName(report, row.associationId), reportValueLabel(row.deviceType), reportValueLabel(row.decisionStatus), reportValueLabel(row.fulfillmentStatus), row._count._all])} />
      <ReportTable title="الأجهزة والمخزون" headers={['الجمعية', 'نوع الجهاز', 'الحالة', 'العدد']} rows={report.devicesAndInventory.map(row => [associationName(report, row.associationId), reportValueLabel(row.deviceType), reportValueLabel(row.status), row._count._all])} />
      <ReportTable title="التوريد والاستلام" headers={['الجمعية', 'المسار', 'الحالة', 'العدد']} rows={[
        ...report.procurement.purchaseOrders.map(row => [associationName(report, row.associationId), 'أوامر الشراء', reportValueLabel(row.status), row._count._all]),
        ...report.procurement.shipments.map(row => [associationName(report, row.associationId), 'الشحنات', reportValueLabel(row.status), row._count._all]),
        ...report.procurement.receipts.map(row => [associationName(report, row.associationId), 'الاستلام', reportValueLabel(row.status), row._count._all]),
      ]} />
      <ReportTable title="التخصيص" headers={['الجمعية', 'الحالة', 'العدد']} rows={report.allocations.map(row => [associationName(report, row.associationId), reportValueLabel(row.status), row._count._all])} />
      <ReportTable title="التخصيص والتسليم" headers={['الجمعية', 'الحالة', 'العدد']} rows={report.deliveryAndExecution.map(row => [associationName(report, row.associationId), reportValueLabel(row.status), row._count._all])} />
      <ReportTable title="حالة تنفيذ الجمعيات والإغلاق" headers={['الجمعية', 'الحالة', 'تاريخ الإغلاق']} rows={report.associationClosure.map(row => [associationName(report, row.participation.associationId ?? ''), reportValueLabel(row.status), row.closedAt ? new Date(row.closedAt).toLocaleDateString('ar-SA') : '—'])} />
      <ReportTable title="تقدم أنشطة المشروع" headers={['المرحلة', 'النشاط', 'الحالة', 'الإنجاز']} rows={report.activities.map(row => [row.phaseName, row.mainActivityName, reportValueLabel(row.status), `${row.completionPercent}%`])} />
      <p className="zad-section-meta2">أُنشئ التقرير: {new Date(report.generatedAt).toLocaleString('ar-SA')} — لا يتضمن بيانات الاتصال أو العناوين التفصيلية للمستفيدين.</p>
    </div>}
  </AppShell>;
}

function Metric({ label, value }: { label: string; value: number }) { return <span className="zad-sum-card2"><span className="zad-sv2b">{value}</span><span className="zad-sl2b">{label}</span></span>; }
function associationName(report: AbanmiReport, id: string) { return report.associations.find(row => row.id === id)?.name ?? '—'; }
function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: Array<Array<string | number>> }) { return <section style={{ ...cardStyle, marginTop: 20, minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}><h2>{title}</h2><div className="table-scroll"><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}>لا توجد بيانات ضمن النطاق المحدد.</td></tr>}</tbody></table></div></section>; }
