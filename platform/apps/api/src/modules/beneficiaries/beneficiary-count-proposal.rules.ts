/** Count-only, read-only proposals. Never chooses a device type or saves a decision. */
export const COUNT_POLICY = {
  version: 'count-proposal-v1', twoPercent: 20, threePercent: 10,
  basis: 'FINANCIAL_ONLY', remainder: 'UNASSIGNED',
} as const;
export interface CountFamily {
  id: string; sourceVersion: string; requestedCount: number; existingCount: number;
  needClass: 'HIGH' | 'MEDIUM' | 'LOW' | null; financialRank: number | null;
  excluded: boolean;
}
export function proposeCounts(input: CountFamily[], quota: number) {
  if (!Number.isInteger(quota) || quota < 0 || quota > 10000) throw Error('Invalid quota');
  const rows = input.map(r => ({ ...r }));
  if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r =>
    !Number.isInteger(r.requestedCount) || r.requestedCount < 0 || r.requestedCount > 3 ||
    !Number.isInteger(r.existingCount) || r.existingCount < 0 || r.existingCount > r.requestedCount)) throw Error('Invalid household counts');
  const existing = rows.reduce((n,r) => n+r.existingCount,0);
  const eligible = rows.filter(r => !r.excluded && r.needClass && r.financialRank !== null && r.requestedCount > 0)
    .sort((a,b) => a.financialRank!-b.financialRank!);
  const limit=Math.min(quota,rows.reduce((n,r)=>n+r.requestedCount,0));
  if(limit*rows.length>300000)throw Error('COUNT_WORK_LIMIT');
  // A shared financial rank is unresolved: never invent an identifier-based winner.
  function groups(list: CountFamily[]) {
    const out: CountFamily[][] = [];
    for (const r of list) { const g=out.at(-1); if(g && g[0].financialRank===r.financialRank)g.push(r); else out.push([r]); }
    return out;
  }
  let minimumFamilies=rows.filter(r=>r.existingCount>0).length;
  let final = new Map(rows.map(r=>[r.id,r.existingCount]));
  let finalTarget=minimumFamilies;
  // Re-evaluate bounded quotas to ensure that more available devices cannot reduce
  // the number of families reached. Only counts are simulated; existing counts stay fixed.
  for(let budget=0;budget<=limit;budget++) {
    const proposed=new Map(rows.map(r=>[r.id,r.existingCount]));
    let left=Math.max(0,budget-existing);
    const target=Math.max(minimumFamilies,Math.min(eligible.length,Math.floor(budget*5/7)));
    let families=rows.filter(r=>r.existingCount>0).length;
    function first(maxFamilies:number) {
      for(const g of groups(eligible.filter(r=>proposed.get(r.id)===0))) {
        if(g.length>left || families+g.length>maxFamilies)break;
        for(const r of g)proposed.set(r.id,1);
        left-=g.length;families+=g.length;
      }
    }
    first(target);
    const pool=families, cap3=Math.floor(pool/10),cap2=Math.floor(pool/5);
    function upgrade(to:2|3) {
      const candidates=eligible.filter(r=>r.requestedCount>=to && (proposed.get(r.id)??0)>0 && (proposed.get(r.id)??0)<to && (to===3?r.needClass==='HIGH':r.needClass!=='LOW'));
      let count=Array.from(proposed.values()).filter(n=>n===to).length;
      for(const g of groups(candidates)) {
        const cost=g.reduce((n,r)=>n+to-proposed.get(r.id)!,0);
        if(count+g.length>(to===3?cap3:cap2) || cost>left)break;
        for(const r of g)proposed.set(r.id,to);
        count+=g.length;
        left-=cost;
      }
    }
    upgrade(3);upgrade(2);first(Number.MAX_SAFE_INTEGER);
    minimumFamilies=families;final=proposed;finalTarget=pool;
  }
  const recommendations=Object.fromEntries(rows.map(r=>{
    const count=final.get(r.id)!;
    const reason=r.excluded?'خارج المقترح بسبب قرار الأسرة السابق':!r.needClass?'البيانات لا تكفي للترتيب المالي':count===0?'لم تشملها الحصة المقترحة أو يوجد تعادل يحتاج مراجعة':count===r.existingCount&&count>0?'أجهزة مخصصة سابقًا؛ لم يُنشأ تخصيص جديد':count===3?'ضمن سقف الثلاثة وأولوية الفئة المرتفعة؛ يحتاج مراجعة الحاجة':count===2?'ضمن سقف الجهازين وأولوية الأسرة؛ يحتاج مراجعة الحاجة':'جهاز أول وفق ترتيب الأسرة داخل جمعيتها';
    return [r.id,{sourceVersion:r.sourceVersion,requestedCount:r.requestedCount,proposedCount:count,existingCount:r.existingCount,additionalCount:Math.max(0,count-r.existingCount),reason,typeSelectionRequired:count>0&&count<r.requestedCount}];
  }));
  const counts=[0,0,0,0];for(const n of final.values())counts[n]++;
  const used=counts[1]+2*counts[2]+3*counts[3];
  const families=counts[1]+counts[2]+counts[3];
  return {recommendations,summary:{quota,used,unused:Math.max(0,quota-used),overQuota:Math.max(0,used-quota),families,zero:counts[0],one:counts[1],two:counts[2],three:counts[3],existing,initialPool:finalTarget,existingCapException:counts[2]*5>families||counts[3]*10>families},policy:COUNT_POLICY};
}
