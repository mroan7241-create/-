"use client";
import { useEffect, useState } from "react";
import type { WorkspaceRow, PrioritySummary, PriorityRecommendation } from "../../lib/beneficiary-workspace";
import { apiFetch } from "../../lib/api";
import { useDialogFocus } from "../../lib/use-dialog-focus";
import s from "./priority.module.css";
const labels={HIGH:"مرتفعة",MEDIUM:"متوسطة",LOW:"منخفضة"};
const amount=(value:number|null)=>value===null?"غير متوفر":value.toLocaleString("ar-SA",{maximumFractionDigits:2});
type PriorityResponse={associationId:string;summary:PrioritySummary;recommendations:Record<string,PriorityRecommendation>};
export function useHouseholdPriorities(enabled:boolean,associationId:string,revision:number){
  const [snapshot,setSnapshot]=useState<{value:PriorityResponse;revision:number}|null>(null);
  const [failure,setFailure]=useState<string|null>(null);
  useEffect(()=>{
    if(!enabled||!associationId)return;
    const abort=new AbortController();setFailure(null);
    void apiFetch<PriorityResponse>(`/beneficiary-workspace/priorities?associationId=${encodeURIComponent(associationId)}`,{signal:abort.signal})
      .then(value=>{if(!abort.signal.aborted)setSnapshot({value,revision});})
      .catch(()=>{if(!abort.signal.aborted)setFailure(associationId);});
    return()=>abort.abort();
  },[enabled,associationId,revision]);
  const value=snapshot?.value.associationId===associationId&&snapshot.revision===revision?snapshot.value:null;
  return {value,unavailable:failure===associationId,loading:!!associationId&&!value&&failure!==associationId};
}

export function PrioritySummaryBar({summary,unavailable}:{summary?:PrioritySummary;unavailable?:boolean}) {
  if(unavailable) return <p className={s.unavailable} role="status">تقدير الحاجة غير متاح مؤقتًا؛ مراجعة الأسر متاحة.</p>;
  if(!summary) return null;
  return <details className={s.summary}>
    <summary><strong>تقدير الحاجة المالي</strong><span>مرتفعة <b>{summary.high}</b> · متوسطة <b>{summary.medium}</b> · منخفضة <b>{summary.low}</b>{summary.unclassified>0&&<> · غير مصنفة <b>{summary.unclassified}</b></>}</span><span className={s.expand}>التفاصيل</span></summary>
    <div className={s.method}>داخل الجمعية المحددة · {summary.total} أسرة. حدود نسبية مقترحة: مرتفعة حتى {amount(summary.highLimit)} ريال للفرد، ومتوسطة حتى {amount(summary.mediumLimit)}، ومنخفضة فوق ذلك. لا تعني انخفاض الاستحقاق أو الرفض. المرجع جميع أسر الجمعية، وليس نتائج البحث الحالية. الظروف معروضة للمراجعة ولم يُعتمد وزنها بعد.</div>
  </details>;
}

export function PriorityCell({row,disabled}:{row:WorkspaceRow;disabled:boolean}) {
  const [expanded,setExpanded]=useState(false), p=row.priority;
  if(!p) return null;
  return <>
    <button type="button" className={`${s.badge} ${p.needClass?s[p.needClass]:s.unknown}`} disabled={disabled} onClick={()=>setExpanded(true)} aria-haspopup="dialog" aria-label={`تقدير الحاجة المالي للأسرة ${row.publicCode}: ${p.needClass?labels[p.needClass]:"غير مصنفة"}${p.classRank?`، ترتيب ${p.classRank} داخل الفئة في جمعيتها`:""}، عرض الأسباب`}>
      {p.needClass?labels[p.needClass]:"غير مصنفة"}{p.classRank!==null&&<> · {p.classRank}</>}<span aria-hidden="true"> ↗</span>
    </button>
    <small className={s.perPerson}>نصيب الفرد: {amount(p.perPerson)}{p.perPerson!==null?" ريال":""}</small>
    {p.warnings.length>0&&<small className={s.flag}>ملاحظة على البيانات</small>}
    {expanded&&<PriorityDetail row={row} onClose={()=>setExpanded(false)}/>}
  </>;
}

export function PriorityDetail({row,onClose}:{row:WorkspaceRow;onClose:()=>void}) {
  const ref=useDialogFocus(onClose),p=row.priority!;
  return <div className={s.overlay} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section ref={ref} className={s.dialog} role="dialog" aria-modal="true" aria-label={`أسباب تقدير الحاجة — ${row.publicCode}`}>
      <header><div><h2>تقدير الحاجة المالي</h2><p>{row.name} · {row.publicCode}<br/>{row.association.name}</p></div><button type="button" onClick={onClose}>إغلاق</button></header>
      <div className={s.result}><strong>{p.needClass?`حاجة ${labels[p.needClass]}`:"غير مصنفة"}</strong><span>{p.classRank!==null?`الترتيب ${p.classRank} داخل الفئة في هذه الجمعية`:"البيانات لا تكفي للتصنيف"}</span></div>
      <dl className={s.facts}><div><dt>دخل الأسرة</dt><dd>{amount(row.income)} ريال</dd></div><div><dt>أفراد الأسرة</dt><dd>{row.familyCount}</dd></div><div><dt>نصيب الفرد من الدخل</dt><dd>{amount(p.perPerson)}{p.perPerson!==null?" ريال":""}</dd></div><div><dt>أولوية الجمعية الأصلية</dt><dd>{p.originalPriority??"غير محددة"}</dd></div></dl>
      <p>حُسب نصيب الفرد بقسمة دخل الأسرة على عدد أفرادها، وقورن بالحدود النسبية لجميع أسر جمعيتها. {p.tiedFinancially?"توجد أسر متساوية ماليًا؛ تُستخدم أولوية الجمعية لحسم التعادل عند توفرها وعدم تكرارها.":"الأقل نصيبًا للفرد يتقدم ماليًا."}</p>
      {p.warnings.map(w=><p className={s.warning} key={w}>{w}</p>)}
      <h3>الظروف والمبررات كما وردت</h3>
      {p.context.length?p.context.map(c=><div className={s.context} key={c.source}><strong>{c.source}</strong><p>{c.text}</p></div>):<p>لا يوجد وصف إضافي في الحقول الحالية؛ لا يعني ذلك غياب الظروف المؤثرة.</p>}
      <p className={s.note}>هذا ترتيب مالي أولي؛ الظروف لم تدخل في الوزن بعد. عدد الأجهزة لا يرفع أولوية الأسرة. التقدير لا يحفظ قبولًا أو رفضًا ولا يخصص أجهزة.</p>
    </section>
  </div>;
}
