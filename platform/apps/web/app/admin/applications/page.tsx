'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  APPLICATION_STATUS_LABELS,
  ApiClientError,
  apiFetch,
  type ApplicationStatus,
  type ApplicationSummary,
  type Paginated,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { initialQueryParam } from '../../lib/query';
import {
  cardStyle,
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
  const [status, setStatus] = useState<'' | ApplicationStatus>(() => (initialQueryParam('status') as ApplicationStatus) || '');
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
    <AppShell user={user}>
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
        />
      )}
    </AppShell>
  );
}

function ApplicationDetail({
  application,
  onClose,
}: {
  application: ApplicationSummary;
  onClose: () => void;
}) {
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);

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
          <dt>قرار الأهلية</dt>
          <dd style={{ margin: 0 }}>{eligibilityLabel(application.eligibilityStatus)}</dd>
          <dt>نتيجة التقييم</dt>
          <dd style={{ margin: 0 }}>{application.evaluationScore == null ? 'لم يُقيّم بعد' : `${application.evaluationScore}/100`}</dd>
          <dt>قائمة الاختيار</dt>
          <dd style={{ margin: 0 }}>{selectionLabel(application.selectionList)}</dd>
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
            <h3 style={{ fontSize: 16 }}>الخطوة التالية</h3>
            <p style={mutedStyle}>هذا الملف للجاهزية والتقييم فقط. اجتياز الأهلية لا ينشئ جمعية ولا يولّد بيانات دخول. التفعيل يتم لاحقًا بعد الاختيار والاتفاقية والتجهيز.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="/admin/selection" style={{ ...primaryButtonStyle, textDecoration: 'none' }}>فتح الأهلية والتقييم والاختيار</a>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function eligibilityLabel(value: ApplicationSummary['eligibilityStatus']) {
  return ({ PENDING: 'بانتظار القرار', PASSED: 'مجتاز', FAILED: 'غير مجتاز', NEEDS_INFO: 'يحتاج معلومات' })[value];
}

function selectionLabel(value: ApplicationSummary['selectionList']) {
  return ({ NONE: 'لم يدخل الاختيار', MAIN: 'القائمة الأساسية', RESERVE: 'قائمة الاحتياط' })[value];
}
