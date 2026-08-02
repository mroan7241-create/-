#!/usr/bin/env node
/**
 * يبني نسخة معاينة من Index.html بحقن بيانات وهمية بدل google.script.run،
 * لالتقاط لقطات الشاشة ومراجعة الواجهة دون نشر المشروع.
 *   تشغيل:  node tools/preview.js  →  ينتج tools/.preview/preview.html
 * الملف الناتج للمعاينة فقط ولا يُنسخ إلى Apps Script.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, '.preview');

const FIXTURES = {
  admin: {
    ok: true, role: 'ADMIN', generatedAt: '2026/07/29 10:12',
    user: { id: 'USR-000001', name: 'مدير النظام', role: 'ADMIN', associationId: '' },
    summary: {
      beneficiaries: 1284, associations: 12, devices: 3160, delegates: 34,
      devicesWarehouse: 940, devicesAllocated: 612, devicesDelivered: 1608,
      deliveryRate: 64, activityRate: 45, completedActivities: 9, totalActivities: 20
    },
    dashboardModules: {
      beneficiaries: {
        total: 1284, new: 96, underReview: 140, approved: 210, locationPending: 87,
        awaitingDevices: 178, readyForReferral: 64, delivering: 152, delivered: 468, stalled: 40,
        deliveryRate: {value: 39, numerator: 468, denominator: 1201}
      },
      devices: {
        total: 3160, warehouse: 940, allocated: 612, withDelegate: 210, delivered: 1608,
        damaged: 28, conflicts: 6
      },
      associations: {
        total: 12, active: 10, inactive: 2, pendingApplications: 3, acceptedApplications: 7,
        rejectedApplications: 2, needsFollowUp: 2,
        progressRate: {value: 51, numerator: 1608, denominator: 3160}
      },
      activities: {
        total: 20, completed: 9, inProgress: 6, upcoming: 3, late: 2, missingEvidence: 3,
        progressRate: {value: 45, numerator: 9, denominator: 20},
        nextDeadline: {label: 'توزيع الدفعة الثالثة على جمعيات المنطقة الشرقية', daysLeft: 9}
      }
    },
    beneficiaries: [
      ben('BEN-000101', 'فاطمة عبدالله العتيبي', 'الرياض', 'الرياض', 'حي النرجس، شارع الأمير سلطان', 6, true, 'أرملة', 2400, ['ثلاجة', 'غسالة'], 'معتمد', 'جاري التجهيز', 'MND-000001', 'النرجس', true),
      ben('BEN-000102', 'نورة سالم القحطاني', 'مكة المكرمة', 'جدة', 'حي الصفا، طريق الملك', 4, true, 'مطلق/مطلقة', 1800, ['ثلاجة', 'مكيف', 'فرن'], 'بانتظار الأجهزة', 'لم يبدأ', '', 'الصفا', true),
      ben('BEN-000103', 'محمد إبراهيم الدوسري', 'الشرقية', 'الدمام', 'حي الفيصلية، شارع 12', 8, false, 'متزوج/متزوجة', 4200, ['غسالة', 'فريزر'], 'تم التسليم', 'تم التسليم', 'MND-000002', 'الفيصلية', true),
      ben('BEN-000104', 'هند ناصر الشمري', 'القصيم', 'بريدة', 'حي الرحاب، طريق المدينة', 5, true, 'أرملة', 2100, ['ثلاجة', 'سخان'], 'تحت المراجعة', 'لم يبدأ', '', 'الرحاب', false),
      ben('BEN-000105', 'عبدالرحمن يوسف الغامدي', 'عسير', 'أبها', 'حي المنسك، شارع الملك فيصل', 7, false, 'يتيم', 0, ['مكيف', 'ثلاجة'], 'جاري التسليم', 'خرج مع المندوب', 'MND-000001', 'المنسك', true),
      ben('BEN-000106', 'سارة خالد الحربي', 'المدينة المنورة', 'المدينة', 'حي قباء، شارع السلام', 3, true, 'أرملة', 1500, ['غسالة'], 'معتمد', 'تعذر التسليم', 'MND-000002', 'قباء', true)
    ],
    associations: [
      assoc('ASC-000001', 'جمعية البر بالرياض', 'الرياض', 'الرياض', 420, 880, 610, 540, 12, 61),
      assoc('ASC-000002', 'جمعية إحسان بجدة', 'مكة المكرمة', 'جدة', 318, 640, 402, 356, 9, 56),
      assoc('ASC-000003', 'جمعية رفد بالدمام', 'الشرقية', 'الدمام', 264, 520, 300, 268, 7, 52),
      assoc('ASC-000004', 'جمعية عطاء بأبها', 'عسير', 'أبها', 282, 480, 250, 196, 6, 41)
    ],
    devices: [
      dev('DEV-001001', 'ثلاجة 16 قدم', 'أجهزة تبريد', 'ASC-000001', 'BEN-000101', 'مخصص'),
      dev('DEV-001002', 'غسالة أوتوماتيك', 'أجهزة غسيل', 'ASC-000001', 'BEN-000101', 'مخصص'),
      dev('DEV-001003', 'فريزر رأسي', 'أجهزة تبريد', 'ASC-000003', 'BEN-000103', 'تم التسليم'),
      dev('DEV-001004', 'مكيف سبليت 18', 'أجهزة تكييف', 'ASC-000004', 'BEN-000105', 'مع المندوب'),
      dev('DEV-001005', 'فرن كهربائي', 'أجهزة طهي', 'ASC-000002', '', 'بالمستودع'),
      dev('DEV-001006', 'سخان مياه 50 لتر', 'أجهزة تسخين', 'ASC-000002', '', 'بالمستودع')
    ],
    delegates: [
      del('MND-000001', 'ASC-000001', 'سعد ماجد القحطاني', '0551234567', 'نشط', 46, 12, '2026/07/29 07:40'),
      del('MND-000002', 'ASC-000003', 'فهد علي الزهراني', '0567778899', 'نشط', 38, 9, '2026/07/28 18:05'),
      del('MND-000003', 'ASC-000002', 'تركي بدر العنزي', '0503334455', 'غير نشط', 0, 0, '')
    ],
    activities: [
      act('التخطيط والاعتماد', 'اعتماد المشروع', 'توقيع الاتفاقية مع الشريك', 'إدارة المشروع', '2026/02/15', 100, 'مكتمل', 'https://drive.google.com/file/d/x', 0),
      act('التخطيط والاعتماد', 'حصر المستفيدين', 'استقبال كشوفات الجمعيات', 'وحدة البيانات', '2026/03/20', 100, 'مكتمل', '', 0),
      act('التوريد', 'التعاقد مع الموردين', 'ترسية العقود', 'إدارة المشتريات', '2026/04/10', 72, 'متأخر', '', 18),
      act('التوريد', 'استلام الأجهزة', 'فحص وجرد المستودع', 'إدارة المستودع', '2026/06/01', 88, 'جارٍ', 'https://drive.google.com/file/d/y', 0),
      act('التوزيع', 'التسليم الميداني', 'جدولة الزيارات', 'فريق العمليات', '2026/09/30', 41, 'جارٍ', '', 0),
      act('الأثر', 'قياس الأثر', 'استبانة رضا المستفيدين', 'وحدة القياس', '2026/11/15', 0, 'لم يبدأ', '', 0)
    ],
    stages: [
      { name: 'التخطيط والاعتماد', progress: 100, status: 'مكتملة' },
      { name: 'التوريد', progress: 80, status: 'متأخرة' },
      { name: 'التوزيع', progress: 41, status: 'قيد التنفيذ' },
      { name: 'الأثر', progress: 0, status: 'قيد التنفيذ' }
    ],
    alerts: [
      { level: 'critical', title: 'نشاط متأخر', message: 'ترسية العقود — متأخر 18 يومًا', section: 'الأنشطة', page: 'activities' },
      { level: 'critical', title: 'تعارض حالة أجهزة', message: '6 أجهزة بحالة "تم التسليم" لا تطابق حالة المستفيد المرتبط', section: 'الأجهزة', page: 'devices', filter: 'تم التسليم' },
      { level: 'high', title: 'طلبات انضمام بانتظار المراجعة', message: '3 طلبات جمعية جديدة قيد المراجعة', section: 'طلبات الانضمام', page: 'applications', filter: 'قيد المراجعة' },
      { level: 'high', title: 'نشاط مكتمل دون شاهد', message: 'استقبال كشوفات الجمعيات', section: 'الشواهد', page: 'activities' },
      { level: 'high', title: 'جمعية تحتاج متابعة', message: 'جمعية عطاء بأبها — لم يسلَّم أي جهاز', section: 'الجمعيات', page: 'associations' },
      { level: 'high', title: 'مستفيدون بانتظار تحديد الموقع', message: '87 مستفيدًا بلا موقع مؤكَّد على الخريطة', section: 'المستفيدون', page: 'beneficiaries', filter: 'بانتظار تحديد الموقع' },
      { level: 'medium', title: 'مستفيدون بلا مندوب', message: '52 مستفيدًا بانتظار تعيين مندوب', section: 'المستفيدون', page: 'beneficiaries', filter: 'لم يبدأ' },
      { level: 'medium', title: 'مستفيدون جاهزون للإحالة', message: '64 مستفيدًا لديهم أجهزة مخصَّصة وموقع مؤكَّد بانتظار تعيين مندوب', section: 'المستفيدون', page: 'beneficiaries', filter: 'جاهز للإحالة' },
      { level: 'high', title: 'تسليمات متعثرة', message: '40 تسليمًا يحتاج إعادة محاولة', section: 'المستفيدون', page: 'beneficiaries', filter: 'تعذر التسليم' }
    ],
    audit: auditRows()
  }
};

function ben(id, name, region, city, address, family, ss, social, income, needs, status, delivery, delegateId, district, hasLocation) {
  var lat = hasLocation ? 24.7136 + Math.random() * 0.1 : null;
  var lng = hasLocation ? 46.6753 + Math.random() * 0.1 : null;
  return {
    id, associationId: 'ASC-000001', name, region, city, district: district || 'النرجس', address,
    phone: '05' + String(10000000 + Math.floor(Math.random() * 8999999)).slice(0, 8),
    phone2: '', familyCount: family, socialSecurity: ss, socialStatus: social, income,
    needs, status, deliveryStatus: delivery, delegateId,
    lat, lng, locationConfirmed: !!hasLocation, locationSource: hasLocation ? 'خريطة' : '', landmark: '',
    notes: 'يفضّل التسليم في الفترة الصباحية.',
    createdAt: '2026/06/12', deliveredAt: delivery === 'تم التسليم' ? '2026/07/21 11:20' : '',
    updatedAt: '2026/07/25 14:05'
  };
}
function assoc(id, name, region, city, beneficiaries, approved, received, delivered, delegates, progress) {
  return {
    id, name, category: 'جمعية أهلية', region, city,
    phone: '0551112222', email: 'info@example.org', status: 'نشطة',
    beneficiaries, approvedDevices: approved, receivedDevices: received,
    deliveredDevices: delivered, delegates, progress
  };
}
function dev(id, name, type, associationId, beneficiaryId, status) {
  return { id, name, type, associationId, beneficiaryId, status, createdAt: '2026/05/18', deliveredAt: '', notes: '' };
}
function del(id, associationId, name, phone, status, assigned, served, lastLogin) {
  return { id, associationId, name, phone, status, assigned, served, lastLogin };
}
function act(stage, mainActivity, subActivity, owner, endDate, progress, status, evidenceUrl, delayDays) {
  return { stage, mainActivity, subActivity, owner, endDate, progress, status, evidenceUrl, delayDays, startDate: '', notes: '', remainingDays: 0 };
}
function auditRows() {
  const rows = [
    ['سعد ماجد القحطاني', 'تأكيد تسليم', 'التسليمات', 'BEN-000103', '2026/07/29 09:14'],
    ['جمعية البر بالرياض', 'تعيين مندوب', 'المستفيدون', 'BEN-000101', '2026/07/29 08:52'],
    ['مدير النظام', 'إضافة جهاز', 'الأجهزة', 'DEV-001006', '2026/07/28 16:30'],
    ['جمعية إحسان بجدة', 'استيراد مستفيدين', 'المستفيدون', '', '2026/07/28 14:02'],
    ['فهد علي الزهراني', 'تعذر التسليم', 'التسليمات', 'BEN-000106', '2026/07/28 11:47'],
    ['مدير النظام', 'تفعيل مندوب', 'المناديب', 'MND-000002', '2026/07/27 10:05'],
    ['جمعية رفد بالدمام', 'تعديل مستفيد', 'المستفيدون', 'BEN-000104', '2026/07/27 09:31'],
    ['مدير النظام', 'إضافة جمعية', 'الجمعيات', 'ASC-000004', '2026/07/26 13:20']
  ];
  return rows.map(r => ({ user: r[0], action: r[1], section: r[2], recordId: r[3], notes: '', at: r[4] }));
}

// لوحة الجمعية: نفس البيانات مقصورة على جمعية واحدة
FIXTURES.association = Object.assign({}, FIXTURES.admin, {
  role: 'ASSOCIATION',
  user: { id: 'USR-000002', name: 'جمعية البر بالرياض', role: 'ASSOCIATION', associationId: 'ASC-000001' },
  association: FIXTURES.admin.associations[0],
  summary: {
    beneficiaries: 420, associations: 1, devices: 880, delegates: 12,
    devicesWarehouse: 270, devicesAllocated: 70, devicesDelivered: 540, deliveryRate: 61
  },
  associations: undefined, activities: undefined, stages: undefined, alerts: undefined
});

// واجهة المندوب
FIXTURES.delegate = {
  ok: true, role: 'DELEGATE', generatedAt: '2026/07/29 10:12',
  user: { id: 'MND-000001', name: 'سعد القحطاني', role: 'DELEGATE', associationId: 'ASC-000001' },
  delegate: FIXTURES.admin.delegates[0],
  summary: { remaining: 4, deliveredToday: 3 },
  beneficiaries: [
    Object.assign({}, FIXTURES.admin.beneficiaries[0], {
      phone: '0501234567',
      devices: [{ id: 'DEV-001001', name: 'ثلاجة 16 قدم', status: 'مع المندوب' },
                { id: 'DEV-001002', name: 'غسالة أوتوماتيك', status: 'مع المندوب' }]
    }),
    Object.assign({}, FIXTURES.admin.beneficiaries[4], {
      phone: '0559876543',
      devices: [{ id: 'DEV-001004', name: 'مكيف سبليت 18', status: 'مع المندوب' }]
    }),
    Object.assign({}, FIXTURES.admin.beneficiaries[3], { phone: '0533221100', devices: [] })
  ],
  history: [
    { id: 'DLV-000501', beneficiaryName: 'محمد إبراهيم الدوسري', deliveredAt: '2026/07/29 09:14', devices: ['DEV-001003'], hasProof: true },
    { id: 'DLV-000499', beneficiaryName: 'عائشة فهد المطيري', deliveredAt: '2026/07/29 08:02', devices: ['DEV-000998', 'DEV-000999'], hasProof: false }
  ],
  audit: [
    { user: 'سعد ماجد القحطاني', action: 'تأكيد تسليم', section: 'التسليمات', recordId: 'BEN-000103', notes: '', at: '2026/07/29 09:14' },
    { user: 'سعد ماجد القحطاني', action: 'تعذر التسليم', section: 'التسليمات', recordId: 'BEN-000106', notes: 'لا يرد', at: '2026/07/28 16:40' },
    { user: 'سعد ماجد القحطاني', action: 'إعادة محاولة تسليم', section: 'التسليمات', recordId: 'BEN-000106', notes: '', at: '2026/07/28 17:05' },
    { user: 'سعد ماجد القحطاني', action: 'تسجيل دخول', section: 'المصادقة', recordId: 'MND-000001', notes: '', at: '2026/07/29 07:40' }
  ]
};

/* ---------------- بناء ملف المعاينة ---------------- */

