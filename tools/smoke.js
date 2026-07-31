#!/usr/bin/env node
/**
 * اختبار تشغيلي: يحمّل كتلة JavaScript الفعلية من Index.html داخل DOM مبسّط،
 * ثم يرسم كل شاشة لكل دور ويتحقق من الصلاحيات والحالات الفارغة.
 *   تشغيل:  node tools/smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const appCode = blocks[blocks.length - 1];

let failures = 0;
let checks = 0;
const assert = (name, condition, detail) => {
  checks++;
  if (condition) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const section = t => console.log('\n' + t);

/* ---------------- DOM مبسّط ---------------- */

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this._html = '';
    this.value = '';
    this.disabled = false;
    this.style = {};
    this.files = [];
    this.checked = false;
    this.classList = {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); return this._set.has(c); }
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set textContent(v) { this._html = String(v); }
  get textContent() { return this._html; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  appendChild(child) { this.children.push(child); return child; }
  remove() {}
  focus() {}
  setSelectionRange() {}
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  reportValidity() { return true; }
  reset() {}
  addEventListener() {}
}

const registry = {};
['root', 'modalRoot', 'toasts'].forEach(id => { registry[id] = new El('div'); });

const listeners = {};
const document = {
  getElementById: id => registry[id] || null,
  createElement: tag => new El(tag),
  querySelector: sel => registry[String(sel).replace('#', '')] || null,
  querySelectorAll: () => [],
  addEventListener: (type, fn) => { listeners[type] = fn; },
  contains: () => false,
  activeElement: null,
  body: new El('body')
};

const serverCalls = [];
const google = {
  script: {
    run: new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return () => google.script.run;
        if (prop === 'withFailureHandler') return () => google.script.run;
        return (...args) => { serverCalls.push({ method: prop, args }); };
      }
    })
  }
};

const sandbox = {
  console, Intl, Promise, Date, Math, JSON, String, Number, Boolean,
  Array, Object, RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent,
  document, google,
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  FileReader: class { readAsText() {} readAsDataURL() {} },
  FormData: class { get() { return ''; } getAll() { return []; } },
  setTimeout, clearTimeout
};
sandbox.window = sandbox;
sandbox.scrollTo = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

section('0) تحميل كود الواجهة');
try {
  vm.runInContext(appCode, sandbox, { filename: 'Index.html:app' });
  assert('تم تنفيذ كتلة التطبيق دون خطأ', true);
} catch (error) {
  assert('تنفيذ كتلة التطبيق', false, error.message);
  process.exit(1);
}

const app = sandbox;

/* ---------------- بيانات اختبار ---------------- */

const ADMIN_DATA = {
  ok: true, role: 'ADMIN', generatedAt: '2026/07/29 10:00',
  user: { id: 'USR-000001', name: 'مدير النظام', role: 'ADMIN', associationId: '' },
  summary: {
    beneficiaries: 128, associations: 4, devices: 310, delegates: 7,
    devicesWarehouse: 90, devicesAllocated: 60, devicesDelivered: 160,
    deliveryRate: 62, activityRate: 45, completedActivities: 9, totalActivities: 20
  },
  beneficiaries: [{
    id: 'BEN-000001', associationId: 'ASC-000001', name: 'فاطمة العتيبي', region: 'الرياض',
    city: 'الرياض', address: 'حي النرجس، شارع الأمير', phone: '0501234567', phone2: '',
    familyCount: 5, socialSecurity: true, socialStatus: 'أرملة', income: 2400,
    needs: ['ثلاجة', 'غسالة'], status: 'معتمد', deliveryStatus: 'جاري التجهيز',
    delegateId: 'MND-000001', notes: 'يفضّل التسليم صباحًا',
    createdAt: '2026/06/01', deliveredAt: '', updatedAt: '2026/07/20 09:00'
  }],
  associations: [{
    id: 'ASC-000001', name: 'جمعية البر', category: 'جمعية أهلية', region: 'الرياض',
    city: 'الرياض', phone: '0551112222', email: 'br@example.org', status: 'نشطة',
    beneficiaries: 40, approvedDevices: 80, receivedDevices: 50, deliveredDevices: 30,
    delegates: 2, progress: 38
  }],
  devices: [{
    id: 'DEV-000001', name: 'ثلاجة', type: 'أجهزة منزلية', associationId: 'ASC-000001',
    beneficiaryId: 'BEN-000001', status: 'مخصص', createdAt: '2026/05/10', deliveredAt: '', notes: ''
  }],
  delegates: [{
    id: 'MND-000001', associationId: 'ASC-000001', name: 'سعد القحطاني', phone: '0567778888',
    status: 'نشط', served: 12, assigned: 5, lastLogin: '2026/07/28 08:30'
  }],
  activities: [{
    stage: 'التجهيز', mainActivity: 'التعاقد', subActivity: 'توقيع العقود', owner: 'إدارة المشروع',
    endDate: '2026/03/01', progress: 60, status: 'متأخر', evidenceUrl: '', delayDays: 12
  }],
  stages: [{ name: 'التجهيز', progress: 60, status: 'قيد التنفيذ' }],
  alerts: [{ level: 'critical', title: 'نشاط متأخر', message: 'توقيع العقود', section: 'الأنشطة' }],
  audit: [{ user: 'مدير النظام', action: 'إضافة مستفيد', section: 'المستفيدون', recordId: 'BEN-000001', at: '2026/07/20 09:00' }],
  applications: [{
    id: 'APP-000001', name: 'جمعية الأمل', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0501112222', email: 'amal@example.org', contactName: 'سالم العتيبي', notes: '',
    status: 'قيد المراجعة', rejectionReason: '', resultingAssociationId: '',
    submittedAt: '2026/07/29 09:00', reviewedAt: '', reviewer: ''
  }]
};

const ASSOCIATION_DATA = Object.assign({}, ADMIN_DATA, {
  role: 'ASSOCIATION',
  user: { id: 'USR-000002', name: 'جمعية البر', role: 'ASSOCIATION', associationId: 'ASC-000001' },
  association: ADMIN_DATA.associations[0],
  associations: undefined,
  activities: undefined,
  stages: undefined,
  alerts: undefined
});

