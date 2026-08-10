'use client';

import { useEffect, useState } from 'react';
import { useRoleGuard } from '../../lib/use-role-guard';
import {
  ApiClientError,
  confirmReceiptBatch,
  getReceiptBatch,
  getReceiptEvidenceUrl,
  listReceiptBatches,
  RECEIPT_BATCH_STATUS_LABELS,
  type ConfirmReceiptItemInput,
  type Paginated,
  type ReceiptBatchDetail,
  type ReceiptBatchListItem,
  type ReceiptBatchStatus,
} from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, mutedStyle, pageStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, successStyle } from '../../lib/ui';

const STATUS_TONE: Record<ReceiptBatchStatus, 'neutral' | 'good' | 'bad'> = {
  DRAFT: 'neutral',
  AWAITING_ASSOCIATION_CONFIRMATION: 'neutral',
  RECEIVED_COMPLETE: 'good',
  RECEIVED_WITH_DISCREPANCIES: 'bad',
};

const PAGE_SIZE = 25;

interface DraftLine {
  itemId: string;
  receivedQty: number;
  damagedQty: number;
  missingQty: number;
  differenceReason: string;
}

/** ASSOCIATION — محاضر الاستلام الواردة: قائمة مُرقَّمة خادميًا + تأكيد استلام (كامل أو مع فروقات موثَّقة بالصور) — التفاصيل الكاملة تُجلَب فقط عند فتح نموذج التأكيد. */
export default function AssociationReceiptsPage() {
  const { user, loading } = useRoleGuard(['ASSOCIATION']);
  const [data, setData] = useState<Paginated<ReceiptBatchListItem> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [openId, setOpenId] = useState<string | null>(null);
  const [openDetail, setOpenDetail] = useState<ReceiptBatchDetail | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState('');

  const [receiverTitle, setReceiverTitle] = useState('مدير الجمعية');
  const [lines, setLines] = useState<Record<string, DraftLine>>({});
  const [quantityPhoto, setQuantityPhoto] = useState<File | null>(null);
  const [signatureImage, setSignatureImage] = useState<File | null>(null);
  const [damagePhotos, setDamagePhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      setError('');
      setData(await listReceiptBatches({ page, pageSize: PAGE_SIZE }));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل المحاضر');
    }
  }

  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page]);

  if (loading || !user) return <p style={pageStyle}>...جارٍ التحميل</p>;

  async function openBatch(id: string) {
    if (openId === id) {
      setOpenId(null);
      setOpenDetail(null);
      return;
    }
    setOpenId(id);
    setOpenDetail(null);
    setOpenError('');
    setNotice('');
    setError('');
    setReceiverTitle('مدير الجمعية');
    setQuantityPhoto(null);
    setSignatureImage(null);
    setDamagePhotos([]);
    setOpenLoading(true);
    try {
      // النموذج يحتاج البنود الكاملة (لا تُحمَّل مسبقًا لكل صفوف القائمة) — تُجلَب فقط عند فتح محضر واحد.
      const detail = await getReceiptBatch(id);
      setOpenDetail(detail);
      const initial: Record<string, DraftLine> = {};
      for (const it of detail.items) {
        initial[it.id] = { itemId: it.id, receivedQty: it.sentQty, damagedQty: 0, missingQty: 0, differenceReason: '' };
      }
      setLines(initial);
    } catch (e) {
      setOpenError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل تفاصيل المحضر');
    } finally {
      setOpenLoading(false);
    }
  }

  function updateLine(itemId: string, patch: Partial<DraftLine>) {
    setLines((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  async function viewEvidence(batchId: string, type: 'quantity' | 'signature') {
    try {
      const res = await getReceiptEvidenceUrl(batchId, type);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setOpenError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل رابط الإثبات');
    }
  }

  async function submitConfirm(batchId: string) {
    setError('');
    if (!quantityPhoto || !signatureImage) {
      setError('صورة الكمية العامة وتوقيع المستلم إلزاميان');
      return;
    }
    const items: ConfirmReceiptItemInput[] = Object.values(lines).map((l) => ({
      itemId: l.itemId,
      receivedQty: l.receivedQty,
      damagedQty: l.damagedQty,
      missingQty: l.missingQty,
      differenceReason: l.differenceReason || undefined,
    }));
    // كل الأصناف التالفة تُربَط بأول صورة تلف مرفوعة — تبسيط واجهة (صورة واحدة تكفي أغلب الحالات).
    const damagedItemIds = items.filter((i) => i.damagedQty > 0).map((i) => i.itemId);
    const damagePhotoLinks = damagedItemIds.length ? [damagedItemIds] : [];
    setSaving(true);
    try {
      const res = await confirmReceiptBatch(batchId, { receiverTitle, items, damagePhotoLinks, quantityPhoto, signatureImage, damagePhotos });
      setNotice(`تم تأكيد الاستلام — ${RECEIPT_BATCH_STATUS_LABELS[res.status]}`);
      setOpenId(null);
      setOpenDetail(null);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر تأكيد الاستلام');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={pageStyle}>
      <h1>محاضر الاستلام الواردة</h1>
      {error && <p style={errorStyle}>{error}</p>}
      {notice && <p style={successStyle}>{notice}</p>}

      {(data?.items ?? []).map((b) => (
        <section key={b.id} style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong>{b.publicCode}</strong> — {b.supplierName}
              <div style={mutedStyle}>{b.itemCount} صنف</div>
            </div>
            <span style={statusBadgeStyle(STATUS_TONE[b.status])}>{RECEIPT_BATCH_STATUS_LABELS[b.status]}</span>
            {b.status === 'AWAITING_ASSOCIATION_CONFIRMATION' && (
              <button style={primaryButtonStyle} onClick={() => openBatch(b.id)}>
                {openId === b.id ? 'إغلاق' : 'تأكيد الاستلام'}
              </button>
            )}
            {(b.status === 'RECEIVED_COMPLETE' || b.status === 'RECEIVED_WITH_DISCREPANCIES') && (
              <button style={secondaryButtonStyle} onClick={() => openBatch(b.id)}>
                {openId === b.id ? 'إغلاق' : 'عرض التفاصيل'}
              </button>
            )}
          </div>

          {openId === b.id && openLoading && <p style={mutedStyle}>...جارٍ التحميل</p>}
          {openId === b.id && openError && <p style={errorStyle}>{openError}</p>}

          {openId === b.id && openDetail && b.status === 'AWAITING_ASSOCIATION_CONFIRMATION' && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {openDetail.items.map((it) => {
                const line = lines[it.id];
                if (!line) return null;
                return (
                  <div key={it.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                    <div style={mutedStyle}>
                      {it.deviceType} — {it.spec} — مُرسَل: {it.sentQty}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <label style={labelStyle}>
                        سليم
                        <input type="number" min={0} style={{ ...inputStyle, width: 90 }} value={line.receivedQty} onChange={(e) => updateLine(it.id, { receivedQty: Number(e.target.value) })} />
                      </label>
                      <label style={labelStyle}>
                        تالف
                        <input type="number" min={0} style={{ ...inputStyle, width: 90 }} value={line.damagedQty} onChange={(e) => updateLine(it.id, { damagedQty: Number(e.target.value) })} />
                      </label>
                      <label style={labelStyle}>
                        ناقص
                        <input type="number" min={0} style={{ ...inputStyle, width: 90 }} value={line.missingQty} onChange={(e) => updateLine(it.id, { missingQty: Number(e.target.value) })} />
                      </label>
                      {(line.damagedQty > 0 || line.missingQty > 0) && (
                        <label style={labelStyle}>
                          سبب الفرق
                          <input style={inputStyle} value={line.differenceReason} onChange={(e) => updateLine(it.id, { differenceReason: e.target.value })} />
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}

              <label style={labelStyle}>
                صفة المستلم
                <input style={inputStyle} value={receiverTitle} onChange={(e) => setReceiverTitle(e.target.value)} />
              </label>
              <label style={labelStyle}>
                صورة الكمية المستلمة (إلزامي)
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setQuantityPhoto(e.target.files?.[0] ?? null)} />
              </label>
              <label style={labelStyle}>
                توقيع المستلم — صورة (إلزامي)
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setSignatureImage(e.target.files?.[0] ?? null)} />
              </label>
              <label style={labelStyle}>
                صورة تلف (إن وُجد فرق)
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setDamagePhotos(e.target.files ? [e.target.files[0]] : [])} />
              </label>

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={primaryButtonStyle} disabled={saving} onClick={() => submitConfirm(b.id)}>
                  {saving ? '...جارٍ الحفظ' : 'تأكيد الاستلام'}
                </button>
                <button style={secondaryButtonStyle} onClick={() => setOpenId(null)}>
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {openId === b.id && openDetail && b.status !== 'AWAITING_ASSOCIATION_CONFIRMATION' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>المستلم: {openDetail.receiverName ?? '—'}</span>
                <span>تاريخ التأكيد: {openDetail.confirmedAt ? new Date(openDetail.confirmedAt).toLocaleString('ar-SA') : '—'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {openDetail.hasQuantityPhoto && (
                  <button style={secondaryButtonStyle} onClick={() => viewEvidence(b.id, 'quantity')}>
                    عرض صورة الكمية
                  </button>
                )}
                {openDetail.hasSignature && (
                  <button style={secondaryButtonStyle} onClick={() => viewEvidence(b.id, 'signature')}>
                    عرض توقيعي
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      ))}
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
