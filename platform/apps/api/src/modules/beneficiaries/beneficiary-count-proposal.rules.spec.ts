import { proposeCounts, type CountFamily } from './beneficiary-count-proposal.rules';
const row=(id:string,rank:number,requestedCount=3,needClass:CountFamily['needClass']='HIGH'):CountFamily=>({id,financialRank:rank,requestedCount,existingCount:0,needClass,sourceVersion:'v1',excluded:false});
describe('read-only count proposals',()=>{
 it('shows proposals of zero, one, two and three without choosing types',()=>{
   const rows=Array.from({length:50},(_,i)=>row(String(i),i+1));
   const r=proposeCounts(rows,50);
   expect(r.summary.three).toBeGreaterThan(0);expect(r.summary.two).toBeGreaterThan(0);expect(r.summary.one).toBeGreaterThan(0);expect(r.summary.zero).toBeGreaterThan(0);
   expect(r.summary.used).toBeLessThanOrEqual(50);expect(r.recommendations['0'].proposedCount).toBe(3);
   expect(r.recommendations['0']).not.toHaveProperty('deviceType');expect(r.recommendations['0'].sourceVersion).toBe('v1');
 });
 it('uses every available first-device opportunity if no additional devices were requested',()=>{
   const r=proposeCounts(Array.from({length:50},(_,i)=>row(String(i),i+1,1)),42);
   expect(r.summary).toMatchObject({families:42,used:42,one:42,two:0,three:0});
 });
 it('never gives three to lower/medium financial priority to fill a quota',()=>{
   const r=proposeCounts(Array.from({length:50},(_,i)=>row(String(i),i+1,3,'MEDIUM')),50);
   expect(r.summary.three).toBe(0);expect(r.summary.two).toBeGreaterThan(0);
 });
 it('keeps excluded/unclassified rows outside new recommendations and preserves existing allocations',()=>{
   const rows=[{...row('allocated',1),existingCount:3,excluded:true},{...row('excluded',2),excluded:true},row('unknown',3,3,null)];
   const r=proposeCounts(rows,2);
   expect(r.summary).toMatchObject({used:3,overQuota:1,existing:3});
   expect(r.recommendations.excluded.proposedCount).toBe(0);expect(r.recommendations.unknown.proposedCount).toBe(0);
 });
 it('does not create an identifier-based winner at an unresolved boundary',()=>{
   const r=proposeCounts([row('z',1),row('a',1),row('b',1)],2);
   expect(r.summary.families).toBe(0);expect(r.summary.unused).toBe(2);
 });
 it('validates counts and handles zero, no households and excess capacity',()=>{
   expect(proposeCounts([],100).summary).toMatchObject({used:0,unused:100});
   expect(proposeCounts([row('a',1)],0).summary.used).toBe(0);
   expect(()=>proposeCounts([row('a',1),row('a',2)],10)).toThrow();
   expect(()=>proposeCounts([row('a',1,4)],10)).toThrow();
   expect(()=>proposeCounts([],NaN)).toThrow();
   expect(()=>proposeCounts(Array.from({length:500},(_,i)=>row(String(i),i+1)),1000)).toThrow('COUNT_WORK_LIMIT');
 });
 it('preserves coverage with increasing quota, caps final family shares, conserves counts and leaves inputs unchanged',()=>{
   const rows=Array.from({length:50},(_,i)=>row(String(i),i+1,i%3+1,i<18?'HIGH':i<40?'MEDIUM':'LOW'));
   const before=JSON.stringify(rows);let last=0;
   for(let quota=0;quota<=90;quota++){
     const r=proposeCounts(rows,quota),s=r.summary;
     expect(s.families).toBeGreaterThanOrEqual(last);last=s.families;
     expect(s.two*5).toBeLessThanOrEqual(s.families);expect(s.three*10).toBeLessThanOrEqual(s.families);
     expect(s.used+s.unused).toBe(quota);
     expect(s.one+s.two+s.three+s.zero).toBe(50);
     for(const row of rows)expect(r.recommendations[row.id].proposedCount).toBeLessThanOrEqual(row.requestedCount);
   }
   expect(JSON.stringify(rows)).toBe(before);
 });
});
