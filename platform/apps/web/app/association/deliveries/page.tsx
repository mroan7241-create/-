'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiClientError,
  DELIVERY_STATUS_LABELS,
  assignDelegate,
  listDeliveries,
  retryDelivery,
  type DeliveryMissionSummary,
  type DeliveryStatus,
  type Paginated,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { BeneficiarySelect } from '../../lib/beneficiary-select';
import { DelegateSelect } from '../../lib/delegate-select';
import { cardStyle, errorStyle, labelStyle, mutedStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, successStyle } from '../../lib/ui';

const PAGE_SIZE = 25;
const STATUS_TONE: Record<DeliveryStatus, 'neutral' | 'good' | 'bad'> = {
  NOT_STARTED: 'neutral', PREPARING: 'neutral', PENDING_DELEGATE_ACKNOWLEDGEMENT: 'neutral', OUT_WITH_DELEGATE: 'neutral', DELIVERED: 'good', DELIVERY_FAILED: 'bad', RETURNED: 'bad',
};

/** ASSOCIATION — عمليات تسليم مستفيديها: إسناد مندوب + متابعة تقدُّم التسليم. بطاقات لا جدول (نفس نمط بقية شاشات ASSOCIATION). */
export default function AssociationDeliveriesPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ASSOCIATION']);

  const [data, setData] = useState<Paginated<DeliveryMissionSummary> | null>(null);
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const [showAssign, setShowAssign] = useState(false);

  const load = useCallback(async () => {
    setListError('');
    try {
      setData(await listDeliveries({ page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل مهام التسليم.');
    }
  }, [page]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function doRetry(id: string) {
    try {
      await retryDelivery(id);
      setNotice('تمت إعادة فتح مهمة التسليم.');
      await load();
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّرت إعادة المحاولة.');
    }
  }

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22 }}>عمليات التسليم</h1>
        <button type="button" style={primaryButtonStyle} onClick={() => setShowAssign(true)}>إسناد مندوب</button>
      </div>

      {listError && <p role="alert" style={errorStyle}>{listError}</p>}
      {notice && <p style={successStyle}>{notice}</p>}
      {data?.items.length === 0 && <p style={mutedStyle}>لا توجد مهام تسليم بعد.</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {data?.items.map((row) => (
          <div key={row.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
              <strong>{row.beneficiary.name}</strong>
              <span style={statusBadgeStyle(STATUS_TONE[row.status])}>{DELIVERY_STATUS_LABELS[row.status]}</span>
            </div>
            <p style={{ ...mutedStyle, margin: '2px 0' }}>{row.beneficiary.region} / {row.beneficiary.city}</p>
            <p style={{ ...mutedStyle, margin: '2px 0' }}>المندوب: {row.delegate?.name ?? '—'}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <Link href={`/association/deliveries/${row.id}`} style={{ ...secondaryButtonStyle, textDecoration: 'none' }}>التفاصيل</Link>
              {row.status === 'DELIVERY_FAILED' && (
                <button type="button" style={secondaryButtonStyle} onClick={() => doRetry(row.id)}>↻ إعادة المحاولة</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</button>
          <span style={mutedStyle}>صفحة {data.page} من {data.totalPages}</span>
          <button type="button" style={secondaryButtonStyle} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      )}

      {showAssign && (
        <AssignModal
          onClose={() => setShowAssign(false)}
          onDone={(message) => {
            setShowAssign(false);
            setNotice(message);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}

function AssignModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [delegateId, setDelegateId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await assignDelegate(beneficiaryId, delegateId);
      onDone('تم إسناد المندوب — العهدة بانتظار تأكيد استلامه.');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الإسناد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(42,20,32,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto', zIndex: 50 }}>
      <form onSubmit={submit} style={{ ...cardStyle, maxWidth: 480, width: '100%', margin: '32px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 19 }}>إسناد مندوب</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق</button>
        </div>
        <p style={mutedStyle}>يظهر مستفيدوكم المعتمَدون فقط. الإسناد يتطلب اكتمال تخصيص كل احتياجاتهم أولًا.</p>

        <label style={labelStyle}>
          المستفيد
          <BeneficiarySelect value={beneficiaryId} onChange={(id) => setBeneficiaryId(id)} />
        </label>

        <label style={labelStyle}>
          المندوب
          <DelegateSelect value={delegateId} onChange={(id) => setDelegateId(id)} />
        </label>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={!beneficiaryId || !delegateId || busy} style={primaryButtonStyle}>
          {busy ? 'جارٍ الإسناد…' : 'إسناد'}
        </button>
      </form>
    </div>
  );
}
