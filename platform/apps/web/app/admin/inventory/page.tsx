'use client';

import { useEffect, useState } from 'react';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AssociationSelect } from '../../lib/association-select';
import {
  ApiClientError,
  DEVICE_STATUS_LABELS,
  DEVICE_TYPE_LABELS,
  DEVICE_TYPES,
  getDeviceUnit,
  listDeviceUnits,
  type DeviceStatus,
  type DeviceType,
  type DeviceUnitSummary,
  type Paginated,
} from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, mutedStyle, pageStyle, statusBadgeStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

/** ADMIN — مخزون الأجهزة: قائمة مُرقَّمة خادميًا (تكافؤ getDeviceDetail/جزء القراءة من saveDevice القديمتين). الإنشاء حصرًا عبر تأكيد محضر استلام. */
export default function AdminInventoryPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [data, setData] = useState<Paginated<DeviceUnitSummary> | null>(null);
  const [associationId, setAssociationId] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [status, setStatus] = useState<DeviceStatus | ''>('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getDeviceUnit>> | null>(null);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    if (!user) return;
    listDeviceUnits({ page, pageSize: 25, associationId: associationId || undefined, deviceType: deviceType || undefined, status: status || undefined })
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل المخزون'));
  }, [user, page, associationId, deviceType, status]);

  if (loading || !user) return <p style={pageStyle}>...جارٍ التحميل</p>;

  return (
    <main style={pageStyle}>
      <h1>مخزون الأجهزة</h1>
      {error && <p style={errorStyle}>{error}</p>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 220 }}>
          <AssociationSelect
            value={associationId}
            onChange={(id) => {
              setAssociationId(id);
              setPage(1);
            }}
            placeholder="كل الجمعيات — ابحث لتصفية..."
          />
        </div>
        <select style={{ ...inputStyle, width: 180 }} value={deviceType} onChange={(e) => { setDeviceType(e.target.value as DeviceType | ''); setPage(1); }}>
          <option value="">كل الأنواع</option>
          {DEVICE_TYPES.map((t) => (
            <option key={t} value={t}>{DEVICE_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select style={{ ...inputStyle, width: 180 }} value={status} onChange={(e) => { setStatus(e.target.value as DeviceStatus | ''); setPage(1); }}>
          <option value="">كل الحالات</option>
          {Object.entries(DEVICE_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>الرمز</th>
            <th style={thStyle}>النوع</th>
            <th style={thStyle}>المواصفة</th>
            <th style={thStyle}>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((d) => (
            <tr
              key={d.id}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setDetailError('');
                getDeviceUnit(d.id)
                  .then(setDetail)
                  .catch((e) => setDetailError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل تفاصيل الجهاز'));
              }}
            >
              <td style={tdStyle}>{d.publicCode}</td>
              <td style={tdStyle}>{d.deviceType ? DEVICE_TYPE_LABELS[d.deviceType as DeviceType] ?? d.deviceType : '—'}</td>
              <td style={tdStyle}>{d.spec ?? '—'}</td>
              <td style={tdStyle}>
                <span style={statusBadgeStyle(d.status === 'DAMAGED' ? 'bad' : d.status === 'DELIVERED' ? 'good' : 'neutral')}>{DEVICE_STATUS_LABELS[d.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data?.items.length && <p style={mutedStyle}>لا توجد أجهزة مطابقة.</p>}

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</button>
          <span style={mutedStyle}>{page} / {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      )}

      {detailError && <p style={errorStyle}>{detailError}</p>}
      {detail && (
        <div style={{ ...cardStyle, marginTop: 20 }}>
          <strong>{detail.publicCode}</strong>
          <p style={mutedStyle}>محضر الاستلام: {detail.receiptBatchPublicCode ?? '—'}</p>
          <button onClick={() => setDetail(null)}>إغلاق</button>
        </div>
      )}
    </main>
  );
}
