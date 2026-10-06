'use client';

import { useState } from 'react';
import { APPLICATION_STATUS_LABELS, ApiClientError, apiFetch, resendApplicationInformation, type ApplicationSummary, type CurrentUser } from '../../lib/api';
import { canAdmin } from '../../lib/admin-access';
import { FinancialSummary } from '../../components/FinancialSummary';
import { APPLICATION_ATTACHMENT_LABELS } from '@alzad/shared';
import { licensePreviewKind } from '../../lib/license-preview';
import { errorStyle, ltrStyle, modalOverlayStyle, modalStyle, mutedStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle } from '../../lib/ui';

export function ApplicationDetail({
  user,
  application,
  onClose,
  closeLabel = 'إغلاق',
  showNextStep = true,
}: {
  user: CurrentUser;
  application: ApplicationSummary;
  onClose: () => void;
  closeLabel?: string;
  showNextStep?: boolean;
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
            {closeLabel}
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
          {application.latestInformationRequest?.isLate && <>
            <dt>مهلة الاستكمال</dt>
            <dd role="status" style={{ margin: 0, color: '#9a6700' }}>متأخر عن مهلة الاستكمال{application.latestInformationRequest.submittedAt ? ' — تم إرسال الاستكمال' : ''}</dd>
          </>}
          <dt>نتيجة التقييم</dt>
          <dd style={{ margin: 0 }}>{application.evaluationScore == null ? 'لم يُقيّم بعد' : `${application.evaluationScore}/100`}</dd>
          <dt>قائمة الاختيار</dt>
          <dd style={{ margin: 0 }}>{selectionLabel(application.selectionList)}</dd>
          <dt>بدأ المعالجة</dt><dd style={{ margin: 0 }}>{actorLabel(application.processingStarter, application.processingStartedAt)}</dd>
          <dt>راجع الأهلية</dt><dd style={{ margin: 0 }}>{actorLabel(application.eligibilityReviewer, application.eligibilityReviewedAt)}</dd>
          <dt>قيّم الطلب</dt><dd style={{ margin: 0 }}>{actorLabel(application.evaluator, application.evaluatedAt)}</dd>
          <dt>اعتمد الاختيار</dt><dd style={{ margin: 0 }}>{actorLabel(application.selectionApprover, application.selectionApprovedAt)}</dd>
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

        <h3 style={{ fontSize: 16, marginTop: 20, marginBottom: 8 }}>ملف الترخيص</h3>
        {!application.hasLicenseFile ? (
          <p style={mutedStyle}>لا يوجد ملف ترخيص مرفق.</p>
        ) : licenseUrl && licensePreviewKind(licenseUrl) === 'file' ? (
          <a href={licenseUrl} target="_blank" rel="noopener noreferrer" style={secondaryButtonStyle}>فتح ملف الترخيص</a>
        ) : licenseUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={licenseUrl} alt="صورة الترخيص" style={{ maxWidth: '100%', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }} />
        ) : (
          <button type="button" style={secondaryButtonStyle} onClick={showLicense}>
            عرض ملف الترخيص
          </button>
        )}
        {licenseError && (
          <p role="alert" style={errorStyle}>
            {licenseError}
          </p>
        )}

        {canAdmin(user, 'applications.review') && application.eligibilityStatus === 'NEEDS_INFO' && <div style={{ marginTop: 16 }}>
          <button type="button" style={secondaryButtonStyle} onClick={async () => { setNotificationMessage(null); try { const result = await resendApplicationInformation(application.id); setNotificationMessage(result.emailQueued ? 'حُفظ إشعار الاستكمال للإرسال إلى البريد الرسمي.' : 'تعذّر تجهيز إشعار الاستكمال. راجع سجل إرسال البريد.'); } catch (reason) { setNotificationMessage(reason instanceof ApiClientError ? reason.message : 'تعذّرت إعادة إرسال الإشعار.'); } }}>إعادة إرسال إشعار الاستكمال</button>
          {notificationMessage && <p role="status" style={notificationMessage.startsWith('تم') ? { color: '#17663a' } : errorStyle}>{notificationMessage}</p>}
        </div>}

        {showNextStep && !decided && (
          <div style={{ marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 16 }}>الخطوة التالية</h3>
            <p style={mutedStyle}>هذا الملف للجاهزية والتقييم فقط. اجتياز الأهلية لا ينشئ جمعية ولا يولّد بيانات دخول. التفعيل يتم لاحقًا بعد الاختيار والاتفاقية والتجهيز.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="/admin/applications" style={{ ...primaryButtonStyle, textDecoration: 'none' }}>فتح مراحل الأهلية والتقييم</a>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function eligibilityLabel(value: ApplicationSummary['eligibilityStatus']) {
  return ({ PENDING: 'بانتظار القرار', PASSED: 'مجتاز', FAILED: 'غير مجتاز', NEEDS_INFO: 'يحتاج معلومات' })[value];
}

function actorLabel(actor: ApplicationSummary['evaluator'], at: string | null): string {
  return actor ? `${actor.name} (${actor.publicCode})${at ? ` — ${new Date(at).toLocaleString('ar-SA')}` : ''}` : '—';
}

export function selectionLabel(value: ApplicationSummary['selectionList']) {
  return ({ NONE: 'لم يدخل الاختيار', MAIN: 'القائمة الأساسية', RESERVE: 'قائمة الاحتياط' })[value];
}

const DOSSIER_SECTIONS: Array<{ title: string; fields: Array<[string, string]> }> = [
  { title: 'الجمعية والموقع', fields: [['organization.name','اسم الجمعية'],['organization.category','التصنيف حسب الحجم المالي'],['organization.sectors','مجالات العمل'],['organization.sectorOther','مجال آخر'],['organization.hasWebsite','لديها موقع إلكتروني'],['organization.websiteUrl','رابط الموقع'],['location.serviceScope','نطاق الخدمة'],['coordinator.name','منسق المشروع'],['covenantRepresentative.name','ممثل الميثاق']] },
  { title: 'القيادة والجاهزية', fields: [['executive.name','المدير التنفيذي'],['executive.phone','جوال المدير التنفيذي'],['executive.education','المؤهل'],['executive.experienceYears','سنوات الخبرة'],['team.fullTime','الموظفون المتفرغون'],['team.partTime','الموظفون بدوام جزئي'],['team.activeVolunteers','المتطوعون النشطون'],['team.nonSaudis','غير السعوديين'],['team.universityOrHigher','جامعي فأعلى'],['socialResearcher.exists','يوجد باحث اجتماعي'],['socialResearcher.name','اسم الباحث الاجتماعي'],['socialResearcher.phone','جوال الباحث الاجتماعي'],['readiness.fieldTeamCount','الفريق الميداني'],['readiness.weeklyDeliveryCapacity','القدرة الأسبوعية'],['readiness.hasReceiptStorage','موقع/آلية لاستلام الأجهزة وحفظها'],['readiness.receiptStorageDescription','وصف الاستلام والحفظ'],['readiness.canDocumentDigitally','توثيق الاستلام والتسليم إلكترونيًا']] },
  { title: 'المستفيدون والبيانات', fields: [['beneficiaries.registeredFamilies','الأسر المسجلة'],['beneficiaries.databaseUpdatedAt','آخر تحديث للقاعدة'],['beneficiaries.hasSystem','نظام إلكتروني للمستفيدين'],['beneficiaries.systemName','نظام المستفيدين'],['beneficiaries.capabilities.search','يدعم البحث'],['beneficiaries.capabilities.update','يدعم تحديث البيانات'],['beneficiaries.capabilities.reports','يدعم التقارير'],['beneficiaries.capabilities.organizedCases','حفظ الحالات بصورة منظمة'],['beneficiaries.classifiesNeed','تصنيف الحالات حسب الحاجة'],['beneficiaries.classifications','تصنيفات الحاجة'],['beneficiaries.hasCaseStudyMechanism','آلية موحدة لدراسة الحالات'],['beneficiaries.caseStudyDescription','وصف آلية دراسة الحالات']] },
  { title: 'الخبرة السابقة', fields: [['experience.hasRecentInKindProject','مشروع دعم عيني حديث'],['experience.projectName','اسم المشروع'],['experience.projectYear','سنة التنفيذ'],['experience.supportType','نوع الدعم'],['experience.projectBeneficiaries','أسر/مستفيدو المشروع'],['experience.supporter','الجهة الداعمة'],['experience.recentProjectsCount','عدد المشاريع الحديثة'],['experience.recentBeneficiariesCount','مستفيدو المشاريع الحديثة'],['experience.ehsanSupportCount2025','مرات الاستفادة من إحسان خلال 2025'],['experience.ehsanSupportTypes','أنواع دعم إحسان'],['experience.hasPreviousSimilarSupport','دعم مشابه سابق'],['experience.previousSupportDescription','وصف الدعم السابق'],['experience.previousSupporter','الداعم السابق'],['experience.previousSupportYear','سنة الدعم السابق']] },
  { title: 'الحوكمة والمالية', fields: [['finance.governanceScore','درجة الحوكمة (%)'],['finance.hasAccountingSystem','نظام محاسبي'],['finance.accountingSystemName','اسم النظام'],['finance.hasSpendingPolicy','لائحة صرف'],['finance.revenue','الإيرادات'],['finance.expenses','المصروفات'],['finance.currentAssets','الأصول المتداولة'],['finance.currentLiabilities','الخصوم المتداولة']] },
  { title: 'التخطيط والاستدامة', fields: [['planning.hasStrategicPlan','خطة استراتيجية'],['planning.hasOperationalPlan','خطة تشغيلية'],['planning.hasPostAidFollowUp','متابعة ما بعد المساعدة'],['planning.postAidFollowUpDescription','وصف آلية المتابعة'],['planning.measuresSatisfaction','قياس الرضا'],['planning.satisfactionTool','أداة قياس الرضا'],['planning.satisfactionOther','تفصيل الأداة الأخرى'],['planning.lastYearProgramsCount','برامج العام الماضي'],['planning.lastYearBeneficiariesCount','مستفيدو العام الماضي']] },
];

function V2Dossier({ application }: { application: ApplicationSummary }) {
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState('');
  const [opening, setOpening] = useState('');
  const keys = [...new Set([...application.attachmentKeys, ...(application.hasInitialBeneficiaryFile ? ['initialBeneficiaryFile'] : [])])];
  async function openAttachment(fieldKey: string) {
    const preview = window.open('about:blank', '_blank');
    if (preview) preview.opener = null;
    setOpening(fieldKey); setFileError('');
    try {
      const result = await apiFetch<{ url: string }>(`/association-applications/${application.id}/license-file?fieldKey=${encodeURIComponent(fieldKey)}`);
      setFileUrls((current) => ({ ...current, [fieldKey]: result.url }));
      if (preview) preview.location.replace(result.url);
    } catch (error) { preview?.close(); setFileError(error instanceof Error ? error.message : 'تعذّر فتح المرفق.'); }
    finally { setOpening(''); }
  }
  return <div style={{ marginTop: 22 }}><h3>ملف الطلب التفصيلي — الإصدار 2</h3>{application.locationNeedsVerification && <p style={errorStyle}>الموقع المُدخل يدويًا يحتاج تحققًا إداريًا.</p>}<section aria-label="مرفقات الطلب"><h4>المرفقات المقدمة</h4><p>القائمة الأولية للمستفيدين: {keys.includes('initialBeneficiaryFile') ? 'أُرفقت — أولية وغير معتمدة نهائيًا' : 'لم تُرفق (اختيارية)'}</p>{keys.length ? keys.map((key) => <div className="button-row" key={key} style={{ marginBottom: 10 }}><span>{APPLICATION_ATTACHMENT_LABELS[key] ?? key}</span><button type="button" style={secondaryButtonStyle} disabled={!!opening} onClick={() => void openAttachment(key)}>{opening === key ? 'جارٍ تجهيز الرابط…' : 'عرض / تنزيل'}</button>{fileUrls[key] && <a href={fileUrls[key]} target="_blank" rel="noopener noreferrer" style={secondaryButtonStyle}>فتح المرفق</a>}</div>) : <p style={mutedStyle}>لا توجد مرفقات مسجلة.</p>}{fileError && <p role="alert" style={errorStyle}>{fileError}</p>}</section>{DOSSIER_SECTIONS.map((section) => <details key={section.title} open><summary style={{ cursor: 'pointer', fontWeight: 700, marginBlock: 12 }}>{section.title}</summary><dl style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 190px) minmax(0, 1fr)', gap: 8 }}>{section.fields.map(([path, label]) => {
    const value = valueAt(application.v2Payload, path);
    let website: URL | null = null;
    if (path === 'organization.websiteUrl' && typeof value === 'string') { try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) website = url; } catch { /* Keep malformed historical text visible, never executable. */ } }
    return <div key={path} style={{ display: 'contents' }}><dt>{label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{website ? <a href={website.href} target="_blank" rel="noopener noreferrer" dir="ltr">{String(value)}</a> : displayValue(value)}</dd></div>;
  })}</dl>{section.title === 'الحوكمة والمالية' && <FinancialSummary finance={application.v2Payload?.finance} />}</details>)}</div>;
}

function valueAt(root: Record<string, unknown> | null, path: string): unknown { let current: unknown = root; for (const key of path.split('.')) { if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined; current = (current as Record<string, unknown>)[key]; } return current; }
function displayValue(value: unknown): string { if (value === true) return 'نعم'; if (value === false) return 'لا'; if (value == null || value === '') return '—'; if (Array.isArray(value)) return value.map(String).join('، ') || '—'; if (typeof value === 'number') return new Intl.NumberFormat('ar-SA').format(value); return String(value); }
