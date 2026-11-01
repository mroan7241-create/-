"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceOverview } from "../../lib/beneficiary-workspace";
import s from "./workspace.module.css";

export function WorkspaceSelector({ overview, associationId, onChoose, loading }: {
  overview: WorkspaceOverview | null; associationId: string;
  onChoose: (id: string) => void; loading: boolean;
}) {
  const [mode, setMode] = useState<"associations" | "intake" | null>(null),
    [search, setSearch] = useState(""), [status, setStatus] = useState("ALL");
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const intake = overview?.intake;
  const chosen = overview?.associations.find(a => a.id === associationId)?.name
    ?? intake?.associations.find(a => a.id === associationId)?.name;
  useEffect(() => {
    const el = dialog.current;
    if (mode && el && !el.open) el.showModal();
    if (!mode && el?.open) el.close();
  }, [mode]);
  function choose(id: string) { onChoose(id); setMode(null); }
  function show(next: "associations" | "intake") { setSearch(""); setStatus("ALL"); setMode(next); }
  return <>
    <button className={`${s.secondary} ${s.associationTriggerV2}`} onClick={() => show("associations")} aria-haspopup="dialog"><strong>{chosen ?? (associationId ? "الجمعية المحددة" : "جميع الجمعيات")}</strong><span aria-hidden="true">⌄</span></button>
    <button className={`${s.secondary} ${s.intakeTriggerV2}`} onClick={() => show("intake")} aria-haspopup="dialog"><span>متابعة الرفع</span><strong><bdi dir="ltr">{intake ? `${intake.started} / ${intake.total}` : "—"}</bdi></strong><span aria-hidden="true">⌄</span></button>
    <dialog ref={dialog} className={s.pickerDialogV2} aria-labelledby={titleId} onCancel={() => setMode(null)} onClose={() => setMode(null)}>
      <header className={s.pickerHeaderV2}><div><h2 id={titleId}>{mode === "intake" ? "متابعة رفع الجمعيات" : "اختيار الجمعية"}</h2><p className={s.help}>{mode === "intake" ? "الأعداد الفعلية ضمن المنطقة المختارة، مستقلة عن فرز الأسر." : "اختر الجمعية لبدء مراجعة أسرها واحتياجاتها."}</p></div><button className={s.close} onClick={() => setMode(null)}>إغلاق</button></header>
      {mode === "associations" ? <>
        <div className={s.pickerToolsV2}><input aria-label="بحث في الجمعيات" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث باسم الجمعية…"/><button className={s.secondary} onClick={() => choose("")}>جميع الجمعيات</button></div>
        <div className={s.pickerScrollV2}><div className={s.associationGridV2}>{overview?.associations.filter(a => a.name.includes(search.trim())).map(a => {
          const progress = intake?.associations.find(row => row.id === a.id);
          return <button key={a.id} aria-pressed={a.id === associationId} className={`${s.associationCardV2} ${a.id === associationId ? s.active : ""}`} onClick={() => choose(a.id)}><strong>{a.name}</strong><small>{a.region} / {a.city}</small>{progress ? <span><bdi dir="ltr">{progress.uploadedCount} / {progress.beneficiaryLimit}</bdi> أسرة <small>{progress.complete ? "بلغت العدد" : progress.uploadedCount ? "رفع جزئي" : "لم تبدأ"}</small></span> : <small>{a.stats.families} أسرة في نطاق الفرز</small>}</button>;
        })}</div></div>
        {!overview ? <p className={s.help}>{loading ? "جارٍ تحميل الجمعيات…" : "تعذر تحميل الجمعيات؛ أعد المحاولة بتحديث الصفحة."}</p> : !overview.associations.some(a => a.name.includes(search.trim())) && <p className={s.empty}>لا توجد جمعيات مطابقة.</p>}
      </> : <>
        {!intake ? <p className={s.empty}>{loading ? "جارٍ تحميل متابعة الرفع…" : "متابعة الرفع غير متاحة حاليًا؛ لا تُعد الأرقام المفقودة صفرًا."}</p> : <>
          <div className={s.intakeStatsV2}>{([["COMPLETE", "بلغت العدد", intake.reachedLimit], ["PARTIAL", "رفع جزئي", intake.partial], ["NONE", "لم تبدأ", intake.notStarted]] as const).map(([key,label,n]) => <button key={key} aria-pressed={status === key} className={status === key ? s.active : ""} onClick={() => setStatus(status === key ? "ALL" : key)}><strong>{n}</strong>{label}</button>)}</div>
          <div className={s.pickerScrollV2}><div>{intake.associations.filter(a => status === "ALL" || (status === "COMPLETE" ? a.complete : status === "NONE" ? !a.uploadedCount : a.uploadedCount > 0 && !a.complete)).map(a => <div key={a.id} className={s.intakeRowV2}><button onClick={() => choose(a.id)}>{a.name}<small>{a.region}</small></button><span><bdi dir="ltr">{a.uploadedCount} / {a.beneficiaryLimit}</bdi> أسرة<small>المتبقي {a.remaining}</small></span></div>)}</div></div>
          <p className={s.help}>المشمولة {intake.total} جمعية. رفع بيانات الأسرة لا يعني اعتمادها، ورفضها لا يحذف بياناتها أو يفرغ حصتها.</p>
        </>}
      </>}
    </dialog>
  </>;
}
