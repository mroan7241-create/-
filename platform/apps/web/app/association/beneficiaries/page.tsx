'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiClientError,
  apiFetch,
  BENEFICIARY_REVIEW_STATUS_LABELS,
  DEVICE_TYPES,
  DEVICE_TYPE_LABELS,
  getReferenceData,
  NEED_DECISION_STATUS_LABELS,
  newOpId,
  type BeneficiaryDetail,
  type BeneficiaryReviewStatus,
  type BeneficiarySummary,
  type DeviceType,
  type Paginated,
  type ReferenceData,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import {
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  modalOverlayStyle,
  modalStyle,
  mutedStyle,
  pageStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  successStyle,
} from '../../lib/ui';

const PAGE_SIZE = 25;

function statusTone(status: BeneficiaryReviewStatus): 'neutral' | 'good' | 'bad' {
  if (status === 'APPROVED') return 'good';
  if (status === 'REJECTED') return 'bad';
  return 'neutral';
}

interface FormState {
  name: string;
  region: string;
  city: string;
  district: string;
  address: string;
  phone: string;
  phone2: string;
  familyCount: string;
  socialSecurity: boolean;
  socialStatus: string;
  income: string;
  landmark: string;
  notes: string;
  deviceTypes: DeviceType[];
}

const EMPTY_FORM: FormState = {
  name: '',
  region: '',
  city: '',
  district: '',
  address: '',
  phone: '',
  phone2: '',
  familyCount: '1',
  socialSecurity: false,
  socialStatus: '',
  income: '0',
  landmark: '',
  notes: '',
  deviceTypes: [],
};

/**
 * شاشة المستفيدين لدور الجمعية — **بطاقات** لا جدول، مطابقةً لِ
 * `Index.html::renderBeneficiaries` (الجمعية تبقى على `beneficiaryCard`،
 * والجدول لِADMIN وحده لأن الجمعية لا تملك صلاحية اعتماد أصلًا).
 *
 * العزل مفروض خادميًا بالكامل: كل الطلبات تعتمد `associationId` من الجلسة
 * حصرًا — لا تُرسل الواجهة معرّف جمعية إطلاقًا.
 */
