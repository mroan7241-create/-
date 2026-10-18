'use client';

import { useEffect, useRef } from 'react';
import type { ApplicationSummary } from '../../lib/api';
import { cardStyle, modalOverlayStyle, modalStyle, secondaryButtonStyle } from '../../lib/ui';
import { savedEvaluationRows } from './file-filters';
import { eligibilityLabel } from './application-detail';

type Check = { key?: string; label?: string; result?: string; detail?: string; reason?: string };
function CheckList({ value }: { value: Record<string, unknown> | null }) {
  const checks = Array.isArray(value?.checks) ? value.checks.filter(check => check && typeof check === 'object' && !Array.isArray(check)) as Check[] : [];
  return checks.length ? <ul>{checks.map((check, index) => <li key={check.key ?? index}><strong>{check.label ?? 'بند'}:</strong> {check.result === 'PASS' ? 'مستوفى' : check.result === 'FAIL' ? 'غير مستوفى' : 'يتطلب مراجعة'}{check.detail || check.reason ? ` — ${check.detail || check.reason}` : ''}</li>)}</ul> : <p>{typeof value?.summary === 'string' ? value.summary : 'غير مسجل'}</p>;
}

export function SavedReviewDialog({ application, kind, evidence, criteria, onClose }: {
  application: ApplicationSummary; kind: 'eligibility' | 'evaluation'; evidence: Record<string, unknown> | null;
  criteria: readonly { key: string; label: string; weight: number }[]; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') { event.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [onClose]);
  const axes = application.evaluationEvidence?.axes as Record<string, { evidence?: Array<{ label: string; value: unknown }> }> | undefined;
  return <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-labelledby="saved-review-title"><div ref={panel} style={{ ...modalStyle, width: 'min(760px, 100%)', maxHeight: '90vh', overflow: 'auto', overflowWrap: 'anywhere' }}>
    <div className="button-row" style={{ justifyContent: 'space-between' }}><h2 id="saved-review-title">{kind === 'eligibility' ? 'عرض الأهلية والأدلة' : 'عرض التقييم الموزون'} — {application.name}</h2><button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق</button></div>
    <p>{application.publicCode} · عرض فقط</p>
    {kind === 'eligibility' ? <>
      <h3>قرار الأهلية المحفوظ: {eligibilityLabel(application.eligibilityStatus)}</h3>
      <h3>مبررات القرار / الملاحظات المحفوظة</h3><p style={{ whiteSpace: 'pre-wrap' }}>{application.eligibilityNotes || 'غير مسجل'}</p>
      <h3>الأدلة المسجلة وقت القرار</h3><CheckList value={application.eligibilityEvidence} />
      <h3>المؤشرات الآلية الحالية</h3><p>للاطلاع فقط؛ ليست بديلًا عن القرار المحفوظ أو مبرراته.</p><CheckList value={evidence} />
    </> : <>
      {savedEvaluationRows(application, criteria).map(row => { const recorded = axes?.[row.key]?.evidence; const facts = Array.isArray(recorded) ? recorded.filter(fact => fact && typeof fact.label === 'string') : []; return <section key={row.key} style={{ ...cardStyle, marginBlock: 12 }}>
        <h3>{row.label} — الوزن {row.weight}%</h3><p><strong>الدرجة المحفوظة: {row.score == null ? 'غير مسجل' : `${row.score} من 5`}</strong></p><p>المساهمة المحفوظة: {row.points == null ? 'غير مسجل' : row.points.toFixed(2)}</p>
        <h4>الأدلة المسجلة وقت التقييم</h4>{facts.length ? <dl>{facts.map((fact, index) => <div key={index}><dt>{fact.label}</dt><dd>{typeof fact.value === 'boolean' ? fact.value ? 'نعم' : 'لا' : ['string','number'].includes(typeof fact.value) ? String(fact.value) : 'غير مسجل'}</dd></div>)}</dl> : <p>غير مسجل</p>}
      </section>; })}
      <p><strong>المجموع المحفوظ: {application.evaluationScore == null ? 'غير مسجل' : `${application.evaluationScore}/100`}</strong></p>
      {typeof application.evaluationBreakdown?.overrideReason === 'string' && application.evaluationBreakdown.overrideReason && <p>ملاحظة التقييم المحفوظة: {application.evaluationBreakdown.overrideReason}</p>}
    </>}
  </div></div>;
}