const DELEGATE_DATA = {
  ok: true, role: 'DELEGATE', generatedAt: '2026/07/29 10:00',
  user: { id: 'MND-000001', name: 'سعد القحطاني', role: 'DELEGATE', associationId: 'ASC-000001' },
  delegate: ADMIN_DATA.delegates[0],
  summary: { remaining: 3, deliveredToday: 2 },
  beneficiaries: [Object.assign({}, ADMIN_DATA.beneficiaries[0], {
    devices: [{ id: 'DEV-000001', name: 'ثلاجة', status: 'مع المندوب' }]
  })],
  history: [{ beneficiaryName: 'نورة السالم', deliveredAt: '2026/07/28 11:00', devices: ['DEV-000002'] }]
};

// audit/activities/applications لم تعد ضمن Bootstrap (Bootstrap.gs) —
// تُحاكى هنا القيم نفسها ضمن state.lazy لمطابقة العقد الجديد بين الخادم
// والواجهة (fetchLazyPage/fetchActivitiesBundle في Index.html) دون تغيير
// بيانات الاختبار الأصلية نفسها.
/** يحاكي نتيجة list*() المُرقَّمة من الخادم لقسم — نفس الشكل الذي تعيده paginate_ فعليًا. */
const lazyPage = list => ({loading: false, items: list || [], total: (list || []).length, page: 1, totalPages: 1, pageSize: 25});
const setRole = data => {
  app.state.data = data;
  app.state.user = data.user;
  app.state.lazy = {
    audit: {loading: false, items: data.audit || [], total: (data.audit || []).length, page: 1, totalPages: 1, pageSize: 25},
    activities: {loading: false, activities: data.activities || [], stages: data.stages || [], evidence: data.evidence || []},
    applications: {loading: false, items: data.applications || [], total: (data.applications || []).length, page: 1, totalPages: 1, pageSize: 25},
    beneficiaries: lazyPage(data.beneficiaries), associations: lazyPage(data.associations),
    devices: lazyPage(data.devices), delegates: lazyPage(data.delegates)
  };
};
const out = () => registry.root.innerHTML;

/* ---------------- 1) شاشة الدخول ---------------- */

section('1) شاشة الدخول');
app.renderLogin();
assert('ترسم شاشة الدخول', out().includes('تسجيل الدخول'));
assert('تعرض Brand Lockup الثنائي (شعارين جنبًا لجنب بلا نص)', out().includes('lockup-duo') && out().includes('lockup-duo-divider'));
assert('لا تعرض مربعًا خلف الشعار', !out().includes('background:#000'));
assert('شعار الزاد الفعلي مضمَّن (data URI حقيقي لا بديل نصي)',
  app.BRAND.zadLogo.indexOf('data:image/png;base64,') === 0 && app.BRAND.zadLogo.length > 1000);
assert('شعار مؤسسة أبانمي الفعلي مضمَّن (data URI حقيقي لا بديل نصي)',
  app.BRAND.partnerLogo.indexOf('data:image/png;base64,') === 0 && app.BRAND.partnerLogo.length > 1000);
assert('شاشة الدخول تعرض وسم <img> فعليًا لشعار الزاد (لا SVG بديل)', out().includes('class="lockup-logo"'));
assert('شاشة الدخول تعرض وسم <img> فعليًا لشعار الشريك (لا اسم نصي بديل)', out().includes('class="lockup-partner-logo"'));
app.state.loginType = 'delegate';
app.renderLogin();
assert('تبديل تبويب المندوب يعرض حقل الرمز', out().includes('رمز دخول المندوب'));
assert('لا يظهر رابط تقديم طلب انضمام في وضع دخول المندوب', !out().includes('show-apply'));
app.state.loginType = 'association';
app.renderLogin();
assert('يظهر رابط تقديم طلب انضمام جمعية في شاشة الدخول', out().includes('show-apply'));
app.renderApplyForm();
assert('ترسم نموذج طلب الانضمام العام', out().includes('submit-application'));
assert('نموذج الطلب يطلب اسم الجمعية والبريد', out().includes('name="name"') && out().includes('name="email"'));
app.renderLogin();

/* ---------------- 2) لوحة الإدارة ---------------- */

section('2) دور الإدارة (ADMIN)');
setRole(ADMIN_DATA);
const adminNav = app.navFor('ADMIN');
assert('قائمة الإدارة تحتوي الجمعيات والأنشطة', adminNav.includes('associations') && adminNav.includes('activities'));
assert('قائمة الإدارة تتضمن الإعدادات (تغيير كلمة المرور)', adminNav.includes('settings'));
app.state.page = 'dashboard'; app.render();
assert('الشريط الجانبي يعرض شعار الزاد الفعلي (مضغوط، بلا شعار الشريك المكرّر)',
  out().includes('class="lockup-logo"') && !out().includes('class="lockup-partner-logo"'));

const adminPages = ['dashboard', 'applications', 'beneficiaries', 'associations', 'devices', 'delegates', 'activities', 'audit', 'settings'];
adminPages.forEach(page => {
  app.state.page = page;
  app.state.search = '';
  app.state.filter = '';
  let error = null;
  try { app.render(); } catch (e) { error = e; }
  assert('ترسم صفحة ' + page, !error && out().length > 200, error && error.message);
});

app.state.page = 'associations';
app.render();
assert('زر إضافة جمعية يظهر للإدارة', out().includes('new-association'));
app.state.page = 'devices';
app.render();
assert('زر إضافة جهاز يظهر للإدارة', out().includes('new-device'));

app.state.page = 'dashboard';
app.render();
assert('مؤشر المستفيدين في لوحة الإدارة قابل للنقر', out().includes('data-act="kpi-nav"') && out().includes('data-page="beneficiaries"'));
const fakeKpiEl = { getAttribute: k => ({ 'data-page': 'devices', 'data-filter': 'تم التسليم' })[k] };
app.CLICK_ACTIONS['kpi-nav'](fakeKpiEl);
assert('النقر على مؤشر "تم تسليمها" ينقل لصفحة الأجهزة', app.state.page === 'devices');
assert('النقر على المؤشر يطبّق فلتر الحالة المرتبط به', app.state.filter === 'تم التسليم');
assert('النقر على مؤشر مرتبط بصفحة مُرقَّمة خادميًا يطلب صفحتها من الخادم فعليًا (لا فلترة محلية فقط)',
  serverCalls.some(c => c.method === 'listDevices'));
