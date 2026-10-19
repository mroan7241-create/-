'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch, ACTIVITY_STATUS_LABELS, type Activity } from '../../lib/api';
import { ErrorState, LoadingState } from '../../components/States';
import { reportValueLabel } from '../../lib/report-labels';
import { activityOverview, groupActivities, matchesSearch, safeEvidenceUrl } from '../portal-model';

export default function ActivitiesPage() { return <Suspense fallback={<LoadingState />}><Activities /></Suspense>; }
function Activities() {
  const params = useSearchParams();
  const [rows, setRows] = useState<Activity[] | null>(null); const [error, setError] = useState('');
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(params.get('status') ?? '');
  const [evidence, setEvidence] = useState<{ id?: string; url?: string; error?: string }>({});
  useEffect(() => { const controller = new AbortController(); apiFetch<Activity[]>('/reports/abanmi/activities', { signal: controller.signal }).then(setRows).catch(() => { if (!controller.signal.aborted) setError('تعذّر تحميل الأنشطة.'); }); return () => controller.abort(); }, []);
  const groups = useMemo(() => groupActivities(rows ?? []), [rows]);
  const overview = activityOverview(rows ?? []);
  const visible = groups.filter(g => matchesSearch(search, g.phase, g.name, ...g.rows.map(r => r.subActivityName ?? '')) && (!status || g.rows.some(r => status === 'current' ? ['IN_PROGRESS', 'LATE'].includes(r.status) : status === r.status)));
  async function openEvidence(id: string) { setEvidence({ id }); try { const result = await apiFetch<{ url: string }>(`/reports/abanmi/activity-evidence/${id}`); const url = safeEvidenceUrl(result.url); if (!url) throw new Error('Unsafe URL'); setEvidence({ id, url }); } catch { setEvidence({ error: 'تعذّر تجهيز رابط الشاهد.' }); } }
  return <><Link className="ab-back" href="/abanmi">← لوحة المشروع</Link><div className="ab-heading"><div><span className="ab-eyebrow">متابعة المشروع</span><h1>الأنشطة، خطوة بخطوة</h1><p>افتح النشاط الرئيسي للاطلاع على الفرعيات والشواهد.</p></div></div>
    {error && <ErrorState message={error} />}{!rows && !error && <LoadingState />}
    {rows && <><div className="ab-activity-snapshot"><article><h2>نشاط مكتمل</h2><p>{overview.completed.at(-1)?.subActivityName ?? overview.completed.at(-1)?.mainActivityName ?? 'لم يُسجّل نشاط مكتمل'}</p></article><article><h2>الجاري الآن ({overview.current.length})</h2><p>{overview.current[0]?.subActivityName ?? overview.current[0]?.mainActivityName ?? 'لا نشاط جارٍ مسجل'}</p></article><article><h2>التالي بحسب البداية المخططة</h2><p>{overview.upcoming[0]?.subActivityName ?? overview.upcoming[0]?.mainActivityName ?? 'لا نشاط قادم مسجل'}</p></article></div>
      <div className="ab-filters"><label>بحث في الأنشطة<input value={search} onChange={e => setSearch(e.target.value)} placeholder="اسم النشاط أو المرحلة" /></label><label>الحالة<select value={status} onChange={e => setStatus(e.target.value)}><option value="">جميع الحالات</option><option value="current">الجاري والمتأخر</option>{Object.entries(ACTIVITY_STATUS_LABELS).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select></label><span>{visible.length} نشاطًا رئيسيًا</span></div>
      {!rows.length && <p className="ab-empty">لم تُسجّل أنشطة بعد.</p>}{rows.length > 0 && !visible.length && <p className="ab-empty">لا توجد أنشطة تطابق البحث.</p>}
      {visible.map(group => { const main = group.rows.find(r => !r.subActivityName); const progress = main ? Number(main.completionPercent) : null; return <details className="ab-activity" key={group.key}><summary><div><small>{group.phase}</small><h2>{group.name}</h2><small>{group.rows.filter(r => r.subActivityName).length} أنشطة فرعية · اضغط للتفاصيل</small></div><div>{main && <span className="ab-badge">{ACTIVITY_STATUS_LABELS[main.status] ?? main.status}</span>}{progress !== null && <strong> {progress}٪</strong>}</div></summary><div className="ab-activity-children">{!main && <p className="ab-note">لا توجد نسبة مستقلة مسجلة للنشاط الرئيسي؛ تظهر نسب الفرعيات دون اختراع متوسط لها.</p>}{group.rows.map(row => { const href = safeEvidenceUrl(row.evidenceUrl); return <article className="ab-activity-row" key={row.id}><h3>{row.subActivityName ?? 'متابعة النشاط الرئيسي'}</h3><footer><span className="ab-badge">{ACTIVITY_STATUS_LABELS[row.status] ?? row.status}</span><strong>{Number(row.completionPercent)}٪</strong><span>البداية: {formatDate(row.startDate)}</span><span>النهاية: {formatDate(row.endDate)}</span></footer><div className="ab-progress" role="progressbar" aria-label={row.subActivityName ?? row.mainActivityName} aria-valuenow={Number(row.completionPercent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, Number(row.completionPercent)))}%` }} /></div><footer>{href && <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">فتح شاهد النشاط ↗</a>}{row.evidence?.map(item => <button key={item.id} onClick={() => void openEvidence(item.id)} disabled={evidence.id === item.id && !evidence.url}>شاهد مرفق · {reportValueLabel(item.approvalStatus)}</button>)}{!href && !row.evidence?.length && <small>لا شاهد متاح</small>}</footer></article>; })}</div></details>; })}
      {evidence.error && <ErrorState message={evidence.error} />}{evidence.url && <div className="ab-note"><a href={evidence.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">فتح ملف الشاهد — رابط مؤقت لخمس دقائق ↗</a> <button onClick={() => setEvidence({})}>إخفاء الرابط</button></div>}
    </>}
  </>;
}
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString('ar-SA', { timeZone: 'Asia/Riyadh' }) : 'غير محدد'; }
