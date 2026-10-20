'use strict';
// Read-only loopback fixture: synthetic organizations only, no database or credentials.
const http = require('node:http');
const requests = [];
const rows = Array.from({length:319}, (_, i) => ({
  id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
  publicCode:`APP-${String(i+1).padStart(6,'0')}`, name:`جمعية تجريبية ${i+1}`,
  region:'الرياض',city:i===318?'الخرج':'الرياض',regionOfficialCode:'0001',governorateOfficialCode:i===318?'0101':'0100',centerOfficialCode:null,
  status:i<119?'UNDER_REVIEW':'ACCEPTED',eligibilityStatus:i<24?'FAILED':'PASSED',selectionList:i<119?'NONE':i<219?'MAIN':'RESERVE',
  processingStartedAt:'2026-10-10T00:00:00Z',submittedAt:'2026-10-10T00:00:00Z',selectionApprovedAt:i>=119?'2026-10-12T00:00:00Z':null,
  resultingAssociationId:null,evaluationScore:i<24?null:90,evaluationRank:null,schemaVersion:2,financialPriority:'STANDARD_PRIORITY_REVIEW',
  latestInformationRequest:null,selectionDelivery:{status:'NOT_REQUESTED'},selectionEditable:true,ownerCanCorrect:false,
}));
const user={id:'fixture-admin',publicCode:'ADM-000001',name:'حساب فحص محلي وهمي',role:'ADMIN',associationId:null,mustChangePassword:false,adminFullAccess:true,adminPermissions:[],adminApplicationScope:null,covenantRequired:false,covenantStatus:null};
function fileRow(row) {return {...row,sector:null,sectorValues:[row.publicCode==='APP-000319'?'البحث العلمي':'التعليم'],email:'synthetic@example.invalid',contactName:'منسق تجريبي',licenseNumber:'TEST',scoreLabel:'0/8'};}
function detail(row) {return {...row,...fileRow(row),category:null,phone:'',notes:null,licenseExpiryDate:null,reviewedAt:null,reviewer:null,processingStarter:null,eligibilityReviewer:null,evaluator:null,selectionApprover:null,eligibilityReviewedAt:null,evaluatedAt:null,answers:[],yesCount:0,totalQuestions:8,hasLicenseFile:false,pledgeAccepted:true,pledgedAt:null,eligibilityNotes:'دليل وهمي للفحص فقط',v2Payload:{organization:{sectors:fileRow(row).sectorValues},consent:{allAccepted:true}},locationNeedsVerification:false,currentAssets:100,currentLiabilities:20,financialResult:5,netWorkingCapital:80,eligibilityEvidence:null,evaluationEvidence:null,evaluationBreakdown:null,attachmentKeys:[]};}
const server=http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://localhost:3180');res.setHeader('Access-Control-Allow-Credentials','true');
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'){res.writeHead(405);return res.end(JSON.stringify({error:{code:'FIXTURE_READ_ONLY',message:'الاختبار محلي للقراءة فقط'}}));}
  const url=new URL(req.url,'http://localhost'); const p=url.pathname.replace(/^\/api\/v1/,'');
  if(p==='/__qa/metrics')return res.end(JSON.stringify(requests));
  let body;
  if(p==='/auth/me')body=user;
  else if(p==='/reference-values')body={associationSectors:['التعليم','البحث العلمي','أخرى'],regions:['الرياض'],citiesByRegion:{الرياض:['الرياض','الخرج']}};
  else if(p==='/association-applications/geography')body={items:[{officialCode:'0001',nameAr:'منطقة الرياض',unitType:'REGION',parentOfficialCode:null,category:null,projectScopeGroup:'RIYADH',hasChildren:true}]};
  else if(p==='/association-applications/index')body={items:url.searchParams.get('kind')==='files'?rows.map(fileRow):rows,total:rows.length,readAt:new Date().toISOString()};
  else if(p==='/association-applications/intake')body={open:true,closesAt:null};
  else if(p==='/participations')body=[];
  else if(/^\/association-applications\/[0-9a-f-]{36}$/.test(p)){
    const row=rows.find(row=>p.endsWith(row.id));
    if(row)body=url.searchParams.get('view')==='list'?row:{...detail(row),...(url.searchParams.get('view')==='review'?{currentEligibilityEvidence:{schemaVersion:2,checks:[],summary:'أدلة وهمية، لا تُستخدم لقرار حقيقي'}}:{})};
  }
  if(body===undefined){res.writeHead(404);return res.end(JSON.stringify({error:{code:'FIXTURE_ROUTE_MISSING',message:'المسار غير متاح في البيانات الوهمية'}}));}
  const json=JSON.stringify(body);requests.push({path:p,kind:url.searchParams.get('kind'),view:url.searchParams.get('view'),bytes:Buffer.byteLength(json)});
  setTimeout(()=>res.end(json),150);
});
server.listen(3001,'127.0.0.1',()=>console.log('Read-only synthetic admin fixture on 127.0.0.1:3001 (319 organizations)'));