app.state.page = 'dashboard'; app.state.filter = ''; app.render();

/* ---------------- 2ب) أقسام الأنشطة الثلاثة في لوحة بيانات الإدارة ---------------- */

const activitiesFixture = [
  {stage: 'التجهيز', mainActivity: 'التعاقد', subActivity: 'توقيع العقود', owner: 'إدارة المشروع',
    endDate: '2026/01/01', progress: 100, status: 'مكتمل', evidenceUrl: 'https://drive.example/e1'},
  {stage: 'التنفيذ', mainActivity: 'التوزيع', subActivity: 'توزيع الدفعة الأولى', owner: 'فريق الميدان',
    endDate: '2026/09/01', progress: 40, status: 'جارٍ', evidenceUrl: ''},
  {stage: 'التنفيذ', mainActivity: 'التوزيع', subActivity: 'توزيع الدفعة الثانية', owner: 'فريق الميدان',
    endDate: '2026/12/01', progress: 0, status: 'لم يبدأ', evidenceUrl: ''}
];
app.state.lazy.activities = {loading: false, activities: activitiesFixture, stages: [], evidence: []};
app.state.page = 'dashboard';
app.render();
assert('لوحة بيانات الإدارة تعرض قسم "مكتمل" مع رابط الشاهد', out().includes('توقيع العقود') && out().includes('الشاهد ↗'));
assert('لوحة بيانات الإدارة تعرض قسم "جارٍ حاليًا" بنسبة التقدّم', out().includes('توزيع الدفعة الأولى') && out().includes(app.fmt(40) + '٪'));
assert('لوحة بيانات الإدارة تعرض قسم "المهمة القادمة" مع موعدها', out().includes('توزيع الدفعة الثانية') && out().includes('2026/12/01'));
assert('عناصر الأنشطة الثلاثة قابلة للنقر لفتح تفاصيلها', out().includes('data-act="edit-activity"'));
app.state.lazy.activities = {loading: false, activities: [], stages: [], evidence: []};
app.render();
assert('لوحة بيانات بلا أنشطة إطلاقًا لا تعرض أقسامًا فارغة مضلِّلة', !out().includes('لا توجد أنشطة مكتملة'));

setRole(ASSOCIATION_DATA);
app.state.page = 'dashboard';
app.render();
assert('أقسام الأنشطة الثلاثة إدارية فقط، لا تظهر لبوابة الجمعية', !out().includes('المهمة القادمة'));
setRole(ADMIN_DATA);
app.state.page = 'dashboard'; app.state.filter = ''; app.render();

/* ---------------- 2ج) حالات التحميل والفراغ والترقيم للقوائم المُرقَّمة خادميًا ---------------- */

['beneficiaries', 'associations', 'devices', 'delegates'].forEach(key => {
  app.state.page = key;
  app.state.lazy[key] = {loading: true};
  let err = null;
  try { app.render(); } catch (e) { err = e; }
  assert('صفحة ' + key + ' تعرض حالة تحميل هيكلية أثناء الجلب (لا محتوى مسبق مضلِّل)',
    !err && out().includes('sk-card'), err && err.message);

  app.state.lazy[key] = {loading: false, items: [], total: 0, page: 1, totalPages: 1};
  app.render();
  assert('صفحة ' + key + ' تعرض حالة فراغة مفسَّرة لا جدولًا فارغًا بلا تفسير',
    out().includes('empty') || out().includes('لا توجد') || out().includes('لا نتائج') || out().includes('لم يُضف'));
});

app.state.lazy.devices = {loading: false, items: ADMIN_DATA.devices, total: 40, page: 1, totalPages: 2, pageSize: 25};
app.state.page = 'devices';
app.render();
assert('صفحة بها أكثر من صفحة واحدة تعرض أزرار تنقّل صفحات فعليّة', out().includes('devices-next-page'));
app.CLICK_ACTIONS['devices-next-page']();
assert('زر "التالي" يطلب الصفحة التالية من الخادم فعليًا', serverCalls.filter(c => c.method === 'listDevices').length >= 2);

setRole(ADMIN_DATA);

app.state.page = 'applications';
app.render();
assert('طلب قيد المراجعة يعرض زري قبول ورفض', out().includes('accept-application') && out().includes('reject-application'));
assert('قائمة الإدارة تعرض تبويب طلبات الانضمام', adminNav.includes('applications'));
app.viewApplication('APP-000001');
const applicationBody = registry.modalRoot.innerHTML;
assert('نافذة تفاصيل الطلب تعرض بيانات مقدّم الطلب', applicationBody.includes('سالم العتيبي') && applicationBody.includes('amal@example.org'));
app.closeModal();

app.state.page = 'activities';
app.state.activityTab = '';
app.render();
assert('زر إضافة نشاط يظهر للإدارة', out().includes('new-activity'));
assert('تبويبات تصفية الأنشطة تظهر', out().includes('activity-tab') && out().includes('متأخرة'));
assert('زر تعديل نشاط يظهر لكل صف', out().includes('edit-activity'));
app.state.activityTab = 'متأخر';
app.render();
assert('تصفية "متأخرة" تُبقي فقط الأنشطة المتأخرة', out().includes('توقيع العقود') && !out().includes('لا توجد أنشطة مطابقة'));
app.state.activityTab = 'مكتمل';
app.render();
assert('تصفية "مكتملة" تُخفي نشاطًا متأخرًا وتعرض حالة فارغة مناسبة', out().includes('لا توجد أنشطة مطابقة'));
app.state.activityTab = '';
app.render();
app.activityForm('', '', '');
assert('نموذج إضافة نشاط جديد يظهر بحقوله الأساسية', registry.modalRoot.innerHTML.includes('name="stage"')
  && registry.modalRoot.innerHTML.includes('name="mainActivity"') && registry.modalRoot.innerHTML.includes('name="subActivity"'));