const html = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');

// عناصر القوائم (listBeneficiaries/listDevices/...) مطلوبة فقط لالتقاط
// لقطات شاشة لصفحات مُحمَّلة كسولًا (lazy) أثناء المراجعة البصرية —
// محاكاة تقريبية للترقيم على مصفوفة وهمية محليًا فقط، ليست الخادم الحقيقي.
const listShimHelpers = `
function fakePage(items, options){
  options = options || {};
  var page = options.page || 1, pageSize = options.pageSize || 25;
  var start = (page - 1) * pageSize;
  return {ok:true, items: items.slice(start, start + pageSize), total: items.length, page: page, pageSize: pageSize};
}
function findFixtureDevice(id){
  return (window.__FIXTURE.devices || []).find(function(d){ return d.id === id; });
}
`;

// كل استدعاء google.script.run.withSuccessHandler(f).withFailureHandler(g).method(...)
// حقيقي يحمل ok/fail خاصَّين به معزولَين عن أي استدعاء آخر متزامن. تسجيل
// ok/fail في متغيّرين مشترَكين (كما في نسخة سابقة من هذه المحاكاة) كان
// يُنتج تعارضًا حقيقيًا عندما يحدث أكثر من استدعاء api() قبل أن يُنفَّذ
// أول setTimeout: النتيجة الأولى تصل بعد أن يكون ok قد أُعيد ضبطه لمعالج
// الاستدعاء الثاني، فتُفقَد النتيجة الأولى أو تُخلَط بالثانية. البناء هنا
// (makeRunner يُعيد كائنًا جديدًا لكل ربط withSuccessHandler/withFailureHandler
// بدل تعديل حالة مشتركة) يطابق دلالات google.script.run الحقيقية.
const METHOD_IMPLS = {
  getBootstrapData: 'function(ok,fail){setTimeout(function(){ok(window.__FIXTURE)},60)}',
  login: 'function(ok,fail){setTimeout(function(){ok({token:"preview-token-0000000000000000000000000000000000",user:window.__FIXTURE.user,bootstrap:window.__FIXTURE})},60)}',
  logout: 'function(ok,fail){setTimeout(function(){ok({ok:true})},10)}',
  listBeneficiaries: 'function(ok,fail,token,options){setTimeout(function(){ok(fakePage(window.__FIXTURE.beneficiaries||[],options))},60)}',
  listDevices: 'function(ok,fail,token,options){setTimeout(function(){ok(fakePage(window.__FIXTURE.devices||[],options))},60)}',
  listDelegates: 'function(ok,fail,token,options){setTimeout(function(){ok(fakePage(window.__FIXTURE.delegates||[],options))},60)}',
  listAssociations: 'function(ok,fail,token,options){setTimeout(function(){ok(fakePage(window.__FIXTURE.associations||[],options))},60)}',
  listAuditLog: 'function(ok,fail,token,options){setTimeout(function(){ok(fakePage(window.__FIXTURE.audit||[],options))},60)}',
  listApplications: 'function(ok,fail,token,options){setTimeout(function(){ok(fakePage(window.__FIXTURE.applications||[],options))},60)}',
  listDelegateAuditLog: 'function(ok,fail,token,id,options){setTimeout(function(){ok(Object.assign(fakePage((window.__FIXTURE.audit||[]).filter(function(r){return r.recordId===id}),options),{delegateName:""}))},60)}',
  getDeviceDetail: 'function(ok,fail,token,id){setTimeout(function(){var d=findFixtureDevice(id);if(!d){fail(new Error("الجهاز غير موجود"));return}var ben=(window.__FIXTURE.beneficiaries||[]).find(function(b){return b.id===d.beneficiaryId});ok({ok:true,device:d,associationName:"جمعية البر بالرياض",beneficiaryName:ben?ben.name:"",delegateId:"",delegateName:ben&&ben.delegateId?"سعد ماجد القحطاني":"",assignedAt:d.createdAt,dispatchedAt:"",log:[]})},60)}',
  getReferenceData: 'function(ok,fail){setTimeout(function(){ok(window.__PREVIEW_REFERENCE_DATA)},30)}',
  listBeneficiaryDeliveryAttempts: 'function(ok,fail,token,id){setTimeout(function(){ok({ok:true,attempts:[{id:"DLV-000501",status:"تم التسليم",reason:"",notes:"",delegateName:"سعد ماجد القحطاني",hasProof:true,at:"2026/07/21 11:20"}]})},60)}',
  getDeliveryProofImage: 'function(ok,fail){setTimeout(function(){ok({ok:true,dataUrl:window.__PREVIEW_PROOF_IMAGE})},60)}'
};
const methodsSrc = Object.keys(METHOD_IMPLS).map(name => JSON.stringify(name) + ':' + METHOD_IMPLS[name]).join(',');

