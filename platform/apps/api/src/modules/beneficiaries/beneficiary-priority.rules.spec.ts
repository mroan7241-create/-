import { classifyPriorities, type PriorityInput } from "./beneficiary-priority.rules";
const row=(id:string,income:number|null,extra:Partial<PriorityInput>={}):PriorityInput=>({id,associationId:"a",income,familyCount:1,needPriority:Number(id)||1,socialSecurity:false,updatedAt:"2026-11-06T00:00:00.000Z",...extra});
describe("read-only household financial priority",()=>{
  it("keeps association medians and ranks independent",()=>{
    const r=classifyPriorities([row("1",100),row("2",200),row("3",300),row("4",100,{associationId:"b"})]);
    expect(r.summaries.a.median).toBe(200);expect(r.summaries.b.median).toBe(100);
    expect(r.recommendations.get("1")).toMatchObject({needClass:"HIGH",classRank:1,perPerson:100});
    expect(r.recommendations.get("4")).toMatchObject({needClass:"MEDIUM",classRank:1,financialRank:1});
  });
  it("computes full household income per member, not total income ordering",()=>{
    const r=classifyPriorities([row("1",2000,{familyCount:2}),row("2",3500,{familyCount:7})]);
    expect(r.recommendations.get("2")?.financialRank).toBe(1);
    expect(r.recommendations.get("2")?.perPerson).toBe(500);
  });
  it("resolves exact financial ties by original association priority, not row input order",()=>{
    const r=classifyPriorities([row("z",3500,{familyCount:7,needPriority:3}),row("a",1000,{familyCount:2,needPriority:1})]);
    expect(r.recommendations.get("a")).toMatchObject({financialRank:1,tiedFinancially:true});
    expect(r.recommendations.get("z")?.financialRank).toBe(2);
  });
  it("compares fractions and boundary equality without rounding displayed money",()=>{
    const r=classifyPriorities([row("1",75),row("2",100),row("3",125)]);
    expect(r.recommendations.get("1")?.needClass).toBe("HIGH");
    expect(r.recommendations.get("3")?.needClass).toBe("MEDIUM");
    const thirds=classifyPriorities([row("1",1,{familyCount:3,needPriority:2}),row("2",2,{familyCount:6,needPriority:1})]);
    expect(thirds.recommendations.get("2")?.financialRank).toBe(1);
    expect(thirds.recommendations.get("1")?.tiedFinancially).toBe(true);
  });
  it("preserves zero, flags social-security ambiguity, and excludes missing/invalid values from medians",()=>{
    const r=classifyPriorities([row("1",0,{socialSecurity:true}),row("2",null),row("3",100,{familyCount:0}),row("4",NaN)]);
    expect(r.summaries.a).toMatchObject({classified:1,unclassified:3,median:0});
    expect(r.recommendations.get("1")).toMatchObject({perPerson:0,financialRank:1});
    expect(r.recommendations.get("1")?.warnings).toHaveLength(1);
    expect(r.recommendations.get("2")).toMatchObject({needClass:null,classRank:null,financialRank:null});
  });
  it("assigns class ranks in financial order even when database rows are shuffled",()=>{
    const r=classifyPriorities([row("4",40),row("3",30),row("2",20),row("1",10),row("5",50)]);
    expect(r.recommendations.get("1")?.classRank).toBe(1);expect(r.recommendations.get("2")?.classRank).toBe(2);
    expect(r.summaries.a).toMatchObject({high:2,medium:1,low:2});
  });
  it("retains original narrative including negation without inventing weights or decisions",()=>{
    const input=[row("1",100,{threeDeviceReason:"ليس من ذوي الإعاقة، ودخله من الضمان",notes:"لا يوجد مرض مزمن",maritalStatus:"أرملة"})];
    const before=JSON.stringify(input),r=classifyPriorities(input),p=r.recommendations.get("1")!;
    expect(JSON.stringify(input)).toBe(before);expect(p.context.map(v=>v.text)).toEqual([input[0].threeDeviceReason,input[0].notes,"أرملة"]);
    expect(r.policy.circumstancesWeighted).toBe(false);expect(p.basis).toBe("FINANCIAL_ONLY");
    expect(p).not.toHaveProperty("reviewStatus");expect(p).not.toHaveProperty("deviceDecision");
  });
  it("does not force percentages or penalize absent descriptions",()=>{
    const r=classifyPriorities([row("1",0),row("2",0),row("3",0)]);
    expect(r.summaries.a.high).toBe(3);expect(r.recommendations.get("1")?.warnings).toEqual([]);
    expect(classifyPriorities([]).summaries).toEqual({});
  });
  it("keeps an unresolved tie shared instead of inventing priority from an identifier",()=>{
    const r=classifyPriorities([row("z",100,{needPriority:null}),row("a",100,{needPriority:null})]);
    expect(r.recommendations.get("z")?.financialRank).toBe(1);
    expect(r.recommendations.get("a")?.classRank).toBe(r.recommendations.get("z")?.classRank);
    expect(r.recommendations.get("z")?.warnings).toHaveLength(1);
  });
});
