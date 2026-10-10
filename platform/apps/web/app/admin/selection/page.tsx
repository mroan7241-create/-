'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { PageHeader } from '../../components/PageHeader';
import { useRoleGuard } from '../../lib/use-role-guard';
import { canAdmin, isAdminOwner } from '../../lib/admin-access';
import type { CurrentUser } from '../../lib/api';
import { apiFetch, decideApplicationEligibility, decideApplicationSelection, evaluateApplication, getApplicationEligibilityEvidence, getApplicationIntake, requestApplicationInformation, resendApplicationInformation, resendApplicationRejection, resendApplicationSelection, commitApplicationSelection, getApplicationGeography, saveSystemSetting, startApplicationProcessing, type ApplicationSummary, type GeographicUnit, type InternalSelectionDecision, type Paginated } from '../../lib/api';
import { filterApplications, applicationCityKey, groupApplications, PROJECT_GROUP_LABELS, selectionGroup, SELECTION_GROUPS, type SelectionGroup } from './selection-groups';
import { fetchPagedItems, fetchAffectedItems } from './selection-load';
import { ApplicationDetail } from '../applications/application-detail';
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
  const needsApplications = mode !== 'settings';
  const [apps, setApps] = useState<ApplicationSummary[]>([]); const [filter, setFilter] = useState<SelectionGroup>('ACTION');
  const [projectGroup, setProjectGroup] = useState('');
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [geography, setGeography] = useState<GeographicUnit[]>([]);
  const [geographyError, setGeographyError] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const busyRef = useRef(false);
  const accessKey = JSON.stringify([user.id, user.adminApplicationScope, user.adminPermissions, user.adminFullAccess]);
  const [eligibilityTarget, setEligibilityTarget] = useState<ApplicationSummary | null>(null); const [evaluationTarget, setEvaluationTarget] = useState<ApplicationSummary | null>(null); const [infoTarget, setInfoTarget] = useState<ApplicationSummary | null>(null);
  const [detailTarget, setDetailTarget] = useState<ApplicationSummary | null>(null);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const loadSequence = useRef(0);
  const invalidateReads = useCallback(() => { loadSequence.current++; }, []);
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
  useEffect(() => {
    setApps([]); setChecked([]); setDetailTarget(null); setEvaluationTarget(null); setEligibilityTarget(null); setInfoTarget(null);
    if (canRead && needsApplications) void load();
    return invalidateReads;
  }, [load, canRead, needsApplications, accessKey, invalidateReads]);
  useEffect(() => { if (canRead && needsApplications) void getApplicationGeography().then((result) => { setGeography(result.items); setGeographyError(''); }).catch((reason) => setGeographyError(readError(reason))); }, [canRead, needsApplications]);
  useEffect(() => { if (canSettings && (mode === 'settings' || mode === 'all')) void getApplicationIntake().then((status) => { setIntake(status); setIntakeTime(status.closesAt ? new Date(Date.parse(status.closesAt) + 3 * 60 * 60_000).toISOString().slice(0, 16) : ''); }).catch((reason) => setMessage(readError(reason))); }, [mode, canSettings]);
  async function refreshAffected(ids: string[], success: string) {
    if (!ids.length) return;
    const sequence = ++loadSequence.current;
    try {
      const changed = await fetchAffectedItems(ids, (id) => apiFetch<ApplicationSummary>(`/association-applications/${id}`), () => fetchPagedItems((page) => apiFetch<Paginated<ApplicationSummary>>(`/association-applications?page=${page}&pageSize=100&includeCounts=false`)));
      if (sequence === loadSequence.current) setApps((current) => current.map((application) => changed.find((item) => item.id === application.id) ?? application));
    } catch (reason) {
      if (sequence === loadSequence.current) setMessage(`${success} لكن تعذّر تحديث العرض؛ لا تُعد تنفيذ الإجراء. استخدم تحديث القائمة. ${readError(reason)}`);
    }
  }
  async function run(action: () => Promise<unknown>, success: string, ids: string[] = [], expectsMail = false): Promise<boolean> {
    if (busyRef.current || listLoading) return false;
    busyRef.current = true; setBusy(true); setMessage('جارٍ تنفيذ العملية…');
    try {
      const result = await action() as { emailQueued?: boolean } | undefined;
      const feedback = expectsMail && result?.emailQueued === false ? `${success} تعذّر تجهيز البريد؛ راجع سجل الإرسال.` : success;
      setMessage(feedback); await refreshAffected(ids, feedback); return true;
    } catch (reason) { setMessage(readError(reason)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function submitInfo(input: { note?: string; deadline?: string; items: Array<{ type: 'FIELD' | 'ATTACHMENT'; key: string; reason: string }> }) {
    if (!infoTarget) return;
    if (busyRef.current || listLoading) return;
    busyRef.current = true; setBusy(true); setMessage('جارٍ تسجيل النواقص وإرسال البريد…');
    try {
      const result = await requestApplicationInformation(infoTarget.id, input);
      setMessage(result.emailQueued ? 'تم تسجيل النواقص وحفظ رسالة الاستكمال للإرسال.' : result.emailSent ? 'تم تسجيل النواقص وإرسال البريد إلى الجمعية.' : result.emailSent === null ? 'طلب الاستكمال محفوظ مسبقًا؛ لم تُنشأ رسالة مكررة.' : 'تم تسجيل النواقص، لكن تعذّر تجهيز البريد. راجع سجل إرسال البريد.');
      setInfoTarget(null); await refreshAffected([infoTarget.id], 'تم تسجيل طلب الاستكمال.');
    } catch (reason) { setMessage(readError(reason)); }
    finally { busyRef.current = false; setBusy(false); }
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
  async function choose(application: ApplicationSummary, decision: InternalSelectionDecision, correction = false) {
    let reason: string | undefined;
    if (correction || decision === 'DECLINED') {
      const input = window.prompt(correction ? 'سبب التصحيح الاستثنائي — يُحفظ في سجل التدقيق:' : 'سبب عدم القبول النهائي — سيُضمّن في رسالة الاعتذار:');
      if (!input?.trim()) return;
      reason = input.trim();
    }
    const label = decision === 'MAIN' ? 'اختيار الأساسية' : decision === 'RESERVE' ? 'اختيار الاحتياط' : decision === 'NONE' ? 'إلغاء الاختيار الداخلي' : 'عدم القبول النهائي وإرسال الاعتذار';
    if (!window.confirm(`تأكيد ${label} للجمعية «${application.name}»؟ ${decision === 'DECLINED' ? 'سيُرسل الاعتذار إلى الجمعية.' : 'هذا قرار داخلي؛ لن يُرسل إشعار اعتماد أو احتياط.'}${correction ? ' سيتم أيضًا معالجة الوصول والميثاق غير الموقّع المرتبطين وفق حماية الخادم، ولا يمكن سحب بريد أُرسل سابقًا.' : ''}`)) return;
    await run(() => decideApplicationSelection(application.id, decision, reason, correction || undefined), `تم ${label}.`, [application.id], decision === 'DECLINED');
  }
  async function sendMain(ids: string[]) {
    const selected = apps.filter((application) => ids.includes(application.id));
    if (!selected.length || selected.length !== ids.length || ids.length > 250) return;
    if (!window.confirm(`إرسال إشعار الاعتماد إلى ${selected.length} جمعية أساسية؟\n${selected.map((application) => `• ${application.name} (${application.publicCode})`).join('\n')}\nبعد بدء الإرسال لا يمكن التراجع بالإجراء العادي.`)) return;
    if (await run(() => commitApplicationSelection('SEND_MAIN', ids), 'تم تسجيل إرسال الاعتماد للجمعيات المحددة؛ قبول خادم البريد لا يثبت الوصول لصندوق المستلم.', ids, true)) setChecked([]);
  }
  async function startSelected(ids: string[]) {
    if (!ids.length || ids.length > 250) return;
    if (!window.confirm(`بدء مراجعة ${ids.length} طلبًا محددًا؟ هذا لا يعتمد الأهلية أو التقييم.\n${apps.filter((application) => ids.includes(application.id)).map((application) => application.name).join('\n')}`)) return;
    if (await run(() => startApplicationProcessing(ids), 'تم بدء مراجعة الطلبات المحددة دون تغيير قرار الأهلية.', ids)) setChecked([]);
  }
  async function saveEligibility(decision: EligibilityDecision, notes?: string) {
    if (!eligibilityTarget) return;
    if (busyRef.current || listLoading) return;
    busyRef.current = true; setBusy(true); setMessage('جارٍ حفظ قرار الأهلية…');
    try {
      await decideApplicationEligibility(eligibilityTarget.id, decision, notes);
      setMessage(decision === 'FAILED' ? 'تم حفظ قرار عدم الاجتياز داخليًا دون إرسال بريد للجمعية.' : decision === 'PASSED' ? 'تم اجتياز الأهلية. أكمل التقييم والاختيار في المرحلة الثانية.' : 'تم حفظ قرار الأهلية.');
      setEligibilityTarget(null); await refreshAffected([eligibilityTarget.id], 'تم حفظ قرار الأهلية.');
    } catch (reason) { setMessage(readError(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function retryRejection(application: ApplicationSummary) {
    if (busyRef.current || listLoading) return;
    if (!window.confirm(`سيُرسل إشعار عدم الاجتياز إلى جمعية «${application.name}». هل تؤكد إرسال البريد؟`)) return;
    busyRef.current = true;
    setBusy(true); setMessage('');
    try { const result = await resendApplicationRejection(application.id); setMessage(result.emailQueued ? 'حُفظ إشعار عدم الاجتياز للإرسال.' : result.emailSent ? 'تم إرسال إشعار عدم الاجتياز للجمعية.' : 'تعذّر تجهيز البريد. راجع سجل إرسال البريد.'); }
    catch (reason) { setMessage(readError(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const groups = mode === 'review' ? SELECTION_GROUPS.filter((group) => ['ACTION', 'NEW', 'RETURNED', 'PROCESSING', 'NEEDS_INFO', 'FAILED'].includes(group.key)) : mode === 'selection' ? SELECTION_GROUPS.filter((group) => ['PASSED_UNSELECTED', 'MAIN', 'RESERVE', 'DECLINED'].includes(group.key)) : SELECTION_GROUPS;
  const actionableGroups = mode === 'review' ? ['NEW', 'RETURNED', 'PROCESSING'] : ACTIONABLE_GROUPS;
  const activeFilter = groups.some((group) => group.key === filter) ? filter : groups[0]?.key ?? 'ACTION';
  const geographicApps = filterApplications(apps, geography, { search: '', projectGroup, city: '' });
  const cities = [...new Map(geographicApps.map((application) => [applicationCityKey(application), { key: applicationCityKey(application), label: `${application.city} — ${application.region}` }])).values()].sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  const filteredApps = filterApplications(apps, geography, { search, projectGroup, city });
  const visible = groupApplications(filteredApps, activeFilter, actionableGroups);
  const counts = Object.fromEntries(SELECTION_GROUPS.map((group) => [group.key, groupApplications(filteredApps, group.key, actionableGroups).length])) as Record<SelectionGroup, number>;
  const ranked = useMemo(() => apps.filter((app) => app.eligibilityStatus === 'PASSED' && app.status !== 'REJECTED' && app.evaluationScore != null).sort((a, b) => (b.evaluationScore ?? 0) - (a.evaluationScore ?? 0) || a.publicCode.localeCompare(b.publicCode, 'ar')), [apps]);
  const rankedVisible = ranked.map((application, index) => ({ application, index })).filter(({ application }) => visible.some((item) => item.id === application.id));
  const selectable = activeFilter === 'MAIN' ? visible.filter((application) => application.evaluationScore != null && (application.selectionDelivery?.status === 'NOT_REQUESTED' || application.selectionDelivery?.status === 'FAILED')) : visible.filter((application) => selectionGroup(application) === 'NEW' && application.status === 'UNDER_REVIEW');
  useEffect(() => { setChecked([]); }, [search, projectGroup, city, activeFilter, accessKey]);
  const selectedIds = checked.filter((id) => selectable.some((application) => application.id === id));
  const allSelected = !!selectable.length && selectable.every((application) => selectedIds.includes(application.id));
  function toggle(id: string, value: boolean) { setChecked((current) => value ? [...new Set([...current, id])] : current.filter((key) => key !== id)); }
  return <>
    {showHeader && <PageHeader title="الأهلية والتقييم والاختيار" subtitle="الأهلية، ثم التقييم، ثم قرار القائمة الأساسية أو الاحتياطية." />}
    {message && <p role="status" aria-live="polite" style={busy ? { color: 'var(--muted)' } : message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}
    {canRead && mode !== 'settings' && listLoading && <p role="status">جارٍ تحديث قوائم الجمعيات…</p>}
    {canSettings && (mode === 'settings' || mode === 'all') && <section style={cardStyle}><h2>موعد استقبال طلبات الجمعيات</h2><p>{intake === null ? 'جارٍ تحميل حالة التقديم…' : intake.closesAt ? `التقديم ${intake.open ? 'مفتوح' : 'مغلق'} — الموعد بتوقيت الرياض.` : 'التقديم مفتوح دون موعد إغلاق.'}</p><label style={labelStyle}>آخر موعد للتقديم — توقيت الرياض<input type="datetime-local" style={inputStyle} value={intakeTime} onChange={(event) => setIntakeTime(event.target.value)} /></label><div className="button-row"><button style={primaryButtonStyle} disabled={busy || !intakeTime} onClick={() => { const date = new Date(`${intakeTime}:00+03:00`); if (!Number.isNaN(date.getTime())) void saveIntake(date.toISOString()); }}>حفظ الموعد</button><button style={secondaryButtonStyle} disabled={busy || !intake?.closesAt} onClick={() => void saveIntake(null)}>إلغاء موعد الإغلاق</button></div><small>بعد الموعد يُرفض بدء طلب جديد وإرسال المسودات، وتبقى متابعة الطلبات السابقة متاحة.</small></section>}
    {canRead && mode !== 'settings' && <section style={{ ...cardStyle, marginBottom: 22 }}><h2>قوائم الطلبات</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
        <label style={{ ...labelStyle, flex: '1 1 260px' }}>بحث باسم الجمعية أو رقم الطلب<input style={inputStyle} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label style={{ ...labelStyle, flex: '1 1 220px' }}>مجموعة المشروع<select style={inputStyle} value={projectGroup} disabled={listLoading || !geography.length} onChange={(event) => { setProjectGroup(event.target.value); setCity(''); }}><option value="">جميع المجموعات</option>{Object.entries(PROJECT_GROUP_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label style={{ ...labelStyle, flex: '1 1 220px' }}>المدينة / المحافظة<select style={inputStyle} value={city} disabled={listLoading} onChange={(event) => setCity(event.target.value)}><option value="">جميع المدن والمحافظات</option>{cities.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <button type="button" style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => { if (!busyRef.current && !listLoading) void load(); }}>تحديث القائمة</button>
      </div>{geographyError && <p role="alert" style={errorStyle}>تعذّر تحميل مرجع المناطق؛ البحث وجميع الطلبات ما زالا متاحين. {geographyError}</p>}
      <p role="status">{PROJECT_GROUP_LABELS[projectGroup] || 'جميع المجموعات'} — {SELECTION_GROUPS.find((group) => group.key === activeFilter)?.label}: {listLoading ? 'جارٍ حساب الطلبات…' : `${visible.length} طلبًا`}</p>
      <div className="button-row" role="group" aria-label="قوائم الأهلية والاختيار">{groups.map((group) => <button key={group.key} type="button" style={activeFilter === group.key ? primaryButtonStyle : secondaryButtonStyle} aria-pressed={activeFilter === group.key} disabled={busy} onClick={() => setFilter(group.key)}>{group.label} ({counts[group.key]})</button>)}</div>
      {selectable.length > 0 && ((canReview && mode !== 'selection') || (canSelect && activeFilter === 'MAIN')) && <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <label className="check-row"><input type="checkbox" checked={allSelected} disabled={busy || listLoading} onChange={(event) => setChecked(event.target.checked ? selectable.map((application) => application.id) : [])} />تحديد النتائج المتاحة الظاهرة ({selectable.length})</label>
        {activeFilter === 'MAIN' ? <button style={primaryButtonStyle} disabled={busy || listLoading || !selectedIds.length || selectedIds.length > 250} onClick={() => void sendMain(selectedIds)}>إرسال الاعتماد للمحدد ({selectedIds.length})</button> : <button style={primaryButtonStyle} disabled={busy || listLoading || !selectedIds.length || selectedIds.length > 250} onClick={() => void startSelected(selectedIds)}>بدء مراجعة المحدد ({selectedIds.length})</button>}
        {selectedIds.length > 250 && <p role="alert" style={errorStyle}>الحد الأقصى للعملية الواحدة 250 طلبًا؛ قلل المحددات. لن تُقتطع القائمة تلقائيًا.</p>}
      </div>}
    </section>}
    {canRead && mode !== 'settings' && <section style={{ ...cardStyle, marginBottom: 22 }}>
      <h2>{SELECTION_GROUPS.find((group) => group.key === activeFilter)?.label}</h2>
      {visible.length === 0 ? <p>لا توجد طلبات في هذه القائمة.</p> : visible.map((application) => {
        const group = selectionGroup(application);
        const reviewable = group !== 'NEW' && application.status === 'UNDER_REVIEW';
        return <article key={application.id} className="workflow-row">
          <div>{selectable.some((item) => item.id === application.id) && ((canReview && mode !== 'selection') || (canSelect && activeFilter === 'MAIN')) && <input type="checkbox" aria-label={`تحديد ${application.name}`} checked={selectedIds.includes(application.id)} disabled={busy || listLoading} onChange={(event) => toggle(application.id, event.target.checked)} />} <strong>{application.name}</strong><p>{application.publicCode} · {application.city} · الأهلية: {ELIGIBILITY_LABELS[application.eligibilityStatus]} · الاختيار: {selectionLabel(application.selectionList)}</p>{group === 'RETURNED' && <p role="status" style={successStyle}>ورد استكمال من الجمعية. راجع البنود والمرفقات قبل القرار.</p>}</div>
          <div className="button-row">
            {group === 'RETURNED' && <button style={primaryButtonStyle} onClick={() => setDetailTarget(application)}>مراجعة الاستكمال</button>}
            {canReview && group === 'NEW' && <button style={primaryButtonStyle} disabled={busy || listLoading} onClick={() => void run(() => startApplicationProcessing([application.id]), 'بدأت مراجعة الطلب.', [application.id])}>بدء المراجعة</button>}
            {canReview && reviewable && !['FAILED', 'NEEDS_INFO'].includes(application.eligibilityStatus) && <button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => setEligibilityTarget(application)}>الأهلية والأدلة</button>}
            {canReview && reviewable && application.schemaVersion === 2 && !['FAILED', 'NEEDS_INFO'].includes(application.eligibilityStatus) && <button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => setInfoTarget(application)}>طلب استكمال وإرسال بريد</button>}
            {canReview && application.eligibilityStatus === 'NEEDS_INFO' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void run(() => resendApplicationInformation(application.id), 'حُفظ بريد الاستكمال للإرسال.', [application.id], true)}>إعادة إرسال البريد</button>}
            {canReview && application.eligibilityStatus === 'FAILED' && <button style={secondaryButtonStyle} disabled={busy} onClick={() => void retryRejection(application)}>إرسال إشعار عدم الاجتياز</button>}
            {canEvaluate && application.eligibilityStatus === 'PASSED' && application.status !== 'REJECTED' && application.selectionList === 'NONE' && <button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => setEvaluationTarget(application)}>التقييم 1–5</button>}
            {application.evaluationScore != null && <span className="status-pill">{application.evaluationScore}/100</span>}
          </div>
        </article>;
      })}
    </section>}
    {canRead && (mode === 'selection' || mode === 'all') && <section style={cardStyle}><h2>الترتيب وقرار الاختيار النهائي</h2><p>اختيار الأساسية أو الاحتياط قرار داخلي بلا بريد. راجع القائمة، ثم حدّد الأساسية واضغط «إرسال الاعتماد للمحدد». إلغاء الاختيار لا يعني عدم القبول النهائي؛ إرسال الاعتذار إجراء مستقل. التصحيح الاستثنائي للمالك فقط وقبل أي توقيع.</p>{rankedVisible.length === 0 ? <p>لا توجد طلبات مكتملة التقييم في القسم والفلاتر المحددة.</p> : rankedVisible.map(({ application, index }) => <article key={application.id} className="workflow-row"><div><strong>{index + 1}. {application.name}</strong><p>{application.publicCode} · {application.evaluationScore}/100 · {selectionLabel(application.selectionList)} · {financialLabel(application.financialPriority)}</p><p role="status">إشعار الاعتماد: {deliveryLabel(application.selectionDelivery?.status)}</p></div><div className="button-row" style={{ gap: 12 }}><button style={secondaryButtonStyle} onClick={() => setDetailTarget(application)}>عرض ملف الجمعية والمرفقات</button>
      {canSelect && application.selectionEditable === true && <>
        {application.selectionList !== 'MAIN' && <button style={primaryButtonStyle} disabled={busy || listLoading} onClick={() => void choose(application, 'MAIN')}>{application.selectionList === 'RESERVE' ? 'نقل إلى الأساسية' : 'اختيار أساسية'}</button>}
        {application.selectionList !== 'RESERVE' && <button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => void choose(application, 'RESERVE')}>{application.selectionList === 'MAIN' ? 'نقل إلى الاحتياط' : 'اختيار احتياط'}</button>}
        {application.selectionList !== 'NONE' && <button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => void choose(application, 'NONE')}>إلغاء الاختيار الداخلي</button>}
      </>}
      {canSelect && application.selectionList === 'RESERVE' && application.selectionEditable === true && <button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => void choose(application, 'DECLINED')}>عدم قبول نهائي وإرسال اعتذار</button>}
      {canSelect && application.selectionList === 'MAIN' && application.selectionDelivery?.status === 'FAILED' && <button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => void run(() => resendApplicationSelection(application.id), 'تم تسجيل إعادة محاولة إشعار الأساسية.', [application.id], true)}>إعادة محاولة الإرسال</button>}
      {isAdminOwner(user) && application.ownerCanCorrect === true && application.selectionEditable !== true && <><button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => void choose(application, 'RESERVE', true)}>تصحيح استثنائي إلى الاحتياط</button><button style={secondaryButtonStyle} disabled={busy || listLoading} onClick={() => void choose(application, 'NONE', true)}>إلغاء اختيار استثنائي</button></>}
      {application.selectionEditable === false && application.ownerCanCorrect === false && <small>القرار محمي؛ لا يتيح هذا الإجراء إلغاء ميثاق موقّع.</small>}
    </div></article>)}</section>}
    {eligibilityTarget && <EligibilityDialog application={eligibilityTarget} busy={busy || listLoading} message={message} onClose={() => setEligibilityTarget(null)} onSubmit={saveEligibility} />}
    {evaluationTarget && <EvaluationDialog application={evaluationTarget} hidden={!!detailTarget} onOpenFile={() => setDetailTarget(evaluationTarget)} busy={busy || listLoading} message={message} onClose={() => setEvaluationTarget(null)} onSubmit={async (scores) => { if (await run(() => evaluateApplication(evaluationTarget.id, scores), 'تم حفظ التقييم الموزون.', [evaluationTarget.id])) setEvaluationTarget(null); }} />}
    {infoTarget && <InformationDialog application={infoTarget} busy={busy || listLoading} message={message} onClose={() => setInfoTarget(null)} onSubmit={submitInfo} />}
    {detailTarget && <ApplicationDetail user={user} application={detailTarget} showNextStep={false} closeLabel={evaluationTarget ? 'العودة للتقييم' : 'إغلاق'} onClose={() => setDetailTarget(null)} />}
  </>;
}

function EligibilityDialog({ application, busy, message, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; message: string; onClose: () => void; onSubmit: (decision: EligibilityDecision, notes?: string) => Promise<void> }) {
  const [decision, setDecision] = useState<EligibilityDecision>(application.eligibilityStatus === 'PENDING' ? 'PASSED' : application.eligibilityStatus); const [notes, setNotes] = useState(application.eligibilityNotes ?? ''); const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null); const [error, setError] = useState('');
  useEffect(() => { getApplicationEligibilityEvidence(application.id).then(setEvidence).catch((reason) => setError(readError(reason))); }, [application.id]); const checks = Array.isArray(evidence?.checks) ? evidence.checks as Array<{ key: string; label: string; result: string; detail: string }> : [];
  return <Dialog title={`الأهلية والأدلة — ${application.name}`} onClose={onClose}>{message && !message.startsWith('تم') && <p role="alert" style={errorStyle}>{message}</p>}<h3>الأدلة الآلية</h3>{error && <p style={errorStyle}>{error}</p>}{!evidence && !error ? <p>جارٍ تحميل الأدلة…</p> : checks.length ? <ul>{checks.map((check) => <li key={check.key}><strong>{check.label}:</strong> {check.result === 'PASS' ? 'مستوفى' : check.result === 'FAIL' ? 'غير مستوفى' : 'يتطلب مراجعة'}{check.detail ? ` — ${check.detail}` : ''}</li>)}</ul> : <p>{String(evidence?.summary ?? 'تتطلب البيانات مراجعة بشرية.')}</p>}<p>للاستكمال استخدم زر «طلب استكمال وإرسال بريد» في قائمة الطلبات.</p><label style={labelStyle}>القرار<select style={inputStyle} value={decision} onChange={(e) => setDecision(e.target.value as EligibilityDecision)}><option value="PASSED">مجتاز</option><option value="FAILED">غير مجتاز</option>{decision === 'NEEDS_INFO' && <option value="NEEDS_INFO" disabled>بانتظار الاستكمال</option>}</select></label><label style={labelStyle}>الملاحظات {decision === 'PASSED' ? '(اختيارية)' : '(إلزامية)'}<textarea style={{ ...inputStyle, minHeight: 90 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label><div className="button-row"><button style={primaryButtonStyle} disabled={busy || decision === 'NEEDS_INFO' || (decision !== 'PASSED' && !notes.trim())} onClick={() => void onSubmit(decision, notes.trim() || undefined)}>حفظ القرار</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div></Dialog>;
}

function EvaluationDialog({ application, busy, message, hidden, onOpenFile, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; message: string; hidden: boolean; onOpenFile: () => void; onClose: () => void; onSubmit: (scores: Scores) => Promise<void> }) {
  const [scores, setScores] = useState<Scores>(() => ({ ...EMPTY_SCORES, ...(application.evaluationBreakdown?.raw as Partial<Scores> | undefined) })); const [reviewed, setReviewed] = useState(false); const [missingReview, setMissingReview] = useState(false); const total = useMemo(() => CRITERIA.reduce((sum, criterion) => sum + scores[criterion.key] / 5 * criterion.weight, 0), [scores]);
  return <Dialog title={`التقييم الموزون — ${application.name}`} onClose={onClose} hidden={hidden} busy={busy}>{message && !message.startsWith('تم') && <p role="alert" style={errorStyle}>{message}</p>}<p>اقرأ بيانات الطلب تحت كل محور، ثم قيّمه من 1 إلى 5. الأوزان ثابتة.</p><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onOpenFile}>عرض ملف الجمعية الكامل والمرفقات</button>{CRITERIA.map((criterion) => <section key={criterion.key} style={{ ...cardStyle, marginBlock: 12 }}><h3 style={{ marginTop: 0 }}>{criterion.label} — الوزن {criterion.weight}%</h3><EvidenceFacts application={application} axis={criterion.key} /><label style={labelStyle}>درجة {criterion.label}<select style={inputStyle} value={scores[criterion.key]} onChange={(e) => setScores((old) => ({ ...old, [criterion.key]: Number(e.target.value) }))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} من 5</option>)}</select></label><small>النقاط: {(scores[criterion.key] / 5 * criterion.weight).toFixed(2)}</small></section>)}<div className="selection-total"><strong>المجموع</strong><span>{total.toFixed(2)} / 100</span></div><label className="check-row"><input type="checkbox" checked={reviewed} onChange={(e) => { setReviewed(e.target.checked); if (e.target.checked) setMissingReview(false); }} />راجعت الدرجات والأدلة قبل الإرسال.</label>{missingReview && <p role="alert" style={errorStyle}>ضع علامة «راجعت الدرجات والأدلة» قبل حفظ التقييم.</p>}<div className="button-row" style={{ gap: 20, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}><button style={primaryButtonStyle} disabled={busy} onClick={() => { if (!reviewed) { setMissingReview(true); return; } void onSubmit(scores); }}>{busy ? 'جارٍ حفظ التقييم…' : 'حفظ التقييم'}</button><button style={secondaryButtonStyle} disabled={busy} onClick={onClose}>إلغاء</button></div></Dialog>;
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

function Dialog({ title, onClose, children, hidden = false, busy = false }: { title: string; onClose: () => void; children: React.ReactNode; hidden?: boolean; busy?: boolean }) { return <div style={{ ...modalOverlayStyle, display: hidden ? 'none' : modalOverlayStyle.display }} role="dialog" aria-modal="true"><div style={{ ...modalStyle, maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 20, marginBottom: 18 }}><h2 style={{ margin: 0 }}>{title}</h2><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onClose}>إغلاق</button></div>{children}</div></div>; }
function deliveryLabel(status: NonNullable<ApplicationSummary['selectionDelivery']>['status'] | undefined) { return ({ NOT_REQUESTED: 'لم يُطلب الإرسال', PENDING: 'بانتظار الإرسال', ACCEPTED: 'قبله خادم البريد — لا يثبت الوصول', FAILED: 'تعذّر الإرسال', UNKNOWN: 'نتيجة الإرسال غير محسومة؛ لا تعِد الإرسال قبل التحقق' })[status ?? 'NOT_REQUESTED']; }
function selectionLabel(value: ApplicationSummary['selectionList']) { return ({ NONE: 'لم يُحدد', MAIN: 'القائمة الأساسية', RESERVE: 'قائمة الاحتياط' })[value]; }
function financialLabel(value: ApplicationSummary['financialPriority']) { return value === 'HIGHER_CAPACITY_LOWER_AID_PRIORITY' ? 'قدرة مالية أعلى / أولوية دعم أقل وفق مؤشر 10 ملايين' : value === 'STANDARD_PRIORITY_REVIEW' ? 'أولوية مالية للمراجعة' : 'المؤشر المالي غير مكتمل'; }
function readError(reason: unknown) { return reason instanceof Error ? reason.message : 'تعذّر تنفيذ العملية.'; }