const shim = '<script>' + listShimHelpers
  + 'var __METHODS__={' + methodsSrc + '};'
  + 'function __makeRunner__(ok,fail){'
  + 'var runner={withSuccessHandler:function(f){return __makeRunner__(f,fail)},'
  + 'withFailureHandler:function(f){return __makeRunner__(ok,f)}};'
  + 'Object.keys(__METHODS__).forEach(function(name){'
  + 'runner[name]=function(){'
  + 'var args=[ok||function(){},fail||function(){}].concat(Array.prototype.slice.call(arguments));'
  + '__METHODS__[name].apply(null,args);'
  + '};'
  + '});'
  + 'return runner;'
  + '}'
  + 'window.google={script:{run:__makeRunner__(null,null)}};'
  + '</script>';

// #login (بدل #admin/#association/#delegate): يعرض شاشة الدخول نفسها
// دون بيانات جلسة إطلاقًا — ?type=delegate يبدّل تبويب "دخول المندوب".
const seeder = '<script>(function(){'
  + 'var role=(location.hash||"#admin").slice(1);'
  + 'if(role==="login"){'
  // القوائم المعتمدة (المنطقة/المدينة/إلخ) متاحة للزوّار بلا جلسة في التطبيق
  // الفعلي؛ يجب تعبئتها هنا أيضًا قبل renderApplyForm وإلا بقيت حقول
  // نموذج التقديم عالقة على "جار تحميل القوائم المعتمدة..." في المعاينة
  // فقط (فجوة أداة معاينة، لا عطلًا في الإنتاج).
  + 'window.state.referenceData=window.__PREVIEW_REFERENCE_DATA;'
  + 'var loginType=new URLSearchParams(location.search).get("type");'
  + 'if(loginType)window.state.loginType=loginType;'
  + 'var loginOpen=new URLSearchParams(location.search).get("open");'
  + 'if(loginOpen==="apply"){window.renderApplyForm();return;}'
  + 'window.renderLogin();'
  + 'if(loginOpen==="forgot-password")window.showForgotPasswordModal();'
  + 'if(loginOpen==="reset-code")window.showResetCodeModal("assoc-a@example.org","إذا كان البريد مسجلًا في النظام فستصلك تعليمات استعادة كلمة المرور خلال دقائق.");'
  + 'if(loginOpen==="forgot-delegate-code")window.showForgotDelegateCodeModal();'
  + 'return;'
  + '}'
  + 'window.__FIXTURE=window.__PREVIEW_DATA[role]||window.__PREVIEW_DATA.admin;'
  + 'window.state.token="preview-token-0000000000000000000000000000000000";'
  + 'window.state.data=window.__FIXTURE;'
  + 'window.state.user=window.__FIXTURE.user;'
  + 'window.state.referenceData=window.__PREVIEW_REFERENCE_DATA;'
  + 'function lazyPg(list){list=list||[];return {loading:false,items:list,total:list.length,page:1,totalPages:1,pageSize:25};}'
  + 'window.state.lazy={'
  + 'beneficiaries:lazyPg(window.__FIXTURE.beneficiaries),associations:lazyPg(window.__FIXTURE.associations),'
  + 'devices:lazyPg(window.__FIXTURE.devices),delegates:lazyPg(window.__FIXTURE.delegates),'
  + 'audit:lazyPg(window.__FIXTURE.audit),applications:lazyPg(window.__FIXTURE.applications),'
  + 'activities:{loading:false,activities:window.__FIXTURE.activities||[],stages:window.__FIXTURE.stages||[],evidence:window.__FIXTURE.evidence||[]}'
  + '};'
  + 'var page=new URLSearchParams(location.search).get("page");'
  + 'if(page)window.state.page=page;'
  + 'window.render();'
  + 'try{'
  + 'var open=new URLSearchParams(location.search).get("open");'
  + 'var openId=new URLSearchParams(location.search).get("id");'
  + 'if(open==="beneficiary-form")window.beneficiaryForm(openId||"");'
  + 'if(open==="view-beneficiary"&&openId)window.viewBeneficiary(openId);'
  + 'if(open==="view-delegate-log"){window.openModal("سجل عمليات المندوب: سعد ماجد القحطاني",'
  + 'window.delegateLogTimeline(window.__FIXTURE.audit||[]),'
  + '\'<button class="btn btn-ghost" data-act="close-modal">إغلاق</button>\')}'
  + 'if(open==="association-accepted"){window.showCredentialShareModal({'
  + 'title:"تم إنشاء الجمعية",personLabel:"اسم الجمعية",personName:"جمعية البر بعنيزة",'
  + 'email:"info@albir-onaizah.org",secretLabel:"كلمة المرور المؤقتة",secretValue:"Tmp-83Kx91Qz",'
  + 'phone:"0550791650",'
  + 'message:window.associationAcceptMessage("جمعية البر بعنيزة","info@albir-onaizah.org","Tmp-83Kx91Qz"),'
  + 'note:"سلّم هذه الكلمة لمسؤول الجمعية عبر قناة آمنة الآن — لن تُعرض مرة أخرى."})}'
  + 'if(open==="delegate-created"){window.showCredentialShareModal({'
  + 'title:"تم إنشاء المندوب",personLabel:"اسم المندوب",personName:"سعد ماجد القحطاني",'
  + 'secretLabel:"رمز دخول المندوب",secretValue:"MND-84KQ2P",phone:"0559012345",'
  + 'message:window.delegateWelcomeMessage("سعد ماجد القحطاني","MND-84KQ2P"),'
  + 'note:"اعرض الرمز للمندوب الآن — لن يظهر مرة أخرى."})}'
  + '}catch(seedErr){'
  + 'var errBox=document.createElement("div");'
  + 'errBox.style.cssText="position:fixed;inset:0;z-index:99999;background:#fff;color:#c00;padding:20px;font:14px monospace;white-space:pre-wrap;overflow:auto";'
  + 'errBox.textContent="SEED_ERROR: "+String((seedErr&&seedErr.stack)||seedErr);'
  + 'document.body.appendChild(errBox);'
  + '}'
  + 'try{if(open==="view-proof")window.viewProofImage("DLV-000501");}catch(e2){}'
  + 'if(new URLSearchParams(location.search).get("scrollBottom")){'
  + 'setTimeout(function(){var mb=document.querySelector(".modal-body");if(mb)mb.scrollTop=mb.scrollHeight;},900);'
  + '}'
  + 'var scrollFrac=new URLSearchParams(location.search).get("scrollFrac");'
  + 'if(scrollFrac){'
  + 'setTimeout(function(){var mb=document.querySelector(".modal-body");if(mb)mb.scrollTop=mb.scrollHeight*parseFloat(scrollFrac);},900);'
  + '}'
  + '}());</script>';

