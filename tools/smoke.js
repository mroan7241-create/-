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
  audit: [{ user: 'مدير النظام', action: 'إضافة مستفيد', section: 'المستفيدون', recordId: 'BEN-000001', at: '2026/07/20 09:00' }]
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

const setRole = data => { app.state.data = data; app.state.user = data.user; };
const out = () => registry.root.innerHTML;

/* ---------------- 1) شاشة الدخول ---------------- */

section('1) شاشة الدخول');
app.renderLogin();
assert('ترسم شاشة الدخول', out().includes('تسجيل الدخول'));
assert('تعرض Brand Lockup للشريك', out().includes('بالشراكة مع'));
assert('لا تعرض مربعًا خلف الشعار', !out().includes('background:#000'));
app.state.loginType = 'delegate';
app.renderLogin();
assert('تبديل تبويب المندوب يعرض حقل الرمز', out().includes('رمز دخول المندوب'));
app.state.loginType = 'association';

/* ---------------- 2) لوحة الإدارة ---------------- */

section('2) دور الإدارة (ADMIN)');
setRole(ADMIN_DATA);
const adminNav = app.navFor('ADMIN');
assert('قائمة الإدارة تحتوي الجمعيات والأنشطة', adminNav.includes('associations') && adminNav.includes('activities'));
assert('قائمة الإدارة تتضمن الإعدادات (تغيير كلمة المرور)', adminNav.includes('settings'));

const adminPages = ['dashboard', 'beneficiaries', 'associations', 'devices', 'delegates', 'activities', 'audit', 'settings'];
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

/* ---------------- 4) البحث والفلاتر ---------------- */

section('4) البحث والفلترة');
app.state.page = 'beneficiaries';
app.state.search = 'فاطمة';
app.state.filter = '';
app.render();
assert('البحث بالاسم يُرجع نتيجة', out().includes('فاطمة العتيبي'));

app.state.search = 'لا-يوجد-هذا-الاسم';
app.render();
assert('بحث بلا نتائج يعرض حالة فارغة مفيدة', out().includes('لا نتائج مطابقة'));

app.state.search = '';
app.state.filter = '';
app.render();
assert('الفلتر الافتراضي "كل الحالات" لا يُخفي السجلات', out().includes('فاطمة العتيبي'));

app.state.filter = 'جاري التجهيز';
app.render();
assert('الفلتر بحالة موجودة يُبقي السجل', out().includes('فاطمة العتيبي'));

app.state.filter = 'ملغي';
app.render();
assert('الفلتر بحالة غير مطابقة يُخفي السجل', !out().includes('فاطمة العتيبي'));
app.state.filter = '';

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
assert('زر التسليم مفعّل عند وجود أجهزة', listHtml.includes('dg-deliver') && !listHtml.includes('dg-deliver" disabled'));

const noDevices = JSON.parse(JSON.stringify(DELEGATE_DATA));
noDevices.beneficiaries[0].devices = [];
setRole(noDevices);
assert('زر التسليم معطّل بلا أجهزة (يمنع التسليم العرضي)', app.renderDelegateList().includes('disabled'));

setRole(DELEGATE_DATA);
app.state.delegatePage = 'history';
app.renderDelegate();
assert('تبويب السجل يعمل', out().includes('نورة السالم'));
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
