'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  APPLICATION_STATUS_LABELS,
  ApiClientError,
  apiFetch,
  resendApplicationInformation,
  startApplicationProcessing,
  type ApplicationStatus,
  type ApplicationSummary,
  type Paginated,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { FinancialSummary } from '../../components/FinancialSummary';
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
  const [workflow, setWorkflow] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState('');

  const load = useCallback(async () => {
    setListError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (workflow) params.set('workflow', workflow);
    try {
      setData(await apiFetch<Paginated<ApplicationSummary> & { counts?: Record<string, number> }>(`/association-applications?${params.toString()}`));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل قائمة الطلبات.');
    }
  }, [page, search, status, workflow]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <div className="workflow-row" style={{ marginBottom: 16 }}><div><h1 style={{ fontSize: 22, marginBottom: 6 }}>طلبات انضمام الجمعيات</h1><p style={mutedStyle}>الطلب ← الأهلية ← التقييم ← اختيار القائمة الأساسية أو الاحتياطية ← الاتفاقية والتجهيز ← التفعيل</p></div><Link href="/admin/selection" style={{ ...primaryButtonStyle, textDecoration: 'none' }}>الأهلية والتقييم والاختيار</Link></div>
      <div className="button-row" style={{ marginBottom: 16 }}>{[['','الكل'],['new','جديدة'],['processing','قيد المعالجة'],['missing','بانتظار الاستكمال']].map(([key,label]) => <button key={key} type="button" style={workflow === key ? primaryButtonStyle : secondaryButtonStyle} onClick={() => { setWorkflow(key); setPage(1); }}>{label}{data && 'counts' in data ? ` (${(data as Paginated<ApplicationSummary> & { counts?: Record<string, number> }).counts?.[key || 'all'] ?? 0})` : ''}</button>)}</div>
      {actionMessage && <p role="status" style={actionMessage.startsWith('تم') ? { color: 'var(--success)' } : errorStyle}>{actionMessage}</p>}

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
              <th style={thStyle}>الأهلية</th>
              <th style={thStyle}>الاختيار</th>
              <th style={thStyle}>التفعيل</th>
              <th style={thStyle}>مؤشّر الإجابات</th>
              <th style={thStyle}>تاريخ التقديم</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && (
              <tr>
                <td style={{ ...tdStyle, textAlign: 'center' }} colSpan={9}>
                  لا توجد طلبات مطابقة.
                </td>
              </tr>
            )}
            {data?.items.map((row) => (
              <tr key={row.id} onClick={() => setSelected(row)} style={{ cursor: 'pointer' }}>
                <td style={tdStyle}><input type="checkbox" aria-label={`تحديد ${row.name}`} checked={checked.includes(row.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setChecked((old) => event.target.checked ? [...new Set([...old, row.id])] : old.filter((id) => id !== row.id))} /> {row.name}</td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.publicCode}</td>
                <td style={tdStyle}>
                  <span style={statusBadgeStyle(row.status === 'ACCEPTED' ? 'good' : row.status === 'REJECTED' ? 'bad' : 'neutral')}>
                    {APPLICATION_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td style={tdStyle}>{eligibilityLabel(row.eligibilityStatus)}</td>
                <td style={tdStyle}>{selectionLabel(row.selectionList)}</td>
                <td style={tdStyle}>{row.resultingAssociationId ? 'مفعّلة' : 'غير مفعّلة'}</td>
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
      <div className="button-row" style={{ marginTop: 12 }}><button type="button" style={primaryButtonStyle} disabled={!checked.length} onClick={async () => { setActionMessage(''); try { const result = await startApplicationProcessing(checked); setActionMessage(`تم بدء معالجة ${result.started} طلب، وسبق بدء ${result.alreadyStarted}.`); setChecked([]); await load(); } catch (reason) { setActionMessage(reason instanceof Error ? reason.message : 'تعذر بدء المعالجة.'); } }}>بدء معالجة المحدد ({checked.length})</button></div>

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
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);

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

        {application.schemaVersion === 2 && application.v2Payload && <V2Dossier application={application} />}

        {application.schemaVersion !== 2 && <>
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
        </>}

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

        {application.eligibilityStatus === 'NEEDS_INFO' && <div style={{ marginTop: 16 }}>
          <button type="button" style={secondaryButtonStyle} onClick={async () => { setNotificationMessage(null); try { await resendApplicationInformation(application.id); setNotificationMessage('تمت إعادة إرسال إشعار الاستكمال إلى البريد الرسمي.'); } catch (reason) { setNotificationMessage(reason instanceof ApiClientError ? reason.message : 'تعذّرت إعادة إرسال الإشعار.'); } }}>إعادة إرسال إشعار الاستكمال</button>
          {notificationMessage && <p role="status" style={notificationMessage.startsWith('تم') ? { color: '#17663a' } : errorStyle}>{notificationMessage}</p>}
        </div>}

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

const DOSSIER_SECTIONS: Array<{ title: string; fields: Array<[string, string]> }> = [
  { title: 'الجمعية والموقع', fields: [['organization.name','اسم الجمعية'],['organization.category','التصنيف'],['organization.sector','المجال'],['location.serviceScope','نطاق الخدمة'],['coordinator.name','منسق المشروع'],['covenantRepresentative.name','ممثل الميثاق']] },
  { title: 'القيادة والجاهزية', fields: [['executive.name','المدير التنفيذي'],['executive.education','المؤهل'],['executive.experienceYears','سنوات الخبرة'],['team.fullTime','الموظفون المتفرغون'],['readiness.fieldTeamCount','الفريق الميداني'],['readiness.weeklyDeliveryCapacity','القدرة الأسبوعية']] },
  { title: 'المستفيدون والبيانات', fields: [['beneficiaries.registeredFamilies','الأسر المسجلة'],['beneficiaries.databaseUpdatedAt','آخر تحديث للقاعدة'],['beneficiaries.systemName','نظام المستفيدين'],['beneficiaries.classifications','تصنيفات الحاجة']] },
  { title: 'الخبرة السابقة', fields: [['experience.hasRecentInKindProject','مشروع دعم عيني حديث'],['experience.projectName','اسم المشروع'],['experience.recentProjectsCount','عدد المشاريع الحديثة'],['experience.recentBeneficiariesCount','مستفيدو المشاريع الحديثة']] },
  { title: 'الحوكمة والمالية', fields: [['finance.hasAccountingSystem','نظام محاسبي'],['finance.accountingSystemName','اسم النظام'],['finance.hasSpendingPolicy','لائحة صرف'],['finance.revenue','الإيرادات'],['finance.expenses','المصروفات'],['finance.currentAssets','الأصول المتداولة'],['finance.currentLiabilities','الخصوم المتداولة']] },
  { title: 'التخطيط والاستدامة', fields: [['planning.hasStrategicPlan','خطة استراتيجية'],['planning.hasOperationalPlan','خطة تشغيلية'],['planning.hasPostAidFollowUp','متابعة ما بعد المساعدة'],['planning.measuresSatisfaction','قياس الرضا'],['planning.lastYearProgramsCount','برامج العام الماضي'],['planning.lastYearBeneficiariesCount','مستفيدو العام الماضي']] },
];

function V2Dossier({ application }: { application: ApplicationSummary }) {
  return <div style={{ marginTop: 22 }}><h3>ملف الطلب التفصيلي — الإصدار 2</h3>{application.locationNeedsVerification && <p style={errorStyle}>الموقع المُدخل يدويًا يحتاج تحققًا إداريًا.</p>}<p style={mutedStyle}>المرفقات: {application.attachmentKeys.length ? application.attachmentKeys.join('، ') : 'لا توجد'}</p>{DOSSIER_SECTIONS.map((section) => <details key={section.title} open><summary style={{ cursor: 'pointer', fontWeight: 700, marginBlock: 12 }}>{section.title}</summary><dl style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 190px) 1fr', gap: 8 }}>{section.fields.map(([path, label]) => <div key={path} style={{ display: 'contents' }}><dt>{label}</dt><dd style={{ margin: 0 }}>{displayValue(valueAt(application.v2Payload, path))}</dd></div>)}</dl>{section.title === 'الحوكمة والمالية' && <FinancialSummary finance={application.v2Payload?.finance} />}</details>)}</div>;
}

function valueAt(root: Record<string, unknown> | null, path: string): unknown { let current: unknown = root; for (const key of path.split('.')) { if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined; current = (current as Record<string, unknown>)[key]; } return current; }
function displayValue(value: unknown): string { if (value === true) return 'نعم'; if (value === false) return 'لا'; if (value == null || value === '') return '—'; if (typeof value === 'number') return new Intl.NumberFormat('ar-SA').format(value); return String(value); }
