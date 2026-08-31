'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { PageHeader } from '../../components/PageHeader';
import { useRoleGuard } from '../../lib/use-role-guard';
import {
  apiFetch, commitApplicationSelection, decideApplicationEligibility, evaluateApplication,
  listSystemSettings, previewApplicationSelection, saveSystemSetting,
  type ApplicationSummary, type Paginated, type WorkflowRecord,
} from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, modalOverlayStyle, modalStyle, primaryButtonStyle, secondaryButtonStyle, successStyle } from '../../lib/ui';

type EligibilityDecision = 'PASSED' | 'FAILED' | 'NEEDS_INFO';
type Scores = {
  operationalReadiness: number; technicalCapability: number; previousExperience: number;
  integrityTransparency: number; participationCommitment: number; sustainabilityImpact: number;
};
const CRITERIA: Array<{ key: keyof Scores; label: string; weight: number }> = [
  { key: 'operationalReadiness', label: 'الجاهزية التشغيلية', weight: 30 },
  { key: 'technicalCapability', label: 'القدرة التقنية', weight: 20 },
  { key: 'previousExperience', label: 'الخبرة السابقة', weight: 20 },
  { key: 'integrityTransparency', label: 'النزاهة والشفافية', weight: 15 },
  { key: 'participationCommitment', label: 'الالتزام بالمشاركة', weight: 10 },
  { key: 'sustainabilityImpact', label: 'الاستدامة والأثر', weight: 5 },
];
const EMPTY_SCORES: Scores = { operationalReadiness: 0, technicalCapability: 0, previousExperience: 0, integrityTransparency: 0, participationCommitment: 0, sustainabilityImpact: 0 };
const ELIGIBILITY_LABELS: Record<ApplicationSummary['eligibilityStatus'], string> = { PENDING: 'بانتظار القرار', PASSED: 'مجتاز', FAILED: 'غير مجتاز', NEEDS_INFO: 'يحتاج معلومات' };

