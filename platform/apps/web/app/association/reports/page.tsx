'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { ErrorState, LoadingState } from '../../components/States';
import { ApiClientError, getAssociationReport, type AssociationReport } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, inputStyle, mutedStyle, primaryButtonStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function CounterTable({ title, values }: { title: string; values: Record<string, number> }) {
  const rows = Object.entries(values);
  return (
    <section style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
      <h2 style={{ fontSize: 17, margin: 0, padding: '16px 16px 6px' }}>{title}</h2>
      {rows.length === 0 ? <p style={{ ...mutedStyle, padding: '0 16px 16px' }}>لا توجد بيانات ضمن هذا التصنيف.</p> : (
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>الحالة / النوع</th><th style={thStyle}>العدد</th></tr></thead>
          <tbody>{rows.map(([label, count]) => <tr key={label}><td style={tdStyle}>{label}</td><td style={tdStyle}>{count}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

export default function AssociationReportsPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ASSOCIATION']);
  const today = new Date();
  const [from, setFrom] = useState(() => isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))));
  const [to, setTo] = useState(() => isoDate(today));
  const [report, setReport] = useState<AssociationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setReport(await getAssociationReport(from, to));
    } catch (err) {
      setReport(null);
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل التقرير التشغيلي.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) void load();
    // The initial tenant report is loaded once after the role guard succeeds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <h1 style={{ marginBottom: 6 }}>تقارير الجمعية</h1>
      <p style={{ ...mutedStyle, marginTop: 0 }}>مؤشرات تشغيلية من بيانات الجمعية الفعلية، دون إدخال بيانات يدوية أو تقديرات.</p>

      <form onSubmit={(event) => { event.preventDefault(); void load(); }} style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', margin: '18px 0' }}>
        <label style={{ display: 'grid', gap: 5 }}>من<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} style={{ ...inputStyle, width: 180 }} required /></label>
        <label style={{ display: 'grid', gap: 5 }}>إلى<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} style={{ ...inputStyle, width: 180 }} required /></label>
        <button type="submit" style={primaryButtonStyle} disabled={loading}>تحديث التقرير</button>
      </form>

      {error && <ErrorState message={error} />}
      {loading && <LoadingState label="جارٍ احتساب التقرير من بيانات الإنتاج…" />}

      {!loading && report && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              ['المستفيدون', report.beneficiaries.total],
              ['الاحتياجات', report.needs.total],
              ['الأجهزة', report.inventory.total],
              ['محاضر الفترة', report.receipts.periodTotal],
              ['مهام التسليم', report.deliveries.currentTotal],
              ['محاولات الفترة', report.deliveries.attemptsInPeriod],
              ['حركات العهدة', report.custody.movementsInPeriod],
            ].map(([label, value]) => <section key={String(label)} style={cardStyle}><span style={mutedStyle}>{label}</span><strong style={{ display: 'block', fontSize: 25, marginTop: 5 }}>{value}</strong></section>)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <CounterTable title="حالة المستفيدين" values={report.beneficiaries.byReviewStatus} />
            <CounterTable title="قرارات الاحتياجات" values={report.needs.byDecisionStatus} />
            <CounterTable title="تنفيذ الاحتياجات" values={report.needs.byFulfillmentStatus} />
            <CounterTable title="حالة المخزون" values={report.inventory.byStatus} />
            <CounterTable title="أنواع الأجهزة" values={report.inventory.byDeviceType} />
            <CounterTable title="محاضر الاستلام في الفترة" values={report.receipts.byStatus} />
            <CounterTable title="حالة مهام التسليم" values={report.deliveries.byStatus} />
            <CounterTable title="محاولات التسليم في الفترة" values={report.deliveries.attemptsByStatus} />
          </div>

          <section style={{ ...cardStyle, marginTop: 12, padding: 0, overflowX: 'auto' }}>
            <h2 style={{ fontSize: 17, margin: 0, padding: '16px 16px 6px' }}>أحدث العمليات خلال الفترة</h2>
            {report.recentOperations.length === 0 ? <p style={{ ...mutedStyle, padding: '0 16px 16px' }}>لا توجد عمليات مسجلة خلال الفترة.</p> : (
              <table style={tableStyle}>
                <thead><tr><th style={thStyle}>العملية</th><th style={thStyle}>الكيان</th><th style={thStyle}>الوقت</th></tr></thead>
                <tbody>{report.recentOperations.map((row, index) => <tr key={`${row.createdAt}-${index}`}><td style={tdStyle}>{row.action}</td><td style={tdStyle}>{row.entityType}</td><td style={tdStyle}>{new Date(row.createdAt).toLocaleString('ar-SA')}</td></tr>)}</tbody>
              </table>
            )}
          </section>
          <p style={mutedStyle}>الفترة: {report.period.from} — {report.period.to} · آخر احتساب: {new Date(report.period.generatedAt).toLocaleString('ar-SA')}</p>
        </>
      )}
    </AppShell>
  );
}
