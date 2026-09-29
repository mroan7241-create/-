'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '../../components/AppShell';
import { useRoleGuard } from '../../lib/use-role-guard';
import { apiFetch, DEVICE_TYPE_LABELS, DEVICE_TYPES, newOpId, type DeviceType } from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, mutedStyle, primaryButtonStyle, secondaryButtonStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

type CentralStockSummary = {
  balances: { deviceType: DeviceType; contractedQty: number; receivedQty: number; distributedQty: number; availableQty: number }[];
  receipts: { id: string; deviceType: DeviceType; quantity: number; reference: string; createdAt: string }[];
  dispatches: { id: string; deviceType: DeviceType; quantity: number; shipment: { publicCode: string; association: { name: string } } }[];
};

export default function CentralStockPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [data, setData] = useState<CentralStockSummary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedType, setSelectedType] = useState<DeviceType>('REFRIGERATOR');
  const [contractedQty, setContractedQty] = useState('');
  const [arrivalQty, setArrivalQty] = useState('');
  const [reference, setReference] = useState('');

  const reload = useCallback(async () => {
    try { setData(await apiFetch<CentralStockSummary>('/central-stock')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذّر تحميل مخزون الزاد'); }
  }, []);

  useEffect(() => { if (user) void reload(); }, [user, reload]);

  async function saveContract() {
    const quantity = Number(contractedQty);
    if (!Number.isInteger(quantity) || quantity < 0 || contractedQty.trim() === '') { setError('أدخل العدد الكلي المتعاقد عليه كعدد صحيح.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch('/central-stock/contract', { method: 'POST', body: JSON.stringify({ deviceType: selectedType, contractedQty: quantity, opId: newOpId() }) });
      setNotice('حُفظ العدد المتعاقد عليه.'); setContractedQty(''); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذّر حفظ العدد المتعاقد عليه'); }
    finally { setBusy(false); }
  }

  async function recordArrival() {
    const quantity = Number(arrivalQty);
    if (!Number.isInteger(quantity) || quantity < 1 || !reference.trim()) { setError('أدخل كمية واصلة موجبة ومرجع استلام واضح.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch('/central-stock/receipts', { method: 'POST', body: JSON.stringify({ deviceType: selectedType, quantity, reference: reference.trim(), opId: newOpId() }) });
      setNotice('سُجّل الاستلام في مخزون الزاد.'); setArrivalQty(''); setReference(''); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذّر تسجيل الاستلام'); }
    finally { setBusy(false); }
  }

  if (loading || !user) return null;
  return <AppShell user={user}>
    <h1>مخزون الزاد المركزي</h1>
    <p style={mutedStyle}>سجّل العدد الكلي المتعاقد عليه، ثم الكميات التي استلمتها الزاد فعليًا. الشحنات الجديدة إلى الجمعيات تُخصم من المتاح تلقائيًا؛ تأكيد استلام الجمعية يبقى في محاضر الاستلام.</p>
    {error && <p role="alert" style={errorStyle}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12, marginBottom: 18 }}>
      {data?.balances.map((row) => <section key={row.deviceType} style={cardStyle}>
        <h2>{DEVICE_TYPE_LABELS[row.deviceType]}</h2>
        <p>المتعاقد عليه: <strong>{row.contractedQty}</strong></p>
        <p>الواصل للزاد: <strong>{row.receivedQty}</strong></p>
        <p>الموجّه للجمعيات: <strong>{row.distributedQty}</strong></p>
        <p>المتاح للتوجيه: <strong>{row.availableQty}</strong></p>
      </section>)}
    </div>
    <section style={{ ...cardStyle, marginBottom: 18 }}>
      <h2>تحديث المخزون</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={labelStyle}>نوع الجهاز
          <select style={inputStyle} value={selectedType} onChange={(event) => setSelectedType(event.target.value as DeviceType)}>
            {DEVICE_TYPES.map((type) => <option key={type} value={type}>{DEVICE_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <label style={labelStyle}>العدد الكلي المتعاقد عليه
          <input style={inputStyle} type="number" min="0" step="1" value={contractedQty} onChange={(event) => setContractedQty(event.target.value)} />
        </label>
        <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void saveContract()}>حفظ العدد الكلي</button>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginTop: 16 }}>
        <label style={labelStyle}>الكمية الواصلة الآن
          <input style={inputStyle} type="number" min="1" step="1" value={arrivalQty} onChange={(event) => setArrivalQty(event.target.value)} />
        </label>
        <label style={labelStyle}>مرجع الاستلام
          <input style={inputStyle} maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="رقم الفاتورة أو المحضر" />
        </label>
        <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => void recordArrival()}>تسجيل الوارد</button>
      </div>
      <p style={mutedStyle}>إذا تجاوز الوارد العدد المتعاقد عليه، صحّح العدد الكلي أولًا. لا تُسجّل الأجهزة الواردة مرتين.</p>
    </section>
    <section style={{ ...cardStyle, marginBottom: 18 }}>
      <h2>توجيه الكميات للجمعيات</h2>
      <p>أنشئ أمر شراء للجمعية ثم شحنة بالكمية المناسبة. لا يمكن إنشاء الشحنة إذا تجاوزت مخزون الزاد المتاح.</p>
      <Link href="/admin/procurement" style={primaryButtonStyle}>الانتقال إلى المشتريات والشحنات</Link>
    </section>
    <section style={{ ...cardStyle, marginBottom: 18, overflowX: 'auto' }}>
      <h2>آخر الكميات الموجّهة</h2>
      {data && !data.dispatches.length && <p style={mutedStyle}>لم تُوجّه كميات من المخزون المركزي بعد.</p>}
      {!!data?.dispatches.length && <table style={tableStyle}><thead><tr><th style={thStyle}>الشحنة</th><th style={thStyle}>الجمعية</th><th style={thStyle}>النوع</th><th style={thStyle}>الكمية</th></tr></thead><tbody>
        {data.dispatches.map((row) => <tr key={row.id}><td style={tdStyle}>{row.shipment.publicCode}</td><td style={tdStyle}>{row.shipment.association.name}</td><td style={tdStyle}>{DEVICE_TYPE_LABELS[row.deviceType]}</td><td style={tdStyle}>{row.quantity}</td></tr>)}
      </tbody></table>}
    </section>
    <section style={{ ...cardStyle, overflowX: 'auto' }}>
      <h2>آخر الكميات الواردة</h2>
      {data && !data.receipts.length && <p style={mutedStyle}>لا توجد كميات واردة مسجلة بعد.</p>}
      {!!data?.receipts.length && <table style={tableStyle}><thead><tr><th style={thStyle}>النوع</th><th style={thStyle}>الكمية</th><th style={thStyle}>المرجع</th><th style={thStyle}>التاريخ</th></tr></thead><tbody>
        {data.receipts.map((row) => <tr key={row.id}><td style={tdStyle}>{DEVICE_TYPE_LABELS[row.deviceType]}</td><td style={tdStyle}>{row.quantity}</td><td style={tdStyle}>{row.reference}</td><td style={tdStyle}>{new Date(row.createdAt).toLocaleDateString('ar-SA')}</td></tr>)}
      </tbody></table>}
    </section>
  </AppShell>;
}
