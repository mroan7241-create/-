'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { PageHeader } from '../../components/PageHeader';
import { useRoleGuard } from '../../lib/use-role-guard';
import { canAdmin } from '../../lib/admin-access';
import type { CurrentUser } from '../../lib/api';
import { apiFetch, decideApplicationEligibility, decideApplicationSelection, evaluateApplication, getApplicationEligibilityEvidence, getApplicationIntake, requestApplicationInformation, resendApplicationInformation, resendApplicationRejection, resendApplicationSelection, saveSystemSetting, startApplicationProcessing, type ApplicationSummary, type Paginated } from '../../lib/api';
import { selectionGroup, SELECTION_GROUPS, type SelectionGroup } from './selection-groups';
import { fetchPagedItems } from './selection-load';
import { evaluationFacts, type EvaluationAxis } from './evaluation-evidence';
import { APPLICATION_ATTACHMENT_LABELS, APPLICATION_FIELD_LABELS, applicationRequirementLabel } from '@alzad/shared';
import { cardStyle, errorStyle, inputStyle, labelStyle, modalOverlayStyle, modalStyle, primaryButtonStyle, secondaryButtonStyle, successStyle } from '../../lib/ui';

type EligibilityDecision = 'PASSED' | 'FAILED' | 'NEEDS_INFO';
type Scores = { operationalReadiness: number; technicalCapability: number; previousExperience: number; integrityTransparency: number; participationCommitment: number; sustainabilityImpact: number };
const CRITERIA: Array<{ key: keyof Scores; label: string; weight: number }> = [
  { key: 'operationalReadiness', label: 'الجاهزية التشغيلية', weight: 30 }, { key: 'technicalCapability', label: 'القدرة التقنية', weight: 20 },
  { key: 'previousExperience', label: 'الخبرة السابقة', weight: 20 }, { key: 'integrityTransparency', label: 'النزاهة والشفافية', weight: 15 },
  { key: 'participationCommitment', label: 'الالتزام بالمشاركة', weight: 10 }, { key: 'sustainabilityImpact', label: 'الاستدامة والأثر', weight: 5 },
];
const EMPTY_SCORES: Scores = { operationalReadiness: 1, technicalCapability: 1, previousExperience: 1, integrityTransparency: 1, participationCommitment: 1, sustainabilityImpact: 1 };
const ELIGIBILITY_LABELS: Record<ApplicationSummary['eligibilityStatus'], string> = { PENDING: 'بانتظار القرار', PASSED: 'مجتاز', FAILED: 'غير مجتاز', NEEDS_INFO: 'يحتاج معلومات' };
const ACTIONABLE_GROUPS = ['NEW', 'RETURNED', 'PROCESSING', 'PASSED_UNSELECTED'];

export default function SelectionPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  if (loading || !user) return null;
  return <AppShell user={user}><SelectionBoard user={user} showHeader /></AppShell>;
}

