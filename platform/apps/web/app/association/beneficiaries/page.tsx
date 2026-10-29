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
  type SaveResult,
} from '../../lib/api';
import { BulkImportButton } from '../../lib/beneficiary-import';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { initialQueryParam } from '../../lib/query';
import {
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  modalOverlayStyle,
  modalStyle,
  mutedStyle,
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

/**
 * NODE-3.1: `address`/`landmark` **ليسا في نموذج الإدخال إطلاقًا** — حقلا
 * قراءة تاريخية فقط (قرار مستخدم صريح، انحراف مقصود عن النظام القديم).
 * لا يظهران كمُدخَلين ولا يُرسَلان في أي جسم طلب.
 */
interface FormState {
  needPriority: string;
  threeDeviceReason: string;
  name: string;
  region: string;
  city: string;
  district: string;
  phone: string;
  phone2: string;
  familyCount: string;
  socialSecurity: '' | 'نعم' | 'لا';
  socialStatus: string;
  income: string;
  notes: string;
  /** إحداثيات اختيارية بالكامل — الحفظ بلا موقع صالح دائمًا. */
  lat: string;
  lng: string;
  locationSource: string;
  deviceTypes: DeviceType[];
}

const EMPTY_FORM: FormState = {
  needPriority: '',
  threeDeviceReason: '',
  name: '',
  region: '',
  city: '',
  district: '',
  phone: '',
  phone2: '',
  familyCount: '1',
  socialSecurity: '',
  socialStatus: '',
  income: '',
  notes: '',
  lat: '',
  lng: '',
  locationSource: '',
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
  const [locationStatus, setLocationStatus] = useState('');
  const [reviewStatus, setReviewStatus] = useState<'' | BeneficiaryReviewStatus>(() => (initialQueryParam('reviewStatus') as BeneficiaryReviewStatus) || '');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<BeneficiaryDetail | 'new' | null>(null);
  const [testBatchIds, setTestBatchIds] = useState<string[]>([]);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [intake, setIntake] = useState<{ limit: number; count: number; remaining: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortBy: 'needPriority' });
    if (search) params.set('search', search);
    if (locationStatus) params.set('locationStatus', locationStatus);
    if (reviewStatus) params.set('reviewStatus', reviewStatus);
    try {
      const [list, status] = await Promise.all([apiFetch<Paginated<BeneficiarySummary>>(`/beneficiaries?${params.toString()}`), apiFetch<{ limit: number; count: number; remaining: number }>('/beneficiaries/intake-status')]);
      setData(list); setIntake(status);
      return status;
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل قائمة المستفيدين.');
    } finally {
      setLoading(false);
    }
  }, [page, search, locationStatus, reviewStatus]);

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
    <AppShell user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: 'var(--zad-800)', marginBottom: 4 }}>المستفيدون</h1>
          <p style={mutedStyle}>
            أضيفوا {intake?.limit ?? 50} أسرة بترتيب الحاجة؛ 1 للأشد حاجة. عند طلب ثلاثة أجهزة يلزم توضيح السبب. الأسر والاحتياجات المرفوعة ستخضع للدراسة.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <BulkImportButton isAdmin={false} limit={intake?.limit ?? 50} disabled={!intake || intake.remaining === 0} onImported={(ids) => { if (user.name === 'جمعية تجربة') setTestBatchIds(ids); void load(); }} />
          <button type="button" style={primaryButtonStyle} disabled={!intake || intake.remaining === 0} onClick={() => setEditing('new')}>
            ＋ إضافة مستفيد
          </button>
        </div>
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
        {/* مُصفّي "بانتظار تحديد الموقع" — مشتق خادميًا من غياب الإحداثيات. */}
        <label style={{ ...labelStyle, flex: '0 1 220px' }}>
          حالة الموقع
          <select
            style={inputStyle}
            value={locationStatus}
            onChange={(e) => {
              setPage(1);
              setLocationStatus(e.target.value);
            }}
          >
            <option value="">الكل</option>
            <option value="PENDING">بانتظار تحديد الموقع</option>
            <option value="CONFIRMED">موقع مؤكد</option>
          </select>
        </label>
        <label style={{ ...labelStyle, flex: '0 1 220px' }}>
          حالة المراجعة
          <select
            style={inputStyle}
            value={reviewStatus}
            onChange={(e) => {
              setPage(1);
              setReviewStatus(e.target.value as '' | BeneficiaryReviewStatus);
            }}
          >
            <option value="">الكل</option>
            <option value="UNDER_REVIEW">تحت المراجعة</option>
            <option value="APPROVED">معتمد</option>
            <option value="REJECTED">مرفوض</option>
          </select>
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
      {intake && <p style={mutedStyle}>المسجل: {intake.count} من {intake.limit} أسرة · المتاح: {intake.remaining}{intake.remaining === 0 ? ' — اكتمل الحد المسموح؛ أي زيادة تحتاج إذن إدارة المشروع.' : ''}</p>}
      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}
      {user.name === 'جمعية تجربة' && (testBatchIds.length > 0 || (data?.total ?? 0) > 0) && <button type="button" style={secondaryButtonStyle} disabled={cleanupBusy} onClick={async () => {
        if (!window.confirm('حذف بيانات دفعة الاختبار الوهمية فقط؟ لا يشمل ذلك الميثاق أو البيانات السابقة.')) return;
        setCleanupBusy(true);
        try {
          const ids = testBatchIds.length ? testBatchIds : (await apiFetch<Paginated<BeneficiarySummary>>('/beneficiaries?pageSize=100')).items.filter(row => /^اختبار رفع الأسر — \d+$/.test(row.name) && /^ONBOARDING-TEST-20261029-[a-f0-9-]{36}$/.test(row.notes ?? '')).map(row => row.id);
          if (!ids.length) throw new Error('لا توجد دفعة اختبار مطابقة للحذف.');
          const result = await apiFetch<{ removedCount: number }>('/beneficiaries/test-import/cleanup', { method: 'POST', body: JSON.stringify({ beneficiaryIds: ids }) });
          setTestBatchIds([]); setNotice(`حُذفت بيانات ${result.removedCount} أسرة تجريبية واحتياجاتها.`); await load();
        } catch (error) { setListError(error instanceof Error ? error.message : 'تعذر تنظيف دفعة الاختبار.'); }
        finally { setCleanupBusy(false); }
      }}>حذف بيانات دفعة اختبار الرفع</button>}

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
            <p style={{ fontSize: 14, fontWeight: 700 }}>ترتيب الحاجة: {row.needPriority ?? 'لم يُحدد'}</p>
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
          defaultRegion={user.associationRegion ?? ''}
          limit={intake?.limit ?? 50}
          onClose={() => setEditing(null)}
          onSaved={async (message, addNext) => {
            setNotice(message);
            const status = await load();
            if (!addNext || status?.remaining === 0) setEditing(null);
          }}
        />
      )}
    </AppShell>
  );
}

