'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { PageHeader } from '../../components/PageHeader';
import { useRoleGuard } from '../../lib/use-role-guard';
import { apiFetch, decideApplicationEligibility, decideApplicationSelection, evaluateApplication, getApplicationEligibilityEvidence, getApplicationIntake, requestApplicationInformation, resendApplicationInformation, resendApplicationRejection, resendApplicationSelection, saveSystemSetting, startApplicationProcessing, type ApplicationSummary, type Paginated } from '../../lib/api';
import { selectionGroup, SELECTION_GROUPS, type SelectionGroup } from './selection-groups';
import { fetchPagedItems } from './selection-load';
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
const ACTIONABLE_GROUPS = ['NEW', 'PROCESSING', 'PASSED_UNSELECTED'];

export default function SelectionPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  if (loading || !user) return null;
  return <AppShell user={user}><SelectionBoard showHeader /></AppShell>;
}

export function SelectionBoard({ showHeader = false }: { showHeader?: boolean }) {
  const [apps, setApps] = useState<ApplicationSummary[]>([]); const [filter, setFilter] = useState<SelectionGroup>('ACTION');
  const [eligibilityTarget, setEligibilityTarget] = useState<ApplicationSummary | null>(null); const [evaluationTarget, setEvaluationTarget] = useState<ApplicationSummary | null>(null); const [infoTarget, setInfoTarget] = useState<ApplicationSummary | null>(null);
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
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void getApplicationIntake().then((status) => { setIntake(status); setIntakeTime(status.closesAt ? new Date(Date.parse(status.closesAt) + 3 * 60 * 60_000).toISOString().slice(0, 16) : ''); }).catch((reason) => setMessage(readError(reason))); }, []);
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> { setBusy(true); setMessage(''); try { await action(); setMessage(success); await load(); return true; } catch (reason) { setMessage(readError(reason)); return false; } finally { setBusy(false); } }
  async function submitInfo(input: { note?: string; deadline?: string; items: Array<{ type: 'FIELD' | 'ATTACHMENT'; key: string; reason: string }> }) {
    if (!infoTarget) return;
    setBusy(true); setMessage('');
    try {
      const result = await requestApplicationInformation(infoTarget.id, input);
      setMessage(result.emailSent ? 'تم تسجيل النواقص وإرسال البريد إلى الجمعية.' : 'تم تسجيل النواقص، لكن تعذّر إرسال البريد. استخدم زر إعادة إرسال البريد.');
      setInfoTarget(null); await load();
    } catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  async function saveIntake(value: string | null) {
    const saved = await run(() => saveSystemSetting('application.intakeClosesAt', value), value ? 'تم حفظ موعد إغلاق التقديم.' : 'أُعيد فتح التقديم.');
    if (saved) { setIntake(await getApplicationIntake()); if (!value) setIntakeTime(''); }
  }
  async function choose(application: ApplicationSummary, decision: 'MAIN' | 'RESERVE') {
    setBusy(true); setMessage('');
    try {
      const result = await decideApplicationSelection(application.id, decision);
      setMessage(result.emailSent === false ? 'حُفظ قرار الاختيار، لكن تعذّر إرسال البريد للجمعية. استخدم زر إعادة الإرسال.' : result.emailSent === null ? 'قرار الاختيار محفوظ مسبقًا؛ لم يُرسل إشعار جديد.' : `تم ${decision === 'MAIN' ? 'اعتماد الجمعية في الأساسية' : 'اعتماد الجمعية في الاحتياط'} وإرسال إشعار القرار.`);
      await load();
    } catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  async function saveEligibility(decision: EligibilityDecision, notes?: string) {
    if (!eligibilityTarget) return;
    setBusy(true); setMessage('');
    try {
      const result = await decideApplicationEligibility(eligibilityTarget.id, decision, notes);
      setMessage(decision === 'FAILED' && result.emailSent === false ? 'حُفظ قرار عدم الاجتياز، لكن تعذّر إرسال البريد. راجع سجل إرسال البريد.' : 'تم حفظ قرار الأهلية.');
      setEligibilityTarget(null); await load();
    } catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  async function retryRejection(application: ApplicationSummary) {
    setBusy(true); setMessage('');
    try { const result = await resendApplicationRejection(application.id); setMessage(result.emailSent ? 'تم إرسال إشعار عدم الاجتياز للجمعية.' : 'تعذّر إرسال البريد. راجع سجل إرسال البريد.'); }
    catch (reason) { setMessage(readError(reason)); }
    finally { setBusy(false); }
  }
  const visible = useMemo(() => apps.filter((app) => filter === 'ALL' || (filter === 'ACTION' ? ACTIONABLE_GROUPS.includes(selectionGroup(app)) : selectionGroup(app) === filter)), [apps, filter]);
  const counts = useMemo(() => Object.fromEntries(SELECTION_GROUPS.map((group) => [group.key, apps.filter((app) => group.key === 'ALL' || (group.key === 'ACTION' ? ACTIONABLE_GROUPS.includes(selectionGroup(app)) : selectionGroup(app) === group.key)).length])) as Record<SelectionGroup, number>, [apps]);
  const ranked = useMemo(() => apps.filter((app) => app.eligibilityStatus === 'PASSED' && app.evaluationScore != null).sort((a, b) => (b.evaluationScore ?? 0) - (a.evaluationScore ?? 0) || a.publicCode.localeCompare(b.publicCode, 'ar')), [apps]);
  return <>
    {showHeader && <PageHeader title="الأهلية والتقييم والاختيار" subtitle="الأهلية، ثم التقييم، ثم قرار القائمة الأساسية أو الاحتياطية." />}
    {message && <p role="status" style={message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}
    {listLoading && <p role="status">جارٍ تحديث قوائم الجمعيات…</p>}
    <section style={cardStyle}><h2>موعد استقبال طلبات الجمعيات</h2><p>{intake === null ? 'جارٍ تحميل حالة التقديم…' : intake.closesAt ? `التقديم ${intake.open ? 'مفتوح' : 'مغلق'} — الموعد بتوقيت الرياض.` : 'التقديم مفتوح دون موعد إغلاق.'}</p><label style={labelStyle}>آخر موعد للتقديم — توقيت الرياض<input type="datetime-local" style={inputStyle} value={intakeTime} onChange={(event) => setIntakeTime(event.target.value)} /></label><div className="button-row"><button style={primaryButtonStyle} disabled={busy || !intakeTime} onClick={() => { const date = new Date(`${intakeTime}:00+03:00`); if (!Number.isNaN(date.getTime())) void saveIntake(date.toISOString()); }}>حفظ الموعد</button><button style={secondaryButtonStyle} disabled={busy || !intake?.closesAt} onClick={() => void saveIntake(null)}>إلغاء موعد الإغلاق</button></div><small>بعد الموعد يُرفض بدء طلب جديد وإرسال المسودات، وتبقى متابعة الطلبات السابقة متاحة.</small></section>
    <section style={cardStyle}><h2>قوائم الطلبات</h2><div className="button-row" role="group" aria-label="قوائم الأهلية والاختيار">{SELECTION_GROUPS.map((group) => <button key={group.key} type="button" style={filter === group.key ? primaryButtonStyle : secondaryButtonStyle} aria-pressed={filter === group.key} onClick={() => setFilter(group.key)}>{group.label} ({counts[group.key]})</button>)}</div></section>
    <section style={cardStyle}><h2>{SELECTION_GROUPS.find((group) => group.key === filter)?.label}</h2>{visible.length === 0 ? <p>لا توجد طلبات في هذه القائمة.</p> : visible.map((application) => <article key={application.id} className="workflow-row"><div><strong>{application.name}</strong><p>{application.publicCode} · {application.city} · الأهلية: {ELIGIBILITY_LABELS[application.eligibilityStatus]} · الاختيار: {selectionLabel(application.selectionList)}</p></div><div className="button-row">{selectionGroup(application) === 'NEW' && <button style={primaryButtonStyle} disabled={busy} onClick={() => void run(() => startApplicationProcessing([application.id]), 'بدأت مراجعة الطلب.')}>بدء المراجعة</button>}<button style={secondaryButtonStyle} disabled={selectionGroup(application) === 'NEW' || application.status !== 'UNDER_REVIEW'} onClick={() => setEligibilityTarget(application)}>الأهلية والأدلة</button><button style={secondaryButtonStyle} disabled={application.schemaVersion !== 2 || application.status !== 'UNDER_REVIEW' || ['FAILED', 'NEEDS_INFO'].includes(application.eligibilityStatus) || selectionGroup(application) === 'NEW'} title={application.schemaVersion !== 2 ? 'الطلبات السابقة لا تدعم رابط الاستكمال الإلكتروني' : undefined} onClick={() => setInfoTarget(application)}>طلب استكمال وإرسال بريد</button>{application.eligibilityStatus === 'NEEDS_INFO' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void run(() => resendApplicationInformation(application.id), 'أُعيد إرسال بريد الاستكمال.')}>إعادة إرسال البريد</button>}{application.eligibilityStatus === 'FAILED' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void retryRejection(application)}>إعادة إرسال عدم الاجتياز</button>}<button style={secondaryButtonStyle} disabled={application.eligibilityStatus !== 'PASSED'} title={application.eligibilityStatus !== 'PASSED' ? 'يجب اجتياز الأهلية أولًا' : undefined} onClick={() => setEvaluationTarget(application)}>التقييم 1–5</button>{application.evaluationScore != null && <span className="status-pill">{application.evaluationScore}/100</span>}</div></article>)}</section>
    <section style={cardStyle}><h2>الترتيب وقرار الاختيار النهائي</h2><p>يمكن الاختيار بعد اجتياز الأهلية وحفظ تقييم 1–5. ويمكن نقل جمعية الاحتياط إلى الأساسية؛ ولا يُسحب اختيار جمعية أساسية من هنا.</p>{ranked.length === 0 ? <p>لا توجد طلبات مكتملة التقييم.</p> : ranked.map((application, index) => <article key={application.id} className="workflow-row"><div><strong>{index + 1}. {application.name}</strong><p>{application.publicCode} · {application.evaluationScore}/100 · {selectionLabel(application.selectionList)} · {financialLabel(application.financialPriority)}</p></div><div className="button-row">{application.selectionList !== 'MAIN' && <button style={primaryButtonStyle} disabled={busy} onClick={() => void choose(application, 'MAIN')}>{application.selectionList === 'RESERVE' ? 'نقل إلى الأساسية' : 'اعتماد أساسية'}</button>}{application.selectionList === 'NONE' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void choose(application, 'RESERVE')}>اعتماد احتياط</button>}{application.selectionList !== 'NONE' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void run(() => resendApplicationSelection(application.id), 'أُعيد إرسال إشعار الاختيار للجمعية.')}>إعادة إرسال إشعار الاختيار</button>}</div></article>)}</section>
    {eligibilityTarget && <EligibilityDialog application={eligibilityTarget} busy={busy} message={message} onClose={() => setEligibilityTarget(null)} onSubmit={saveEligibility} />}
    {evaluationTarget && <EvaluationDialog application={evaluationTarget} busy={busy} message={message} onClose={() => setEvaluationTarget(null)} onSubmit={async (scores) => { if (await run(() => evaluateApplication(evaluationTarget.id, scores), 'تم حفظ التقييم الموزون.')) setEvaluationTarget(null); }} />}
    {infoTarget && <InformationDialog application={infoTarget} busy={busy} message={message} onClose={() => setInfoTarget(null)} onSubmit={submitInfo} />}
  </>;
}

