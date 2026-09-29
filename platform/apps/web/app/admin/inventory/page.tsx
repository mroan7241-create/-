'use client';

import { useEffect, useState } from 'react';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AssociationSelect } from '../../lib/association-select';
import { initialQueryParam } from '../../lib/query';
import {
  ApiClientError,
  apiFetch,
  DEVICE_STATUS_LABELS,
  DEVICE_TYPE_LABELS,
  DEVICE_TYPES,
  getDeviceUnit,
  listDeviceUnits,
  markDeviceDamaged,
  newOpId,
  updateDeviceUnit,
  type DeviceStatus,
  type DeviceType,
  type DeviceUnitSummary,
  type Paginated,
} from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, modalOverlayStyle, modalStyle, mutedStyle, pageStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

type DamageCase = {
  id: string;
  associationId: string;
  association: { name: string };
  receiptItem: { publicCode: string; receiptBatch: { publicCode: string } } | null;
  device: { publicCode: string } | null;
  quantity: number;
  description: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_RETURN' | 'RETURNED' | 'AWAITING_REPLACEMENT' | 'REPLACED' | 'SETTLED' | 'CLOSED';
  returnRequired: boolean;
  returnedAt: string | null;
  replacementExpected: boolean;
  replacementReceivedAt: string | null;
  resolution: string | null;
  createdAt: string;
  closedAt: string | null;
};

