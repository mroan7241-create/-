import "reflect-metadata";
import { jest } from "@jest/globals";
import { AccountRole, prisma } from "@alzad/db";
import { BeneficiaryWorkspaceService } from "./beneficiary-workspace.service";
import type { AuthContext } from "../auth/auth.types";
import type { IdempotencyService } from "../../common/idempotency.service";
const ctx={role:AccountRole.ADMIN,accountId:"admin",sessionId:"session",associationId:null,publicCode:"ADM",mustChangePassword:false,adminFullAccess:false,adminApplicationScope:{regionCodes:["0002"]}} as AuthContext;
const version=new Date("2026-11-06T00:00:00.000Z");
afterEach(()=>jest.restoreAllMocks());
function setup(){
  jest.spyOn(prisma.association,"findFirst").mockResolvedValue({id:"a"} as never);
  const cohort=jest.spyOn(prisma.beneficiary,"findMany").mockResolvedValue([
    {id:"one",associationId:"a",income:100,familyCount:1,needPriority:1,socialSecurity:false,updatedAt:version},
    {id:"hidden-by-search",associationId:"a",income:300,familyCount:1,needPriority:2,socialSecurity:false,updatedAt:version},
  ] as never);
  return {cohort,service:new BeneficiaryWorkspaceService({} as IdempotencyService)};
}
describe("separate read-only priority cohort authorization",()=>{
  it("uses full scoped association data despite page/search/device filters and avoids writes",async()=>{
    const {cohort,service}=setup();
    const update=jest.spyOn(prisma.beneficiary,"update").mockRejectedValue(Error("Must not write"));
    const result=await service.priorities(ctx,{associationId:"a",search:"one",city:"city",topTen:"true",deviceType:"OVEN",page:2});
    expect(result.recommendations.one).toMatchObject({needClass:"HIGH",classRank:1});
    const request=cohort.mock.calls[0][0]!;
    expect(request).toMatchObject({take:5001,where:{archivedAt:null,associationId:"a"}});
    expect(JSON.stringify(request)).toContain("0002");expect(JSON.stringify(request)).toContain("NOT");
    expect(request.select).not.toHaveProperty("phone");expect(update).not.toHaveBeenCalled();
  });
  it("carries the exact source version for the UI stale-data guard",async()=>{
    const {cohort,service}=setup();
    cohort.mockResolvedValue([{id:"one",associationId:"a",income:100,familyCount:1,needPriority:1,socialSecurity:false,updatedAt:new Date(version.getTime()+1)}] as never);
    const result=await service.priorities(ctx,{associationId:"a"});expect(result.recommendations.one.sourceVersion).toBe(new Date(version.getTime()+1).toISOString());
  });
  it("reports failure from analysis without modifying the list endpoint",async()=>{
    const {cohort,service}=setup();cohort.mockRejectedValue(Error("Database busy"));
    await expect(service.priorities(ctx,{associationId:"a"})).rejects.toThrow("Database busy");
  });
  it("denies an unauthorized or archived/demo association before reading households",async()=>{
    const {cohort,service}=setup();jest.spyOn(prisma.association,"findFirst").mockResolvedValue(null);
    await expect(service.priorities(ctx,{associationId:"a"})).rejects.toMatchObject({code:"BENEFICIARY_NOT_FOUND"});expect(cohort).not.toHaveBeenCalled();
  });
  it("requires one explicit association and never returns an arbitrary global rank",async()=>{
    const {cohort,service}=setup();await expect(service.priorities(ctx,{})).rejects.toMatchObject({code:"PRIORITY_ASSOCIATION_REQUIRED"});expect(cohort).not.toHaveBeenCalled();
  });
});