app.closeModal();
app.activityForm('التجهيز', 'التعاقد', 'توقيع العقود');
assert('نموذج تعديل نشاط قائم يُعبَّأ ببياناته الحالية', registry.modalRoot.innerHTML.includes('value="التجهيز"'));
app.closeModal();

/* ---------------- 3) لوحة الجمعية ---------------- */

section('3) دور الجمعية (ASSOCIATION)');
setRole(ASSOCIATION_DATA);
const assocNav = app.navFor('ASSOCIATION');
assert('قائمة الجمعية لا تحتوي إدارة الجمعيات', !assocNav.includes('associations'));
assert('قائمة الجمعية لا تحتوي الأنشطة العامة', !assocNav.includes('activities'));

['dashboard', 'beneficiaries', 'devices', 'delegates', 'audit', 'settings'].forEach(page => {
  app.state.page = page;
  app.state.search = '';
  app.state.filter = '';
  let error = null;
  try { app.render(); } catch (e) { error = e; }
  assert('ترسم صفحة ' + page, !error && out().length > 200, error && error.message);
});

app.state.page = 'beneficiaries';
app.render();
assert('زر الإضافة بالجملة يظهر للجمعية', out().includes('bulk-import'));
assert('زر تعيين المندوب يظهر لمستفيد غير مسلَّم', out().includes('assign-delegate'));
app.state.page = 'devices';
app.render();
assert('الجمعية لا ترى زر إضافة جهاز', !out().includes('new-device'));

app.beneficiaryForm('');
assert('نموذج المستفيد يعرض حقلي الإحداثيات وزر تحديد الموقع', registry.modalRoot.innerHTML.includes('name="lat"')
  && registry.modalRoot.innerHTML.includes('name="lng"') && registry.modalRoot.innerHTML.includes('use-my-location'));
assert('نموذج المستفيد يعرض حقل العلامة المميزة الاختياري', registry.modalRoot.innerHTML.includes('name="landmark"'));
assert('نموذج المستفيد يعرض حاوية الخريطة وأزرار المسح وفتح الخرائط', registry.modalRoot.innerHTML.includes('id="locationMap"')
  && registry.modalRoot.innerHTML.includes('clear-location') && registry.modalRoot.innerHTML.includes('open-location-maps'));
assert('نموذج المستفيد يعرض حقل مصدر الموقع المخفي', registry.modalRoot.innerHTML.includes('id="f_locationSource"'));
assert('حقلا الإحداثيات اليدويان بنطاق عالمي (-90..90 / -180..180) لا نطاق السعودية فقط',
  registry.modalRoot.innerHTML.includes('min="-90" max="90"') && registry.modalRoot.innerHTML.includes('min="-180" max="180"'));
app.closeModal();

/* ---------------- 3ب) اختيار الموقع بصريًا: منطق الخريطة والبدائل الآمنة ---------------- */

section('3ب) اختيار الموقع بصريًا وبدائل الفشل');

assert('locationCoordsLabel تعرض رسالة واضحة بلا موقع', app.locationCoordsLabel(null, null) === 'لم يُحدَّد موقع بعد.');
assert('locationCoordsLabel تعرض الإحداثيات المنسَّقة عند وجودها',
  app.locationCoordsLabel(24.7136, 46.6753).includes('24.713600') && app.locationCoordsLabel(24.7136, 46.6753).includes('46.675300'));

app.beneficiaryForm('');
registry.f_lat = new El('input'); registry.f_lat.id = 'f_lat';
registry.f_lng = new El('input'); registry.f_lng.id = 'f_lng';
registry.f_locationSource = new El('input'); registry.f_locationSource.id = 'f_locationSource';
registry.locationCoordsHint = new El('span'); registry.locationCoordsHint.id = 'locationCoordsHint';
registry.locationMapStatus = new El('span'); registry.locationMapStatus.id = 'locationMapStatus';
registry.locationMap = new El('div'); registry.locationMap.id = 'locationMap';
registry.f_address = new El('input'); registry.f_address.id = 'f_address';

assert('initLocationPicker لا يفشل حتى بلا مكتبة خريطة محمَّلة فعليًا (بيئة الاختبار بلا شبكة)', (() => {
  let error = null;
  try { app.initLocationPicker({}); } catch (e) { error = e; }
  return !error;
})());

app.setLocationFromLatLng(24.7136, 46.6753, 'خريطة');
assert('setLocationFromLatLng يعبّئ حقلي الإحداثيات', registry.f_lat.value === '24.713600' && registry.f_lng.value === '46.675300');
assert('setLocationFromLatLng يضبط مصدر الموقع إلى القيمة الممرَّرة', registry.f_locationSource.value === 'خريطة');
assert('setLocationFromLatLng يحدّث نص الإحداثيات المعروض', registry.locationCoordsHint.innerHTML.includes('24.713600'));

app.clearLocationFields();
assert('clearLocationFields يفرّغ الحقلين ومصدر الموقع', registry.f_lat.value === '' && registry.f_lng.value === '' && registry.f_locationSource.value === '');

let lastOpenUrl = null;
app.window.open = (url) => { lastOpenUrl = url; return { opener: null }; };
registry.f_lat.value = '24.7136'; registry.f_lng.value = '46.6753';
app.openLocationInMaps();
assert('فتح الموقع في خرائط جوجل يستخدم الإحداثيات عند توفّرها', lastOpenUrl && lastOpenUrl.includes('query=24.7136,46.6753'));

registry.f_lat.value = ''; registry.f_lng.value = ''; registry.f_address.value = 'حي النرجس';
lastOpenUrl = null;
app.openLocationInMaps();
assert('بلا إحداثيات: فتح الموقع يسقط تلقائيًا للعنوان النصي', lastOpenUrl && lastOpenUrl.includes('query=') && !lastOpenUrl.includes('undefined'));

registry.f_lat.value = ''; registry.f_lng.value = ''; registry.f_address.value = '';
lastOpenUrl = null;
const toastCountBefore = registry.toasts.children.length;
app.openLocationInMaps();
assert('بلا إحداثيات وبلا عنوان: لا يُفتح رابط فارغ، بل تنبيه واضح فقط', !lastOpenUrl && registry.toasts.children.length > toastCountBefore);