export default function AssociationBeneficiariesPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ASSOCIATION']);

  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [socialStatuses, setSocialStatuses] = useState<string[]>([]);
  const [data, setData] = useState<Paginated<BeneficiarySummary> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<BeneficiaryDetail | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    try {
      setData(await apiFetch<Paginated<BeneficiarySummary>>(`/beneficiaries?${params.toString()}`));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل قائمة المستفيدين.');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (!user) return;
    void load();
    getReferenceData()
      .then((ref) => {
        setReference(ref);
        setSocialStatuses(ref.socialStatuses ?? []);
      })
      .catch(() => undefined);
  }, [user, load]);

  async function openEdit(id: string) {
    try {
      setEditing(await apiFetch<BeneficiaryDetail>(`/beneficiaries/${id}`));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل بيانات المستفيد.');
    }
  }

  if (guardLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: 'var(--zad-800)', marginBottom: 4 }}>المستفيدون</h1>
          <p style={mutedStyle}>
            كل مستفيد جديد يجب أن يحمل احتياجًا واحدًا على الأقل. الاحتياجات قابلة للتعديل ما دام المستفيد تحت المراجعة.
          </p>
        </div>
        <button type="button" style={primaryButtonStyle} onClick={() => setEditing('new')}>
          ＋ إضافة مستفيد
        </button>
      </div>

      <div style={{ ...cardStyle, marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ ...labelStyle, flex: '1 1 260px' }}>
          بحث
          <input
            style={inputStyle}
            value={searchInput}
            placeholder="ابحث بالاسم أو الرقم أو الجوال…"
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                setSearch(searchInput.trim());
              }
            }}
          />
        </label>
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={() => {
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          تطبيق
        </button>
      </div>

      {listError && <p style={{ ...errorStyle, marginTop: 12 }}>{listError}</p>}
      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}

      {loading && <p style={{ ...mutedStyle, marginTop: 16 }}>جارِ التحميل…</p>}
      {!loading && data && data.items.length === 0 && (
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <p style={mutedStyle}>لم يُضف أي مستفيد بعد. ابدأ بإضافة مستفيد واحد.</p>
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {(data?.items ?? []).map((row) => (
          <div key={row.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <strong>{row.name}</strong>
              <span style={statusBadgeStyle(statusTone(row.reviewStatus))}>
                {BENEFICIARY_REVIEW_STATUS_LABELS[row.reviewStatus]}
              </span>
            </div>
            <p style={{ ...mutedStyle, margin: '6px 0' }}>
              {row.publicCode} — {row.city} — {row.phone}
            </p>
            <p style={{ fontSize: 13, margin: '6px 0' }}>
              الاحتياجات: {row.needsTotal} (معلَّق {row.needsPending} / معتمد {row.needsApproved} / مرفوض {row.needsRejected})
            </p>
            {row.beneficiaryRejectReason && (
              <p style={{ ...mutedStyle, margin: '6px 0' }}>سبب الرفض: {row.beneficiaryRejectReason}</p>
            )}
            <button type="button" style={{ ...secondaryButtonStyle, marginTop: 8 }} onClick={() => void openEdit(row.id)}>
              {row.reviewStatus === 'UNDER_REVIEW' ? 'تعديل' : 'عرض'}
            </button>
          </div>
        ))}
      </div>

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            السابق
          </button>
          <span style={mutedStyle}>
            صفحة {data.page} من {data.totalPages} — {data.total} سجلًا
          </span>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </button>
        </div>
      )}

      {editing && (
        <BeneficiaryForm
          initial={editing}
          reference={reference}
          socialStatuses={socialStatuses}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </main>
  );
}

function BeneficiaryForm({
  initial,
  reference,
  socialStatuses,
  onClose,
  onSaved,
}: {
  initial: BeneficiaryDetail | 'new';
  reference: ReferenceData | null;
  socialStatuses: string[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const isNew = initial === 'new';
  const existing = isNew ? null : initial;
  const locked = !!existing && existing.reviewStatus !== 'UNDER_REVIEW';

  const [form, setForm] = useState<FormState>(
    existing
      ? {
          name: existing.name,
          region: existing.region,
          city: existing.city,
          district: existing.district ?? '',
          address: existing.address,
          phone: existing.phone,
          phone2: existing.phone2 ?? '',
          familyCount: String(existing.familyCount),
          socialSecurity: existing.socialSecurity,
          socialStatus: existing.socialStatus,
          income: String(existing.income ?? 0),
          landmark: existing.landmark ?? '',
          notes: existing.notes ?? '',
          deviceTypes: existing.needs.map((n) => n.deviceType),
        }
      : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cities = reference && form.region ? (reference.citiesByRegion[form.region] ?? []) : [];

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDevice(type: DeviceType) {
    setForm((prev) => ({
      ...prev,
      deviceTypes: prev.deviceTypes.includes(type)
        ? prev.deviceTypes.filter((t) => t !== type)
        : [...prev.deviceTypes, type],
    }));
  }

  async function submit() {
    setError(null);
    if (form.deviceTypes.length === 0) {
      setError('اختر احتياجًا واحدًا على الأقل.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        region: form.region,
        city: form.city,
        district: form.district,
        address: form.address,
        phone: form.phone,
        familyCount: Number(form.familyCount),
        socialSecurity: form.socialSecurity,
        socialStatus: form.socialStatus,
        income: Number(form.income || 0),
        opId: newOpId(),
      };
      if (form.phone2.trim()) body.phone2 = form.phone2.trim();
      if (form.landmark.trim()) body.landmark = form.landmark.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();
      // الاحتياجات تُرسل فقط ما دام المستفيد قابلًا للتعديل — بعد القرار
      // النهائي يرفضها الخادم صراحةً، فلا نرسلها أصلًا.
      if (!locked) body.deviceTypes = form.deviceTypes;

      if (existing) {
        await apiFetch(`/beneficiaries/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        await onSaved('تم حفظ تعديلات المستفيد.');
      } else {
        await apiFetch('/beneficiaries', { method: 'POST', body: JSON.stringify(body) });
        await onSaved('تمت إضافة المستفيد واحتياجاته.');
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر حفظ بيانات المستفيد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <h2 style={{ marginTop: 0, color: 'var(--zad-800)' }}>{isNew ? 'إضافة مستفيد' : `تعديل: ${existing?.name}`}</h2>

        {locked && (
          <p style={{ ...mutedStyle, marginTop: 0 }}>
            سبق البتّ نهائيًا في هذا المستفيد ({BENEFICIARY_REVIEW_STATUS_LABELS[existing!.reviewStatus]}) — لا يمكن تعديل
            احتياجاته.
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
          <label style={labelStyle}>
            اسم المستفيد
            <input style={inputStyle} value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label style={labelStyle}>
            المنطقة
            <select
              style={inputStyle}
              value={form.region}
              onChange={(e) => {
                set('region', e.target.value);
                set('city', '');
              }}
            >
              <option value="">اختر…</option>
              {(reference?.regions ?? []).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            المدينة
            <select style={inputStyle} value={form.city} onChange={(e) => set('city', e.target.value)}>
              <option value="">اختر…</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            الحي
            <input style={inputStyle} value={form.district} maxLength={120} onChange={(e) => set('district', e.target.value)} />
          </label>
          <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
            العنوان الوصفي (الشارع وأقرب معلم)
            <input style={inputStyle} value={form.address} maxLength={250} onChange={(e) => set('address', e.target.value)} />
          </label>
          <label style={labelStyle}>
            رقم الجوال
            <input style={inputStyle} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label style={labelStyle}>
            رقم جوال إضافي (اختياري)
            <input style={inputStyle} value={form.phone2} onChange={(e) => set('phone2', e.target.value)} />
          </label>
          <label style={labelStyle}>
            عدد الأفراد
            <input
              style={inputStyle}
              type="number"
              min={1}
              max={99}
              value={form.familyCount}
              onChange={(e) => set('familyCount', e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            الحالة الاجتماعية
            {socialStatuses.length > 0 ? (
              <select style={inputStyle} value={form.socialStatus} onChange={(e) => set('socialStatus', e.target.value)}>
                <option value="">اختر…</option>
                {socialStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <input style={inputStyle} value={form.socialStatus} onChange={(e) => set('socialStatus', e.target.value)} />
            )}
          </label>
          <label style={labelStyle}>
            مبلغ الدخل
            <input
              style={inputStyle}
              type="number"
              min={0}
              value={form.income}
              onChange={(e) => set('income', e.target.value)}
            />
          </label>
          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.socialSecurity}
              onChange={(e) => set('socialSecurity', e.target.checked)}
            />
            ضمان اجتماعي
          </label>
          <label style={labelStyle}>
            علامة مميزة (اختياري)
            <input style={inputStyle} value={form.landmark} maxLength={200} onChange={(e) => set('landmark', e.target.value)} />
          </label>
          <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
            ملاحظات (اختياري)
            <textarea
              style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
              value={form.notes}
              maxLength={1000}
              onChange={(e) => set('notes', e.target.value)}
            />
          </label>
        </div>

        <h3 style={{ marginBottom: 6 }}>الاحتياجات المطلوبة</h3>
        {locked ? (
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {existing!.needs.map((n) => (
              <li key={n.id} style={{ fontSize: 14 }}>
                {DEVICE_TYPE_LABELS[n.deviceType]} — {NEED_DECISION_STATUS_LABELS[n.decisionStatus]}
                {n.rejectReason ? ` (${n.rejectReason})` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {DEVICE_TYPES.map((type) => {
              const need = existing?.needs.find((n) => n.deviceType === type);
              const decided = need && need.decisionStatus !== 'PENDING';
              return (
                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={form.deviceTypes.includes(type)}
                    disabled={decided}
                    onChange={() => toggleDevice(type)}
                  />
                  {DEVICE_TYPE_LABELS[type]}
                  {decided && <span style={mutedStyle}> ({NEED_DECISION_STATUS_LABELS[need!.decisionStatus]})</span>}
                </label>
              );
            })}
          </div>
        )}

        {error && <p style={{ ...errorStyle, marginTop: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => void submit()}>
            {isNew ? 'إضافة' : 'حفظ'}
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
