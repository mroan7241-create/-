'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Package, Truck, Users } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { ErrorState, LoadingState } from '../components/States';
import { getAbanmiReport, type AbanmiReport } from '../lib/api';
import { useRoleGuard } from '../lib/use-role-guard';
import { primaryButtonStyle, secondaryButtonStyle } from '../lib/ui';

export default function AbanmiDashboardPage() {
  const { user, loading } = useRoleGuard(['ABANMI']);
  const [report, setReport] = useState<AbanmiReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (user) getAbanmiReport().then(setReport).catch(() => setError('تعذّر تحميل لوحة المشروع.')); }, [user]);
  if (loading || !user) return null;
  const cards = report ? [
    { label: 'الجمعيات المشاركة', value: report.overall.associations, icon: Building2 },
    { label: 'المستفيدون', value: report.overall.beneficiaries, icon: Users },
    { label: 'الأجهزة', value: report.overall.devices, icon: Package },
    { label: 'عمليات التسليم', value: report.overall.deliveries, icon: Truck },
  ] : [];
  return <AppShell user={user}>
    <header className="zad-hero2"><div className="zad-hero2-text"><h1>لوحة مشروع الأجهزة الكهربائية</h1><div className="zad-hero2-fresh">عرض تنفيذي تجميعي — للقراءة فقط</div></div></header>
    {error && <ErrorState message={error} />}{!report && !error && <LoadingState />}
    {report && <>
      <div className="zad-section-head2"><div className="zad-framed-title2"><div className="zad-rule2" /><h2>المؤشرات الرئيسية</h2></div></div>
      <div className="zad-modules2">{cards.map(({ label, value, icon: Icon }) => <article className="zad-module2" key={label}><div className="zad-module2-head"><span className="zad-module2-icon"><Icon size={18} /></span><strong>{label}</strong></div><div className="zad-primary-block2"><span className="zad-fig2">{value}</span></div></article>)}</div>
      <div className="zad-section-head2"><div className="zad-framed-title2"><div className="zad-rule2" /><h2>التغطية حسب المنطقة</h2></div></div>
      <div className="zad-summary-strip2">{report.byRegion.length ? report.byRegion.map((row) => <span className="zad-sum-card2" key={row.region}><div className="zad-sv2b">{row.associations}</div><div className="zad-sl2b">{row.region}</div></span>) : <p>لا توجد بيانات مناطق ضمن النطاق الحالي.</p>}</div>
      <div className="button-row" style={{ marginTop: 24 }}><Link style={{ ...primaryButtonStyle, textDecoration: 'none' }} href="/abanmi/reports">فتح التقارير التفصيلية</Link><Link style={{ ...secondaryButtonStyle, textDecoration: 'none' }} href="/abanmi/activities">متابعة تنفيذ المشروع</Link></div>
      <p className="zad-section-meta2" style={{ marginTop: 20 }}>لا تتضمن هذه البوابة بيانات الاتصال أو العناوين أو بيانات الدخول الخاصة بالمستفيدين.</p>
    </>}
  </AppShell>;
}