function BeneficiaryForm({
  initial,
  reference,
  socialStatuses,
  defaultRegion,
  limit,
  onClose,
  onSaved,
}: {
  initial: BeneficiaryDetail | 'new';
  reference: ReferenceData | null;
  socialStatuses: string[];
  defaultRegion: string;
  limit: number;
  onClose: () => void;
  onSaved: (message: string, addNext?: boolean) => Promise<void>;
}) {
  const isNew = initial === 'new';
  const existing = isNew ? null : initial;
  const locked = !!existing && existing.reviewStatus !== 'UNDER_REVIEW';

  const [form, setForm] = useState<FormState>(
    existing
      ? {
          name: existing.name,
          needPriority: existing.needPriority == null ? '' : String(existing.needPriority),
          threeDeviceReason: existing.threeDeviceReason ?? '',
          region: existing.region,
          city: existing.city,
          district: existing.district ?? '',
          phone: existing.phone,
          phone2: existing.phone2 ?? '',
          familyCount: String(existing.familyCount),
          socialSecurity: existing.socialSecurity ? 'نعم' : 'لا',
          socialStatus: existing.socialStatus,
          income: existing.income == null ? '' : String(existing.income),
          notes: existing.notes ?? '',
          lat: existing.lat == null ? '' : String(existing.lat),
          lng: existing.lng == null ? '' : String(existing.lng),
          locationSource: existing.locationSource ?? '',
          deviceTypes: existing.needs.map((n) => n.deviceType),
        }
      : { ...EMPTY_FORM, region: defaultRegion },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opId, setOpId] = useState(newOpId);
  const [lastSaved, setLastSaved] = useState('');

  const cities = reference && form.region ? (reference.citiesByRegion[form.region] ?? []) : [];

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setOpId(newOpId());
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDevice(type: DeviceType) {
    setOpId(newOpId());
    setForm((prev) => ({
      ...prev,
      deviceTypes: prev.deviceTypes.includes(type)
        ? prev.deviceTypes.filter((t) => t !== type)
        : [...prev.deviceTypes, type],
    }));
  }

  async function submit(addNext = false) {
    setError(null);
    if (!form.name.trim() || !form.region || !form.city || !form.district.trim() || !form.phone.trim() || !form.socialStatus) {
      setError('أكمل الاسم والمنطقة والمدينة والحي والجوال والحالة الاجتماعية.');
      return;
    }
    if (form.deviceTypes.length === 0) {
      setError('اختر احتياجًا واحدًا على الأقل.');
      return;
    }
    if (!form.socialSecurity) {
      setError('أجب عن سؤال الاستفادة من الضمان الاجتماعي بنعم أو لا.');
      return;
    }
    if (form.income.trim() === '' || !Number.isInteger(Number(form.income)) || Number(form.income) < 0 || Number(form.income) > 1_000_000) {
      setError('أدخل دخل المستفيد بالريال من 0 إلى 1000000، واكتب 0 إذا لم يكن له دخل.');
      return;
    }
    const needPriority = Number(form.needPriority);
    if ((isNew || form.needPriority !== '') && (!Number.isInteger(needPriority) || needPriority < 1 || needPriority > limit)) {
      setError(`أدخل ترتيب الحاجة من 1 إلى ${limit}؛ الرقم 1 للأسرة الأشد حاجة.`);
      return;
    }
    if (!locked && form.deviceTypes.length === 3 && !/[\p{L}\p{N}]/u.test(form.threeDeviceReason)) {
      setError('عند طلب ثلاثة أجهزة يجب كتابة مبرر يشرح حاجة الأسرة إليها.');
      return;
    }
    const latFilled = form.lat.trim() !== '';
    const lngFilled = form.lng.trim() !== '';
    if (latFilled !== lngFilled) {
      setError('أدخل خط العرض وخط الطول معًا، أو اترك الحقلين فارغين معًا.');
      return;
    }
    setBusy(true);
    try {
      // `address`/`landmark` **لا يُرسَلان أبدًا** — ليسا حقلَي إدخال بعد
      // الآن، ويرفضهما الخادم صراحةً بـ400 لو أُرسلا (NODE-3.1 البند 1).
      const body: Record<string, unknown> = {
        ...(form.needPriority !== '' ? { needPriority } : {}),
        ...(!locked ? { threeDeviceReason: form.threeDeviceReason.trim() } : {}),
        name: form.name,
        region: form.region,
        city: form.city,
        district: form.district,
        phone: form.phone,
        familyCount: Number(form.familyCount),
        socialSecurity: form.socialSecurity === 'نعم',
        socialStatus: form.socialStatus,
        income: Number(form.income),
        opId,
      };
      if (form.phone2.trim()) body.phone2 = form.phone2.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();

      // الموقع: الحقلان معًا ⇒ حفظ إحداثيات؛ فارغان عند **تعديل** سجل كان
      // يحمل موقعًا ⇒ مسح صريح (`null` لكليهما) مطابقةً لزر "مسح الموقع"
      // القديم؛ فارغان في سجل بلا موقع أصلًا ⇒ لا يُرسل شيء إطلاقًا حتى لا
      // يُلمَس الموقع بلا داعٍ.
      if (latFilled && lngFilled) {
        body.lat = Number(form.lat);
        body.lng = Number(form.lng);
        body.locationSource = form.locationSource || 'MANUAL';
      } else if (existing && existing.lat != null) {
        body.lat = null;
        body.lng = null;
      }

      // الاحتياجات تُرسل فقط ما دام المستفيد قابلًا للتعديل — بعد القرار
      // النهائي يرفضها الخادم صراحةً، فلا نرسلها أصلًا.
      if (!locked) body.deviceTypes = form.deviceTypes;

      const result = existing
        ? await apiFetch<SaveResult>(`/beneficiaries/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await apiFetch<SaveResult>('/beneficiaries', { method: 'POST', body: JSON.stringify(body) });

      // تنبيه "مطابق محتمل" غير حاجب: الحفظ **نجح** فعلًا، فيُعرض كتنبيه
      // مُلحَق بالرسالة لا كنافذة مانعة (نفس سلوك toast التحذيري القديم).
      const base = existing ? 'تم حفظ تعديلات المستفيد.' : 'تمت إضافة المستفيد واحتياجاته.';
      await onSaved(result?.possibleDuplicate ? `${base} ⚠ ${result.possibleDuplicate.message}` : base, addNext);
      if (addNext) {
        setLastSaved(`تمت إضافة ${form.name}. يمكنك إدخال المستفيد التالي.`);
        setForm({ ...EMPTY_FORM, region: form.region, city: form.city, district: form.district, needPriority: needPriority < limit ? String(needPriority + 1) : '' });
        setOpId(newOpId());
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر حفظ بيانات المستفيد.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * تحديد الموقع عبر `navigator.geolocation` المدمج في المتصفح — بلا أي
   * مفتاح API أو مكتبة خرائط أو تبعية جديدة، ولا يُطلَب الإذن إلا عند ضغط
   * المستخدم صراحةً على هذا الزر.
   */
  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('المتصفح لا يدعم تحديد الموقع.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOpId(newOpId());
        setForm((prev) => ({
          ...prev,
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
          locationSource: 'CURRENT_LOCATION',
        }));
        setError(null);
      },
      () => setError('تعذّر الحصول على الموقع — تحقق من إذن الموقع في المتصفح.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function clearLocation() {
    setOpId(newOpId());
    setForm((prev) => ({ ...prev, lat: '', lng: '', locationSource: '' }));
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <h2 style={{ marginTop: 0, color: 'var(--zad-800)' }}>{isNew ? 'إضافة مستفيد' : `تعديل: ${existing?.name}`}</h2>
        <p style={mutedStyle}>المدينة والحي مطلوبان. موقع منزل المستفيد الدقيق اختياري ويمكن إضافته لاحقًا.</p>
        {lastSaved && <p role="status" style={successStyle}>{lastSaved}</p>}

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
            ترتيب الحاجة (1 للأشد حاجة)
            <input style={inputStyle} type="number" min={1} max={limit} step={1} disabled={locked} value={form.needPriority} onChange={(e) => set('needPriority', e.target.value)} />
          </label>
          <label style={labelStyle}>
            المنطقة
            <select
              style={inputStyle}
              value={form.region}
              disabled={isNew && !!defaultRegion && !!reference?.regions.includes(defaultRegion)}
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
          <label style={labelStyle}>
            رقم الجوال
            <input style={inputStyle} inputMode="tel" autoComplete="tel" dir="ltr" placeholder="05XXXXXXXX" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label style={labelStyle}>
            رقم جوال إضافي (اختياري)
            <input style={inputStyle} value={form.phone2} onChange={(e) => set('phone2', e.target.value)} />
          </label>
          <label style={labelStyle}>
            عدد أفراد الأسرة شامل المستفيد
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
            كم دخل المستفيد؟ (ريال)
            <input
              style={inputStyle}
              type="number"
              min={0}
              max={1_000_000}
              step={1}
              placeholder="اكتب 0 إذا لم يكن له دخل"
              value={form.income}
              onChange={(e) => set('income', e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            هل يستفيد من الضمان الاجتماعي؟
            <select style={inputStyle} value={form.socialSecurity} onChange={(e) => set('socialSecurity', e.target.value as FormState['socialSecurity'])}>
              <option value="">اختر…</option>
              <option value="نعم">نعم</option>
              <option value="لا">لا</option>
            </select>
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

        {/*
          الموقع — اختياري بالكامل: يمكن حفظ المستفيد بلا إحداثيات دائمًا.
          بلا أي مكتبة خرائط أو مزوّد خارجي أو تبعية جديدة: `navigator.geolocation`
          المدمج + إدخال يدوي للإحداثيات. (اختيار الموقع بصريًا على خريطة
          مؤجَّل لقرار مزوّد الخرائط — راجع docs/BENEFICIARIES.md.)
        */}
        <details style={{ marginTop: 14, marginBottom: 14 }}><summary style={{ cursor: 'pointer', fontWeight: 700 }}>موقع منزل المستفيد الدقيق (اختياري)</summary>
        <p style={{ ...mutedStyle, marginTop: 0 }}>
          {form.lat && form.lng
            ? `الموقع المحدَّد حاليًا: ${form.lat}، ${form.lng}`
            : 'لم يُحدَّد موقع بعد — يمكن الحفظ دون تحديد الموقع وإكماله لاحقًا.'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" style={secondaryButtonStyle} onClick={useMyLocation}>
            📍 أنا الآن عند منزل المستفيد — استخدم موقعي
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={clearLocation}>
            ✕ مسح الموقع
          </button>
          {form.lat && form.lng && (
            <a
              href={`https://www.google.com/maps?q=${form.lat},${form.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...secondaryButtonStyle, textDecoration: 'none', display: 'inline-block' }}
            >
              فتح في خرائط Google
            </a>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label style={labelStyle}>
            خط العرض
            <input
              style={inputStyle}
              type="number"
              step="any"
              min={-90}
              max={90}
              dir="ltr"
              value={form.lat}
              onChange={(e) => {
                set('lat', e.target.value);
                set('locationSource', 'MANUAL');
              }}
            />
          </label>
          <label style={labelStyle}>
            خط الطول
            <input
              style={inputStyle}
              type="number"
              step="any"
              min={-180}
              max={180}
              dir="ltr"
              value={form.lng}
              onChange={(e) => {
                set('lng', e.target.value);
                set('locationSource', 'MANUAL');
              }}
            />
          </label>
        </div>
        <p style={mutedStyle}>لا تستخدم موقعك الحالي وأنت في مكتب الجمعية؛ المطلوب موقع منزل المستفيد.</p></details>
        {/* حقول تاريخية للقراءة فقط — تظهر إن حملها السجل، ولا تُرسَل أبدًا. */}
        {existing && (existing.address || existing.landmark) && (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 6 }}>بيانات تاريخية (للقراءة فقط)</h3>
            {existing.address && <p style={{ ...mutedStyle, margin: '2px 0' }}>العنوان الوصفي: {existing.address}</p>}
            {existing.landmark && <p style={{ ...mutedStyle, margin: '2px 0' }}>علامة مميزة: {existing.landmark}</p>}
            <p style={{ ...mutedStyle, margin: '2px 0' }}>
              هذان الحقلان محفوظان من النظام القديم للاطّلاع فقط، ولم يعودا قابلين للتعديل.
            </p>
          </div>
        )}

        <h3 style={{ marginBottom: 6 }}>الاحتياجات المطلوبة</h3>
        <p style={mutedStyle}>الأصل جهاز واحد لكل أسرة حسب الاحتياج. الأسرة التي تحتاج جهازين تكون أشد حاجة من الأسرة التي تحتاج جهازًا واحدًا.</p>
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

        {(form.deviceTypes.length === 3 || form.threeDeviceReason) && <label style={{ ...labelStyle, marginTop: 12 }}>
          مبرر طلب ثلاثة أجهزة {form.deviceTypes.length === 3 ? '(إلزامي)' : '(اختياري)'}
          <textarea style={{ ...inputStyle, minHeight: 85 }} maxLength={1000} disabled={locked} value={form.threeDeviceReason} onChange={(e) => set('threeDeviceReason', e.target.value)} placeholder="وضّح حاجة الأسرة إلى الأجهزة الثلاثة." />
        </label>}
        {error && <p role="alert" style={{ ...errorStyle, marginTop: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => void submit()}>
            {isNew ? 'إضافة' : 'حفظ'}
          </button>
          {isNew && <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void submit(true)}>حفظ وإضافة التالي</button>}
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