app.closeModal();
delete registry.f_lat; delete registry.f_lng; delete registry.f_locationSource;
delete registry.locationCoordsHint; delete registry.locationMapStatus; delete registry.locationMap; delete registry.f_address;

/* ---------------- 4) البحث والفلاتر ---------------- */

// المستفيدون لم يعودوا يُصفَّون محليًا (listBeneficiaries على الخادم يُصفّي
// ويُرقّم قبل الإرسال، مثل سجل العمليات وطلبات الانضمام تمامًا) — smoke.js
// يختبر هنا فقط أن صفحة المستفيدين ترسم ما وصلها في state.lazy.beneficiaries
// بشكل صحيح لكل حالة (نتائج/بحث فارغ/تحميل)، لا منطق البحث الخادمي نفسه
// (ذاك مختبَر في server-test.js/reference-test.js عبر applySearch_ فعليًا).
app.state.page = 'beneficiaries';
app.state.search = 'فاطمة';
app.state.filter = '';
app.state.lazy.beneficiaries = lazyPage([ADMIN_DATA.beneficiaries[0]]);
app.render();
assert('البحث بالاسم يُرجع نتيجة', out().includes('فاطمة العتيبي'));

app.state.search = 'لا-يوجد-هذا-الاسم';
app.state.lazy.beneficiaries = lazyPage([]);
app.render();
assert('بحث بلا نتائج يعرض حالة فارغة مفيدة', out().includes('لا نتائج مطابقة'));

app.state.search = '';
app.state.filter = '';
app.state.lazy.beneficiaries = lazyPage([ADMIN_DATA.beneficiaries[0]]);
app.render();
assert('الفلتر الافتراضي "كل الحالات" لا يُخفي السجلات', out().includes('فاطمة العتيبي'));

app.state.filter = 'جاري التجهيز';
app.render();
assert('الفلتر بحالة موجودة يُبقي السجل (بيانات الصفحة كما وصلت من الخادم)', out().includes('فاطمة العتيبي'));

app.state.filter = 'ملغي';
app.state.lazy.beneficiaries = lazyPage([]);
app.render();
assert('الفلتر بحالة غير مطابقة يُخفي السجل (الخادم يُعيد صفحة فارغة)', !out().includes('فاطمة العتيبي'));
app.state.filter = '';
setRole(ADMIN_DATA);
app.state.page = 'beneficiaries';
app.state.lazy.beneficiaries = lazyPage(ADMIN_DATA.beneficiaries);
app.render();
assert('حقلا فلتر الجمعية والترتيب يظهران للإدارة في صفحة المستفيدين',
  out().includes('data-act="set-assoc-filter"') && out().includes('data-act="set-sort"'));
setRole(ASSOCIATION_DATA);
app.state.page = 'beneficiaries';
app.state.lazy.beneficiaries = lazyPage(ASSOCIATION_DATA.beneficiaries);
app.render();
assert('حقل فلتر الجمعية لا يظهر للجمعية (مقيَّدة بجمعيتها من الخادم أصلًا، لا حاجة لاختيار)',
  !out().includes('data-act="set-assoc-filter"'));

// سجل العمليات لم يعد يُصفَّى محليًا (listAuditLog على الخادم يُصفّي
// ويُرقّم قبل الإرسال) — smoke.js يختبر هنا فقط أن الصفحة ترسم ما وصلها
// في state.lazy.audit.items بشكل صحيح لكل حالة (نتائج/بحث فارغ/تحميل)،
// لا منطق البحث نفسه (ذاك مختبَر خادميًا في account-test.js/server-test.js).
setRole(ADMIN_DATA);
app.state.page = 'audit'; app.state.search = ''; app.state.filter = ''; app.render();
assert('سجل العمليات يعرض شريط بحث وتصفية بالقسم', out().includes('data-act="set-search"') && out().includes('data-act="set-filter"'));
assert('سجل العمليات يعرض السجل الموجود افتراضيًا', out().includes('إضافة مستفيد'));

app.state.lazy.audit = {loading: false, items: [], total: 0, page: 1, totalPages: 1, pageSize: 25};
app.render();
assert('نتيجة بحث فارغة من الخادم تعرض حالة فارغة مناسبة', out().includes('لا توجد عمليات مسجّلة'));

app.state.lazy.audit = {loading: true, items: [], total: 0, page: 1, totalPages: 1, pageSize: 25};
app.render();
assert('حالة التحميل تعرض هيكلًا عظميًا بدل صفوف فارغة مضلِّلة', out().includes('sk-card'));

app.state.lazy.audit = {loading: false, items: ADMIN_DATA.audit, total: 40, page: 2, totalPages: 2, pageSize: 25};
app.render();
assert('صفحة ثانية من النتائج تعرض أزرار تنقّل بين الصفحات', out().includes('audit-prev-page') && out().includes('audit-next-page'));
app.state.filter = '';
setRole(ADMIN_DATA);

/* ---------------- 5) الحالات الفارغة ---------------- */

section('5) الحالات الفارغة');
setRole(Object.assign({}, ASSOCIATION_DATA, { beneficiaries: [], devices: [], delegates: [], audit: [] }));
app.state.page = 'beneficiaries'; app.state.search = ''; app.render();
assert('حالة فارغة للمستفيدين مع دعوة لإجراء', out().includes('لم يُضف أي مستفيد بعد') && out().includes('new-beneficiary'));
app.state.page = 'delegates'; app.render();
assert('حالة فارغة للمناديب', out().includes('لا يوجد مناديب'));
app.state.page = 'devices'; app.render();
assert('حالة فارغة للأجهزة', out().includes('لا توجد أجهزة مسجّلة'));
app.state.page = 'audit'; app.render();
assert('حالة فارغة لسجل العمليات', out().includes('لا توجد عمليات مسجّلة'));

/* ---------------- 6) واجهة المندوب ---------------- */

section('6) دور المندوب (DELEGATE)');
setRole(DELEGATE_DATA);
let delegateError = null;
try { app.render(); } catch (e) { delegateError = e; }
assert('ترسم واجهة المندوب', !delegateError && out().includes('مهام التسليم'), delegateError && delegateError.message);
assert('تعرض عدد المتبقّين', out().includes('مستفيدون متبقّون'));
assert('رأس بوابة المندوب يعرض شعاري الزاد والشريك معًا',
  out().includes('class="lockup-logo"') && out().includes('class="lockup-partner-logo"'));