// أدنى بيانات مرجعية واقعية كافية لعرض حقول المنطقة/المدينة والتصنيفات
// في المعاينة دون رسالة "تعذّر تحميل القوائم المعتمدة" (كانت getReferenceData
// غير مُحاكاة إطلاقًا سابقًا، فيفشل استدعاؤها بخطأ JS خام يظهر للمستخدم).
const PREVIEW_REFERENCE_DATA = {
  ready: true, source: 'preview',
  regions: ['الرياض', 'مكة المكرمة', 'الشرقية', 'القصيم', 'عسير', 'المدينة المنورة'],
  citiesByRegion: {
    'الرياض': ['الرياض', 'الخرج', 'الدوادمي'],
    'مكة المكرمة': ['جدة', 'مكة المكرمة', 'الطائف'],
    'الشرقية': ['الدمام', 'الخبر', 'الأحساء'],
    'القصيم': ['بريدة', 'عنيزة'],
    'عسير': ['أبها', 'خميس مشيط'],
    'المدينة المنورة': ['المدينة المنورة', 'ينبع']
  },
  deviceTypes: ['ثلاجة', 'غسالة', 'فرن', 'مكيف', 'فريزر', 'سخان'],
  socialStatuses: ['أرملة', 'يتيم', 'مطلق/مطلقة', 'متزوج/متزوجة', 'أخرى'],
  associationCategories: ['جمعية خيرية', 'جمعية أهلية', 'جمعية بر'],
  associationSectors: ['تنمية اجتماعية', 'رعاية أسرية', 'إغاثة وتنمية'],
  applicationQuestions: [], pledgeText: ''
};
// صورة PNG حقيقية 1×1 (شفافة) — تكفي معاينة نافذة "صورة إثبات التسليم" بصريًا.
const PREVIEW_PROOF_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const dataBlock = '<script>window.__PREVIEW_DATA=' + JSON.stringify(FIXTURES)
  + ';window.__PREVIEW_REFERENCE_DATA=' + JSON.stringify(PREVIEW_REFERENCE_DATA)
  + ';window.__PREVIEW_PROOF_IMAGE=' + JSON.stringify(PREVIEW_PROOF_IMAGE) + ';</script>';

// يُحقن الوهمي قبل كتلة التطبيق، والبذرة بعدها مباشرة قبل </body>
const lastScriptOpen = html.lastIndexOf('<script>');
let preview = html.slice(0, lastScriptOpen) + dataBlock + '\n' + shim + '\n' + html.slice(lastScriptOpen);
preview = preview.replace('</body>', seeder + '\n</body>');

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'preview.html');
fs.writeFileSync(outFile, preview, 'utf8');
console.log('تم إنشاء ملف المعاينة: ' + path.relative(ROOT, outFile));
console.log('افتحه بـ  #admin  أو  #association  أو  #delegate  أو  #login  و ?page=beneficiaries');
