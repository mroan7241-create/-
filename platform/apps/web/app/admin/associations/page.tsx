'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ApiClientError,
  apiFetch,
  getAdminReport,
  getReferenceData,
  getFinalCovenantUrl,
  issuePartyOneSigningSession,
  type AssociationSummary,
  type AbanmiReport,
  type Paginated,
  type ReferenceData,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { ConfirmDialog, type ConfirmDialogProps } from '../../components/ConfirmDialog';
import { initialQueryParam } from '../../lib/query';
import { associationAcceptMessage, buildWhatsAppShareUrl } from '../../lib/credential-share';
import {
  cardStyle,
  dangerButtonStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  ltrStyle,
  modalOverlayStyle,
  modalStyle,
  mutedStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  successStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../lib/ui';

const PAGE_SIZE = 25;
const STATUS_LABELS: Record<'ACTIVE' | 'INACTIVE', string> = { ACTIVE: 'نشطة', INACTIVE: 'معطَّلة' };

interface FormState {
  name: string;
  category: string;
  region: string;
  city: string;
  phone: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  temporaryPassword: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  category: '',
  region: '',
  city: '',
  phone: '',
  email: '',
  status: 'ACTIVE',
  temporaryPassword: '',
};

export default function AdminAssociationsPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);

  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [data, setData] = useState<Paginated<AssociationSummary> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>(() => (initialQueryParam('status') as 'ACTIVE' | 'INACTIVE') || '');
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<AssociationSummary | 'new' | null>(null);
  const [resetResult, setResetResult] = useState<{ name: string; password: string; phone: string; email: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Omit<ConfirmDialogProps, 'onCancel'> | null>(null);
  const [partyOneLink, setPartyOneLink] = useState<{ name: string; url: string } | null>(null);
  const [profile, setProfile] = useState<{ association: AssociationSummary & { account?: { status: string; mustChangePassword: boolean; lastLoginAt: string | null } | null }; report: AbanmiReport } | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const load = useCallback(async () => {
    setListError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    try {
      setData(await apiFetch<Paginated<AssociationSummary>>(`/associations?${params.toString()}`));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل قائمة الجمعيات.');
    }
  }, [page, search, status]);

  useEffect(() => {
    if (user) {
      void load();
      getReferenceData().then(setReference).catch(() => undefined);
    }
  }, [user, load]);

  function toggleStatus(row: AssociationSummary) {
    const next = row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setConfirmation({
      title: next === 'INACTIVE' ? 'تأكيد تعطيل الجمعية' : 'تأكيد تفعيل الجمعية',
      message: next === 'INACTIVE'
        ? `تعطيل «${row.name}» سيُنهي فورًا كل جلسات حسابها وحسابات مندوبيها. متابعة؟`
        : `إعادة تفعيل «${row.name}»؟ لن تُستعاد الجلسات القديمة — يلزم تسجيل دخول جديد.`,
      confirmLabel: next === 'INACTIVE' ? 'تعطيل' : 'تفعيل', tone: next === 'INACTIVE' ? 'danger' : 'primary',
      onConfirm: async () => {
        try { await apiFetch(`/associations/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); setNotice(next === 'INACTIVE' ? 'تم تعطيل الجمعية وإنهاء جلساتها.' : 'تم تفعيل الجمعية.'); setConfirmation(null); await load(); }
        catch (err) { setListError(err instanceof ApiClientError ? err.message : 'تعذّر تغيير حالة الجمعية.'); }
      },
    });
  }

  function resetPassword(row: AssociationSummary) {
    setConfirmation({
      title: 'تأكيد إعادة تعيين كلمة المرور',
      message: `إعادة تعيين كلمة مرور حساب «${row.name}»؟ ستظهر كلمة المرور الجديدة مرة واحدة فقط.`,
      confirmLabel: 'إعادة تعيين كلمة المرور', tone: 'danger',
      onConfirm: async () => {
        try { const res = await apiFetch<{ temporaryPassword: string }>(`/auth/associations/${row.id}/reset-password`, { method: 'POST' }); setConfirmation(null); setResetResult({ name: row.name, password: res.temporaryPassword, phone: row.phone ?? '', email: row.email ?? '' }); }
        catch (err) { setListError(err instanceof ApiClientError ? err.message : 'تعذّرت إعادة تعيين كلمة المرور.'); }
      },
    });
  }

  async function openProfile(row: AssociationSummary) {
    setProfileLoading(true);
    setListError(null);
    try {
      const [association, report] = await Promise.all([
        apiFetch<AssociationSummary & { account?: { status: string; mustChangePassword: boolean; lastLoginAt: string | null } | null }>(`/associations/${row.id}`),
        getAdminReport({ associationId: row.id }),
      ]);
      setProfile({ association, report });
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل ملف الجمعية.');
    } finally { setProfileLoading(false); }
  }

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22 }}>الجمعيات</h1>
        <button type="button" style={primaryButtonStyle} onClick={() => setEditing('new')}>
          إضافة جمعية
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
        style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}
      >
        <label style={{ ...labelStyle, flex: '1 1 240px' }}>
          بحث (اسم/رمز/بريد/منطقة/مدينة)
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, flex: '0 1 200px' }}>
          الحالة
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as '' | 'ACTIVE' | 'INACTIVE');
            }}
            style={inputStyle}
          >
            <option value="">الكل</option>
            <option value="ACTIVE">نشطة</option>
            <option value="INACTIVE">معطَّلة</option>
          </select>
        </label>
        <button type="submit" style={primaryButtonStyle}>
          بحث
        </button>
      </form>

      {listError && (
        <p role="alert" style={errorStyle}>
          {listError}
        </p>
      )}
      {notice && <p style={successStyle}>{notice}</p>}
      {partyOneLink && <section style={{ ...cardStyle, border: '2px solid #d46a2e' }}><h2>رابط توقيع الطرف الأول — {partyOneLink.name}</h2><p>الرابط أحادي الاستخدام ويُسلّم للممثل المخول فقط.</p><code dir="ltr" style={{ overflowWrap: 'anywhere' }}>{partyOneLink.url}</code><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}><button type="button" style={secondaryButtonStyle} onClick={() => navigator.clipboard.writeText(partyOneLink.url)}>نسخ الرابط</button><a href={partyOneLink.url} target="_blank" rel="noopener noreferrer" style={{ ...primaryButtonStyle, textDecoration: 'none' }}>فتح جلسة التوقيع</a><button type="button" style={secondaryButtonStyle} onClick={() => setPartyOneLink(null)}>إخفاء</button></div></section>}

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>الاسم</th>
              <th style={thStyle}>الرمز</th>
              <th style={thStyle}>المنطقة/المدينة</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>مستفيدون</th>
              <th style={thStyle}>أجهزة</th>
              <th style={thStyle}>مندوبون</th>
              <th style={thStyle}>ميثاق المشاركة</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && (
              <tr>
                <td style={{ ...tdStyle, textAlign: 'center' }} colSpan={9}>
                  لا توجد جمعيات مطابقة.
                </td>
              </tr>
            )}
            {data?.items.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}><button type="button" className="text-link" onClick={() => void openProfile(row)}>{row.name}</button></td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.publicCode}</td>
                <td style={tdStyle}>
                  {row.region} / {row.city}
                </td>
                <td style={tdStyle}>
                  <span style={statusBadgeStyle(row.status === 'ACTIVE' ? 'good' : 'bad')}>{STATUS_LABELS[row.status]}</span>
                </td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.beneficiariesCount}</td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.devicesCount}</td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.delegatesCount}</td>
                <td style={tdStyle}>{row.covenant ? <div style={{ display: 'grid', gap: 5 }}><strong>{covenantStatus(row.covenant.status)}</strong><span>الإصدار {row.covenant.templateVersion}</span><span dir="ltr">{row.covenant.reference}</span>{row.covenant.orgSignerName && <span>الممثل: {row.covenant.orgSignerName}</span>}{row.covenant.signedByOrgAt && <span>توقيع الجمعية: {formatDate(row.covenant.signedByOrgAt)}</span>}{row.covenant.fullyExecutedAt && <span>الاكتمال: {formatDate(row.covenant.fullyExecutedAt)}</span>}{row.covenant.status === 'SIGNED_BY_ORG' && <button type="button" style={secondaryButtonStyle} onClick={() => void issuePartyOneSigningSession(row.covenant!.id).then((result) => setPartyOneLink({ name: row.name, url: `${window.location.origin}${result.path}` })).catch((err) => setListError(err instanceof ApiClientError ? err.message : 'تعذّر إنشاء رابط التوقيع.'))}>رابط توقيع الطرف الأول</button>}{row.covenant.status === 'SIGNED' && <button type="button" style={secondaryButtonStyle} onClick={() => void getFinalCovenantUrl(row.covenant!.id).then(({ url }) => window.open(url, '_blank', 'noopener,noreferrer'))}>تنزيل النسخة النهائية</button>}</div> : 'لا يوجد'}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" style={secondaryButtonStyle} onClick={() => setEditing(row)}>
                      تعديل
                    </button>
                    <button type="button" style={secondaryButtonStyle} onClick={() => toggleStatus(row)}>
                      {row.status === 'ACTIVE' ? 'تعطيل' : 'تفعيل'}
                    </button>
                    <button type="button" style={dangerButtonStyle} onClick={() => resetPassword(row)}>
                      إعادة تعيين كلمة المرور
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            السابق
          </button>
          <span style={mutedStyle}>
            صفحة {data.page} من {data.totalPages} — {data.total} جمعية
          </span>
          <button type="button" style={secondaryButtonStyle} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            التالي
          </button>
        </div>
      )}

      {editing && (
        <AssociationForm
          reference={reference}
          association={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
          }}
        />
      )}

      {resetResult && (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true">
          <section style={{ ...modalStyle, maxWidth: 520 }}>
            <h2 style={{ fontSize: 19, marginBottom: 12 }}>كلمة مرور مؤقتة جديدة — {resetResult.name}</h2>
            <p style={{ ...cardStyle, background: 'var(--zad-100)', borderColor: 'var(--zad-300)', fontWeight: 700 }}>
              أُلغيت كلمة المرور المؤقتة السابقة. تظهر الجديدة مرة واحدة فقط — انسخها وسلّمها للجمعية.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ ...ltrStyle, fontSize: 18, padding: '10px 14px', background: 'var(--canvas)', borderRadius: 'var(--r-sm)' }}>
                {resetResult.password}
              </code>
              <button type="button" style={secondaryButtonStyle} onClick={() => navigator.clipboard.writeText(resetResult.password)}>
                نسخ
              </button>
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() =>
                  navigator.clipboard.writeText(associationAcceptMessage(resetResult.name, resetResult.email, resetResult.password))
                }
              >
                ⧉ نسخ الرسالة كاملة
              </button>
              {(() => {
                const waUrl = buildWhatsAppShareUrl(resetResult.phone, associationAcceptMessage(resetResult.name, resetResult.email, resetResult.password));
                return waUrl ? (
                  <a href={waUrl} target="_blank" rel="noopener noreferrer" style={{ ...primaryButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
                    إرسال عبر واتساب
                  </a>
                ) : (
                  <span style={mutedStyle}>رقم الجوال غير صالح لإرسال واتساب مباشر.</span>
                );
              })()}
            </div>
            <div style={{ marginTop: 20 }}>
              <button type="button" style={primaryButtonStyle} onClick={() => setResetResult(null)}>
                إغلاق
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmation && <ConfirmDialog {...confirmation} onCancel={() => setConfirmation(null)} />}
      {(profileLoading || profile) && <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-labelledby="association-profile-title"><section style={{ ...modalStyle, maxWidth: 820 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><h2 id="association-profile-title" style={{ margin: 0 }}>ملف الجمعية</h2><button type="button" style={secondaryButtonStyle} onClick={() => setProfile(null)}>إغلاق</button></div>
        {profileLoading && <p>جارٍ تحميل ملف الجمعية…</p>}
        {profile && <><h3>{profile.association.name}</h3><p>{profile.association.publicCode} · {profile.association.region} / {profile.association.city} · {STATUS_LABELS[profile.association.status]}</p>
          <div className="zad-summary-strip2">
            <span className="zad-sum-card2"><b className="zad-sv2b">{profile.association.beneficiariesCount}</b><span className="zad-sl2b">مستفيدون</span></span>
            <span className="zad-sum-card2"><b className="zad-sv2b">{profile.association.devicesCount}</b><span className="zad-sl2b">أجهزة</span></span>
            <span className="zad-sum-card2"><b className="zad-sv2b">{profile.association.delegatesCount}</b><span className="zad-sl2b">مندوبون</span></span>
            <span className="zad-sum-card2"><b className="zad-sv2b">{profile.report.overall.deliveries}</b><span className="zad-sl2b">مهام تسليم</span></span>
          </div>
          <p>حالة الحساب: {profile.association.account?.status === 'ACTIVE' ? 'نشط' : 'غير نشط'} · آخر دخول: {profile.association.account?.lastLoginAt ? new Date(profile.association.account.lastLoginAt).toLocaleString('ar-SA') : 'لم يسجّل دخولًا'}</p>
          <p>الميثاق: {profile.association.covenant ? covenantStatus(profile.association.covenant.status) : 'لا يوجد ميثاق'}</p>
          <Link href={`/admin/reports?associationId=${profile.association.id}`} style={{ ...primaryButtonStyle, textDecoration: 'none', display: 'inline-block' }}>عرض التقرير الكامل</Link>
        </>}
      </section></div>}
    </AppShell>
  );
}

function covenantStatus(status: string) {
  if (status === 'SENT') return 'بانتظار توقيع الجمعية';
  if (status === 'SIGNED_BY_ORG') return 'بانتظار توقيع الطرف الأول';
  if (status === 'SIGNED') return 'مكتمل ومعتمد';
  if (status === 'DRAFT') return 'مسودة';
  return status === 'CANCELLED' ? 'ملغى' : 'غير نشط';
}

function formatDate(value: string) { return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium' }).format(new Date(value)); }

function AssociationForm({
  reference,
  association,
  onClose,
  onSaved,
}: {
  reference: ReferenceData | null;
  association: AssociationSummary | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isNew = association === null;
  const [form, setForm] = useState<FormState>(
    association
      ? {
          name: association.name,
          category: association.category ?? '',
          region: association.region,
          city: association.city,
          phone: association.phone ?? '',
          email: association.email ?? '',
          status: association.status,
          temporaryPassword: '',
        }
      : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // opId يُولَّد مرة واحدة لكل فتح نموذج إنشاء — إعادة الإرسال بعد فشل شبكة لا تُنشئ جمعيتين.
  const [opId] = useState(() => crypto.randomUUID());

  const cities = reference && form.region ? (reference.citiesByRegion[form.region] ?? []) : [];

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value, ...(key === 'region' ? { city: '' } : {}) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isNew) {
        await apiFetch('/associations', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            category: form.category || undefined,
            region: form.region,
            city: form.city,
            phone: form.phone,
            email: form.email,
            status: form.status,
            temporaryPassword: form.temporaryPassword,
            opId,
          }),
        });
        onSaved('تم إنشاء الجمعية وحساب الدخول الخاص بها.');
      } else {
        await apiFetch(`/associations/${association.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name,
            category: form.category,
            region: form.region,
            city: form.city,
            phone: form.phone,
            email: form.email,
            status: form.status,
          }),
        });
        onSaved('تم حفظ تعديلات الجمعية.');
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الحفظ. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <form onSubmit={save} style={{ ...modalStyle, maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 19 }}>{isNew ? 'إضافة جمعية' : `تعديل — ${association.name}`}</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            إغلاق
          </button>
        </div>

        <label style={labelStyle}>
          اسم الجمعية
          <input required maxLength={150} value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <label style={labelStyle}>
            التصنيف
            <select value={form.category} onChange={(e) => set('category', e.target.value)} style={inputStyle}>
              <option value="">— بلا تصنيف —</option>
              {(reference?.associationCategories ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            المنطقة
            <select required value={form.region} onChange={(e) => set('region', e.target.value)} style={inputStyle}>
              <option value="">— اختر —</option>
              {(reference?.regions ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            المدينة
            <select required value={form.city} onChange={(e) => set('city', e.target.value)} style={inputStyle} disabled={!form.region}>
              <option value="">{form.region ? '— اختر —' : 'اختر المنطقة أولًا'}</option>
              {cities.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            رقم الجوال
            <input
              required
              placeholder="05XXXXXXXX"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              style={{ ...inputStyle, ...ltrStyle }}
            />
          </label>

          <label style={labelStyle}>
            البريد الإلكتروني
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              style={{ ...inputStyle, ...ltrStyle }}
            />
          </label>

          <label style={labelStyle}>
            الحالة
            <select value={form.status} onChange={(e) => set('status', e.target.value as 'ACTIVE' | 'INACTIVE')} style={inputStyle}>
              <option value="ACTIVE">نشطة</option>
              <option value="INACTIVE">معطَّلة</option>
            </select>
          </label>
        </div>

        {isNew && (
          <label style={labelStyle}>
            كلمة المرور المؤقتة لحساب الجمعية
            <input
              required
              minLength={8}
              value={form.temporaryPassword}
              onChange={(e) => set('temporaryPassword', e.target.value)}
              style={{ ...inputStyle, ...ltrStyle }}
            />
            <span style={mutedStyle}>8 خانات على الأقل مع حروف وأرقام. سيُطلب من الجمعية تغييرها عند أول دخول.</span>
          </label>
        )}

        {!isNew && (
          <p style={mutedStyle}>
            تعديل البريد هنا يغيّر بريد التواصل فقط — بريد تسجيل الدخول لا يتغيّر. لتسليم كلمة مرور جديدة استخدم زر «إعادة
            تعيين كلمة المرور».
          </p>
        )}

        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}

        <div>
          <button type="submit" disabled={busy} style={primaryButtonStyle}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
        </div>
      </form>
    </div>
  );
}
