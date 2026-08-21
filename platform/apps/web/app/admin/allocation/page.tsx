'use client';

import { useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { AssociationSelect } from '../../lib/association-select';
import { useRoleGuard } from '../../lib/use-role-guard';
import { ApiClientError, DEVICE_TYPE_LABELS, getAllocationBaskets, runAllocation, type AllocationBasket, type AllocationBaskets, type DeviceType } from '../../lib/api';
import { cardStyle, errorStyle, labelStyle, mutedStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui';

export default function AdminAllocationPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [associationId, setAssociationId] = useState('');
  const [data, setData] = useState<AllocationBaskets | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    if (!associationId) return;
    setBusy(true); setError('');
    try { setData(await getAllocationBaskets(associationId)); } catch (e) { setError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل جاهزية التخصيص.'); } finally { setBusy(false); }
  }
  async function run() {
    if (!associationId) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await runAllocation(associationId); setData(result.baskets); setNotice(result.skipped ? `لم تُنشأ مطابقة جديدة: ${result.skipped}` : `تمت المطابقة: ${result.filled} جهازًا و${result.completed} سلة مكتملة.`); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : 'تعذّر تشغيل التخصيص.'); } finally { setBusy(false); }
  }
  if (loading || !user) return null;
  return <AppShell user={user}>
    <h1>تشغيل التخصيص</h1><p style={mutedStyle}>يعرض المحرك الفعلي فقط. لا يمكن إسناد مندوب قبل اكتمال السلة.</p>
    <div style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}><label style={{ ...labelStyle, minWidth: 260 }}>الجمعية<AssociationSelect value={associationId} onChange={(id) => { setAssociationId(id); setData(null); setNotice(''); }} /></label><button type="button" style={secondaryButtonStyle} disabled={!associationId || busy} onClick={load}>{busy ? 'جارٍ التحميل…' : 'تحديث الحالة'}</button><button type="button" style={primaryButtonStyle} disabled={!associationId || busy} onClick={run}>{busy ? 'جارٍ التشغيل…' : 'تشغيل/إعادة محاولة التخصيص'}</button></div>
    {error && <p role="alert" style={errorStyle}>{error}</p>}{notice && <p style={mutedStyle}>{notice}</p>}
    {data && <><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0' }}><Stat label="إجمالي السلال" value={data.summary.total} /><Stat label="مكتملة" value={data.summary.complete} /><Stat label="ناقصة" value={data.summary.incomplete} /><Stat label="جاهزة للإسناد" value={data.summary.readyForAssignment} /></div><p style={mutedStyle}>المخزون الحر: {Object.entries(data.stock).map(([type, qty]) => `${DEVICE_TYPE_LABELS[type as DeviceType]}: ${qty}`).join(' — ')}</p><BasketSection title="السلال المكتملة" rows={data.complete} empty="لا توجد سلال مكتملة." /><BasketSection title="السلال الناقصة" rows={data.incomplete} empty="لا توجد سلال ناقصة." /></>}
    {!data && !busy && associationId && !error && <p style={mutedStyle}>حدّد “تحديث الحالة” لقراءة سلال الجمعية.</p>}
  </AppShell>;
}
function Stat({ label, value }: { label: string; value: number }) { return <div style={{ ...cardStyle, minWidth: 130 }}><div style={mutedStyle}>{label}</div><strong style={{ fontSize: 24 }}>{value}</strong></div>; }
function BasketSection({ title, rows, empty }: { title: string; rows: AllocationBasket[]; empty: string }) { return <section style={{ marginTop: 20 }}><h2 style={{ fontSize: 18 }}>{title}</h2>{rows.length === 0 ? <p style={mutedStyle}>{empty}</p> : rows.map((row) => <article key={row.beneficiary.id} style={{ ...cardStyle, marginBottom: 10 }}><strong>{row.beneficiary.name}</strong> <span style={mutedStyle}>({row.beneficiary.publicCode}) — {row.association.name}</span><p style={mutedStyle}>{row.readyForAssignment ? 'جاهز لإسناد المندوب' : row.complete ? 'مكتملة لكن ليست في مرحلة الإسناد الآن' : 'لا يمكن الإسناد قبل اكتمال السلة'}</p>{row.needs.map((need) => <div key={need.id} style={mutedStyle}>{DEVICE_TYPE_LABELS[need.deviceType]}: {need.allocation ? `الجهاز ${need.allocation.device.publicCode}` : 'غير مخصص'}</div>)}{row.missing.map((missing) => <div key={missing.needId} style={errorStyle}>{DEVICE_TYPE_LABELS[missing.deviceType]}: {missing.reason}</div>)}</article>)}</section>; }
