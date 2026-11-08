import 'reflect-metadata';
import {jest} from '@jest/globals';
import {prisma,AccountRole} from '@alzad/db';
import {BeneficiaryWorkspaceService} from './beneficiary-workspace.service';
import type {AuthContext} from '../auth/auth.types';
import type {IdempotencyService} from '../../common/idempotency.service';
const ctx={role:AccountRole.ADMIN,accountId:'admin',sessionId:'s',associationId:null,publicCode:'ADM',mustChangePassword:false,adminFullAccess:false,adminApplicationScope:{regionCodes:['0002']}} as AuthContext;
afterEach(()=>jest.restoreAllMocks());
function setup(){
 const tx={association:{findMany:jest.fn<()=>Promise<unknown[]>>().mockResolvedValue([{id:'a',name:'جمعية محلية',region:'0002'}]),findFirst:jest.fn<()=>Promise<unknown>>().mockResolvedValue({id:'a'}),count:jest.fn<()=>Promise<number>>().mockResolvedValue(24)},beneficiary:{findMany:jest.fn<()=>Promise<unknown[]>>().mockResolvedValue([
  {id:'b',associationId:'a',income:100,familyCount:4,needPriority:1,socialSecurity:false,updatedAt:new Date('2026-11-08T00:00:00Z'),reviewStatus:'UNDER_REVIEW',needs:[{id:'n',deviceType:'REFRIGERATOR',decisionStatus:'PENDING',allocations:[]}]},
 ])},deviceAllocation:{findMany:jest.fn<()=>Promise<unknown[]>>().mockResolvedValue([]),count:jest.fn<()=>Promise<number>>().mockResolvedValue(0)}};
 jest.spyOn(prisma,'$transaction').mockImplementation((async(fn:Function)=>fn(tx)) as never);
 return {tx,service:new BeneficiaryWorkspaceService({} as IdempotencyService)};
}
describe('count-only simulation read service',()=>{
 it('uses global denominator while authorizing the selected association and keeping cohort scoped',async()=>{
  const {tx,service}=setup();const r=await service.countProposals(ctx,{total:1150,associationId:'a'});
  expect(r).toMatchObject({simulationOnly:true,total:1150,associationCount:24,baseQuota:47,divisionRemainder:22});
  expect(r.summary).toMatchObject({quota:47,used:1,one:1});
  const calls=tx.beneficiary.findMany.mock.calls as unknown[][];
  expect(JSON.stringify(calls[0][0])).toContain('0002');expect(JSON.stringify(calls[0][0])).toContain('associationId');
  const selector=(calls[0][0] as {select:object}).select;expect(selector).not.toHaveProperty('phone');expect(selector).not.toHaveProperty('name');expect(selector).not.toHaveProperty('threeDeviceReason');
  expect(r.recommendations.b.requestSignature).toBe(JSON.stringify(['UNDER_REVIEW',['n','PENDING']]));
 });
 it('never reads households or even the global count for a forbidden or inactive association',async()=>{
  const {tx,service}=setup();tx.association.findFirst.mockResolvedValue(null);
  await expect(service.countProposals(ctx,{total:1000,associationId:'no'})).rejects.toMatchObject({code:'BENEFICIARY_NOT_FOUND'});
  expect(tx.association.count).not.toHaveBeenCalled();expect(tx.beneficiary.findMany).not.toHaveBeenCalled();
 });
 it('accounts for allocations outside the active household cohort without changing them',async()=>{
  const {tx,service}=setup();tx.deviceAllocation.count.mockResolvedValue(50);
  const r=await service.countProposals(ctx,{total:1000,associationId:'a'});
  expect(r).toMatchObject({reservedOther:50});expect(r.summary).toMatchObject({quota:41,used:50,overQuota:9,unused:0});
  expect(r.recommendations.b.proposedCount).toBe(0);
 });
 it('does not rank an incomplete cohort or accept invalid totals',async()=>{
  const {tx,service}=setup();await expect(service.countProposals(ctx,{total:1.5,associationId:'a'})).rejects.toMatchObject({code:'COUNT_TOTAL_INVALID'});
  tx.beneficiary.findMany.mockResolvedValue(Array.from({length:5001},()=>({})));
  await expect(service.countProposals(ctx,{total:1000,associationId:'a'})).rejects.toMatchObject({code:'COUNT_COHORT_LIMIT'});
 });
 it('updates the project in one scoped cohort read and never invents types for partial proposals',async()=>{
  const {tx,service}=setup();
  tx.beneficiary.findMany.mockResolvedValue([
   {id:'one',associationId:'a',income:100,familyCount:4,needPriority:1,socialSecurity:false,updatedAt:new Date('2026-11-08Z'),reviewStatus:'UNDER_REVIEW',
    needs:['REFRIGERATOR','OVEN','WASHING_MACHINE'].map((deviceType,i)=>({id:'n'+i,deviceType,decisionStatus:'PENDING',allocations:[]}))},
   {id:'two',associationId:'a',income:200,familyCount:4,needPriority:2,socialSecurity:false,updatedAt:new Date('2026-11-08Z'),reviewStatus:'UNDER_REVIEW',
    needs:[{id:'n4',deviceType:'REFRIGERATOR',decisionStatus:'PENDING',allocations:[]}]},
  ]);
  tx.deviceAllocation.findMany.mockResolvedValue([{associationId:'a',beneficiaryNeed:{deviceType:'OVEN'}}]);
  const r=await service.countProposalOverview(ctx,{total:1150});
  expect(r).toMatchObject({baseQuota:47,divisionRemainder:22,associationCount:24,scopeComplete:false,simulationOnly:true});
  expect(r.rows[0]).toMatchObject({households:2,unresolvedDevices:1,resolvedTypes:{REFRIGERATOR:1,OVEN:1,WASHING_MACHINE:0},summary:{used:3,families:2,unused:44}});
  expect(tx.beneficiary.findMany).toHaveBeenCalledTimes(1);
  const call=(tx.beneficiary.findMany.mock.calls as unknown[][])[0][0];
  expect(JSON.stringify(call)).toContain('0002');expect(JSON.stringify(call)).toContain('associationId');
  expect((call as {select:object}).select).not.toHaveProperty('name');
  expect((call as {select:object}).select).not.toHaveProperty('phone');
 });
 it('does not return partial project totals after cohort truncation',async()=>{
  const {tx,service}=setup();tx.beneficiary.findMany.mockResolvedValue(Array.from({length:20001},()=>({})));
  await expect(service.countProposalOverview(ctx,{total:1000})).rejects.toMatchObject({code:'COUNT_COHORT_LIMIT'});
  expect(tx.deviceAllocation.findMany).not.toHaveBeenCalled();
 });

 it('keeps portfolio totals equal to the selected-family calculation and conserves known plus unknown types',async()=>{
  const {tx,service}=setup();
  const rows=Array.from({length:50},(_,i)=>({id:'b'+i,associationId:'a',income:100+i*25,familyCount:4,needPriority:i+1,socialSecurity:false,
    updatedAt:new Date('2026-11-08Z'),reviewStatus:i===49?'REJECTED':'UNDER_REVIEW',
    needs:['REFRIGERATOR','OVEN','WASHING_MACHINE'].slice(0,i%3+1).map((deviceType,j)=>({id:'n'+i+'-'+j,deviceType,
      decisionStatus:i===48?'REJECTED':'PENDING',allocations:i===0&&j===0?[{id:'allocation'}]:[]}))}));
  tx.beneficiary.findMany.mockResolvedValue(rows);tx.deviceAllocation.count.mockResolvedValue(1);
  tx.deviceAllocation.findMany.mockResolvedValue([{associationId:'a',beneficiaryNeed:{deviceType:'REFRIGERATOR'}}]);
  const detail=await service.countProposals(ctx,{total:1150,associationId:'a'});
  const overview=await service.countProposalOverview(ctx,{total:1150}),r=overview.rows[0];
  expect(r.summary).toEqual(detail.summary);
  expect(Object.values(r.resolvedTypes).reduce((n,x)=>n+x,0)+r.unresolvedDevices).toBe(r.summary.used);
 });

});