function EligibilityDialog({ application, busy, message, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; message: string; onClose: () => void; onSubmit: (decision: EligibilityDecision, notes?: string) => Promise<void> }) {
  const [decision, setDecision] = useState<EligibilityDecision>(application.eligibilityStatus === 'PENDING' ? 'PASSED' : application.eligibilityStatus); const [notes, setNotes] = useState(application.eligibilityNotes ?? ''); const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null); const [error, setError] = useState('');
  useEffect(() => { getApplicationEligibilityEvidence(application.id).then(setEvidence).catch((reason) => setError(readError(reason))); }, [application.id]); const checks = Array.isArray(evidence?.checks) ? evidence.checks as Array<{ key: string; label: string; result: string; detail: string }> : [];
  return <Dialog title={`الأهلية والأدلة — ${application.name}`} onClose={onClose}>{message && !message.startsWith('تم') && <p role="alert" style={errorStyle}>{message}</p>}<h3>الأدلة الآلية</h3>{error && <p style={errorStyle}>{error}</p>}{!evidence && !error ? <p>جارٍ تحميل الأدلة…</p> : checks.length ? <ul>{checks.map((check) => <li key={check.key}><strong>{check.label}:</strong> {check.result === 'PASS' ? 'مستوفى' : check.result === 'FAIL' ? 'غير مستوفى' : 'يتطلب مراجعة'}{check.detail ? ` — ${check.detail}` : ''}</li>)}</ul> : <p>{String(evidence?.summary ?? 'تتطلب البيانات مراجعة بشرية.')}</p>}<p>للاستكمال استخدم زر «طلب استكمال وإرسال بريد» في قائمة الطلبات.</p><label style={labelStyle}>القرار<select style={inputStyle} value={decision} onChange={(e) => setDecision(e.target.value as EligibilityDecision)}><option value="PASSED">مجتاز</option><option value="FAILED">غير مجتاز</option>{decision === 'NEEDS_INFO' && <option value="NEEDS_INFO" disabled>بانتظار الاستكمال</option>}</select></label><label style={labelStyle}>الملاحظات {decision === 'PASSED' ? '(اختيارية)' : '(إلزامية)'}<textarea style={{ ...inputStyle, minHeight: 90 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label><div className="button-row"><button style={primaryButtonStyle} disabled={busy || decision === 'NEEDS_INFO' || (decision !== 'PASSED' && !notes.trim())} onClick={() => void onSubmit(decision, notes.trim() || undefined)}>حفظ القرار</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div></Dialog>;
}

function EvaluationDialog({ application, busy, message, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; message: string; onClose: () => void; onSubmit: (scores: Scores) => Promise<void> }) {
  const [scores, setScores] = useState<Scores>(() => ({ ...EMPTY_SCORES, ...(application.evaluationBreakdown?.raw as Partial<Scores> | undefined) })); const [reviewed, setReviewed] = useState(false); const total = useMemo(() => CRITERIA.reduce((sum, criterion) => sum + scores[criterion.key] / 5 * criterion.weight, 0), [scores]);
  return <Dialog title={`التقييم الموزون — ${application.name}`} onClose={onClose}>{message && !message.startsWith('تم') && <p role="alert" style={errorStyle}>{message}</p>}<p>قيّم كل محور بدرجة صحيحة من 1 إلى 5. الأوزان ثابتة ولا توجد أوزان فرعية مخفية.</p>{CRITERIA.map((criterion) => <label key={criterion.key} style={labelStyle}>{criterion.label} — الوزن {criterion.weight}%<select style={inputStyle} value={scores[criterion.key]} onChange={(e) => setScores((old) => ({ ...old, [criterion.key]: Number(e.target.value) }))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} من 5</option>)}</select><span>النقاط: {(scores[criterion.key] / 5 * criterion.weight).toFixed(2)}</span></label>)}<div className="selection-total"><strong>المجموع</strong><span>{total.toFixed(2)} / 100</span></div><label className="check-row"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />راجعت الدرجات والأدلة قبل الإرسال.</label><div className="button-row"><button style={primaryButtonStyle} disabled={busy || !reviewed} onClick={() => void onSubmit(scores)}>حفظ التقييم</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div></Dialog>;
}

