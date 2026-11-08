"use client";
import {useEffect,useState} from 'react';
import {apiFetch} from '../../lib/api';
import {useDialogFocus} from '../../lib/use-dialog-focus';
import type {WorkspaceRow} from '../../lib/beneficiary-workspace';
import s from './count-proposal.module.css';
import dialog from './priority.module.css';
export interface CountRecommendation {
  sourceVersion:string;requestSignature:string;requestedCount:number;proposedCount:number;existingCount:number;additionalCount:number;reason:string;typeSelectionRequired:boolean;
}
export interface CountProposalResponse {
  associationId:string;total:number;associationCount:number;baseQuota:number;divisionRemainder:number;reservedOther:number;computedAt:string;simulationOnly:true;
  recommendations:Record<string,CountRecommendation>;
  summary:{quota:number;used:number;unused:number;overQuota:number;families:number;zero:number;one:number;two:number;three:number;existing:number;initialPool:number;existingCapException:boolean};
}
export function useCountProposals(enabled:boolean,associationId:string,revision:number){
  const [draft,setDraft]=useState('1000'),[total,setTotal]=useState<number|null>(null),[nonce,setNonce]=useState(0);
  const [snapshot,setSnapshot]=useState<{value:CountProposalResponse;revision:number;nonce:number}|null>(null);
  const [error,setError]=useState<{associationId:string;total:number;revision:number;nonce:number;text:string}|null>(null);
  const [invalid,setInvalid]=useState(false);
  useEffect(()=>{
    if(!enabled||!associationId||total===null)return;
    const abort=new AbortController();
    void apiFetch<CountProposalResponse>(`/beneficiary-workspace/count-proposals?total=${total}&associationId=${encodeURIComponent(associationId)}`,{signal:abort.signal})
      .then(value=>{if(!abort.signal.aborted)setSnapshot({value,revision,nonce});})
      .catch(e=>{if(!abort.signal.aborted)setError({associationId,total,revision,nonce,text:e instanceof Error?e.message:'تعذر حساب المقترح'});});
    return()=>abort.abort();
  },[enabled,associationId,total,revision,nonce]);
  const matches=snapshot?.value.associationId===associationId&&snapshot.value.total===total&&snapshot.revision===revision&&snapshot.nonce===nonce;
  const errorMatches=error?.associationId===associationId&&error.total===total&&error.revision===revision&&error.nonce===nonce;
  const value=enabled&&draft.trim()!==''&&Number(draft)===total&&matches?snapshot.value:null;
  function apply(){const n=Number(draft);if(!draft.trim()||!Number.isInteger(n)||n<0||n>10000){setInvalid(true);return;}setInvalid(false);setTotal(n);setNonce(n=>n+1);}
  return {draft,setDraft,total,value,invalid,error:errorMatches?error.text:'',apply,clear:()=>setTotal(null),active:total!==null,
    loading:enabled&&!!associationId&&total!==null&&!value&&!errorMatches&&Number(draft)===total};
}
export function CountProposalBar({model,associationId}:{model:ReturnType<typeof useCountProposals>;associationId:string}){
  const v=model.value;
  return <details className={s.bar} open={model.active||undefined}>
    <summary><strong>مقترح عدد الأجهزة</strong><span>محاكاة للمراجعة</span></summary>
    <div className={s.content}>
      <div className={s.controls}><label htmlFor="count-proposal-total">إجمالي أجهزة المشروع</label><input id="count-proposal-total" type="number" min={0} max={10000} step={1} value={model.draft} onChange={e=>model.setDraft(e.target.value)} />
        <button type="button" onClick={model.apply} disabled={!associationId||model.loading}>احسب المقترح</button>
        {model.active&&<button type="button" onClick={model.clear}>إيقاف العرض</button>}
      </div>
      {!associationId&&<p>اختر جمعية لحساب نصيبها ومقترح أسرها.</p>}
      {model.invalid&&<p role="alert">أدخل عددًا صحيحًا من صفر إلى 10000.</p>}
      {model.loading&&<p role="status">جارٍ حساب المقترح…</p>}
      {model.error&&<p role="alert">{model.error} — بقيت القرارات دون تغيير.</p>}
      {model.active&&Number(model.draft)!==model.total&&<p role="status">تغيّر الإجمالي؛ اضغط «احسب المقترح» لتحديث الأعداد.</p>}
      {v&&<>
        <p className={s.facts}><strong>حصة الجمعية {v.baseQuota}</strong><span>لـ{v.associationCount} جمعية</span><span>مقترح / مخصص سابقًا: {v.summary.used}</span><span>متبقٍ في حصة الجمعية: {v.summary.unused}</span></p>
        <p className={s.facts}><span>أسر مقترح لها: {v.summary.families}</span><span>جهاز: {v.summary.one}</span><span>جهازان: {v.summary.two}</span><span>ثلاثة: {v.summary.three}</span><span>لم تشملها الحصة: {v.summary.zero}</span></p>
        <p>باقي قسمة إجمالي المشروع: <strong>{v.divisionRemainder} جهازًا دون توزيع</strong>. لا يشمل فائض حصص الجمعيات الأخرى.</p>
        {v.summary.existing+v.reservedOther>0&&<p>تتضمن الحصة {v.summary.existing+v.reservedOther} أجهزة مخصصة سابقًا؛ لم يُنشأ تخصيص جديد.</p>}
        {v.summary.overQuota>0&&<p role="alert">التخصيص السابق يتجاوز الحصة بـ{v.summary.overQuota}. لم تُلغَ أجهزة سابقة.</p>}
        {v.summary.existingCapException&&<p role="status">توجد تخصيصات سابقة تتجاوز السقوف النسبية؛ أُبقيت كما هي.</p>}
        <details className={s.method}><summary>قاعدة المحاكاة</summary><p>الحصة الأساسية هي إجمالي الأجهزة مقسومًا على جميع الجمعيات النشطة، دون جمعية تجربة. الفرز داخل الجمعية مالي، ثم أولوية الجمعية لحسم التعادل. سقف الأسر بجهازين فقط 20%، وبثلاثة 10%؛ لا نملأ السقوف شكليًا.</p><p>تبدأ الموازنة بهدف أولي للأسر يعادل الحصة ÷ 1.4، ثم تُراجع الأجهزة الإضافية عدديًا للأعلى أولوية. الثالث للمرتفعة ماليًا، والثاني للمرتفعة فالمتوسطة؛ المتبقي يتيح جهازًا أول لأسر إضافية دون زيادة السقوف تلقائيًا. زيادة الحصة لا تقلل عدد الأسر المقترح مساعدتها. التعادل غير المحسوم لا يُكسر برقم الأسرة.</p><p>هذه محاكاة مالية على عدد الأجهزة المطلوبة، لا تحققًا من ضرورتها. لم تُراجع الظروف في الوزن، ولم يُختر نوع جهاز أو يُحفظ قرار أو يُرسل بريد.</p></details>
      </>}
    </div>
  </details>;
}
export function CountProposalCell({row,proposal,disabled}:{row:WorkspaceRow;proposal:CountRecommendation|null;disabled:boolean}){
 const [open,setOpen]=useState(false);
 return <>{proposal?<><button className={s.count} type="button" disabled={disabled} aria-haspopup="dialog" aria-label={`المقترح للأسرة ${row.publicCode}: ${proposal.proposedCount} من ${proposal.requestedCount} أجهزة، عرض السبب`} onClick={()=>setOpen(true)}>{proposal.proposedCount}<small>من {proposal.requestedCount}</small></button>{proposal.typeSelectionRequired&&<small className={s.hint}>النوع لم يُحدد</small>}{open&&<CountProposalDetail row={row} proposal={proposal} onClose={()=>setOpen(false)}/>}</>:<span className={s.hint}>—</span>}</>;
}
export function CountProposalDetail({row,proposal:p,onClose}:{row:WorkspaceRow;proposal:CountRecommendation;onClose:()=>void}){
 const focus=useDialogFocus(onClose);
 return <div className={dialog.overlay} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={focus} className={dialog.dialog} role="dialog" aria-modal="true" aria-label={`سبب العدد المقترح — ${row.publicCode}`}><header><div><h2>العدد المقترح: {p.proposedCount}</h2><p>{row.name} · {row.publicCode}<br/>{row.association.name}</p></div><button type="button" onClick={onClose}>إغلاق</button></header><p>{p.reason}</p><p>الأجهزة المطلوبة غير المرفوضة: {p.requestedCount} · المخصص سابقًا: {p.existingCount} · الإضافة المقترحة: {p.additionalCount}</p>{p.proposedCount===0?<p>الصفر لا يعني رفض الأسرة أو احتياجها.</p>:<p>{p.typeSelectionRequired?'النوع لم يُحدد؛ يلزم اختيار الأجهزة لاحقًا.':'يغطي المقترح الأجهزة المتاحة في الطلب؛ لم يُنشأ تخصيص فعلي.'}</p>}<p className={dialog.note}>مقترح مالي عددي فقط، يحتاج مراجعة الظروف وحاجة الأجهزة. لا يغيّر قبول الأسرة أو الأجهزة ولا يرسل بريدًا.</p></section></div>;
}
