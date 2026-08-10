'use client';

import { useEffect, useState } from 'react';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AssociationSelect } from '../../lib/association-select';
import {
  ApiClientError,
  createReceiptBatch,
  DEVICE_TYPE_LABELS,
  DEVICE_TYPES,
  getReceiptBatch,
  getReceiptEvidenceUrl,
  listReceiptBatches,
  RECEIPT_BATCH_STATUS_LABELS,
  sendReceiptBatch,
  type CreateReceiptItemInput,
  type DeviceType,
  type Paginated,
  type ReceiptBatchDetail,
  type ReceiptBatchListItem,
  type ReceiptBatchStatus,
} from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, mutedStyle, pageStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, successStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

const STATUS_TONE: Record<ReceiptBatchStatus, 'neutral' | 'good' | 'bad'> = {
  DRAFT: 'neutral',
  AWAITING_ASSOCIATION_CONFIRMATION: 'neutral',
  RECEIVED_COMPLETE: 'good',
  RECEIVED_WITH_DISCREPANCIES: 'bad',
};

const PAGE_SIZE = 25;

interface DraftItem extends CreateReceiptItemInput {}

/** ADMIN — إدارة محاضر استلام دفعات الأجهزة: إنشاء + إرسال + قائمة مُرقَّمة خادميًا + تفاصيل عند الطلب. تأكيد الاستلام مسؤولية الجمعية (association/receipts). */
export default function AdminReceiptsPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [data, setData] = useState<Paginated<ReceiptBatchListItem> | null>(null);
  const [page, setPage] = useState(1);
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

  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptBatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  async function refresh() {
    try {
      setError('');
      setData(await listReceiptBatches({ page, pageSize: PAGE_SIZE, status: statusFilter || undefined }));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل المحاضر');
    }
  }

  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page, statusFilter]);

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
      setAssociationId('');
      setSupplierName('');
      setSentDate('');
      setNotes('');
      setItems([{ deviceType: 'REFRIGERATOR', spec: '', sentQty: 1 }]);
      setPage(1);
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

  async function openDetail(id: string) {
    if (openBatchId === id) {
      setOpenBatchId(null);
      setDetail(null);
      return;
    }
    setOpenBatchId(id);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      setDetail(await getReceiptBatch(id));
    } catch (e) {
      setDetailError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل تفاصيل المحضر');
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <main style={pageStyle}>
      <h1>محاضر استلام دفعات الأجهزة</h1>
      {error && <p style={errorStyle}>{error}</p>}
      {notice && <p style={successStyle}>{notice}</p>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          style={{ ...inputStyle, width: 220 }}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as ReceiptBatchStatus | '');
            setPage(1);
          }}
        >
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
            <AssociationSelect value={associationId} onChange={(id) => setAssociationId(id)} placeholder="ابحث عن جمعية..." />
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
            <>
              <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(b.id)}>
                <td style={tdStyle}>{b.publicCode}</td>
                <td style={tdStyle}>{b.supplierName}</td>
                <td style={tdStyle}>
                  <span style={statusBadgeStyle(STATUS_TONE[b.status])}>{RECEIPT_BATCH_STATUS_LABELS[b.status]}</span>
                </td>
                <td style={tdStyle}>{b.sentDate ? new Date(b.sentDate).toLocaleDateString('ar-SA') : '—'}</td>
                <td style={tdStyle}>{b.itemCount}</td>
                <td style={tdStyle}>
                  {b.status === 'DRAFT' && (
                    <button
                      style={secondaryButtonStyle}
                      onClick={(e) => {
                        e.stopPropagation();
                        doSend(b.id);
                      }}
                    >
                      إرسال للجمعية
                    </button>
                  )}
                </td>
              </tr>
              {openBatchId === b.id && (
                <tr>
                  <td style={tdStyle} colSpan={6}>
                    <ReceiptDetailPanel detail={detail} loading={detailLoading} error={detailError} batchId={b.id} />
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      {!data?.items.length && <p style={mutedStyle}>لا توجد محاضر بعد.</p>}

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</button>
          <span style={mutedStyle}>{page} / {data.totalPages}</span>
          <button style={secondaryButtonStyle} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      )}
    </main>
  );
}

function ReceiptDetailPanel({ detail, loading, error, batchId }: { detail: ReceiptBatchDetail | null; loading: boolean; error: string; batchId: string }) {
  const [evidenceError, setEvidenceError] = useState('');

  async function viewEvidence(type: 'quantity' | 'signature' | 'damage', damagePhotoId?: string) {
    setEvidenceError('');
    try {
      const res = await getReceiptEvidenceUrl(batchId, type, damagePhotoId);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setEvidenceError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل رابط الإثبات');
    }
  }

  if (loading) return <p style={mutedStyle}>...جارٍ تحميل التفاصيل</p>;
  if (error) return <p style={errorStyle}>{error}</p>;
  if (!detail) return null;

  return (
    <div style={{ ...cardStyle, marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <span>المستلم: {detail.receiverName ?? '—'}</span>
        <span>الصفة: {detail.receiverTitle ?? '—'}</span>
        <span>تاريخ التأكيد: {detail.confirmedAt ? new Date(detail.confirmedAt).toLocaleString('ar-SA') : '—'}</span>
        {detail.notes && <span>ملاحظات: {detail.notes}</span>}
      </div>
      {evidenceError && <p style={errorStyle}>{evidenceError}</p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {detail.hasQuantityPhoto && (
          <button style={secondaryButtonStyle} onClick={() => viewEvidence('quantity')}>
            عرض صورة الكمية
          </button>
        )}
        {detail.hasSignature && (
          <button style={secondaryButtonStyle} onClick={() => viewEvidence('signature')}>
            عرض توقيع المستلم
          </button>
        )}
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>النوع</th>
            <th style={thStyle}>المواصفة</th>
            <th style={thStyle}>مُرسَل</th>
            <th style={thStyle}>سليم</th>
            <th style={thStyle}>تالف</th>
            <th style={thStyle}>ناقص</th>
            <th style={thStyle}>سبب الفرق</th>
            <th style={thStyle}>صور التلف</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it) => (
            <tr key={it.id}>
              <td style={tdStyle}>{it.deviceType}</td>
              <td style={tdStyle}>{it.spec}</td>
              <td style={tdStyle}>{it.sentQty}</td>
              <td style={tdStyle}>{it.receivedQty}</td>
              <td style={tdStyle}>{it.damagedQty}</td>
              <td style={tdStyle}>{it.missingQty}</td>
              <td style={tdStyle}>{it.differenceReason || '—'}</td>
              <td style={tdStyle}>
                {it.damagePhotos.map((p, i) => (
                  <button key={p.id} style={secondaryButtonStyle} onClick={() => viewEvidence('damage', p.id)}>
                    صورة {i + 1}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