function InformationDialog({ application, busy, message, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; message: string; onClose: () => void; onSubmit: (input: { note?: string; deadline?: string; items: Array<{ type: 'FIELD' | 'ATTACHMENT'; key: string; reason: string }> }) => Promise<void> }) {
  const [type, setType] = useState<'FIELD' | 'ATTACHMENT'>('FIELD'); const [key, setKey] = useState(''); const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [deadline, setDeadline] = useState('');
  const [items, setItems] = useState<Array<{ type: 'FIELD' | 'ATTACHMENT'; key: string; reason: string }>>([]);
  const current = key.trim() && reason.trim() ? { type, key: key.trim(), reason: reason.trim() } : null;
  return <Dialog title={`طلب استكمال — ${application.name}`} onClose={onClose}>
    {message && !message.startsWith('تم') && <p role="alert" style={errorStyle}>{message}</p>}
    <p>اختر البيانات أو المرفقات الناقصة، ثم أرسلها في بريد واحد إلى الجمعية. ستظهر أيضًا في صفحة متابعة طلبها.</p>
    {items.length > 0 && <ol>{items.map((item, index) => <li key={`${item.key}-${index}`}>{item.reason} <button type="button" style={secondaryButtonStyle} onClick={() => setItems((old) => old.filter((_, at) => at !== index))}>حذف</button></li>)}</ol>}
    <label style={labelStyle}>نوع العنصر<select style={inputStyle} value={type} onChange={(e) => { setType(e.target.value as 'FIELD' | 'ATTACHMENT'); setKey(''); }}><option value="FIELD">بيان</option><option value="ATTACHMENT">مرفق</option></select></label>
    <label style={labelStyle}>العنصر المطلوب{type === 'ATTACHMENT' ? <select style={inputStyle} value={key} onChange={(e) => setKey(e.target.value)}><option value="">اختر المرفق</option>{Object.entries(ATTACHMENT_FIELDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <select style={inputStyle} value={key} onChange={(e) => setKey(e.target.value)}><option value="">اختر البيان من الطلب</option>{applicationFieldKeys(application.v2Payload).map((path) => <option key={path} value={path}>{FIELD_LABELS[path] ?? path}</option>)}</select>}</label>
    <label style={labelStyle}>ما الذي يجب استكماله؟<textarea style={{ ...inputStyle, minHeight: 90 }} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <button type="button" style={secondaryButtonStyle} disabled={!current || items.length >= 49} onClick={() => { if (current) { setItems((old) => [...old, current]); setKey(''); setReason(''); } }}>إضافة نقص آخر</button>
    <label style={labelStyle}>ملاحظة عامة (اختيارية)<textarea style={{ ...inputStyle, minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <label style={labelStyle}>المهلة (اختيارية)<input type="date" style={inputStyle} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
    <div className="button-row"><button style={primaryButtonStyle} disabled={busy || (!items.length && !current)} onClick={() => void onSubmit({ note: note.trim() || undefined, deadline: deadline || undefined, items: [...items, ...(current ? [current] : [])] })}>تسجيل النواقص وإرسال البريد</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div>
  </Dialog>;
}

const ATTACHMENT_FIELDS: Record<string, string> = { licenseFile: 'الترخيص', previousProjectEvidence: 'شاهد مشروع سابق', spendingPolicyFile: 'لائحة الصرف', strategicPlanFile: 'الخطة الاستراتيجية', operationalPlanFile: 'الخطة التشغيلية', initialBeneficiaryFile: 'القائمة الأولية للمستفيدين', financialStatementsFile: 'القوائم المالية' };
const FIELD_LABELS: Record<string, string> = { 'organization.name': 'اسم الجمعية', 'organization.licenseNumber': 'رقم الترخيص', 'organization.licenseExpiryDate': 'تاريخ انتهاء الترخيص', 'organization.officialEmail': 'البريد الرسمي', 'organization.officialPhone': 'رقم التواصل', 'organization.category': 'تصنيف الجمعية', 'organization.sector': 'مجال عمل الجمعية', 'coordinator.name': 'اسم المنسق', 'coordinator.title': 'صفة المنسق', 'coordinator.phone': 'جوال المنسق', 'coordinator.email': 'بريد المنسق', 'beneficiaries.registeredFamilies': 'عدد الأسر المسجلة', 'beneficiaries.databaseUpdatedAt': 'تاريخ تحديث بيانات المستفيدين', 'finance.revenue': 'الإيرادات', 'finance.expenses': 'المصروفات', 'finance.currentAssets': 'الأصول المتداولة', 'finance.currentLiabilities': 'الخصوم المتداولة' };
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
  return keys.sort((a, b) => (FIELD_LABELS[a] ?? a).localeCompare(FIELD_LABELS[b] ?? b, 'ar'));
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div style={modalOverlayStyle} role="dialog" aria-modal="true"><div style={{ ...modalStyle, maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}><h2>{title}</h2>{children}<button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق النافذة</button></div></div>; }
function selectionLabel(value: ApplicationSummary['selectionList']) { return ({ NONE: 'لم يُحدد', MAIN: 'القائمة الأساسية', RESERVE: 'قائمة الاحتياط' })[value]; }
function financialLabel(value: ApplicationSummary['financialPriority']) { return value === 'HIGHER_CAPACITY_LOWER_AID_PRIORITY' ? 'قدرة مالية أعلى / أولوية دعم أقل وفق مؤشر 10 ملايين' : value === 'STANDARD_PRIORITY_REVIEW' ? 'أولوية مالية للمراجعة' : 'المؤشر المالي غير مكتمل'; }
function readError(reason: unknown) { return reason instanceof Error ? reason.message : 'تعذّر تنفيذ العملية.'; }