const damageStatusLabels: Record<DamageCase['status'], string> = {
  OPEN: 'جديدة', UNDER_REVIEW: 'قيد المراجعة', AWAITING_RETURN: 'بانتظار الإرجاع',
  RETURNED: 'أُعيدت', AWAITING_REPLACEMENT: 'بانتظار البديل', REPLACED: 'استُبدلت',
  SETTLED: 'سُوِّيت', CLOSED: 'مغلقة',
};

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
  const [confirmDamage, setConfirmDamage] = useState(false);
  const [showDamageCases, setShowDamageCases] = useState(false);
  const [damageCases, setDamageCases] = useState<Paginated<DamageCase> | null>(null);
  const [damagePage, setDamagePage] = useState(1);
  const [damageError, setDamageError] = useState('');
  const [damageNotice, setDamageNotice] = useState('');
  const [damageLoading, setDamageLoading] = useState(false);
  const [damageBusy, setDamageBusy] = useState(false);
  const [damageResolution, setDamageResolution] = useState<Record<string, string>>({});
  const [confirmCloseDamageId, setConfirmCloseDamageId] = useState<string | null>(null);

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

  function reloadDamageCases() {
    if (!showDamageCases) return;
    setDamageLoading(true);
    const query = new URLSearchParams({ page: String(damagePage), pageSize: '25' });
    if (associationId) query.set('associationId', associationId);
    apiFetch<Paginated<DamageCase>>(`/inventory/damage-cases?${query}`)
      .then((result) => { setDamageCases(result); setDamageError(''); })
      .catch((e) => setDamageError(e instanceof ApiClientError ? e.message : 'تعذّر تحميل حالات التلف'))
      .finally(() => setDamageLoading(false));
  }

  useEffect(() => {
    if (!user || !showDamageCases) return;
    reloadDamageCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, showDamageCases, damagePage, associationId]);

  async function decideDamageCase(id: string, nextStatus: 'UNDER_REVIEW' | 'SETTLED' | 'CLOSED') {
    setDamageBusy(true);
    setDamageError('');
    setDamageNotice('');
    try {
      await apiFetch(`/inventory/damage-cases/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus, resolution: nextStatus === 'SETTLED' ? damageResolution[id]?.trim() : undefined, opId: newOpId() }),
      });
      setDamageResolution((current) => ({ ...current, [id]: '' }));
      setDamageNotice(nextStatus === 'UNDER_REVIEW' ? 'بدأت مراجعة حالة التلف.' : nextStatus === 'SETTLED' ? 'حُفظ قرار معالجة التلف.' : 'أُغلقت حالة التلف.');
      reloadDamageCases();
    } catch (e) {
      setDamageError(e instanceof ApiClientError ? e.message : 'تعذّر حفظ قرار حالة التلف');
    } finally {
      setDamageBusy(false);
      setConfirmCloseDamageId(null);
    }
  }

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

      {(detailError || detail) && (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-labelledby="admin-device-detail-title">
        <section style={{ ...modalStyle, maxWidth: 620 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><h2 id="admin-device-detail-title" style={{ margin: 0 }}>تفاصيل الجهاز</h2><button type="button" style={secondaryButtonStyle} onClick={() => { setDetail(null); setDetailError(''); }}>إغلاق</button></div>
          {detailError && <p style={errorStyle}>{detailError}</p>}
          {detail && <><strong dir="ltr" style={{ display: 'block', marginTop: 14 }}>{detail.publicCode}</strong>
          <div className="detail-grid" style={{ marginTop: 12 }}>
            <span>النوع: {detail.deviceType ? DEVICE_TYPE_LABELS[detail.deviceType as DeviceType] ?? detail.deviceType : '—'}</span>
            <span>المواصفة: {detail.spec ?? '—'}</span>
            <span>الحالة: {DEVICE_STATUS_LABELS[detail.status]}</span>
            <span>موقع العهدة: {detail.currentLocationType}</span>
            <span>محضر الاستلام: {detail.receiptBatchPublicCode ?? '—'}</span>
            <span>تاريخ الإدخال: {new Date(detail.createdAt).toLocaleString('ar-SA')}</span>
            <span>آخر تحديث: {new Date(detail.updatedAt).toLocaleString('ar-SA')}</span>
          </div>

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
                <button type="button" disabled={editBusy} onClick={() => setConfirmDamage(true)} style={secondaryButtonStyle}>وَسم تالف</button>
              </div>
            </div>
          )}

          </>}
        </section>
        </div>
      )}

      <section style={{ ...cardStyle, marginTop: 24 }}>
        <h2>مراجعة حالات التلف</h2>
        <p style={mutedStyle}>تظهر حالات التلف الموثقة عند استلام الشحنات أو وَسم جهاز في المخزون. إغلاق الحالة قرار إداري مستقل بعد تسجيل المعالجة.</p>
        <button type="button" style={secondaryButtonStyle} onClick={() => { setShowDamageCases((value) => !value); setDamagePage(1); }}>
          {showDamageCases ? 'إخفاء حالات التلف' : 'عرض حالات التلف'}
        </button>
        {showDamageCases && <>
          {damageError && <p role="alert" style={errorStyle}>{damageError}</p>}
          {damageNotice && <p role="status" style={mutedStyle}>{damageNotice}</p>}
          {damageLoading && <p style={mutedStyle}>جارٍ تحميل حالات التلف...</p>}
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={tableStyle}>
              <thead><tr>
                <th style={thStyle}>الجمعية</th><th style={thStyle}>المرجع</th><th style={thStyle}>الكمية</th>
                <th style={thStyle}>التلف</th><th style={thStyle}>الحالة</th><th style={thStyle}>القرار</th>
              </tr></thead>
              <tbody>{(damageCases?.items ?? []).map((item) => <tr key={item.id}>
                <td style={tdStyle}>{item.association.name}</td>
                <td style={tdStyle}>{item.receiptItem?.receiptBatch.publicCode ?? item.device?.publicCode ?? '—'}</td>
                <td style={tdStyle}>{item.quantity}</td>
                <td style={tdStyle}>{item.description}</td>
                <td style={tdStyle}>{damageStatusLabels[item.status]}{item.resolution && <div style={mutedStyle}>{item.resolution}</div>}</td>
                <td style={tdStyle}>
                  {item.status === 'OPEN' && <button type="button" disabled={damageBusy} style={secondaryButtonStyle} onClick={() => decideDamageCase(item.id, 'UNDER_REVIEW')}>بدء المراجعة</button>}
                  {item.status === 'UNDER_REVIEW' && <div style={{ minWidth: 220 }}>
                    <label style={labelStyle}>قرار المعالجة
                      <textarea style={inputStyle} maxLength={2000} rows={2} value={damageResolution[item.id] ?? ''} onChange={(e) => setDamageResolution((current) => ({ ...current, [item.id]: e.target.value }))} />
                    </label>
                    <button type="button" disabled={damageBusy || !damageResolution[item.id]?.trim()} style={primaryButtonStyle} onClick={() => decideDamageCase(item.id, 'SETTLED')}>حفظ التسوية</button>
                  </div>}
                  {item.status === 'SETTLED' && <button type="button" disabled={damageBusy} style={secondaryButtonStyle} onClick={() => setConfirmCloseDamageId(item.id)}>إغلاق الحالة</button>}
                  {item.status !== 'OPEN' && item.status !== 'UNDER_REVIEW' && item.status !== 'SETTLED' && item.status !== 'CLOSED' && <span style={mutedStyle}>يتطلب توثيق الإرجاع أو البديل</span>}
                  {item.status === 'CLOSED' && <span style={mutedStyle}>لا إجراء</span>}
                </td>
              </tr>)}</tbody>
            </table>
          </div>
          {damageCases && damageCases.items.length === 0 && <p style={mutedStyle}>لا توجد حالات تلف مطابقة.</p>}
          {damageCases && damageCases.totalPages > 1 && <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" disabled={damagePage <= 1} onClick={() => setDamagePage((value) => value - 1)}>السابق</button>
            <span style={mutedStyle}>{damagePage} / {damageCases.totalPages}</span>
            <button type="button" disabled={damagePage >= damageCases.totalPages} onClick={() => setDamagePage((value) => value + 1)}>التالي</button>
          </div>}
        </>}
      </section>
      {confirmDamage && <ConfirmDialog
        title="تأكيد وسم الجهاز تالفًا"
        message="وَسم هذا الجهاز تالفًا؟ لا يمكن التراجع عن هذا من هنا."
        confirmLabel="وَسم تالف"
        tone="danger"
        onCancel={() => setConfirmDamage(false)}
        onConfirm={async () => { await damage(); setConfirmDamage(false); }}
      />}
      {confirmCloseDamageId && <ConfirmDialog
        title="تأكيد إغلاق حالة التلف"
        message="هل اكتملت معالجة التلف وتوثيق القرار؟ لا يمكن إعادة فتح الحالة من هنا."
        confirmLabel="إغلاق الحالة"
        onCancel={() => setConfirmCloseDamageId(null)}
        onConfirm={() => decideDamageCase(confirmCloseDamageId, 'CLOSED')}
      />}
    </AppShell>
  );
}