const listHtml = app.renderDelegateList();
assert('رابط واتساب سليم', listHtml.includes('https://wa.me/966501234567'));
assert('رابط الخرائط سليم وقابل للفتح', listHtml.includes('https://www.google.com/maps/search/?api=1&amp;query='));
assert('لا توجد بقايا Markdown في رابط الخرائط', !listHtml.includes(']('));

const brokenPhoneData = JSON.parse(JSON.stringify(DELEGATE_DATA));
brokenPhoneData.beneficiaries[0].phone = '550791650';
setRole(brokenPhoneData);
const brokenPhoneHtml = app.renderDelegateList();
assert('رابط واتساب سليم حتى مع رقم قديم بلا صفر بادئ', brokenPhoneHtml.includes('https://wa.me/966550791650'));
assert('رابط الاتصال سليم حتى مع رقم قديم بلا صفر بادئ', brokenPhoneHtml.includes('tel:0550791650'));
setRole(DELEGATE_DATA);
assert('زر الاتصال يحمل بديل النسخ عند حجب المتصفح', brokenPhoneHtml.includes('data-act="call-fallback"'));
assert('زر نسخ الرقم يظهر دائمًا كبديل صريح (لا ينتظر فشل الاتصال أولًا)', listHtml.includes('data-act="copy-phone"'));
assert('زر التسليم مفعّل عند وجود أجهزة', listHtml.includes('dg-deliver') && !listHtml.includes('dg-deliver" disabled'));

const withLandmark = JSON.parse(JSON.stringify(DELEGATE_DATA));
withLandmark.beneficiaries[0].landmark = 'بجانب المسجد';
setRole(withLandmark);
assert('العلامة المميزة تظهر في عنوان بطاقة المستفيد لدى المندوب', app.renderDelegateList().includes('بجانب المسجد'));

const noLocationAtAll = JSON.parse(JSON.stringify(DELEGATE_DATA));
noLocationAtAll.beneficiaries[0].address = '';
noLocationAtAll.beneficiaries[0].city = '';
noLocationAtAll.beneficiaries[0].lat = null;
noLocationAtAll.beneficiaries[0].lng = null;
setRole(noLocationAtAll);
const noLocationHtml = app.renderDelegateList();
assert('بلا عنوان ولا إحداثيات: زر الموقع يعرض تنبيهًا بدل رابط خرائط فارغ',
  noLocationHtml.includes('data-act="no-location-alert"') && !noLocationHtml.includes('www.google.com/maps/search/?api=1&query= '));
setRole(DELEGATE_DATA);
assert('زر التسليم مفعّل عند وجود أجهزة', listHtml.includes('dg-deliver') && !listHtml.includes('dg-deliver" disabled'));

const noDevices = JSON.parse(JSON.stringify(DELEGATE_DATA));
noDevices.beneficiaries[0].devices = [];
setRole(noDevices);
assert('زر التسليم معطّل بلا أجهزة (يمنع التسليم العرضي)', app.renderDelegateList().includes('disabled'));

setRole(DELEGATE_DATA);
app.state.delegatePage = 'history';
app.renderDelegate();
assert('تبويب السجل يعمل', out().includes('نورة السالم'));

app.state.delegatePage = 'route';
app.state.delegateRoute = null;
app.renderDelegate();
assert('تبويب مسار اليوم يعرض زر تحديد الموقع', out().includes('delegate-locate'));
assert('مستفيد بلا إحداثيات يظهر في قائمة منفصلة قبل حساب المسار', out().includes('بلا إحداثيات'));

assert('haversineKm تُعيد صفرًا لنفس النقطة', app.haversineKm(24.7, 46.6, 24.7, 46.6) === 0);
const riyadhJeddahKm = app.haversineKm(24.7136, 46.6753, 21.4858, 39.1925);
assert('haversineKm تحسب مسافة واقعية تقريبًا بين الرياض وجدة (٨٠٠–٩٥٠ كم)',
  riyadhJeddahKm > 800 && riyadhJeddahKm < 950);

app.state.delegateRoute = {
  origin: {lat: 24.7, lng: 46.6},
  ordered: [{item: Object.assign({}, DELEGATE_DATA.beneficiaries[0], {lat: 24.71, lng: 46.61}), distanceKm: 1.4}]
};
app.renderDelegate();
assert('مسار محسوب يعرض ترتيب المستفيد والمسافة التقريبية', out().includes('بعد تقريبي بخط مستقيم: 1.4 كم'));
assert('مسار محسوب يوضّح صراحة أن المسافة تقريبية بخط مستقيم لا توجيهًا فعليًا',
  out().includes('مسافة تقريبية بخط مستقيم'));
assert('مسار محسوب يستخدم رابط خرائط بالإحداثيات الدقيقة', out().includes('query=24.71,46.61'));
assert('كل محطة في المسار تعرض أزرار التواصل الكاملة (واتساب/اتصال/نسخ/موقع)',
  out().includes('a-wa') && out().includes('a-call') && out().includes('data-act="copy-phone"'));
assert('كل محطة في المسار تعرض الأجهزة المخصَّصة', out().includes('ثلاجة'));

// محاكاة "تحديث المسار دون إعادة تحميل النظام كاملًا": بعد أن يُستبدَل
// مرجع كائن المستفيد في state.data.beneficiaries (كما تفعل upsertRecord
// فعليًا بعد تأكيد تسليم أو تسجيل تعذّر)، يجب أن تعكس بطاقة المحطة في
// المسار نفسه الحالة الجديدة فورًا دون إعادة بناء المسار بالكامل.
app.state.data.beneficiaries[0] = Object.assign({}, app.state.data.beneficiaries[0], {
  deliveryStatus: 'تم التسليم', status: 'تم التسليم'
});
app.renderDelegate();
assert('تحديث حالة التسليم عبر استبدال المرجع (upsertRecord) ينعكس فورًا في بطاقة المسار دون إعادة حسابه',
  out().includes('dg-card-done'));
