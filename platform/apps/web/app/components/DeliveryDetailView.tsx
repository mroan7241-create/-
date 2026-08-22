'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiClientError,
  DELIVERY_FAILURE_REASON_LABELS,
  DELIVERY_STATUS_LABELS,
  getDelivery,
  getDeliveryProofUrl,
  retryDelivery,
  returnDelivery,
  type DeliveryMissionDetail,
  type DeliveryStatus,
} from '../lib/api';
import {
  cardStyle,
  dangerButtonStyle,
  errorStyle,
  inputStyle,
  mutedStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  successStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '../lib/ui';

const STATUS_TONE: Record<DeliveryStatus, 'neutral' | 'good' | 'bad'> = {
  NOT_STARTED: 'neutral',
  PREPARING: 'neutral',
  PENDING_DELEGATE_ACKNOWLEDGEMENT: 'neutral',
  OUT_WITH_DELEGATE: 'neutral',
  DELIVERED: 'good',
  DELIVERY_FAILED: 'bad',
  RETURNED: 'bad',
  PENDING_DELIVERY_APPROVAL: 'neutral',
  DEFERRED: 'neutral',
  PENDING_RETURN_APPROVAL: 'neutral',
  DELIVERY_CLOSED: 'good',
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('ar-SA') : '—';
}

export function DeliveryDetailView({ missionId, listHref }: { missionId: string; listHref: string }) {
  const [mission, setMission] = useState<DeliveryMissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyAction, setBusyAction] = useState<'retry' | 'return' | `proof-${string}` | null>(null);
  const [returnNotes, setReturnNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMission(await getDelivery(missionId));
    } catch (err) {
      setMission(null);
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل تفاصيل مهمة التسليم.');
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runRetry() {
    setBusyAction('retry');
    setError('');
    setNotice('');
    try {
      await retryDelivery(missionId);
      setNotice('تمت إعادة فتح مهمة التسليم بنجاح.');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّرت إعادة المحاولة.');
    } finally {
      setBusyAction(null);
    }
  }

  async function runReturn() {
    setBusyAction('return');
    setError('');
    setNotice('');
    try {
      await returnDelivery(missionId, returnNotes.trim() || undefined);
      setReturnNotes('');
      setNotice('تم تسجيل الإرجاع إلى المستودع بنجاح.');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تسجيل الإرجاع.');
    } finally {
      setBusyAction(null);
    }
  }

  async function openProof(attemptId: string) {
    setBusyAction(`proof-${attemptId}`);
    setError('');
    try {
      const { url } = await getDeliveryProofUrl(attemptId);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر فتح إثبات التسليم.');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>تفاصيل مهمة التسليم</h1>
        <Link href={listHref} style={{ ...secondaryButtonStyle, textDecoration: 'none' }}>العودة إلى التسليمات</Link>
      </div>

      {loading && <p style={mutedStyle}>جارٍ تحميل تفاصيل المهمة…</p>}
      {error && <p role="alert" style={errorStyle}>{error}</p>}
      {notice && <p role="status" style={successStyle}>{notice}</p>}

      {!loading && mission && (
        <>
          <section style={{ ...cardStyle, marginTop: 16 }} aria-labelledby="delivery-summary-heading">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 id="delivery-summary-heading" style={{ fontSize: 18, margin: '0 0 6px' }}>{mission.publicCode}</h2>
                <span style={statusBadgeStyle(STATUS_TONE[mission.status])}>{DELIVERY_STATUS_LABELS[mission.status]}</span>
              </div>
              <div style={{ ...mutedStyle, textAlign: 'left' }}>
                <div>تاريخ الإنشاء: {formatDate(mission.createdAt)}</div>
                <div>تاريخ الإسناد: {formatDate(mission.assignedAt)}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16, marginTop: 20 }}>
              <div>
                <strong>المستفيد</strong>
                <p style={{ margin: '6px 0 0' }}>{mission.beneficiary.name}</p>
                <p style={{ ...mutedStyle, margin: '4px 0' }}>{mission.beneficiary.phone}</p>
                <p style={{ ...mutedStyle, margin: '4px 0' }}>{mission.beneficiary.region} / {mission.beneficiary.city}{mission.beneficiary.district ? ` / ${mission.beneficiary.district}` : ''}</p>
                <p style={{ ...mutedStyle, margin: '4px 0' }}>{mission.beneficiary.address}</p>
              </div>
              <div>
                <strong>المندوب</strong>
                <p style={{ margin: '6px 0 0' }}>{mission.delegate?.name ?? 'لم يُسند'}</p>
                {mission.delegate && (
                  <>
                    <p style={{ ...mutedStyle, margin: '4px 0' }}>{mission.delegate.publicCode}</p>
                    <p style={{ ...mutedStyle, margin: '4px 0' }}>{mission.delegate.phone ?? 'لا يوجد رقم هاتف'}</p>
                  </>
                )}
              </div>
            </div>
          </section>

          {(mission.status === 'DELIVERY_FAILED' || mission.status === 'OUT_WITH_DELEGATE') && (
            <section style={{ ...cardStyle, marginTop: 16 }} aria-labelledby="delivery-actions-heading">
              <h2 id="delivery-actions-heading" style={{ fontSize: 18, marginTop: 0 }}>الإجراءات المتاحة</h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                {mission.status === 'DELIVERY_FAILED' && (
                  <button type="button" style={secondaryButtonStyle} disabled={busyAction !== null} onClick={runRetry}>
                    {busyAction === 'retry' ? 'جارٍ إعادة الفتح…' : 'إعادة المحاولة'}
                  </button>
                )}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 260px' }}>
                  ملاحظة الإرجاع (اختيارية)
                  <textarea value={returnNotes} onChange={(event) => setReturnNotes(event.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                </label>
                <button type="button" style={dangerButtonStyle} disabled={busyAction !== null} onClick={runReturn}>
                  {busyAction === 'return' ? 'جارٍ طلب الإرجاع…' : 'طلب إرجاع بانتظار تأكيد الجمعية'}
                </button>
              </div>
            </section>
          )}

          <section style={{ ...cardStyle, padding: 0, overflowX: 'auto', marginTop: 16 }} aria-labelledby="delivery-attempts-heading">
            <h2 id="delivery-attempts-heading" style={{ fontSize: 18, padding: '18px 20px 8px', margin: 0 }}>سجل المحاولات</h2>
            {mission.attempts.length === 0 ? (
              <p style={{ ...mutedStyle, padding: '0 20px 18px' }}>لا توجد محاولات مسجلة لهذه المهمة.</p>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>المحاولة</th>
                    <th style={thStyle}>الحالة</th>
                    <th style={thStyle}>الوقت</th>
                    <th style={thStyle}>سبب التعثر</th>
                    <th style={thStyle}>الملاحظات</th>
                    <th style={thStyle}>الإثبات</th>
                  </tr>
                </thead>
                <tbody>
                  {mission.attempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td style={tdStyle}>{attempt.publicCode}</td>
                      <td style={tdStyle}><span style={statusBadgeStyle(STATUS_TONE[attempt.status])}>{DELIVERY_STATUS_LABELS[attempt.status]}</span></td>
                      <td style={tdStyle}>{formatDate(attempt.attemptedAt)}</td>
                      <td style={tdStyle}>{attempt.failureReason ? DELIVERY_FAILURE_REASON_LABELS[attempt.failureReason] : '—'}</td>
                      <td style={tdStyle}>{attempt.notes || '—'}</td>
                      <td style={tdStyle}>
                        {attempt.hasProof ? (
                          <button type="button" style={secondaryButtonStyle} disabled={busyAction !== null} onClick={() => openProof(attempt.id)}>
                            {busyAction === `proof-${attempt.id}` ? 'جارٍ الفتح…' : 'عرض الإثبات'}
                          </button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
