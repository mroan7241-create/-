'use client';

import { useEffect, useState } from 'react';
import { useRoleGuard } from '../../lib/use-role-guard';
import {
  ApiClientError,
  apiFetch,
  createReceiptBatch,
  DEVICE_TYPE_LABELS,
  DEVICE_TYPES,
  listReceiptBatches,
  RECEIPT_BATCH_STATUS_LABELS,
  sendReceiptBatch,
  type AssociationSummary,
  type CreateReceiptItemInput,
  type DeviceType,
  type Paginated,
  type ReceiptBatchStatus,
  type ReceiptBatchSummary,
} from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, mutedStyle, pageStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, successStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

const STATUS_TONE: Record<ReceiptBatchStatus, 'neutral' | 'good' | 'bad'> = {
  DRAFT: 'neutral',
  AWAITING_ASSOCIATION_CONFIRMATION: 'neutral',
  RECEIVED_COMPLETE: 'good',
  RECEIVED_WITH_DISCREPANCIES: 'bad',
};

interface DraftItem extends CreateReceiptItemInput {}

/** ADMIN — إدارة محاضر استلام دفعات الأجهزة: إنشاء + إرسال + قائمة. تأكيد الاستلام مسؤولية الجمعية (association/receipts). */
export default function AdminReceiptsPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [data, setData] = useState<Paginated<ReceiptBatchSummary> | null>(null);
  const [associations, setAssociations] = useState<AssociationSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReceiptBatchStatus | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const [associationId, setAssociationId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [sentDate, setSentDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([{ deviceType: 'REFRIGERATOR', spec: '', sentQty: 1 }]);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      setData(await listReceiptBatches({ pageSize: 25, status: statusFilter || undefined }));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل المحاضر');
    }
  }

  useEffect(() => {
    if (!user) return;
    refresh();
    apiFetch<Paginated<AssociationSummary>>('/associations?pageSize=200')
      .then((res) => setAssociations(res.items))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter]);

  if (loading || !user) return <p style={pageStyle}>...جارٍ التحميل</p>;

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function submitCreate() {
    setError('');
    setSaving(true);
    try {
      const res = await createReceiptBatch({ associationId, supplierName, sentDate, notes: notes || undefined, items });
      setNotice(`أُنشئ المحضر ${res.id} بنجاح — أرسله للجمعية عند الجاهزية`);
      setShowCreate(false);
      setSupplierName('');
      setSentDate('');
      setNotes('');
      setItems([{ deviceType: 'REFRIGERATOR', spec: '', sentQty: 1 }]);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر إنشاء المحضر');
    } finally {
      setSaving(false);
    }
  }

  async function doSend(id: string) {
    setError('');
    try {
      await sendReceiptBatch(id);
      setNotice('أُرسل المحضر للجمعية');
      await refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر إرسال المحضر');
    }
  }

  return (
    <main style={pageStyle}>
      <h1>محاضر استلام دفعات الأجهزة</h1>
      {error && <p style={errorStyle}>{error}</p>}
      {notice && <p style={successStyle}>{notice}</p>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select style={{ ...inputStyle, width: 220 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ReceiptBatchStatus | '')}>
          <option value="">كل الحالات</option>
          {Object.entries(RECEIPT_BATCH_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button style={primaryButtonStyle} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'إلغاء' : '+ محضر جديد'}
        </button>
      </div>

      {showCreate && (
        <section style={{ ...cardStyle, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            الجمعية المستلمة
            <select style={inputStyle} value={associationId} onChange={(e) => setAssociationId(e.target.value)}>
              <option value="">اختر جمعية</option>
              {associations.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            اسم المورد
            <input style={inputStyle} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          </label>
          <label style={labelStyle}>
            تاريخ الإرسال
            <input type="date" style={inputStyle} value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
          </label>
          <label style={labelStyle}>
            ملاحظات (اختياري)
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div>
            <strong>الأصناف</strong>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <select style={{ ...inputStyle, width: 160 }} value={item.deviceType} onChange={(e) => updateItem(i, { deviceType: e.target.value as DeviceType })}>
                  {DEVICE_TYPES.map((t) => (
                    <option key={t} value={t}>{DEVICE_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <input style={{ ...inputStyle, width: 160 }} placeholder="المواصفة" value={item.spec} onChange={(e) => updateItem(i, { spec: e.target.value })} />
                <input type="number" min={1} style={{ ...inputStyle, width: 100 }} value={item.sentQty} onChange={(e) => updateItem(i, { sentQty: Number(e.target.value) })} />
                {items.length > 1 && (
                  <button style={secondaryButtonStyle} onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}>
                    حذف
                  </button>
                )}
              </div>
            ))}
            <button style={{ ...secondaryButtonStyle, marginTop: 8 }} onClick={() => setItems((prev) => [...prev, { deviceType: 'REFRIGERATOR', spec: '', sentQty: 1 }])}>
              + إضافة صنف
            </button>
          </div>

          <button style={primaryButtonStyle} disabled={saving || !associationId || !supplierName || !sentDate} onClick={submitCreate}>
            {saving ? '...جارٍ الحفظ' : 'حفظ كمسودة'}
          </button>
        </section>
      )}

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>الرمز</th>
            <th style={thStyle}>المورد</th>
            <th style={thStyle}>الحالة</th>
            <th style={thStyle}>تاريخ الإرسال</th>
            <th style={thStyle}>عدد الأصناف</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((b) => (
            <tr key={b.id}>
              <td style={tdStyle}>{b.publicCode}</td>
              <td style={tdStyle}>{b.supplierName}</td>
              <td style={tdStyle}>
                <span style={statusBadgeStyle(STATUS_TONE[b.status])}>{RECEIPT_BATCH_STATUS_LABELS[b.status]}</span>
              </td>
              <td style={tdStyle}>{b.sentDate ? new Date(b.sentDate).toLocaleDateString('ar-SA') : '—'}</td>
              <td style={tdStyle}>{b.items.length}</td>
              <td style={tdStyle}>
                {b.status === 'DRAFT' && (
                  <button style={secondaryButtonStyle} onClick={() => doSend(b.id)}>
                    إرسال للجمعية
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data?.items.length && <p style={mutedStyle}>لا توجد محاضر بعد.</p>}
    </main>
  );
}