assert('محطة مُسلَّمة: زر تأكيد التسليم يصبح معطَّلًا (لا تكرار تأكيد)',
  /a-deliver" data-act="dg-deliver" data-id="BEN-000001" disabled/.test(out()));
app.state.delegateRoute = null;
app.state.delegatePage = 'list';

const emptyDelegate = Object.assign({}, DELEGATE_DATA, { beneficiaries: [] });
setRole(emptyDelegate);
assert('حالة "أنجزت مهامك" للمندوب', app.renderDelegateList().includes('أنجزت جميع مهامك'));

/* ---------------- 7) الهروب من HTML ---------------- */

section('7) الحماية من XSS وحقن HTML');
const evil = '<img src=x onerror=alert(1)>';
assert('esc يهرب الوسوم', app.esc(evil) === '&lt;img src=x onerror=alert(1)&gt;');
assert('esc يهرب علامات الاقتباس', app.esc('a"b\'c') === 'a&quot;b&#039;c');

const xssData = JSON.parse(JSON.stringify(ASSOCIATION_DATA));
xssData.beneficiaries = [Object.assign({}, ADMIN_DATA.beneficiaries[0], {
  name: evil, notes: '</script><script>alert(2)</script>', address: '"><b>x</b>'
})];
setRole(xssData);
app.state.page = 'beneficiaries'; app.state.search = ''; app.state.filter = '';
app.render();
assert('اسم خبيث لا يُنتج وسمًا فعّالًا', !out().includes('<img src=x'));
assert('لا يُنتج إغلاق script من بيانات', !out().toLowerCase().includes('</script>'));

/* ---------------- 8) تنسيق الأرقام والحالات ---------------- */

section('8) أدوات العرض');
assert('fmt يعيد أرقامًا عربية منسّقة', typeof app.fmt(1234) === 'string' && app.fmt(1234).length > 0);
assert('pct يقيّد النسبة بين 0 و100', app.pct(-5) === 0 && app.pct(150) === 100 && app.pct(42) === 42);
assert('statusClass يميّز التسليم الناجح', app.statusClass('تم التسليم') === 'good');
assert('statusClass يميّز التعذر', app.statusClass('تعذر التسليم') === 'bad');
assert('الحالة تُعرض نصًا لا لونًا فقط', app.statusChip('تم التسليم').includes('تم التسليم'));
assert('phoneIntl يحوّل 05 إلى 9665', app.phoneIntl('0501234567') === '966501234567');
assert('phoneIntl يترك الرقم الدولي كما هو', app.phoneIntl('966501234567') === '966501234567');
assert('phoneIntl يعالج 9 أرقام بلا صفر (العطل المرصود حيًّا: 550791650)',
  app.phoneIntl('550791650') === '966550791650');
assert('phoneLocal يعيد صفرًا بادئًا لبيانات قديمة ناقصة', app.phoneLocal('550791650') === '0550791650');
assert('phoneLocal يطبّع الصيغة الدولية إلى المحلية', app.phoneLocal('966550791650') === '0550791650');
assert('phoneLocal يترك الصيغة المحلية الصحيحة كما هي', app.phoneLocal('0550791650') === '0550791650');

/* ---------------- 9) قراءة CSV ---------------- */

section('9) استيراد CSV');
const csv = 'الاسم,المنطقة,المدينة,العنوان,الجوال,عدد الأفراد,الضمان,الحالة,الدخل,الاحتياج,ملاحظات\n'
  + 'سارة,الرياض,الرياض,حي الياسمين,0501234567,4,نعم,أرملة,3000,ثلاجة,\n';
const parsed = app.parseCsv(csv);
assert('يقرأ صفًا واحدًا صحيحًا', parsed.length === 1);
assert('يربط الأعمدة بأسمائها', parsed[0].name === 'سارة' && parsed[0].city === 'الرياض');
let csvError = null;
try { app.parseCsv('الاسم\n'); } catch (e) { csvError = e; }
assert('يرفض ملفًا بلا سجلات برسالة عربية', csvError && csvError.message.includes('لا يحتوي'));

const csvNoCoords = 'الاسم,المنطقة,المدينة,العنوان,الجوال,عدد الأفراد,الضمان,الحالة,الدخل,الاحتياج,ملاحظات\n'
  + 'نورة,الرياض,الرياض,حي النخيل,0501234568,3,نعم,أرملة,2500,غسالة,\n';
const parsedNoCoords = app.parseCsv(csvNoCoords);
assert('ملف CSV قديم بلا عمودي الإحداثيات يُقرأ بأمان (lat/lng فارغتان لا يفشل التحليل)',
  parsedNoCoords.length === 1 && parsedNoCoords[0].lat === '' && parsedNoCoords[0].lng === '');

const csvWithCoords = 'الاسم,المنطقة,المدينة,العنوان,الجوال,عدد الأفراد,الضمان,الحالة,الدخل,الاحتياج,ملاحظات,خط العرض,خط الطول\n'
  + 'هند,الرياض,الرياض,حي الملقا,0501234569,2,نعم,أرملة,2000,ثلاجة,,24.75,46.65\n';
const parsedWithCoords = app.parseCsv(csvWithCoords);
assert('ملف CSV بعمودي الإحداثيات في النهاية يقرأهما بشكل صحيح',
  parsedWithCoords[0].lat === '24.75' && parsedWithCoords[0].lng === '46.65');

const csvWithLandmark = 'الاسم,المنطقة,المدينة,العنوان,الجوال,عدد الأفراد,الضمان,الحالة,الدخل,الاحتياج,ملاحظات,خط العرض,خط الطول,علامة مميزة\n'
  + 'ريم,الرياض,الرياض,حي الملقا,0501234570,2,نعم,أرملة,2000,ثلاجة,,24.75,46.65,بجانب الحديقة\n';
assert('ملف CSV بعمود العلامة المميزة الاختياري في النهاية يقرأه بشكل صحيح',
  app.parseCsv(csvWithLandmark)[0].landmark === 'بجانب الحديقة');
assert('ملف CSV قديم بلا عمود العلامة المميزة يبقى يعمل (فارغ لا يفشل)',
  app.parseCsv(csvWithCoords)[0].landmark === '');

const previewRows = [
  {row: 2, name: 'صحيح', valid: true, lat: 24.7, lng: 46.6},
  {row: 3, name: 'خاطئ', valid: false, error: 'المدينة "جدة" لا تتبع منطقة "الرياض"'}
];
const previewHtml = app.renderBulkPreviewTable(previewRows);
assert('معاينة استيراد Excel تعرض رقم الصف لكل سجل', previewHtml.includes('صف 2') && previewHtml.includes('صف 3'));
assert('معاينة استيراد Excel تعرض الإحداثيات المقروءة للصف الصحيح', previewHtml.includes('24.7، 46.6'));
assert('معاينة استيراد Excel تعرض سبب الخطأ للصف الخاطئ', previewHtml.includes('لا تتبع منطقة'));
assert('معاينة استيراد Excel تميّز الصحيح عن الخاطئ بوضوح', previewHtml.includes('✓ صحيح') && previewHtml.includes('✗ خاطئ'));

app.bulkImportModal();
assert('نافذة الاستيراد الجماعي توضّح أن عمودي الإحداثيات اختياريان وتوافق الملفات القديمة',
  registry.modalRoot.innerHTML.includes('خط العرض وخط الطول') && registry.modalRoot.innerHTML.includes('اختيارية'));
assert('نافذة الاستيراد الجماعي تذكر مرادفات إنجليزية لخط العرض/الطول ("Latitude"/"Longitude")',
  registry.modalRoot.innerHTML.includes('Latitude') && registry.modalRoot.innerHTML.includes('Longitude'));
assert('نافذة الاستيراد الجماعي تذكر عمود العلامة المميزة الاختياري', registry.modalRoot.innerHTML.includes('العلامة المميزة'));
assert('نافذة الاستيراد الجماعي توضّح اشتراط وجود الإحداثيتين معًا أو غيابهما معًا',
  registry.modalRoot.innerHTML.includes('معًا'));
assert('نافذة الاستيراد الجماعي تعرض زر تنزيل قالب CSV', registry.modalRoot.innerHTML.includes('data-act="download-import-template"'));
app.closeModal();

/* ---------------- 9ب) قالب الاستيراد القابل للتنزيل ---------------- */

const templateCsv = app.buildImportTemplateCsv();
const templateRows = app.parseCsv(templateCsv);
assert('قالب الاستيراد يبدأ بعلامة BOM لفتح Excel للعربية بترميز صحيح', templateCsv.charCodeAt(0) === 0xFEFF);
assert('عناوين قالب الاستيراد تطابق ترتيب أعمدة parseCsv بالضبط',
  app.IMPORT_TEMPLATE_HEADERS.join(',') === ['الاسم', 'المنطقة', 'المدينة', 'العنوان', 'الجوال', 'عدد الأفراد',
    'الضمان الاجتماعي', 'الحالة الاجتماعية', 'الدخل', 'الاحتياج', 'الملاحظات', 'خط العرض', 'خط الطول', 'علامة مميزة'].join(','));
assert('صف المثال في القالب يُقرأ صحيحًا عبر parseCsv نفسه (بلا تباين بنية)',
  templateRows.length === 1 && templateRows[0].name === 'سارة العتيبي' && templateRows[0].landmark === 'بجانب المسجد'
  && templateRows[0].lat === '24.7136' && templateRows[0].lng === '46.6753');
assert('downloadImportTemplate لا يفشل حتى بلا Blob/URL في بيئة الاختبار (سقوط آمن بتنبيه بدل استثناء)', (() => {
  let error = null;
  try { app.downloadImportTemplate(); } catch (e) { error = e; }
  return !error;
})());

/* ---------------- 10) المنطقة والمدينة المترابطتان ---------------- */

section('10) حقلا المنطقة والمدينة المترابطان');

setRole(ASSOCIATION_DATA);
app.state.referenceData = null;
assert('قبل تشغيل الترحيل: حقلا نص حرّ كما كانا',
  app.regionCityFields('الرياض', 'الرياض', 'f').includes('name="region"')
  && app.regionCityFields('الرياض', 'الرياض', 'f').includes('<input'));

const mockRef = {
  ready: true,
  regions: ['الرياض', 'مكة المكرمة'],
  citiesByRegion: {'الرياض': ['الرياض', 'الخرج'], 'مكة المكرمة': ['جدة', 'الطائف']},
  deviceTypes: ['ثلاجة', 'غسالة'],
  socialStatuses: ['أرملة', 'يتيم'],
  associationCategories: ['جمعية أهلية', 'جمعية خيرية']
};
app.state.referenceData = mockRef;

const fields = app.regionCityFields('الرياض', 'الخرج', 'f');
assert('بعد الترحيل: قائمتان منسدلتان متلاحقتان', fields.includes('<select') && fields.includes('name="region"') && fields.includes('name="city"'));
assert('قائمة المدن تعرض مدن المنطقة المختارة فقط', fields.includes('الخرج') && !fields.includes('جدة'));
assert('المنطقة المحفوظة محدَّدة مسبقًا', /<option value="الرياض" selected/.test(fields));
assert('ربط القائمتين عبر data-city-target', fields.includes('data-act="region-select"') && fields.includes('data-city-target="f_city"'));

const emptyRegionFields = app.regionCityFields('', '', 'f');
assert('بلا منطقة مختارة: قائمة المدن مقفلة', /id="f_city"[^>]*disabled/.test(emptyRegionFields));

assert('الحالة الاجتماعية تستخدم القائمة المعتمدة بعد الترحيل',
  app.socialStatusOptions().join(',') === mockRef.socialStatuses.join(','));
app.state.referenceData = null;
assert('الحالة الاجتماعية تسقط للثابت المحلي قبل الترحيل',
  app.socialStatusOptions().join(',') === app.SOCIAL_STATUSES.join(','));

app.state.referenceData = mockRef;
const categoryField = app.associationCategoryField('جمعية خيرية');
assert('تصنيف الجمعية يصبح قائمة معتمدة بعد الترحيل', categoryField.includes('<select') && categoryField.includes('جمعية خيرية'));
app.state.referenceData = null;
assert('تصنيف الجمعية نص حرّ قبل الترحيل', app.associationCategoryField('').includes('<input'));

/* ---------------- النتيجة ---------------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
