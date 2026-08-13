'use client';

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
import { AssociationSelect } from '../../lib/association-select';
import { BeneficiarySelect } from '../../lib/beneficiary-select';
import { DelegateSelect } from '../../lib/delegate-select';
import { initialQueryParam } from '../../lib/query';
import { cardStyle, errorStyle, inputStyle, labelStyle, mutedStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, successStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

const PAGE_SIZE = 25;
const STATUS_TONE: Record<DeliveryStatus, 'neutral' | 'good' | 'bad'> = {
  NOT_STARTED: 'neutral', PREPARING: 'neutral', OUT_WITH_DELEGATE: 'neutral', DELIVERED: 'good', DELIVERY_FAILED: 'bad', RETURNED: 'bad',
};

/** ADMIN — عمليات التسليم: إسناد مندوب لمستفيد مكتمِل التخصيص + متابعة كل المهام عبر الجمعيات. يوازي assignDelegate/listBeneficiaryDeliveryAttempts القديمتين. */
export default function AdminDeliveriesPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);

  const [data, setData] = useState<Paginated<DeliveryMissionSummary> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | DeliveryStatus>(() => (initialQueryParam('status') as DeliveryStatus) || '');
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const [showAssign, setShowAssign] = useState(false);

  const load = useCallback(async () => {
    setListError('');
    try {
      setData(await listDeliveries({ page, pageSize: PAGE_SIZE, status: status || undefined }));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل مهام التسليم.');
    }
  }, [page, status]);

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

      <label style={{ ...labelStyle, maxWidth: 260, marginBottom: 16 }}>
        الحالة
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value as '' | DeliveryStatus); }} style={inputStyle}>
          <option value="">الكل</option>
          {Object.entries(DELIVERY_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      {listError && <p role="alert" style={errorStyle}>{listError}</p>}
      {notice && <p style={successStyle}>{notice}</p>}

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>المستفيد</th>
              <th style={thStyle}>المندوب</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>تاريخ الإسناد</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && <tr><td style={{ ...tdStyle, textAlign: 'center' }} colSpan={5}>لا توجد مهام تسليم مطابقة.</td></tr>}
            {data?.items.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>{row.beneficiary.name}<br /><span style={mutedStyle}>{row.beneficiary.region}/{row.beneficiary.city}</span></td>
                <td style={tdStyle}>{row.delegate?.name ?? '—'}</td>
                <td style={tdStyle}><span style={statusBadgeStyle(STATUS_TONE[row.status])}>{DELIVERY_STATUS_LABELS[row.status]}</span></td>
                <td style={tdStyle}>{row.assignedAt ? new Date(row.assignedAt).toLocaleDateString('ar-SA') : '—'}</td>
                <td style={tdStyle}>
                  {row.status === 'DELIVERY_FAILED' && (
                    <button type="button" style={secondaryButtonStyle} onClick={() => doRetry(row.id)}>↻ إعادة المحاولة</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</button>
          <span style={mutedStyle}>صفحة {data.page} من {data.totalPages} — {data.total} مهمة</span>
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
  const [associationId, setAssociationId] = useState('');
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
      onDone('تم إسناد المندوب — أصبحت الأجهزة معه.');
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
        <p style={mutedStyle}>يظهر المستفيدون المعتمَدون فقط. الإسناد يتطلب اكتمال تخصيص كل احتياجاتهم أولًا (تلقائيًا بعد توفّر المخزون).</p>

        <label style={labelStyle}>
          الجمعية (لتضييق البحث)
          <AssociationSelect value={associationId} onChange={(id) => { setAssociationId(id); setBeneficiaryId(''); setDelegateId(''); }} />
        </label>

        <label style={labelStyle}>
          المستفيد
          <BeneficiarySelect value={beneficiaryId} onChange={(id) => setBeneficiaryId(id)} associationId={associationId || undefined} />
        </label>

        <label style={labelStyle}>
          المندوب
          <DelegateSelect value={delegateId} onChange={(id) => setDelegateId(id)} associationId={associationId || undefined} />
        </label>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={!beneficiaryId || !delegateId || busy} style={primaryButtonStyle}>
          {busy ? 'جارٍ الإسناد…' : 'إسناد'}
        </button>
      </form>
    </div>
  );
}
