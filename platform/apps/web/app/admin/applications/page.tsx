'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  APPLICATION_STATUS_LABELS,
  ApiClientError,
  apiFetch,
  type ApplicationStatus,
  type ApplicationSummary,
  type Paginated,
  type ReviewResult,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
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
  pageStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  successStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../lib/ui';

const PAGE_SIZE = 25;

export default function AdminApplicationsPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);

  const [data, setData] = useState<Paginated<ApplicationSummary> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState<'' | ApplicationStatus>('');
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApplicationSummary | null>(null);

  const load = useCallback(async () => {
    setListError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    try {
      setData(await apiFetch<Paginated<ApplicationSummary>>(`/association-applications?${params.toString()}`));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل قائمة الطلبات.');
    }
  }, [page, search, status]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (guardLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>طلبات انضمام الجمعيات</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
        style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}
      >
        <label style={{ ...labelStyle, flex: '1 1 240px' }}>
          بحث (اسم/رقم الطلب/بريد/مسؤول/ترخيص)
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, flex: '0 1 200px' }}>
          الحالة
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as '' | ApplicationStatus);
            }}
            style={inputStyle}
          >
            <option value="">الكل</option>
            {(Object.keys(APPLICATION_STATUS_LABELS) as ApplicationStatus[]).map((key) => (
              <option key={key} value={key}>
                {APPLICATION_STATUS_LABELS[key]}
              </option>
            ))}
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

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>اسم الجمعية</th>
              <th style={thStyle}>رقم الطلب</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>مؤشّر الإجابات</th>
              <th style={thStyle}>تاريخ التقديم</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && (
              <tr>
                <td style={{ ...tdStyle, textAlign: 'center' }} colSpan={6}>
                  لا توجد طلبات مطابقة.
                </td>
              </tr>
            )}
            {data?.items.map((row) => (
              <tr key={row.id} onClick={() => setSelected(row)} style={{ cursor: 'pointer' }}>
                <td style={tdStyle}>{row.name}</td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.publicCode}</td>
                <td style={tdStyle}>
                  <span style={statusBadgeStyle(row.status === 'ACCEPTED' ? 'good' : row.status === 'REJECTED' ? 'bad' : 'neutral')}>
                    {APPLICATION_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.scoreLabel}</td>
                <td style={tdStyle}>{new Date(row.submittedAt).toLocaleDateString('ar-SA')}</td>
                <td style={tdStyle}>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setSelected(row)}>
                    عرض
                  </button>
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
            صفحة {data.page} من {data.totalPages} — {data.total} طلبًا
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

      {selected && (
        <ApplicationDetail
          application={selected}
          onClose={() => setSelected(null)}
          onReviewed={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </main>
  );
}

function ApplicationDetail({
  application,
  onClose,
  onReviewed,
}: {
  application: ApplicationSummary;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReviewResult | null>(null);
  const [copied, setCopied] = useState(false);

  // opId جديد لكل محاولة مراجعة (نقرة)، ويُعاد استخدامه كما هو لو أعاد
  // المستخدم المحاولة بعد فشل شبكة — فلا تتكرَّر العملية على الخادم.
  const [opId, setOpId] = useState(() => crypto.randomUUID());

  const decided = application.status !== 'UNDER_REVIEW';

  async function showLicense() {
    setLicenseError(null);
    try {
      const res = await apiFetch<{ url: string }>(`/association-applications/${application.id}/license-file`);
      setLicenseUrl(res.url);
    } catch (err) {
      setLicenseError(err instanceof ApiClientError ? err.message : 'تعذّر فتح ملف الترخيص.');
    }
  }

  async function review(decision: 'accept' | 'reject') {
    setError(null);
    if (decision === 'reject' && !rejectReason.trim()) {
      setError('سبب الرفض مطلوب.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<ReviewResult>(`/association-applications/${application.id}/review`, {
        method: 'POST',
        body: JSON.stringify(decision === 'accept' ? { decision, opId } : { decision, opId, reason: rejectReason.trim() }),
      });
      setOutcome(res);
      if (decision === 'reject') onReviewed();
    } catch (err) {
      // opId جديد فقط عند خطأ تحقق/تعارض نهائي — لا عند فشل شبكة (نُبقيه ليعمل كإعادة محاولة idempotent).
      if (err instanceof ApiClientError && err.code === 'APPLICATION_IDEMPOTENCY_CONFLICT') setOpId(crypto.randomUUID());
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تنفيذ المراجعة. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  if (outcome) {
    const previouslyIssued = outcome.temporaryPasswordPreviouslyIssued && !outcome.temporaryPassword;
    return (
      <div style={modalOverlayStyle} role="dialog" aria-modal="true">
        <section style={modalStyle}>
          <h2 style={{ fontSize: 19, marginBottom: 12 }}>تم قبول الطلب</h2>
          <p style={successStyle}>
            رقم الجمعية الجديدة: <span style={ltrStyle}>{outcome.associationPublicCode}</span>
          </p>

          {previouslyIssued ? (
            <p style={{ ...cardStyle, background: 'var(--gold-100)', borderColor: 'var(--gold-400)' }}>
              سبق تنفيذ هذه العملية وتسليم كلمة المرور المؤقتة مرة واحدة، ولا يمكن عرضها مجددًا لأنها لا تُخزَّن في أي مكان.
              لتسليم كلمة مرور جديدة استخدم زر «إعادة تعيين كلمة المرور» في شاشة إدارة الجمعيات.
            </p>
          ) : (
            <>
              <p style={{ ...cardStyle, background: 'var(--zad-100)', borderColor: 'var(--zad-300)', fontWeight: 700 }}>
                هذه كلمة المرور المؤقتة وستظهر مرة واحدة فقط ولن تُعرض مرة أخرى إطلاقًا — انسخها وسلّمها للجمعية الآن.
              </p>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ ...ltrStyle, fontSize: 18, padding: '10px 14px', background: 'var(--canvas)', borderRadius: 'var(--r-sm)' }}>
                  {outcome.temporaryPassword}
                </code>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={async () => {
                    await navigator.clipboard.writeText(outcome.temporaryPassword ?? '');
                    setCopied(true);
                  }}
                >
                  {copied ? 'تم النسخ' : 'نسخ'}
                </button>
              </div>
            </>
          )}

          <div style={{ marginTop: 20 }}>
            <button type="button" style={primaryButtonStyle} onClick={onReviewed}>
              إغلاق
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <section style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 19 }}>{application.name}</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            إغلاق
          </button>
        </div>

        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '150px 1fr', rowGap: 8, fontSize: 14 }}>
          <dt>رقم الطلب</dt>
          <dd style={{ margin: 0, ...ltrStyle }}>{application.publicCode}</dd>
          <dt>الحالة</dt>
          <dd style={{ margin: 0 }}>
            <span style={statusBadgeStyle(application.status === 'ACCEPTED' ? 'good' : application.status === 'REJECTED' ? 'bad' : 'neutral')}>
              {APPLICATION_STATUS_LABELS[application.status]}
            </span>
          </dd>
          <dt>التصنيف / المجال</dt>
          <dd style={{ margin: 0 }}>
            {application.category ?? '—'} / {application.sector ?? '—'}
          </dd>
          <dt>المنطقة / المدينة</dt>
          <dd style={{ margin: 0 }}>
            {application.region} / {application.city}
          </dd>
          <dt>المسؤول</dt>
          <dd style={{ margin: 0 }}>{application.contactName}</dd>
          <dt>الجوال</dt>
          <dd style={{ margin: 0, ...ltrStyle }}>{application.phone}</dd>
          <dt>البريد</dt>
          <dd style={{ margin: 0, ...ltrStyle }}>{application.email}</dd>
          <dt>رقم الترخيص</dt>
          <dd style={{ margin: 0, ...ltrStyle }}>{application.licenseNumber}</dd>
          <dt>انتهاء الترخيص</dt>
          <dd style={{ margin: 0 }}>
            {application.licenseExpiryDate ? new Date(application.licenseExpiryDate).toLocaleDateString('ar-SA') : '—'}
          </dd>
          <dt>ملاحظات</dt>
          <dd style={{ margin: 0 }}>{application.notes || '—'}</dd>
          {application.status === 'REJECTED' && (
            <>
              <dt>سبب الرفض</dt>
              <dd style={{ margin: 0 }}>{application.rejectReason}</dd>
            </>
          )}
        </dl>

        <h3 style={{ fontSize: 16, marginTop: 20, marginBottom: 8 }}>
          أسئلة القبول <span style={{ ...mutedStyle, ...ltrStyle }}>({application.scoreLabel})</span>
        </h3>
        <p style={{ ...mutedStyle, marginTop: 0 }}>مؤشّر عرض فقط — القرار يدوي بالكامل ولا يعتمد على هذا الرقم.</p>
        <ul style={{ margin: 0, paddingInlineStart: 20, fontSize: 14 }}>
          {application.answers.map((answer) => (
            <li key={answer.key}>
              {answer.label} — <strong>{answer.value === null ? '—' : answer.value ? 'نعم' : 'لا'}</strong>
            </li>
          ))}
        </ul>

        <h3 style={{ fontSize: 16, marginTop: 20, marginBottom: 8 }}>صورة الترخيص</h3>
        {!application.hasLicenseFile ? (
          <p style={mutedStyle}>لا يوجد ملف ترخيص مرفق.</p>
        ) : licenseUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={licenseUrl} alt="صورة الترخيص" style={{ maxWidth: '100%', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }} />
        ) : (
          <button type="button" style={secondaryButtonStyle} onClick={showLicense}>
            عرض صورة الترخيص
          </button>
        )}
        {licenseError && (
          <p role="alert" style={errorStyle}>
            {licenseError}
          </p>
        )}

        {!decided && (
          <div style={{ marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 16 }}>القرار</h3>
            <label style={labelStyle}>
              سبب الرفض (مطلوب عند الرفض فقط)
              <textarea
                rows={2}
                maxLength={300}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </label>
            {error && (
              <p role="alert" style={errorStyle}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => review('accept')}>
                قبول الطلب
              </button>
              <button type="button" style={dangerButtonStyle} disabled={busy} onClick={() => review('reject')}>
                رفض الطلب
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
