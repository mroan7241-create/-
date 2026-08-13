'use client';

import { useEffect, useState } from 'react';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { AssociationSelect } from '../../lib/association-select';
import { initialQueryParam } from '../../lib/query';
import {
  ApiClientError,
  DEVICE_STATUS_LABELS,
  DEVICE_TYPE_LABELS,
  DEVICE_TYPES,
  getDeviceUnit,
  listDeviceUnits,
  markDeviceDamaged,
  updateDeviceUnit,
  type DeviceStatus,
  type DeviceType,
  type DeviceUnitSummary,
  type Paginated,
} from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, mutedStyle, pageStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

/** ADMIN — مخزون الأجهزة: قائمة مُرقَّمة خادميًا (تكافؤ getDeviceDetail/جزء القراءة من saveDevice القديمتين). الإنشاء حصرًا عبر تأكيد محضر استلام. */
export default function AdminInventoryPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [data, setData] = useState<Paginated<DeviceUnitSummary> | null>(null);
  const [associationId, setAssociationId] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [status, setStatus] = useState<DeviceStatus | ''>(() => (initialQueryParam('status') as DeviceStatus) || '');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getDeviceUnit>> | null>(null);
  const [detailError, setDetailError] = useState('');
  const [editType, setEditType] = useState<DeviceType | ''>('');
  const [editSpec, setEditSpec] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editNotice, setEditNotice] = useState('');

  function reload() {
    listDeviceUnits({ page, pageSize: 25, associationId: associationId || undefined, deviceType: deviceType || undefined, status: status || undefined })
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل المخزون'));
  }

  useEffect(() => {
    if (!user) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page, associationId, deviceType, status]);

  function openDetail(id: string) {
    setDetailError('');
    setEditNotice('');
    getDeviceUnit(id)
      .then((d) => {
        setDetail(d);
        setEditType((d.deviceType as DeviceType) ?? '');
        setEditSpec(d.spec ?? '');
      })
      .catch((e) => setDetailError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل تفاصيل الجهاز'));
  }

  async function saveEdit() {
    if (!detail) return;
    setEditBusy(true);
    setDetailError('');
    try {
      await updateDeviceUnit(detail.id, { deviceType: editType || undefined, spec: editSpec || undefined });
      setEditNotice('تم الحفظ.');
      openDetail(detail.id);
      reload();
    } catch (e) {
      setDetailError(e instanceof ApiClientError ? e.message : 'تعذّر الحفظ.');
    } finally {
      setEditBusy(false);
    }
  }

  async function damage() {
    if (!detail) return;
    if (!window.confirm('وَسم هذا الجهاز تالفًا؟ لا يمكن التراجع عن هذا من هنا.')) return;
    setEditBusy(true);
    setDetailError('');
    try {
      await markDeviceDamaged(detail.id);
      setEditNotice('تم وَسم الجهاز تالفًا.');
      openDetail(detail.id);
      reload();
    } catch (e) {
      setDetailError(e instanceof ApiClientError ? e.message : 'تعذّر تنفيذ العملية.');
    } finally {
      setEditBusy(false);
    }
  }

  if (loading || !user) return <p style={pageStyle}>...جارٍ التحميل</p>;

  return (
    <AppShell user={user}>
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
              onClick={() => openDetail(d.id)}
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
        <div style={{ ...cardStyle, marginTop: 20, maxWidth: 420 }}>
          <strong>{detail.publicCode}</strong>
          <p style={mutedStyle}>محضر الاستلام: {detail.receiptBatchPublicCode ?? '—'}</p>
          <p style={mutedStyle}>الحالة: {DEVICE_STATUS_LABELS[detail.status]}</p>

          {detail.status === 'WAREHOUSE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <label style={labelStyle}>
                نوع الجهاز
                <select value={editType} onChange={(e) => setEditType(e.target.value as DeviceType | '')} style={inputStyle}>
                  <option value="">— بلا تغيير —</option>
                  {DEVICE_TYPES.map((t) => (
                    <option key={t} value={t}>{DEVICE_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                المواصفة
                <input value={editSpec} onChange={(e) => setEditSpec(e.target.value)} style={inputStyle} />
              </label>
              {editNotice && <p style={mutedStyle}>{editNotice}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" disabled={editBusy} onClick={saveEdit} style={primaryButtonStyle}>حفظ التصحيح</button>
                <button type="button" disabled={editBusy} onClick={damage} style={secondaryButtonStyle}>وَسم تالف</button>
              </div>
            </div>
          )}

          <button onClick={() => setDetail(null)} style={{ marginTop: 12 }}>إغلاق</button>
        </div>
      )}
    </AppShell>
  );
}