export function SelectionBoard({ user, showHeader = false, mode = 'all' }: { user: CurrentUser; showHeader?: boolean; mode?: 'all' | 'review' | 'selection' | 'settings' }) {
  const canRead = canAdmin(user, 'applications.read');
  const canReview = canAdmin(user, 'applications.review');
  const canEvaluate = canAdmin(user, 'applications.evaluate');
  const canSelect = canAdmin(user, 'applications.select');
  const canSettings = canAdmin(user, 'settings.manage');
  const [apps, setApps] = useState<ApplicationSummary[]>([]); const [filter, setFilter] = useState<SelectionGroup>('ACTION');
  const [eligibilityTarget, setEligibilityTarget] = useState<ApplicationSummary | null>(null); const [evaluationTarget, setEvaluationTarget] = useState<ApplicationSummary | null>(null); const [infoTarget, setInfoTarget] = useState<ApplicationSummary | null>(null);
  const [detailTarget, setDetailTarget] = useState<ApplicationSummary | null>(null);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const loadSequence = useRef(0);
  const [intake, setIntake] = useState<{ open: boolean; closesAt: string | null } | null>(null);
  const [intakeTime, setIntakeTime] = useState('');
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setListLoading(true);
    try {
      const all = await fetchPagedItems((page) => apiFetch<Paginated<ApplicationSummary>>(`/association-applications?page=${page}&pageSize=100&includeCounts=false`));
      if (sequence === loadSequence.current) setApps(all);
    } catch (reason) {
      if (sequence === loadSequence.current) setMessage(readError(reason));
    } finally {
      if (sequence === loadSequence.current) setListLoading(false);
    }
  }, []);
  useEffect(() => { if (mode !== 'settings' && canRead) void load(); }, [load, mode, canRead]);
  useEffect(() => { if (canSettings && (mode === 'settings' || mode === 'all')) void getApplicationIntake().then((status) => { setIntake(status); setIntakeTime(status.closesAt ? new Date(Date.parse(status.closesAt) + 3 * 60 * 60_000).toISOString().slice(0, 16) : ''); }).catch((reason) => setMessage(readError(reason))); }, [mode, canSettings]);
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> { setBusy(true); setMessage('جارٍ تنفيذ العملية وتحديث القائمة…'); try { const result = await action() as { emailQueued?: boolean } | undefined; setMessage(result?.emailQueued === false ? 'تعذّر تجهيز البريد لهذا الطلب. راجع سجل إرسال البريد.' : success); await load(); return true; } catch (reason) { setMessage(readError(reason)); return false; } finally { setBusy(false); } }
  async function submitInfo(input: { note?: string; deadline?: string; items: Array<{ type: 'FIELD' | 'ATTACHMENT'; key: string; reason: string }> }) {
    if (!infoTarget) return;
    setBusy(true); setMessage('جارٍ تسجيل النواقص وإرسال البريد…');
    try {
      const result = await requestApplicationInformation(infoTarget.id, input);
      setMessage(result.emailQueued ? 'تم تسجيل النواقص وحفظ رسالة الاستكمال للإرسال.' : result.emailSent ? 'تم تسجيل النواقص وإرسال البريد إلى الجمعية.' : result.emailSent === null ? 'طلب الاستكمال محفوظ مسبقًا؛ لم تُنشأ رسالة مكررة.' : 'تم تسجيل النواقص، لكن تعذّر تجهيز البريد. راجع سجل إرسال البريد.');
      setInfoTarget(null); await load();
    } catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  async function saveIntake(value: string | null) {
    setBusy(true); setMessage('جارٍ حفظ الموعد…');
    try {
      await saveSystemSetting('application.intakeClosesAt', value);
      setIntake(await getApplicationIntake());
      if (!value) setIntakeTime('');
      setMessage(value ? 'تم حفظ موعد إغلاق التقديم.' : 'أُعيد فتح التقديم.');
    } catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  async function choose(application: ApplicationSummary, decision: 'MAIN' | 'RESERVE') {
    if (!window.confirm(`تأكيد ${decision === 'MAIN' ? 'اختيار الأساسية' : 'اختيار الاحتياط'} للجمعية «${application.name}»؟ بعد التأكيد سيُحفظ القرار ويُرسل إشعاره تلقائيًا إلى بريد هذه الجمعية. لا يمكن الرجوع من الأساسية إلى الاحتياط بعد بدء الإرسال أو إنشاء حساب التوقيع.`)) return;
    setBusy(true); setMessage('جارٍ حفظ قرار الاختيار وإرسال الإشعار…');
    try {
      const result = await decideApplicationSelection(application.id, decision);
      setMessage(result.emailQueued ? `تم ${decision === 'MAIN' ? 'اعتماد الجمعية في الأساسية' : 'اعتماد الجمعية في الاحتياط'} وحفظ إشعار القرار للإرسال.` : result.emailSent === false ? 'حُفظ قرار الاختيار، لكن تعذّر تجهيز البريد للجمعية. راجع سجل إرسال البريد.' : result.emailSent === null ? 'قرار الاختيار محفوظ مسبقًا؛ لم يُرسل إشعار جديد.' : `تم ${decision === 'MAIN' ? 'اعتماد الجمعية في الأساسية' : 'اعتماد الجمعية في الاحتياط'} وإرسال إشعار القرار.`);
      await load();
    } catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  async function saveEligibility(decision: EligibilityDecision, notes?: string) {
    if (!eligibilityTarget) return;
    setBusy(true); setMessage('جارٍ حفظ قرار الأهلية…');
    try {
      const result = await decideApplicationEligibility(eligibilityTarget.id, decision, notes);
      setMessage(result.emailQueued ? 'حُفظ قرار عدم الاجتياز ورسالة إشعاره للإرسال.' : decision === 'FAILED' && result.emailSent === false ? 'حُفظ قرار عدم الاجتياز، لكن تعذّر تجهيز البريد. راجع سجل إرسال البريد.' : decision === 'PASSED' ? 'تم اجتياز الأهلية. أكمل التقييم والاختيار في المرحلة الثانية.' : 'تم حفظ قرار الأهلية.');
      setEligibilityTarget(null); await load();
    } catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  async function retryRejection(application: ApplicationSummary) {
    setBusy(true); setMessage('');
    try { const result = await resendApplicationRejection(application.id); setMessage(result.emailQueued ? 'حُفظ إشعار عدم الاجتياز للإرسال.' : result.emailSent ? 'تم إرسال إشعار عدم الاجتياز للجمعية.' : 'تعذّر تجهيز البريد. راجع سجل إرسال البريد.'); }
    catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  const groups = mode === 'review' ? SELECTION_GROUPS.filter((group) => ['ACTION', 'NEW', 'RETURNED', 'PROCESSING', 'NEEDS_INFO', 'FAILED'].includes(group.key)) : mode === 'selection' ? SELECTION_GROUPS.filter((group) => ['PASSED_UNSELECTED', 'MAIN', 'RESERVE'].includes(group.key)) : SELECTION_GROUPS;
  const actionableGroups = mode === 'review' ? ['NEW', 'RETURNED', 'PROCESSING'] : ACTIONABLE_GROUPS;
  const activeFilter = groups.some((group) => group.key === filter) ? filter : groups[0]?.key ?? 'ACTION';
  const visible = apps.filter((app) => activeFilter === 'ALL' || (activeFilter === 'ACTION' ? actionableGroups.includes(selectionGroup(app)) : selectionGroup(app) === activeFilter));
  const counts = Object.fromEntries(SELECTION_GROUPS.map((group) => [group.key, apps.filter((app) => group.key === 'ALL' || (group.key === 'ACTION' ? actionableGroups.includes(selectionGroup(app)) : selectionGroup(app) === group.key)).length])) as Record<SelectionGroup, number>;
  const ranked = useMemo(() => apps.filter((app) => app.eligibilityStatus === 'PASSED' && app.evaluationScore != null).sort((a, b) => (b.evaluationScore ?? 0) - (a.evaluationScore ?? 0) || a.publicCode.localeCompare(b.publicCode, 'ar')), [apps]);
  return <>
    {showHeader && <PageHeader title="الأهلية والتقييم والاختيار" subtitle="الأهلية، ثم التقييم، ثم قرار القائمة الأساسية أو الاحتياطية." />}
    {message && <p role="status" aria-live="polite" style={busy ? { color: 'var(--muted)' } : message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}
    {canRead && mode !== 'settings' && listLoading && <p role="status">جارٍ تحديث قوائم الجمعيات…</p>}
    {canSettings && (mode === 'settings' || mode === 'all') && <section style={cardStyle}><h2>موعد استقبال طلبات الجمعيات</h2><p>{intake === null ? 'جارٍ تحميل حالة التقديم…' : intake.closesAt ? `التقديم ${intake.open ? 'مفتوح' : 'مغلق'} — الموعد بتوقيت الرياض.` : 'التقديم مفتوح دون موعد إغلاق.'}</p><label style={labelStyle}>آخر موعد للتقديم — توقيت الرياض<input type="datetime-local" style={inputStyle} value={intakeTime} onChange={(event) => setIntakeTime(event.target.value)} /></label><div className="button-row"><button style={primaryButtonStyle} disabled={busy || !intakeTime} onClick={() => { const date = new Date(`${intakeTime}:00+03:00`); if (!Number.isNaN(date.getTime())) void saveIntake(date.toISOString()); }}>حفظ الموعد</button><button style={secondaryButtonStyle} disabled={busy || !intake?.closesAt} onClick={() => void saveIntake(null)}>إلغاء موعد الإغلاق</button></div><small>بعد الموعد يُرفض بدء طلب جديد وإرسال المسودات، وتبقى متابعة الطلبات السابقة متاحة.</small></section>}
    {canRead && mode !== 'settings' && <section style={cardStyle}><h2>قوائم الطلبات</h2><div className="button-row" role="group" aria-label="قوائم الأهلية والاختيار">{groups.map((group) => <button key={group.key} type="button" style={activeFilter === group.key ? primaryButtonStyle : secondaryButtonStyle} aria-pressed={activeFilter === group.key} onClick={() => setFilter(group.key)}>{group.label} ({counts[group.key]})</button>)}</div></section>}
    {canRead && mode !== 'settings' && <section style={cardStyle}>
      <h2>{SELECTION_GROUPS.find((group) => group.key === activeFilter)?.label}</h2>
      {visible.length === 0 ? <p>لا توجد طلبات في هذه القائمة.</p> : visible.map((application) => {
        const group = selectionGroup(application);
        const reviewable = group !== 'NEW' && application.status === 'UNDER_REVIEW';
        return <article key={application.id} className="workflow-row">
          <div><strong>{application.name}</strong><p>{application.publicCode} · {application.city} · الأهلية: {ELIGIBILITY_LABELS[application.eligibilityStatus]} · الاختيار: {selectionLabel(application.selectionList)}</p>{group === 'RETURNED' && <p role="status" style={successStyle}>ورد استكمال من الجمعية. راجع البنود والمرفقات قبل القرار.</p>}</div>
          <div className="button-row">
            {group === 'RETURNED' && <button style={primaryButtonStyle} onClick={() => setDetailTarget(application)}>مراجعة الاستكمال</button>}
            {canReview && group === 'NEW' && <button style={primaryButtonStyle} disabled={busy} onClick={() => void run(() => startApplicationProcessing([application.id]), 'بدأت مراجعة الطلب.')}>بدء المراجعة</button>}
            {canReview && reviewable && !['FAILED', 'NEEDS_INFO'].includes(application.eligibilityStatus) && <button style={secondaryButtonStyle} onClick={() => setEligibilityTarget(application)}>الأهلية والأدلة</button>}
            {canReview && reviewable && application.schemaVersion === 2 && !['FAILED', 'NEEDS_INFO'].includes(application.eligibilityStatus) && <button style={secondaryButtonStyle} onClick={() => setInfoTarget(application)}>طلب استكمال وإرسال بريد</button>}
            {canReview && application.eligibilityStatus === 'NEEDS_INFO' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void run(() => resendApplicationInformation(application.id), 'حُفظ بريد الاستكمال للإرسال.')}>إعادة إرسال البريد</button>}
            {canReview && application.eligibilityStatus === 'FAILED' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void retryRejection(application)}>إعادة إرسال عدم الاجتياز</button>}
            {canEvaluate && application.eligibilityStatus === 'PASSED' && <button style={secondaryButtonStyle} onClick={() => setEvaluationTarget(application)}>التقييم 1–5</button>}
            {application.evaluationScore != null && <span className="status-pill">{application.evaluationScore}/100</span>}
          </div>
        </article>;
      })}
    </section>}
    {canRead && (mode === 'selection' || mode === 'all') && <section style={cardStyle}><h2>الترتيب وقرار الاختيار النهائي</h2><p>يمكن الاختيار بعد اجتياز الأهلية وحفظ تقييم 1–5. افتح ملف الجمعية وراجع أدلتها قبل اختيار الأساسية أو الاحتياط. يمكن نقل الاحتياط إلى الأساسية، وإرجاع الأساسية إلى الاحتياط قبل بدء إشعار الأساسية أو إنشاء حساب التوقيع. حفظ القرار يرسل الإشعار تلقائيًا لهذه الجمعية.</p>{ranked.length === 0 ? <p>لا توجد طلبات مكتملة التقييم.</p> : ranked.map((application, index) => <article key={application.id} className="workflow-row"><div><strong>{index + 1}. {application.name}</strong><p>{application.publicCode} · {application.evaluationScore}/100 · {selectionLabel(application.selectionList)} · {financialLabel(application.financialPriority)}</p></div><div className="button-row"><button style={secondaryButtonStyle} onClick={() => setDetailTarget(application)}>عرض بيانات الجمعية</button>{canSelect && application.selectionList !== 'MAIN' && <button style={primaryButtonStyle} disabled={busy} onClick={() => void choose(application, 'MAIN')}>{application.selectionList === 'RESERVE' ? 'نقل إلى الأساسية' : 'اعتماد أساسية'}</button>}{canSelect && application.selectionList !== 'RESERVE' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void choose(application, 'RESERVE')}>{application.selectionList === 'MAIN' ? 'نقل إلى الاحتياط' : 'اعتماد احتياط'}</button>}{canSelect && application.selectionList !== 'NONE' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void run(() => resendApplicationSelection(application.id), 'حُفظ إشعار الاختيار للإرسال.')}>إعادة إرسال إشعار الاختيار</button>}</div></article>)}</section>}
    {eligibilityTarget && <EligibilityDialog application={eligibilityTarget} busy={busy} message={message} onClose={() => setEligibilityTarget(null)} onSubmit={saveEligibility} />}
    {evaluationTarget && <EvaluationDialog application={evaluationTarget} busy={busy} message={message} onClose={() => setEvaluationTarget(null)} onSubmit={async (scores) => { if (await run(() => evaluateApplication(evaluationTarget.id, scores), 'تم حفظ التقييم الموزون.')) setEvaluationTarget(null); }} />}
    {infoTarget && <InformationDialog application={infoTarget} busy={busy} message={message} onClose={() => setInfoTarget(null)} onSubmit={submitInfo} />}
    {detailTarget && <ApplicationReviewDialog application={detailTarget} onClose={() => setDetailTarget(null)} />}
  </>;
}

function EligibilityDialog({ application, busy, message, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; message: string; onClose: () => void; onSubmit: (decision: EligibilityDecision, notes?: string) => Promise<void> }) {
  const [decision, setDecision] = useState<EligibilityDecision>(application.eligibilityStatus === 'PENDING' ? 'PASSED' : application.eligibilityStatus); const [notes, setNotes] = useState(application.eligibilityNotes ?? ''); const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null); const [error, setError] = useState('');
  useEffect(() => { getApplicationEligibilityEvidence(application.id).then(setEvidence).catch((reason) => setError(readError(reason))); }, [application.id]); const checks = Array.isArray(evidence?.checks) ? evidence.checks as Array<{ key: string; label: string; result: string; detail: string }> : [];
  return <Dialog title={`الأهلية والأدلة — ${application.name}`} onClose={onClose}>{message && !message.startsWith('تم') && <p role="alert" style={errorStyle}>{message}</p>}<h3>الأدلة الآلية</h3>{error && <p style={errorStyle}>{error}</p>}{!evidence && !error ? <p>جارٍ تحميل الأدلة…</p> : checks.length ? <ul>{checks.map((check) => <li key={check.key}><strong>{check.label}:</strong> {check.result === 'PASS' ? 'مستوفى' : check.result === 'FAIL' ? 'غير مستوفى' : 'يتطلب مراجعة'}{check.detail ? ` — ${check.detail}` : ''}</li>)}</ul> : <p>{String(evidence?.summary ?? 'تتطلب البيانات مراجعة بشرية.')}</p>}<p>للاستكمال استخدم زر «طلب استكمال وإرسال بريد» في قائمة الطلبات.</p><label style={labelStyle}>القرار<select style={inputStyle} value={decision} onChange={(e) => setDecision(e.target.value as EligibilityDecision)}><option value="PASSED">مجتاز</option><option value="FAILED">غير مجتاز</option>{decision === 'NEEDS_INFO' && <option value="NEEDS_INFO" disabled>بانتظار الاستكمال</option>}</select></label><label style={labelStyle}>الملاحظات {decision === 'PASSED' ? '(اختيارية)' : '(إلزامية)'}<textarea style={{ ...inputStyle, minHeight: 90 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label><div className="button-row"><button style={primaryButtonStyle} disabled={busy || decision === 'NEEDS_INFO' || (decision !== 'PASSED' && !notes.trim())} onClick={() => void onSubmit(decision, notes.trim() || undefined)}>حفظ القرار</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div></Dialog>;
}

function EvaluationDialog({ application, busy, message, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; message: string; onClose: () => void; onSubmit: (scores: Scores) => Promise<void> }) {
  const [scores, setScores] = useState<Scores>(() => ({ ...EMPTY_SCORES, ...(application.evaluationBreakdown?.raw as Partial<Scores> | undefined) })); const [reviewed, setReviewed] = useState(false); const [missingReview, setMissingReview] = useState(false); const total = useMemo(() => CRITERIA.reduce((sum, criterion) => sum + scores[criterion.key] / 5 * criterion.weight, 0), [scores]);
  return <Dialog title={`التقييم الموزون — ${application.name}`} onClose={onClose}>{message && !message.startsWith('تم') && <p role="alert" style={errorStyle}>{message}</p>}<p>اقرأ بيانات الطلب تحت كل محور، ثم قيّمه من 1 إلى 5. الأوزان ثابتة.</p>{CRITERIA.map((criterion) => <section key={criterion.key} style={{ ...cardStyle, marginBlock: 12 }}><h3 style={{ marginTop: 0 }}>{criterion.label} — الوزن {criterion.weight}%</h3><EvidenceFacts application={application} axis={criterion.key} /><label style={labelStyle}>درجة {criterion.label}<select style={inputStyle} value={scores[criterion.key]} onChange={(e) => setScores((old) => ({ ...old, [criterion.key]: Number(e.target.value) }))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} من 5</option>)}</select></label><small>النقاط: {(scores[criterion.key] / 5 * criterion.weight).toFixed(2)}</small></section>)}<div className="selection-total"><strong>المجموع</strong><span>{total.toFixed(2)} / 100</span></div><label className="check-row"><input type="checkbox" checked={reviewed} onChange={(e) => { setReviewed(e.target.checked); if (e.target.checked) setMissingReview(false); }} />راجعت الدرجات والأدلة قبل الإرسال.</label>{missingReview && <p role="alert" style={errorStyle}>ضع علامة «راجعت الدرجات والأدلة» قبل حفظ التقييم.</p>}<div className="button-row"><button style={primaryButtonStyle} disabled={busy} onClick={() => { if (!reviewed) { setMissingReview(true); return; } void onSubmit(scores); }}>{busy ? 'جارٍ حفظ التقييم…' : 'حفظ التقييم'}</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div></Dialog>;
}

