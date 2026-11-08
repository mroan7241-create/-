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
export interface CountPortfolioRow {
  associationId:string;name:string;region:string;households:number;
  summary:CountProposalResponse['summary'];resolvedTypes:Record<string,number>;unresolvedDevices:number;
}
export interface CountPortfolio {
  total:number;associationCount:number;baseQuota:number;divisionRemainder:number;
  scopeComplete:boolean;computedAt:string;simulationOnly:true;rows:CountPortfolioRow[];
}
export function useCountProposals(enabled:boolean,associationId:string,revision:number){
  const [draft,setDraft]=useState('1000'),[total,setTotal]=useState<number|null>(null),[nonce,setNonce]=useState(0);
  const [snapshot,setSnapshot]=useState<{value:CountProposalResponse;revision:number;nonce:number}|null>(null);
  const [portfolio,setPortfolio]=useState<{value:CountPortfolio;revision:number;nonce:number}|null>(null);
  const [error,setError]=useState<{key:string;text:string}|null>(null);
  const [portfolioError,setPortfolioError]=useState<{key:string;text:string}|null>(null);
  const [invalid,setInvalid]=useState(false);
  const draftValid=!!draft.trim()&&Number.isInteger(Number(draft))&&Number(draft)>=0&&Number(draft)<=10000;
  const generation=[total,revision,nonce].join(':'),selectedKey=associationId+':'+generation;
  useEffect(()=>{
    if(total===null)return;
    const n=Number(draft),valid=!!draft.trim()&&Number.isInteger(n)&&n>=0&&n<=10000;
    if(!valid||n===total)return;
    const timer=setTimeout(()=>{setInvalid(false);setTotal(n);},450);
    return()=>clearTimeout(timer);
  },[draft,total]);
  useEffect(()=>{
    if(!enabled||total===null)return;
    const abort=new AbortController();
    void apiFetch<CountPortfolio>('/beneficiary-workspace/count-proposals/overview?total='+total,{signal:abort.signal})
      .then(value=>{if(!abort.signal.aborted){setPortfolioError(null);setPortfolio({value,revision,nonce});}})
      .catch(e=>{if(!abort.signal.aborted)setPortfolioError({key:generation,text:e instanceof Error?e.message:'تعذر تحديث الجمعيات'});});
    return()=>abort.abort();
  },[enabled,total,revision,nonce,generation]);
  useEffect(()=>{
    if(!enabled||!associationId||total===null)return;
    const abort=new AbortController();
    void apiFetch<CountProposalResponse>('/beneficiary-workspace/count-proposals?total='+total+'&associationId='+encodeURIComponent(associationId),{signal:abort.signal})
      .then(value=>{if(!abort.signal.aborted){setError(null);setSnapshot({value,revision,nonce});}})
      .catch(e=>{if(!abort.signal.aborted)setError({key:selectedKey,text:e instanceof Error?e.message:'تعذر حساب مقترح الأسر'});});
    return()=>abort.abort();
  },[enabled,associationId,total,revision,nonce,selectedKey]);
  const current=enabled&&draft.trim()!==''&&Number(draft)===total;
  const matches=snapshot?.value.associationId===associationId&&snapshot.value.total===total&&snapshot.revision===revision&&snapshot.nonce===nonce;
  const portfolioMatches=portfolio?.value.total===total&&portfolio.revision===revision&&portfolio.nonce===nonce;
  const value=current&&matches?snapshot.value:null,project=current&&portfolioMatches?portfolio.value:null;
  const failure=error?.key===selectedKey?error.text:'',projectFailure=portfolioError?.key===generation?portfolioError.text:'';
  function apply(){const n=Number(draft);if(!draft.trim()||!Number.isInteger(n)||n<0||n>10000){setInvalid(true);return;}setInvalid(false);setTotal(n);setNonce(n=>n+1);}
  return {draft,setDraft,total,value,project,invalid:invalid||(total!==null&&!draftValid),error:failure,projectError:projectFailure,apply,clear:()=>setTotal(null),active:total!==null,
    loading:enabled&&draftValid&&!!associationId&&total!==null&&!value&&!failure,
    projectLoading:enabled&&draftValid&&total!==null&&!project&&!projectFailure};
}
function Metric({value,label}:{value:number;label:string}){
  return <div className={s.metric}><strong>{value.toLocaleString('en-US')}</strong><span>{label}</span></div>;
}
export function CountProposalBar({model,associationId,onChoose}:{model:ReturnType<typeof useCountProposals>;associationId:string;onChoose?:(id:string)=>void}){
  const project=model.project,selected=project?.rows.find(r=>r.associationId===associationId);
  const combined=project?.rows.reduce((t,r)=>({used:t.used+r.summary.used,families:t.families+r.summary.families,
    unresolved:t.unresolved+r.unresolvedDevices,fridge:t.fridge+(r.resolvedTypes.REFRIGERATOR??0),
    oven:t.oven+(r.resolvedTypes.OVEN??0),washer:t.washer+(r.resolvedTypes.WASHING_MACHINE??0)}),
    {used:0,families:0,unresolved:0,fridge:0,oven:0,washer:0});
  return <section className={s.bar} aria-label="توزيع أجهزة المشروع">
    <header className={s.header}><div><h2>توزيع أجهزة المشروع</h2><p>إجمالي واحد لجميع الجمعيات · مقترح للمراجعة</p></div>
      <div className={s.controls}><label htmlFor="count-proposal-total">إجمالي الأجهزة المتاحة</label><div className={s.inputGroup}>
        <input id="count-proposal-total" type="number" min={0} max={10000} step={1} value={model.draft} onChange={e=>model.setDraft(e.target.value)} />
        <button type="button" onClick={model.apply}>{model.active?'تحديث':'عرض التوزيع'}</button></div>
        <small>{model.active?'يتحدث المقترح تلقائيًا بعد تعديل الإجمالي':'أدخل العدد لبدء المعاينة'}</small>
      </div>
    </header>
    <div className={s.content}>
      {model.invalid&&<p role="alert">أدخل عددًا صحيحًا من صفر إلى 10000.</p>}
      {model.projectLoading&&<p className={s.status} role="status">جارٍ تحديث حصص الجمعيات ومقترحات الأسر…</p>}
      {model.projectError&&<p role="alert">{model.projectError} — لم تتغير القرارات.</p>}
      {project&&combined&&<>
        <div className={s.metrics} aria-label="ملخص التوزيع"><Metric value={project.associationCount} label="جمعية في القسمة"/>
          <Metric value={project.baseQuota} label="حصة كل جمعية"/><Metric value={combined.used} label={project.scopeComplete?'أجهزة في المقترح':'أجهزة ضمن صلاحيتك'}/>
          <Metric value={combined.families} label="أسرة في المقترح"/><Metric value={project.divisionRemainder} label="باقي القسمة"/>
        </div>
        <details className={s.associations}><summary>حصص الجمعيات <span>{project.rows.length} جمعية · اضغط على الجمعية لعرض أسرها</span></summary>
          <div className={s.associationGrid}>{project.rows.map(r=><button key={r.associationId} type="button" className={r.associationId===associationId?s.selectedAssociation:s.association} aria-pressed={r.associationId===associationId} onClick={()=>onChoose?.(r.associationId)}>
            <span className={s.associationName}>{r.name}<small>{r.region}</small></span><span className={s.associationNumbers}><strong>{r.summary.used}<small>من {r.summary.quota} جهازًا</small></strong><span>{r.summary.families} أسرة</span></span>
          </button>)}</div>
        </details>
        <details className={s.types}><summary>أنواع الأجهزة <span>{combined.unresolved>0?combined.unresolved+' جهازًا بانتظار اختيار النوع':'الأنواع محددة في المقترح'}</span></summary>
          <div className={s.metrics}><Metric value={combined.fridge} label="ثلاجة محددة"/><Metric value={combined.oven} label="فرن محدد"/><Metric value={combined.washer} label="غسالة محددة"/><Metric value={combined.unresolved} label="لم يُحدد نوعها"/></div>
          <p>الأعداد المحددة تشمل التخصيص السابق والطلبات المشمولة كاملة. طلب ثلاثة أجهزة مع اقتراح جهازين يبقى دون اختيار النوع. هذه الأعداد ليست اعتمادًا جديدًا.</p>
        </details>
        {project.rows.some(r=>r.summary.overQuota>0)&&<p role="alert">توجد جمعية بتخصيص سابق يتجاوز حصتها؛ تظهر الزيادة داخل ملخصها ولم تُلغَ أي أجهزة.</p>}
        {!project.scopeComplete&&<p className={s.status}>تظهر بيانات الجمعيات ضمن صلاحيتك؛ القسمة تشمل جميع الجمعيات النشطة.</p>}
      </>}
      {selected&&<div className={s.selected}><div className={s.selectedTitle}><strong>{selected.name}</strong><span>{selected.households} أسرة مرفوعة · الحصة {selected.summary.quota} جهازًا</span></div>
        <div className={s.distribution}><Metric value={selected.summary.one} label="أسرة بجهاز"/><Metric value={selected.summary.two} label="أسرة بجهازين"/><Metric value={selected.summary.three} label="أسرة بثلاثة"/><Metric value={selected.summary.zero} label="خارج المقترح"/><Metric value={selected.summary.unused} label="جهاز متبقٍ"/></div>
        {selected.summary.overQuota>0&&<p role="alert">التخصيص السابق يتجاوز الحصة بـ{selected.summary.overQuota}؛ لم يُلغَ تخصيص سابق.</p>}
        {selected.summary.existingCapException&&<p>توجد تخصيصات سابقة تتجاوز السقوف؛ أُبقيت كما هي.</p>}
      </div>}
      {model.active&&!associationId&&<p className={s.status}>اختر جمعية من «حصص الجمعيات» للاطلاع على مقترح كل أسرة.</p>}
      {model.error&&<p role="alert">{model.error}</p>}
      {model.active&&<div className={s.footer}><span>مراجعة الأعداد ← اختيار الأنواع الناقصة ← الاعتماد لاحقًا</span><button type="button" onClick={model.clear}>إخفاء المقترحات</button></div>}
      <details className={s.method}><summary>قاعدة التوزيع</summary><p>القسمة على جميع الجمعيات النشطة دون التجربة. الأولوية المالية داخل كل جمعية، ثم ترتيبها الأصلي للتعادل. سقف الأسر بجهازين 20% وبثلاثة 10%، دون ملئها تلقائيًا.</p><p>تبدأ الموازنة بهدف أولي للأسر يعادل الحصة ÷ 1.4. الثالث للمرتفعة ماليًا، والثاني للمرتفعة فالمتوسطة؛ المتبقي يتيح جهازًا أول لأسر إضافية. زيادة الحصة لا تقلل عدد الأسر المشمولة، والتعادل غير المحسوم يبقى للمراجعة.</p><p>هذه محاكاة مالية عددية. الظروف وضرورة كل جهاز تحتاج المراجعة. لا حفظ لقرار أو تخصيص ولا إرسال بريد.</p></details>
    </div>
  </section>;
}
export function CountProposalCell({row,proposal,disabled}:{row:WorkspaceRow;proposal:CountRecommendation|null;disabled:boolean}){
 const [open,setOpen]=useState(false);
 return <>{proposal?<><button className={proposal.proposedCount===0?s.zeroCount:s.count} type="button" disabled={disabled} aria-haspopup="dialog" aria-label={`المقترح للأسرة ${row.publicCode}: ${proposal.proposedCount} من ${proposal.requestedCount} أجهزة، عرض السبب`} onClick={()=>setOpen(true)}><strong>{proposal.proposedCount}</strong><small>من {proposal.requestedCount} مطلوب</small></button>{proposal.typeSelectionRequired&&<small className={s.hint}>النوع لم يُحدد</small>}{open&&<CountProposalDetail row={row} proposal={proposal} onClose={()=>setOpen(false)}/>}</>:<span className={s.hint}>—</span>}</>;
}
export function CountProposalDetail({row,proposal:p,onClose}:{row:WorkspaceRow;proposal:CountRecommendation;onClose:()=>void}){
 const focus=useDialogFocus(onClose);
 return <div className={dialog.overlay} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={focus} className={dialog.dialog} role="dialog" aria-modal="true" aria-label={`سبب العدد المقترح — ${row.publicCode}`}><header><div><h2>العدد المقترح: {p.proposedCount}</h2><p>{row.name} · {row.publicCode}<br/>{row.association.name}</p></div><button type="button" onClick={onClose}>إغلاق</button></header><p>{p.reason}</p><p>الأجهزة المطلوبة غير المرفوضة: {p.requestedCount} · المخصص سابقًا: {p.existingCount} · الإضافة المقترحة: {p.additionalCount}</p>{p.proposedCount===0?<p>الصفر لا يعني رفض الأسرة أو احتياجها.</p>:<p>{p.typeSelectionRequired?'النوع لم يُحدد؛ يلزم اختيار الأجهزة لاحقًا.':'يغطي المقترح الأجهزة المتاحة في الطلب؛ لم يُنشأ تخصيص فعلي.'}</p>}<p className={dialog.note}>مقترح مالي عددي فقط، يحتاج مراجعة الظروف وحاجة الأجهزة. لا يغيّر قبول الأسرة أو الأجهزة ولا يرسل بريدًا.</p></section></div>;
}
