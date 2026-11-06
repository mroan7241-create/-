/** Read-only financial recommendation. No eligibility/device decision is made here. */
export const PRIORITY_POLICY = { version: "financial-relative-v1", lowerMedianPercent: 75, upperMedianPercent: 125, circumstancesWeighted: false } as const;
export type NeedClass = "HIGH" | "MEDIUM" | "LOW";
export interface PriorityInput {
  id: string; associationId: string; income: number | null; familyCount: number;
  needPriority: number | null; socialSecurity: boolean; updatedAt: string;
  threeDeviceReason?: string | null; notes?: string | null; maritalStatus?: string;
}
type Ratio = { n: bigint; d: bigint };
const cmp = (a: Ratio, b: Ratio) => a.n*b.d < b.n*a.d ? -1 : a.n*b.d > b.n*a.d ? 1 : 0;
const numeric = (r: Ratio) => Number(r.n)/Number(r.d)/100;
function ratio(row: PriorityInput): Ratio | null {
  return row.income !== null && Number.isFinite(row.income) && row.income >= 0 && row.income <= 1_000_000 && Number.isInteger(row.familyCount) && row.familyCount >= 1 && row.familyCount <= 99
    ? { n: BigInt(Math.round(row.income*100)), d: BigInt(row.familyCount) } : null;
}
export function classifyPriorities(input: PriorityInput[]) {
  const groups = new Map<string, PriorityInput[]>();
  for (const row of input) { const group=groups.get(row.associationId)??[]; group.push(row); groups.set(row.associationId,group); }
  const recommendations = new Map<string, {
    policyVersion: string; basis: "FINANCIAL_ONLY"; sourceVersion: string;
    perPerson: number | null; needClass: NeedClass | null; classRank: number | null;
    financialRank: number | null; tiedFinancially: boolean; originalPriority: number | null;
    warnings: string[]; context: { source: string; text: string }[];
  }>();
  const summaries: Record<string,{ total: number; classified: number; unclassified: number; high: number; medium: number; low: number; median: number | null; highLimit: number | null; mediumLimit: number | null }> = {};
  for (const [associationId, group] of groups) {
    const valid=group.flatMap(row=>{const value=ratio(row);return value?[{row,value}]:[];});
    valid.sort((a,b)=>cmp(a.value,b.value)||(a.row.needPriority??Infinity)-(b.row.needPriority??Infinity)||a.row.id.localeCompare(b.row.id));
    const m=Math.floor(valid.length/2), left=valid[m-1]?.value, right=valid[m]?.value;
    const median: Ratio|null = !right ? null : valid.length%2 ? right : {n:left!.n*right.d+right.n*left!.d,d:2n*left!.d*right.d};
    const lower=median?{n:median.n*3n,d:median.d*4n}:null;
    const upper=median?{n:median.n*5n,d:median.d*4n}:null;
    const counts={HIGH:0,MEDIUM:0,LOW:0};
    const indexes=new Map(valid.map((entry,i)=>[entry.row.id,i]));
    for (const row of group) {
      const i=indexes.get(row.id), value=ratio(row);
      const needClass:NeedClass|null=value&&lower&&upper ? cmp(value,lower)<=0?"HIGH":cmp(value,upper)<=0?"MEDIUM":"LOW" : null;
      // Rank is assigned in financial order below; never use source/database order.
      const warnings:string[]=[];
      if(!value) warnings.push("لا تكفي البيانات لحساب نصيب الفرد");
      if(row.income===0&&row.socialSecurity) warnings.push("دخل صفر مع الاستفادة من الضمان؛ قد يختلف تفسير الدخل");
      const context=[{source:"مبرر الطلب",text:row.threeDeviceReason??""},{source:"الملاحظات",text:row.notes??""},{source:"الحالة الاجتماعية",text:row.maritalStatus??""}].filter(v=>v.text.trim());
      recommendations.set(row.id,{policyVersion:PRIORITY_POLICY.version,basis:"FINANCIAL_ONLY",sourceVersion:row.updatedAt,
        perPerson:value?numeric(value):null,needClass,classRank:null,financialRank:i===undefined?null:i+1,
        tiedFinancially:i!==undefined&&((i>0&&cmp(value!,valid[i-1].value)===0)||(i+1<valid.length&&cmp(value!,valid[i+1].value)===0)),
        originalPriority:row.needPriority,warnings,context});
    }
    for(let i=0;i<valid.length;i++){
      const entry=valid[i],rec=recommendations.get(entry.row.id)!;
      rec.classRank=++counts[rec.needClass!];
      const previous=valid[i-1],next=valid[i+1];
      const unresolved=(other:typeof previous)=>other&&cmp(entry.value,other.value)===0&&entry.row.needPriority===other.row.needPriority;
      if(unresolved(previous)||unresolved(next))rec.warnings.push("التعادل المالي لم يُحسم؛ أولوية الجمعية متساوية أو غير محددة");
      if(unresolved(previous)){
        const prior=recommendations.get(previous.row.id)!;
        rec.financialRank=prior.financialRank;rec.classRank=prior.classRank;
      }
    }
    summaries[associationId]={total:group.length,classified:valid.length,unclassified:group.length-valid.length,
      high:counts.HIGH,medium:counts.MEDIUM,low:counts.LOW,median:median?numeric(median):null,
      highLimit:lower?numeric(lower):null,mediumLimit:upper?numeric(upper):null};
  }
  return {policy:PRIORITY_POLICY,recommendations,summaries};
}