export default function SelectionPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [preview, setPreview] = useState<WorkflowRecord[]>([]);
  const [threshold, setThreshold] = useState('');
  const [mainTarget, setMainTarget] = useState('');
  const [eligibilityTarget, setEligibilityTarget] = useState<ApplicationSummary | null>(null);
  const [evaluationTarget, setEvaluationTarget] = useState<ApplicationSummary | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [result, settingsBody] = await Promise.all([
        apiFetch<Paginated<ApplicationSummary>>('/association-applications?page=1&pageSize=100'),
        listSystemSettings() as Promise<{ items?: Array<{ key: string; value: unknown }> }>,
      ]);
      setApps(result.items);
      const settings = settingsBody.items ?? [];
      const pass = settings.find((item) => item.key === 'selection.passThreshold')?.value;
      const target = settings.find((item) => item.key === 'selection.mainTargetCount')?.value;
      setThreshold(typeof pass === 'number' ? String(pass) : '');
      setMainTarget(typeof target === 'number' ? String(target) : '');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تحميل شاشة الاختيار'); }
  }, []);
  useEffect(() => { if (user) void load(); }, [user, load]);

  async function run(action: () => Promise<unknown>, success = 'تم حفظ القرار.') {
    setBusy(true); setMessage('');
    try { await action(); setMessage(success); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر التنفيذ'); }
    finally { setBusy(false); }
  }

  if (loading || !user) return null;
  const configured = threshold !== '' && mainTarget !== '';
  return <AppShell user={user}>
    <PageHeader title="الأهلية والتقييم والاختيار" subtitle="مسار منفصل وواضح من قرار الأهلية حتى اعتماد قائمتي MAIN وRESERVE." />
    {message && <p role="status" style={message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}

    <section style={cardStyle}>
      <h2>إعدادات قرار الاختيار</h2>
      <p>لا توجد قيم افتراضية مخفية. يجب اعتماد القيم هنا قبل اعتماد القائمة النهائية.</p>
      <div className="form-grid">
        <label style={labelStyle}>حد الاجتياز من 100<input style={inputStyle} type="number" min="0" max="100" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
        <label style={labelStyle}>السعة المعتمدة لقائمة MAIN<input style={inputStyle} type="number" min="1" value={mainTarget} onChange={(event) => setMainTarget(event.target.value)} /></label>
      </div>
      <button style={primaryButtonStyle} disabled={busy || threshold === '' || mainTarget === ''} onClick={() => run(async () => {
        await saveSystemSetting('selection.passThreshold', Number(threshold));
        await saveSystemSetting('selection.mainTargetCount', Number(mainTarget));
      }, 'تم حفظ إعدادات الاختيار المعتمدة.')}>حفظ الإعدادات</button>
    </section>

    <section style={cardStyle}>
      <h2>طلبات الجمعيات</h2>
      {apps.length === 0 ? <p>لا توجد طلبات حالية.</p> : apps.map((application) => <article key={application.id} className="workflow-row">
        <div><strong>{application.name}</strong><p>{application.publicCode} · {application.city} · الأهلية: {ELIGIBILITY_LABELS[application.eligibilityStatus]}</p></div>
        <div className="button-row">
          <button style={secondaryButtonStyle} onClick={() => setEligibilityTarget(application)}>قرار الأهلية</button>
          <button style={secondaryButtonStyle} disabled={application.eligibilityStatus !== 'PASSED'} onClick={() => setEvaluationTarget(application)}>نموذج التقييم</button>
          {application.evaluationScore != null && <span className="status-pill">النتيجة {application.evaluationScore}/100</span>}
        </div>
      </article>)}
    </section>

    <section style={cardStyle}>
      <h2>القائمة النهائية</h2>
      {!configured && <p style={errorStyle}>BUSINESS CONFIG REQUIRED: اضبط حد الاجتياز وسعة MAIN أولًا.</p>}
      <button style={secondaryButtonStyle} disabled={!configured || busy} onClick={() => run(async () => { const result = await previewApplicationSelection(); setPreview(result.items); }, 'تم تحديث معاينة الترتيب.')}>معاينة الترتيب</button>
      {preview.map((row) => <p key={row.id}>{String(row.rank)}. {String(row.name)} — {String(row.score)}/100 — {row.passesThreshold ? 'مجتاز' : 'دون الحد'}</p>)}
      <button style={primaryButtonStyle} disabled={!configured || busy} onClick={() => run(() => commitApplicationSelection(Number(mainTarget)), 'تم اعتماد قائمتي MAIN وRESERVE.')}>اعتماد القائمة النهائية</button>
    </section>

    {eligibilityTarget && <EligibilityDialog application={eligibilityTarget} busy={busy} onClose={() => setEligibilityTarget(null)} onSubmit={(decision, notes) => run(() => decideApplicationEligibility(eligibilityTarget.id, decision, notes), 'تم حفظ قرار الأهلية.').then(() => setEligibilityTarget(null))} />}
    {evaluationTarget && <EvaluationDialog application={evaluationTarget} busy={busy} onClose={() => setEvaluationTarget(null)} onSubmit={(scores) => run(() => evaluateApplication(evaluationTarget.id, scores), 'تم حفظ التقييم الموزون.').then(() => setEvaluationTarget(null))} />}
  </AppShell>;
}

function EligibilityDialog({ application, busy, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; onClose: () => void; onSubmit: (decision: EligibilityDecision, notes?: string) => Promise<void> }) {
  const [decision, setDecision] = useState<EligibilityDecision>(application.eligibilityStatus === 'PENDING' ? 'PASSED' : application.eligibilityStatus);
  const [notes, setNotes] = useState(application.eligibilityNotes ?? '');
  const requiresNotes = decision !== 'PASSED';
  return <div style={modalOverlayStyle} role="dialog" aria-modal="true"><div style={{ ...modalStyle, maxWidth: 520 }}>
    <h2>قرار أهلية — {application.name}</h2>
    <label style={labelStyle}>القرار<select style={inputStyle} value={decision} onChange={(event) => setDecision(event.target.value as EligibilityDecision)}><option value="PASSED">مجتاز</option><option value="FAILED">غير مجتاز</option><option value="NEEDS_INFO">يحتاج معلومات إضافية</option></select></label>
    <label style={labelStyle}>الملاحظات {requiresNotes ? '(إلزامية)' : '(اختيارية)'}<textarea style={{ ...inputStyle, minHeight: 100 }} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="button-row"><button style={primaryButtonStyle} disabled={busy || (requiresNotes && !notes.trim())} onClick={() => onSubmit(decision, notes.trim() || undefined)}>حفظ القرار</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div>
  </div></div>;
}

function EvaluationDialog({ application, busy, onClose, onSubmit }: { application: ApplicationSummary; busy: boolean; onClose: () => void; onSubmit: (scores: Scores) => Promise<void> }) {
  const [scores, setScores] = useState<Scores>(EMPTY_SCORES);
  const [reviewed, setReviewed] = useState(false);
  const total = useMemo(() => CRITERIA.reduce((sum, criterion) => sum + scores[criterion.key] * criterion.weight / 100, 0), [scores]);
  return <div style={modalOverlayStyle} role="dialog" aria-modal="true"><div style={{ ...modalStyle, maxWidth: 720, maxHeight: '90vh', overflow: 'auto' }}>
    <h2>التقييم الموزون — {application.name}</h2>
    <p>أدخل درجة كل معيار من 0 إلى 100. يُحتسب المجموع من المعايير الستة والأوزان المعتمدة أدناه فقط.</p>
    {CRITERIA.map((criterion) => <label key={criterion.key} style={labelStyle}>{criterion.label} — الوزن {criterion.weight}%<input style={inputStyle} type="number" min="0" max="100" value={scores[criterion.key]} onChange={(event) => setScores((current) => ({ ...current, [criterion.key]: Math.max(0, Math.min(100, Number(event.target.value))) }))} /><span>النقاط: {(scores[criterion.key] * criterion.weight / 100).toFixed(2)}</span></label>)}
    <div className="selection-total"><strong>المجموع المباشر</strong><span>{total.toFixed(2)} / 100</span></div>
    <label className="check-row"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />راجعت جميع الدرجات والمجموع قبل الإرسال.</label>
    <div className="button-row"><button style={primaryButtonStyle} disabled={busy || !reviewed} onClick={() => onSubmit(scores)}>حفظ التقييم</button><button style={secondaryButtonStyle} onClick={onClose}>إلغاء</button></div>
  </div></div>;
}
