'use client';

import { useEffect, useState } from 'react';
import { useRoleGuard } from '../../lib/use-role-guard';
import {
  ApiClientError,
  confirmReceiptBatch,
  listReceiptBatches,
  RECEIPT_BATCH_STATUS_LABELS,
  type ConfirmReceiptItemInput,
  type Paginated,
  type ReceiptBatchStatus,
  type ReceiptBatchSummary,
} from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, mutedStyle, pageStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, successStyle } from '../../lib/ui';

const STATUS_TONE: Record<ReceiptBatchStatus, 'neutral' | 'good' | 'bad'> = {
  DRAFT: 'neutral',
  AWAITING_ASSOCIATION_CONFIRMATION: 'neutral',
  RECEIVED_COMPLETE: 'good',
  RECEIVED_WITH_DISCREPANCIES: 'bad',
};

interface DraftLine {
  itemId: string;
  receivedQty: number;
  damagedQty: number;
  missingQty: number;
  differenceReason: string;
}

/** ASSOCIATION — محاضر الاستلام الواردة: قائمة + تأكيد استلام (كامل أو مع فروقات موثَّقة بالصور). */
export default function AssociationReceiptsPage() {
  const { user, loading } = useRoleGuard(['ASSOCIATION']);
  const [data, setData] = useState<Paginated<ReceiptBatchSummary> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [receiverTitle, setReceiverTitle] = useState('مدير الجمعية');
  const [lines, setLines] = useState<Record<string, DraftLine>>({});
  const [quantityPhoto, setQuantityPhoto] = useState<File | null>(null);
  const [signatureImage, setSignatureImage] = useState<File | null>(null);
  const [damagePhotos, setDamagePhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      setData(await listReceiptBatches({ pageSize: 25 }));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل المحاضر');
    }
  }

  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (loading || !user) return <p style={pageStyle}>...جارٍ التحميل</p>;

  function openBatch(b: ReceiptBatchSummary) {
    setOpenId(b.id);
    setNotice('');
    setError('');
    setReceiverTitle('مدير الجمعية');
    setQuantityPhoto(null);
    setSignatureImage(null);
    setDamagePhotos([]);
    const initial: Record<string, DraftLine> = {};
    for (const it of b.items) {
      initial[it.id] = { itemId: it.id, receivedQty: it.sentQty, damagedQty: 0, missingQty: 0, differenceReason: '' };
    }
    setLines(initial);
  }

  function updateLine(itemId: string, patch: Partial<DraftLine>) {
    setLines((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  async function submitConfirm(batch: ReceiptBatchSummary) {
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
      const res = await confirmReceiptBatch(batch.id, { receiverTitle, items, damagePhotoLinks, quantityPhoto, signatureImage, damagePhotos });
      setNotice(`تم تأكيد الاستلام — ${RECEIPT_BATCH_STATUS_LABELS[res.status]}`);
      setOpenId(null);
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
              <div style={mutedStyle}>{b.items.length} صنف</div>
            </div>
            <span style={statusBadgeStyle(STATUS_TONE[b.status])}>{RECEIPT_BATCH_STATUS_LABELS[b.status]}</span>
            {b.status === 'AWAITING_ASSOCIATION_CONFIRMATION' && (
              <button style={primaryButtonStyle} onClick={() => (openId === b.id ? setOpenId(null) : openBatch(b))}>
                {openId === b.id ? 'إغلاق' : 'تأكيد الاستلام'}
              </button>
            )}
          </div>

          {openId === b.id && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {b.items.map((it) => {
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
                <button style={primaryButtonStyle} disabled={saving} onClick={() => submitConfirm(b)}>
                  {saving ? '...جارٍ الحفظ' : 'تأكيد الاستلام'}
                </button>
                <button style={secondaryButtonStyle} onClick={() => setOpenId(null)}>
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </section>
      ))}
      {!data?.items.length && <p style={mutedStyle}>لا توجد محاضر بعد.</p>}
    </main>
  );
}