function InformationDialog({ application, busy, message, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; message: string; onClose: () => void; onSubmit: (input: { note?: string; deadline?: string; items: Array<{ type: 'FIELD' | 'ATTACHMENT'; key: string; reason: string }> }) => Promise<void> }) {
  const [type, setType] = useState<'FIELD' | 'ATTACHMENT'>('FIELD'); const [key, setKey] = useState(''); const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [deadline, setDeadline] = useState('');
  const [items, setItems] = useState<Array<{ type: 'FIELD' | 'ATTACHMENT'; key: string; reason: string }>>([]);
  const current = key.trim() && reason.trim() ? { type, key: key.trim(), reason: reason.trim() } : null;
  return <Dialog title={`طلب استكمال — ${application.name}`} onClose={onClose}>
    {message && !message.startsWith('تم') && <p role="alert" style={errorStyle}>{message}</p>}
    <p>اختر البيانات أو المرفقات الناقصة، ثم أرسلها في بريد واحد إلى الجمعية. ستظهر أيضًا في صفحة متابعة طلبها.</p>
    {items.length > 0 && <ol>{items.map((item, index) => <li key={`${item.key}-${index}`}><strong>{applicationRequirementLabel(item.type, item.key)}</strong> — {item.reason} <button type="button" style={secondaryButtonStyle} onClick={() => setItems((old) => old.filter((_, at) => at !== index))}>حذف</button></li>)}</ol>}
    <label style={labelStyle}>نوع العنصر<select style={inputStyle} value={type} onChange={(e) => { setType(e.target.value as 'FIELD' | 'ATTACHMENT'); setKey(''); }}><option value="FIELD">بيان</option><option value="ATTACHMENT">مرفق</option></select></label>
    <label style={labelStyle}>العنصر المطلوب{type === 'ATTACHMENT' ? <select style={inputStyle} value={key} onChange={(e) => setKey(e.target.value)}><option value="">اختر المرفق</option>{Object.entries(APPLICATION_ATTACHMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <select style={inputStyle} value={key} onChange={(e) => setKey(e.target.value)}><option value="">اختر البيان من الطلب</option>{applicationFieldKeys(application.v2Payload).map((path) => <option key={path} value={path}>{APPLICATION_FIELD_LABELS[path] ?? path}</option>)}</select>}</label>
    <label style={labelStyle}>ما الذي يجب استكماله؟<textarea style={{ ...inputStyle, minHeight: 90 }} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <button type="button" style={secondaryButtonStyle} disabled={!current || items.length >= 49} onClick={() => { if (current) { setItems((old) => [...old, current]); setKey(''); setReason(''); } }}>إضافة نقص آخر</button>
    <label style={labelStyle}>ملاحظة عامة (اختيارية)<textarea style={{ ...inputStyle, minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <label style={labelStyle}>المهلة (اختيارية)<input type="date" style={inputStyle} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
    <div className="button-row"><button style={primaryButtonStyle} disabled={busy || (!items.length && !current)} onClick={() => void onSubmit({ note: note.trim() || undefined, deadline: deadline || undefined, items: [...items, ...(current ? [current] : [])] })}>تسجيل النواقص وإرسال البريد</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div>
  </Dialog>;
}

function applicationFieldKeys(value: Record<string, unknown> | null): string[] {
  const keys: string[] = [];
  function visit(node: Record<string, unknown>, prefix = '') {
    for (const [key, entry] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (path.startsWith('acknowledgements.')) continue;
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) visit(entry as Record<string, unknown>, path);
      else if (['string', 'number', 'boolean'].includes(typeof entry)) keys.push(path);
    }
  }
  if (value) visit(value);
  return keys.sort((a, b) => (APPLICATION_FIELD_LABELS[a] ?? a).localeCompare(APPLICATION_FIELD_LABELS[b] ?? b, 'ar'));
}

function EvidenceFacts({ application, axis }: { application: ApplicationSummary; axis: EvaluationAxis }) {
  if (!application.v2Payload) return <p style={{ color: 'var(--muted)' }}>هذا الطلب لا يحتوي استبانة تفصيلية؛ راجع ملفه قبل التقييم.</p>;
  return <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) 1fr', gap: 6, marginBlock: 10 }}>{evaluationFacts(application, axis).map((fact) => <div key={fact.label} style={{ display: 'contents' }}><dt>{fact.label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{fact.value}</dd></div>)}</dl>;
}

function ApplicationReviewDialog({ application, onClose }: { application: ApplicationSummary; onClose: () => void }) {
  const request = application.latestInformationRequest;
  return <Dialog title={`ملف ${application.name} — ${application.publicCode}`} onClose={onClose}>
    <p>المدينة: {application.city} · الأهلية: {ELIGIBILITY_LABELS[application.eligibilityStatus]} · التقييم: {application.evaluationScore == null ? 'لم يُحفظ بعد' : `${application.evaluationScore}/100`}</p>
    {request?.status === 'SUBMITTED' && <section style={cardStyle}><h3>استكمال ورد من الجمعية</h3><p>تاريخ الإرسال: {request.submittedAt ? new Date(request.submittedAt).toLocaleString('ar-SA') : 'غير متاح'}</p><ul>{request.items.map((item) => <li key={`${item.type}-${item.key}`}><strong>{applicationRequirementLabel(item.type, item.key)}</strong> — {item.reason}{item.type === 'ATTACHMENT' && <span> · {application.attachmentKeys.includes(item.key) ? 'المرفق موجود في الطلب' : 'المرفق غير ظاهر في الطلب'}</span>}</li>)}</ul></section>}
    <p>المرفقات الموجودة: {application.attachmentKeys.length ? application.attachmentKeys.map((key) => APPLICATION_ATTACHMENT_LABELS[key] ?? key).join('، ') : 'لا توجد'}</p>
    <p>مراجع الأهلية: {application.eligibilityReviewer?.name ?? '—'} · المقيّم: {application.evaluator?.name ?? '—'} · معتمد الاختيار: {application.selectionApprover?.name ?? '—'}</p>
    {CRITERIA.map((criterion) => <details key={criterion.key}><summary style={{ cursor: 'pointer', fontWeight: 700, marginBlock: 10 }}>{criterion.label}</summary><EvidenceFacts application={application} axis={criterion.key} /></details>)}
    <a href={`/admin/applications?view=files&search=${encodeURIComponent(application.publicCode)}`} style={{ ...secondaryButtonStyle, display: 'inline-block', textDecoration: 'none', marginBlock: 12 }}>فتح الملف الكامل والمرفقات</a>
  </Dialog>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div style={modalOverlayStyle} role="dialog" aria-modal="true"><div style={{ ...modalStyle, maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}><h2>{title}</h2>{children}<button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق النافذة</button></div></div>; }
function selectionLabel(value: ApplicationSummary['selectionList']) { return ({ NONE: 'لم يُحدد', MAIN: 'القائمة الأساسية', RESERVE: 'قائمة الاحتياط' })[value]; }
function financialLabel(value: ApplicationSummary['financialPriority']) { return value === 'HIGHER_CAPACITY_LOWER_AID_PRIORITY' ? 'قدرة مالية أعلى / أولوية دعم أقل وفق مؤشر 10 ملايين' : value === 'STANDARD_PRIORITY_REVIEW' ? 'أولوية مالية للمراجعة' : 'المؤشر المالي غير مكتمل'; }
function readError(reason: unknown) { return reason instanceof Error ? reason.message : 'تعذّر تنفيذ العملية.'; }
