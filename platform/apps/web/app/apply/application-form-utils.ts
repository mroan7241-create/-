export const EMAIL_ERROR = 'أدخل بريدًا إلكترونيًا صحيحًا، مثل name@example.com';
export const PHONE_ERROR = 'تحقق من أرقام الجوال: يجب إدخال 9 أرقام تبدأ بالرقم 5.';
export const CONSENT_VERSION = 'application-declarations-v1';
const PRACTICAL_EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 180 && PRACTICAL_EMAIL_RE.test(value);
}

export function isValidSaudiMobile(value: string): boolean {
  return /^5\d{8}$/.test(value);
}

export function normalizeArabicSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('ar-SA')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '');
}

export function riyadhRecentYears(now = new Date()): number[] {
  const current = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
  }).format(now));
  return [current, current - 1];
}

export function payloadFingerprint(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export function validateStep(step:number,payload:Record<string, unknown>,attachments:string[]):string {
  const required:Record<number,string[]>={1:['organization.name','organization.licenseNumber','organization.licenseExpiryDate','organization.category','organization.sector','organization.officialEmail','organization.officialPhone','location.regionCode','location.governorateCode','location.districtCustom','location.serviceScope','coordinator.name','coordinator.title','coordinator.phone','coordinator.email','covenantRepresentative.name','covenantRepresentative.title'],2:['executive.name','executive.phone','executive.education','executive.experienceYears','team.fullTime','team.partTime','team.activeVolunteers','team.nonSaudis','team.universityOrHigher','socialResearcher.exists','readiness.fieldTeamCount','readiness.weeklyDeliveryCapacity','readiness.hasReceiptStorage','readiness.canDocumentDigitally'],3:['beneficiaries.registeredFamilies','beneficiaries.databaseUpdatedAt','beneficiaries.hasSystem','beneficiaries.classifiesNeed','beneficiaries.hasCaseStudyMechanism'],4:['experience.hasRecentInKindProject','experience.recentProjectsCount','experience.recentBeneficiariesCount','experience.ehsanSupportCount2025','experience.hasPreviousSimilarSupport'],5:['finance.hasAccountingSystem','finance.hasSpendingPolicy','finance.revenue','finance.expenses','finance.currentAssets','finance.currentLiabilities'],6:['planning.hasStrategicPlan','planning.hasOperationalPlan','planning.hasPostAidFollowUp','planning.measuresSatisfaction','planning.lastYearProgramsCount','planning.lastYearBeneficiariesCount']};
  const conditional:string[]=[];
  if(step===1&&textAt(payload,'organization.category')==='أخرى') conditional.push('organization.categoryOther');
  if(step===1&&textAt(payload,'organization.sector')==='أخرى') conditional.push('organization.sectorOther');
  if(step===2&&boolAt(payload,'socialResearcher.exists')===true) conditional.push('socialResearcher.name','socialResearcher.phone');
  if(step===2&&boolAt(payload,'readiness.hasReceiptStorage')===true) conditional.push('readiness.receiptStorageDescription');
  if(step===3&&boolAt(payload,'beneficiaries.hasSystem')===true) conditional.push('beneficiaries.systemName','beneficiaries.capabilities.search','beneficiaries.capabilities.update','beneficiaries.capabilities.reports','beneficiaries.capabilities.organizedCases');
  if(step===3&&boolAt(payload,'beneficiaries.classifiesNeed')===true) conditional.push('beneficiaries.classifications');
  if(step===3&&boolAt(payload,'beneficiaries.hasCaseStudyMechanism')===true) conditional.push('beneficiaries.caseStudyDescription');
  if(step===4&&numberAt(payload,'experience.ehsanSupportCount2025')>0) conditional.push('experience.ehsanSupportTypes');
  if(step===4&&boolAt(payload,'experience.hasPreviousSimilarSupport')===true) conditional.push('experience.previousSupportDescription','experience.previousSupporter','experience.previousSupportYear');
  if(step===5&&boolAt(payload,'finance.hasAccountingSystem')===true) conditional.push('finance.accountingSystemName');
  if(step===6&&boolAt(payload,'planning.hasPostAidFollowUp')===true) conditional.push('planning.postAidFollowUpDescription');
  if(step===4&&boolAt(payload,'experience.hasRecentInKindProject')===true) conditional.push('experience.projectName','experience.projectYear','experience.supportType','experience.projectBeneficiaries','experience.supporter');
  if(step===6&&boolAt(payload,'planning.measuresSatisfaction')===true) conditional.push('planning.satisfactionTool');
  if(step===6&&boolAt(payload,'planning.measuresSatisfaction')===true&&textAt(payload,'planning.satisfactionTool')==='أخرى') conditional.push('planning.satisfactionOther');
  const missing=[...(required[step]??[]),...conditional].find((path)=>{const value=getAt(payload,path);return value===undefined||value===null||(typeof value==='string'&&value.trim()==='')});
  if(missing)return 'أكمل جميع الحقول المطلوبة في هذه الخطوة قبل المتابعة.';
  if(step===1&&['organization.officialEmail','coordinator.email'].some((path)=>!isValidEmail(textAt(payload,path))))return EMAIL_ERROR;
  const phonePaths=step===1?['organization.officialPhone','coordinator.phone']:step===2?['executive.phone',...(boolAt(payload,'socialResearcher.exists')===true?['socialResearcher.phone']:[])]:[];
  if(phonePaths.some((path)=>!isValidSaudiMobile(textAt(payload,path))))return PHONE_ERROR;
  if(step===4&&boolAt(payload,'experience.hasRecentInKindProject')===true&&!riyadhRecentYears().includes(numberAt(payload,'experience.projectYear')))return 'اختر سنة التنفيذ من آخر سنتين ميلاديتين.';
  if(step===3&&boolAt(payload,'beneficiaries.hasSystem')===true&&['search','update','reports','organizedCases'].some((key)=>typeof getAt(payload,`beneficiaries.capabilities.${key}`)!=='boolean'))return 'حدد إمكانات نظام المستفيدين.';
  if(step===4&&boolAt(payload,'experience.hasPreviousSimilarSupport')===true){const year=numberAt(payload,'experience.previousSupportYear');if(!Number.isInteger(year)||year<2000||year>new Date().getUTCFullYear())return 'أدخل سنة صالحة للدعم السابق.';}
  if(step===4&&boolAt(payload,'experience.hasRecentInKindProject')===true){const count=numberAt(payload,'experience.projectBeneficiaries');if(!Number.isInteger(count)||count<0||count>10000000)return 'أدخل عددًا صحيحًا صالحًا لمستفيدي المشروع السابق.';}
  if(step===5&&!attachments.includes('financialStatementsFile'))return 'القوائم المالية المعتمدة/المراجعة مطلوبة قبل المتابعة.';
  if((step===5||step===7)&&boolAt(payload,'finance.hasSpendingPolicy')===true&&!attachments.includes('spendingPolicyFile'))return 'لائحة الصرف المعتمدة مطلوبة.';
  if((step===6||step===7)&&boolAt(payload,'planning.hasStrategicPlan')===true&&!attachments.includes('strategicPlanFile'))return 'الخطة الاستراتيجية مطلوبة.';
  if((step===6||step===7)&&boolAt(payload,'planning.hasOperationalPlan')===true&&!attachments.includes('operationalPlanFile'))return 'الخطة التشغيلية مطلوبة.';
  if(step===7){if(!attachments.includes('licenseFile'))return 'ملف الترخيص مطلوب قبل الإرسال.';if(!attachments.includes('financialStatementsFile'))return 'القوائم المالية المعتمدة/المراجعة مطلوبة قبل الإرسال.';if(boolAt(payload,'acknowledgements.allAccepted')!==true||textAt(payload,'acknowledgements.consentVersion')!==CONSENT_VERSION||!validIsoTimestamp(getAt(payload,'acknowledgements.acceptedAt')))return 'يجب الموافقة على جميع الإقرارات قبل إرسال الطلب.';}
  return '';
}

function getAt(root:Record<string, unknown>,path:string):unknown { let value:unknown=root; for(const key of path.split('.')){if(!value||typeof value!=='object'||Array.isArray(value))return undefined; value=(value as Record<string,unknown>)[key];} return value; }
function textAt(root:Record<string,unknown>,path:string):string { const value=getAt(root,path); return typeof value==='string'?value:''; }
function boolAt(root:Record<string,unknown>,path:string):unknown { return getAt(root,path); }
function numberAt(root:Record<string,unknown>,path:string):number { return Number(getAt(root,path)); }
function validIsoTimestamp(value:unknown):boolean { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
