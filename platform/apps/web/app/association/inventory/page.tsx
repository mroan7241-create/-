'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
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
import { initialQueryParam } from '../../lib/query';
import { useRoleGuard } from '../../lib/use-role-guard';
import {
  cardStyle,
  inputStyle,
  mutedStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../lib/ui';

const PAGE_SIZE = 25;
const STATUSES = Object.keys(DEVICE_STATUS_LABELS) as DeviceStatus[];
const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: 'مستودع الجمعية',
  DAMAGED_HOLDING: 'حجز التالف',
  DELEGATE: 'عهدة مندوب',
  BENEFICIARY: 'لدى المستفيد',
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('ar-SA') : '—';
}

export default function AssociationInventoryPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ASSOCIATION']);
  const [data, setData] = useState<Paginated<DeviceUnitSummary> | null>(null);
  const [counts, setCounts] = useState<Partial<Record<DeviceStatus, number>>>({});
  const [page, setPage] = useState(1);
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [status, setStatus] = useState<DeviceStatus | ''>(() => (initialQueryParam('status') as DeviceStatus) || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getDeviceUnit>> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await listDeviceUnits({
        page,
        pageSize: PAGE_SIZE,
        deviceType: deviceType || undefined,
        status: status || undefined,
      }));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل مخزون الجمعية.');
    } finally {
      setLoading(false);
    }
  }, [deviceType, page, status]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    Promise.all(STATUSES.map(async (item) => [item, (await listDeviceUnits({ pageSize: 1, status: item })).total] as const))
      .then((rows) => setCounts(Object.fromEntries(rows)))
      .catch(() => setCounts({}));
  }, [user]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    try {
      setDetail(await getDeviceUnit(id));
    } catch (err) {
      setDetailError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل تفاصيل الجهاز.');
    } finally {
      setDetailLoading(false);
    }
  }

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <h1 style={{ marginBottom: 6 }}>مخزون الجمعية</h1>
      <p style={{ ...mutedStyle, marginTop: 0 }}>قائمة تشغيلية بالأجهزة وحالتها وموقع عهدتها الحالي. إضافة الأجهزة تتم من محاضر الاستلام.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10, margin: '18px 0' }}>
        {STATUSES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => { setStatus(item); setPage(1); }}
            style={{ ...cardStyle, cursor: 'pointer', textAlign: 'right', borderColor: status === item ? 'var(--primary)' : undefined }}
          >
            <span style={mutedStyle}>{DEVICE_STATUS_LABELS[item]}</span>
            <strong style={{ display: 'block', fontSize: 24, marginTop: 5 }}>{counts[item] ?? '—'}</strong>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select
          aria-label="نوع الجهاز"
          value={deviceType}
          onChange={(event) => { setDeviceType(event.target.value as DeviceType | ''); setPage(1); }}
          style={{ ...inputStyle, width: 210 }}
        >
          <option value="">كل أنواع الأجهزة</option>
          {DEVICE_TYPES.map((item) => <option key={item} value={item}>{DEVICE_TYPE_LABELS[item]}</option>)}
        </select>
        <select
          aria-label="حالة الجهاز"
          value={status}
          onChange={(event) => { setStatus(event.target.value as DeviceStatus | ''); setPage(1); }}
          style={{ ...inputStyle, width: 220 }}
        >
          <option value="">كل الحالات</option>
          {STATUSES.map((item) => <option key={item} value={item}>{DEVICE_STATUS_LABELS[item]}</option>)}
        </select>
        {(deviceType || status) && (
          <button type="button" style={secondaryButtonStyle} onClick={() => { setDeviceType(''); setStatus(''); setPage(1); }}>
            مسح التصفية
          </button>
        )}
      </div>

      {error && <ErrorState message={error} />}
      {loading && <LoadingState label="جارٍ تحميل أجهزة الجمعية…" />}
      {!loading && data?.items.length === 0 && <EmptyState message="لا توجد أجهزة مطابقة للتصفية الحالية." />}

      {!loading && data && data.items.length > 0 && (
        <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>الرمز</th>
                <th style={thStyle}>النوع</th>
                <th style={thStyle}>المواصفة</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>موقع العهدة</th>
                <th style={thStyle}>آخر تحديث</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {data.items.map((device) => (
                <tr key={device.id}>
                  <td style={tdStyle}>{device.publicCode}</td>
                  <td style={tdStyle}>{device.deviceType ? DEVICE_TYPE_LABELS[device.deviceType as DeviceType] ?? device.deviceType : '—'}</td>
                  <td style={tdStyle}>{device.spec ?? '—'}</td>
                  <td style={tdStyle}>
                    <span style={statusBadgeStyle(device.status === 'DAMAGED' ? 'bad' : device.status === 'DELIVERED' ? 'good' : 'neutral')}>
                      {DEVICE_STATUS_LABELS[device.status]}
                    </span>
                  </td>
                  <td style={tdStyle}>{LOCATION_LABELS[device.currentLocationType] ?? device.currentLocationType}</td>
                  <td style={tdStyle}>{formatDate(device.updatedAt)}</td>
                  <td style={tdStyle}>
                    <button type="button" style={secondaryButtonStyle} onClick={() => void openDetail(device.id)}>التفاصيل</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</button>
          <span style={mutedStyle}>صفحة {data.page} من {data.totalPages} — {data.total} جهاز</span>
          <button type="button" style={secondaryButtonStyle} disabled={page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>التالي</button>
        </div>
      )}

      {(detailLoading || detailError || detail) && (
        <section style={{ ...cardStyle, marginTop: 20, maxWidth: 560 }} aria-labelledby="association-device-detail">
          <h2 id="association-device-detail" style={{ fontSize: 18, marginTop: 0 }}>تفاصيل الجهاز</h2>
          {detailLoading && <LoadingState />}
          {detailError && <ErrorState message={detailError} />}
          {detail && (
            <div style={{ display: 'grid', gap: 7 }}>
              <strong>{detail.publicCode}</strong>
              <span>النوع: {detail.deviceType ? DEVICE_TYPE_LABELS[detail.deviceType as DeviceType] ?? detail.deviceType : '—'}</span>
              <span>المواصفة: {detail.spec ?? '—'}</span>
              <span>الحالة: {DEVICE_STATUS_LABELS[detail.status]}</span>
              <span>موقع العهدة: {LOCATION_LABELS[detail.currentLocationType] ?? detail.currentLocationType}</span>
              <span>محضر الاستلام: {detail.receiptBatchPublicCode ?? '—'}</span>
              <span>تاريخ الإدخال: {formatDate(detail.createdAt)}</span>
              <span>آخر تحديث: {formatDate(detail.updatedAt)}</span>
              <span>تاريخ التسليم: {formatDate(detail.deliveredAt)}</span>
              <button type="button" style={{ ...secondaryButtonStyle, marginTop: 6, justifySelf: 'start' }} onClick={() => setDetail(null)}>إغلاق</button>
            </div>
          )}
        </section>
      )}
    </AppShell>
  );
}
