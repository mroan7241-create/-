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
// عناصر بوابة التسليم تُسجَّل كعناصر حقيقية في هذا الـDOM المبسّط حتى
// تُختبر منطق التفعيل/التعطيل فعليًا (updateDeliveryGate) لا شكل النص فقط.
['root', 'modalRoot', 'toasts', 'deliverySubmit', 'deliveryGateHint', 'deliveryConfirm']
  .forEach(id => { registry[id] = new El(id === 'deliveryConfirm' ? 'input' : (id === 'deliverySubmit' ? 'button' : 'div')); });

const listeners = {};
const document = {
  getElementById: id => registry[id] || null,
  createElement: tag => new El(tag),
  querySelector: sel => registry[String(sel).replace('#', '')] || null,
  querySelectorAll: () => [],
  addEventListener: (type, fn) => { listeners[type] = fn; },
  contains: () => false,
  activeElement: null,
  documentElement: new El('html'),
  body: new El('body'),
  referrer: ''
};

// location مبسّطة لدعم systemUrl() (رابط "الدخول" في رسائل مشاركة بيانات
// الدخول) — لا حاجة لأكثر من href ثابت هنا؛ الاختبارات الحية تتحقق فقط
// من أن الدالة لا تفشل وتعيد نصًا معقولًا.
const location = { href: 'https://example.com/exec' };

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
  document, google, location,
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
  dashboardModules: {
    beneficiaries: {
      total: 128, new: 10, underReview: 8, approved: 20, awaitingDevices: 15,
      delivering: 15, delivered: 60, stalled: 3,
      deliveryRate: {value: 55, numerator: 60, denominator: 108}
    },
    devices: {
      total: 310, warehouse: 90, allocated: 60, withDelegate: 20, delivered: 160,
      damaged: 5, conflicts: 2
    },
    associations: {
      total: 4, active: 3, inactive: 1, pendingApplications: 1, acceptedApplications: 2,
      rejectedApplications: 1, needsFollowUp: 1,
      progressRate: {value: 52, numerator: 160, denominator: 310}
    },
    activities: {
      total: 20, completed: 9, inProgress: 4, upcoming: 5, late: 2, missingEvidence: 3,
      progressRate: {value: 45, numerator: 9, denominator: 20},
      nextDeadline: {label: 'توزيع الدفعة الثانية', daysLeft: 14}
    }
  },
  beneficiaries: [{
    id: 'BEN-000001', associationId: 'ASC-000001', name: 'فاطمة العتيبي', region: 'الرياض',
    city: 'الرياض', district: 'النرجس', address: 'حي النرجس، شارع الأمير', phone: '0501234567', phone2: '',
    familyCount: 5, socialSecurity: true, socialStatus: 'أرملة', income: 2400,
    needs: ['ثلاجة', 'غسالة'], status: 'معتمد', deliveryStatus: 'جاري التجهيز',
    delegateId: 'MND-000001', notes: 'يفضّل التسليم صباحًا',
    lat: 24.7136, lng: 46.6753, locationConfirmed: true,
    createdAt: '2026/06/01', deliveredAt: '', updatedAt: '2026/07/20 09:00'
  }],
  associations: [{
    id: 'ASC-000001', name: 'جمعية البر', category: 'جمعية أهلية', region: 'الرياض',
    city: 'الرياض', phone: '0551112222', email: 'br@example.org', status: 'نشطة',
    beneficiaries: 40, approvedDevices: 80, receivedDevices: 50, deliveredDevices: 30,
    delegates: 2, progress: 38
  }],
  devices: [{
    id: 'DEV-000001', name: 'ثلاجة', type: 'ثلاجة', associationId: 'ASC-000001',
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
  alerts: [
    { level: 'critical', title: 'نشاط متأخر', message: 'توقيع العقود', section: 'الأنشطة', page: 'activities' },
    { level: 'high', title: 'طلبات انضمام بانتظار المراجعة', message: '1 طلب جمعية جديدة قيد المراجعة', section: 'طلبات الانضمام', page: 'applications', filter: 'قيد المراجعة' },
    { level: 'medium', title: 'مستفيدون بلا مندوب', message: '5 مستفيدين بانتظار تعيين مندوب', section: 'المستفيدون', page: 'beneficiaries', filter: 'لم يبدأ' }
  ],
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
  // lat/lng تُصفَّر صراحة هنا رغم وجودها في ADMIN_DATA.beneficiaries[0]:
  // اختبارات "مسار اليوم" أدناه تفترض عمدًا مستفيدًا بلا إحداثيات لتغطية
  // حالة الفراغ الخاصة بذلك (لا علاقة لهذا بحظر الإحالة نفسه — المستفيد هنا
  // مُسنَد للمندوب فعلًا في بيانات المحاكاة الثابتة، بصرف النظر عن الموقع).
  beneficiaries: [Object.assign({}, ADMIN_DATA.beneficiaries[0], {
    lat: null, lng: null, locationConfirmed: false,
    devices: [{ id: 'DEV-000001', name: 'ثلاجة', status: 'مع المندوب' }]
  })],
  history: [{ id: 'DLV-000001', beneficiaryName: 'نورة السالم', deliveredAt: '2026/07/28 11:00', devices: ['DEV-000002'], hasProof: true }]
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

// إعادة تصميم شاشة الدخول: بلا لوحة تسويقية ولا إحصاءات، نموذج مركزي
// وحيد فوق خلفية زخرفية فقط.
assert('لا توجد لوحة فنية جانبية (login-art) في شاشة الدخول تحديدًا', !out().includes('class="login-art"'));
assert('لا يظهر أي نص ترويجي/إحصائي قديم ("منظومة موحّدة"/"أدوار تشغيلية"/"توثيق بالصورة"/"زادٌ ونَماء")',
  !out().includes('منظومة موحّدة') && !out().includes('أدوار تشغيلية') && !out().includes('توثيق بالصورة') && !out().includes('زادٌ ونَماء'));
assert('الحاوية الرئيسية تحمل صنف "login-solo" (تخطيط عمود واحد مركزي)', out().includes('login login-solo'));
assert('خلفية زخرفية هادئة موجودة (login-bg) بلا أي محتوى نصي داخلها', out().includes('class="login-bg"'));
assert('زر الدخول الأساسي وزر التقديم الثانوي بينهما تباعد صريح (login-secondary-act)', out().includes('class="login-secondary-act"'));
assert('الزر الأساسي (تسجيل الدخول) بصريًا أقوى: btn-primary، والثانوي أخف: btn-ghost', out().includes('btn btn-primary btn-block') && out().includes('btn btn-ghost btn-block'));

// صورة معالم السعودية العامة (خلفية) ومخطوطة "أهلا وسهلا" (داخل البطاقة) —
// كلتاهما مضمَّنتان data URI حقيقيتان لا روابط GitHub خارجية.
assert('صورة خلفية الدخول (معالم سعودية) مضمَّنة data URI حقيقية',
  app.BRAND.loginBg.indexOf('data:image/jpeg;base64,') === 0 && app.BRAND.loginBg.length > 5000);
assert('صورة مخطوطة "أهلا وسهلا" مضمَّنة data URI حقيقية بنسق PNG (شفافية)',
  app.BRAND.loginCalligraphy.indexOf('data:image/png;base64,') === 0 && app.BRAND.loginCalligraphy.length > 5000);
assert('خلفية الدخول تُمرَّر عبر متغيّر CSS مخصَّص (--login-photo) لا اعتماد على رابط خارجي',
  out().includes('--login-photo:url(') && out().includes(app.BRAND.loginBg.slice(0, 40)));
assert('مخطوطة الترحيب تظهر كعنصر <img> داخل بطاقة الدخول (login-calligraphy)، لا فوق صورة الخلفية',
  out().includes('class="login-calligraphy"'));

// صدفة تطبيق ثابتة (login-viewport-lock + .login-solo كـ position:fixed):
// تحلّ محل تخمين min-height/vh القديم بمنع شاشة الدخول من المشاركة في
// ارتفاع المستند إطلاقًا، بدل مجرد مطابقته. --app-viewport-height تُقاس
// بجافاسكربت (visualViewport أولوية، fallback إلى innerHeight) وتُستخدَم
// كـ height فعلي للصدفة لا كحدّ أدنى، مع تحديث مُقيَّد بـ rAF عبر أحداث
// resize/orientationchange/visualViewport كي لا تتراكم المستمعات.
assert('سكربت --app-viewport-height مبكر في <head> (قبل أي محتوى الجسم) لقياس الارتفاع الحقيقي بجافاسكربت',
  html.indexOf('--app-viewport-height') < html.indexOf('<body>') && html.indexOf("setProperty('--app-viewport-height'") > 0);
assert('سكربت --app-viewport-height يستمع لتغيّر الحجم وvisualViewport (لوحة المفاتيح/تدوير الجوال) بلا تكرار مستمعات',
  html.includes("addEventListener('resize', scheduleApply)") && html.includes('window.visualViewport')
  && html.includes("visualViewport.addEventListener('resize', scheduleApply)"));
assert('قياس الارتفاع مُقيَّد بـ requestAnimationFrame (لا تحديث متزامن مباشر عند كل حدث)',
  html.includes('requestAnimationFrame(applyHeight)'));
assert('.login-solo يستخدم height الفعلي (لا min-height) مضبوطًا على var(--app-viewport-height)',
  html.includes('height:var(--app-viewport-height, 100vh)') && !html.includes('min-height:var(--real-vh'));
assert('.login-solo مثبَّتة خارج تدفّق المستند (position:fixed;inset:0) فلا يمكنها زيادة ارتفاع المستند إطلاقًا',
  /\.login-solo\{[^}]*position:fixed;inset:0/.test(html));
assert('صنف login-viewport-lock يقفل تمرير html/body فقط أثناء عرض شاشة الدخول (overflow:hidden + منع الارتداد)',
  html.includes('html.login-viewport-lock') && html.includes('body.login-viewport-lock')
  && /html\.login-viewport-lock[\s\S]{0,150}overflow:hidden/.test(html)
  && html.includes('overscroll-behavior:none'));
assert('دالة setLoginViewportLock تبدّل الصنف على html وbody معًا (idempotent)',
  html.includes('function setLoginViewportLock(active)')
  && html.includes("documentElement.classList.toggle('login-viewport-lock'")
  && html.includes("body.classList.toggle('login-viewport-lock'"));
assert('renderLogin يُفعِّل القفل (أول سطر) وrender() يُلغيه افتراضيًا قبل التفريع لكل شاشة أخرى',
  /function renderLogin\(\)\s*\{\s*setLoginViewportLock\(true\)/.test(html)
  && /function render\(\)\s*\{[\s\S]{0,500}setLoginViewportLock\(false\)/.test(html));
assert('شاشات أخرى (تقديم الجمعية/تغيير كلمة المرور الإلزامي/بوابة المندوب) تُلغي القفل صراحة عند رسمها',
  /function renderApplyForm\([^)]*\)\s*\{\s*setLoginViewportLock\(false\)/.test(html)
  && /function renderForcePasswordChange\(\)\s*\{\s*setLoginViewportLock\(false\)/.test(html)
  && /function renderDelegate\(\)\s*\{\s*setLoginViewportLock\(false\)/.test(html));

app.state.loginType = 'delegate';
app.renderLogin();
assert('تبديل تبويب المندوب يعرض حقل الرمز', out().includes('رمز دخول المندوب'));
assert('لا يظهر رابط تقديم طلب انضمام في وضع دخول المندوب', !out().includes('show-apply'));
assert('تبويب المندوب يعرض رابط "نسيت رمز الدخول؟" لا رابط "نسيت كلمة المرور؟"',
  out().includes('data-act="forgot-delegate-code"') && !out().includes('data-act="forgot-password"'));
app.state.loginType = 'association';
app.renderLogin();
assert('يظهر رابط تقديم طلب انضمام جمعية في شاشة الدخول', out().includes('show-apply'));
assert('تبويب الإدارة/الجمعيات يعرض رابط "نسيت كلمة المرور؟" لا رابط رمز المندوب',
  out().includes('data-act="forgot-password"') && !out().includes('data-act="forgot-delegate-code"'));

/* ---------------- 1ب) استعادة كلمة المرور ونسيان رمز المندوب (واجهة) ---------------- */

app.showForgotPasswordModal();
assert('نافذة "نسيت كلمة المرور؟" تعرض حقل بريد وزر إرسال', registry.modalRoot.innerHTML.includes('id="fp_email"')
  && registry.modalRoot.innerHTML.includes('data-act="submit-forgot-password"'));
app.closeModal();

app.showResetCodeModal('assoc-a@example.org', 'إذا كان البريد مسجلًا فستصلك تعليمات الاستعادة.');
assert('نافذة إدخال رمز الاستعادة تعرض حقول الرمز وكلمة المرور الجديدة وتأكيدها',
  registry.modalRoot.innerHTML.includes('id="rc_code"') && registry.modalRoot.innerHTML.includes('id="rc_next"')
  && registry.modalRoot.innerHTML.includes('id="rc_confirm"') && registry.modalRoot.innerHTML.includes('data-act="submit-reset-code"'));
assert('نافذة إدخال الرمز تحمل البريد في حقل مخفٍّ لا في نص ظاهر مكرَّر',
  registry.modalRoot.innerHTML.includes('type="hidden" name="email" value="assoc-a@example.org"'));
app.closeModal();

app.showForgotDelegateCodeModal();
assert('نافذة "نسيت رمز الدخول؟" رسالة توجيهية فقط بلا حقول أو نداء خادم', !registry.modalRoot.innerHTML.includes('<form')
  && registry.modalRoot.innerHTML.includes('تواصل مع الجمعية'));
app.closeModal();

assert('إجراءات الاستعادة الأربعة مسجَّلة في جدول التوزيع (CLICK_ACTIONS)',
  typeof app.CLICK_ACTIONS['forgot-password'] === 'function' && typeof app.CLICK_ACTIONS['submit-forgot-password'] === 'function'
  && typeof app.CLICK_ACTIONS['submit-reset-code'] === 'function' && typeof app.CLICK_ACTIONS['forgot-delegate-code'] === 'function');
app.renderApplyForm();
assert('ترسم نموذج طلب الانضمام العام', out().includes('submit-application'));
assert('نموذج الطلب يطلب اسم الجمعية والبريد (بريد مبني من اسم مستخدم ونطاق)', out().includes('name="name"') && out().includes('name="emailLocal"') && out().includes('name="emailDomain"'));
// نموذج التقديم لم يُعَد تصميمه (خارج نطاق تبسيط شاشة الدخول) — يحتفظ
// بلوحته الجانبية كما كانت تمامًا؛ انحداره هنا يعني أن تبسيط تخطيط
// الدخول أثّر خطأً في شاشة لم يُطلَب لمسها إطلاقًا.
assert('نموذج التقديم يحتفظ بلوحته الجانبية (login-art) كما كانت — لم يُعَد تصميمه', out().includes('class="login-art"'));
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

/* ---------------- 2ب) لوحة التحكم التنفيذية بالوحدات الست (الإدارة) ---------------- */

assert('لوحة الإدارة تعرض شبكة الوحدات الأربع الأولى (مستفيدون/أجهزة/جمعيات/أنشطة) بدل بطاقات مفردة كثيرة',
  out().includes('class="modules-grid"') && (out().match(/class="module-card"/g) || []).length === 4);
assert('وحدة المستفيدين تعرض كل الحالات المطلوبة بمقام واضح للنسبة', (() => {
  const html = out();
  return ['الإجمالي', 'جديد', 'تحت المراجعة', 'معتمد', 'بانتظار الأجهزة', 'جاري التسليم', 'تم التسليم', 'متعثر']
    .every(label => html.includes(label)) && html.includes('نسبة التسليم: ' + app.fmt(60) + ' من ' + app.fmt(108));
})());
assert('وحدة الأجهزة تعرض تعارضات الحالة بلون تحذيري (mstat critical) عند وجودها',
  /class="mstat clickable critical"[^>]*data-value="devices"/.test(out()));
assert('وحدة الجمعيات والطلبات تعرض حالات الطلبات الثلاث ورابطها للفلتر الصحيح',
  /data-act="go" data-value="applications" data-filter="قيد المراجعة"/.test(out())
  && /data-act="go" data-value="applications" data-filter="مقبول"/.test(out())
  && /data-act="go" data-value="applications" data-filter="مرفوض"/.test(out()));
assert('وحدة الأنشطة تعرض الحالات الأربع وأقرب موعد قادم مع المدة المتبقية',
  ['مكتمل', 'جارٍ', 'قادم', 'متأخر'].every(label => out().includes(label))
  && out().includes('توزيع الدفعة الثانية') && out().includes(app.fmt(14) + ' يومًا'));
assert('كل رقم وحدة قابل للنقر عنصر <button> فعلي مع aria-label واضح (وصول بلوحة المفاتيح وقارئ الشاشة)',
  /<button type="button" class="mstat clickable"[^>]*aria-label="الإجمالي: /.test(out()));
assert('كل رقم وحدة قابل للنقر ينقل إلى الصفحة والفلتر الصحيحين فعليًا (لا فلترة محلية وهمية)', (() => {
  const fakeStatEl = { getAttribute: k => ({ 'data-value': 'devices', 'data-filter': 'تم التسليم' })[k] };
  app.CLICK_ACTIONS['go'](fakeStatEl);
  const ok = app.state.page === 'devices' && app.state.filter === 'تم التسليم'
    && serverCalls.some(c => c.method === 'listDevices');
  app.state.page = 'dashboard'; app.state.filter = ''; app.render();
  return ok;
})());

/* ---------------- 2ج) مركز المتابعة والتنبيهات وآخر العمليات ---------------- */

assert('مركز المتابعة والتنبيهات يظهر مرتَّبًا بالأولوية مع إجراء واضح لكل تنبيه',
  out().includes('مركز المتابعة والتنبيهات') && out().includes('عرض القائمة المرتبطة ←'));
assert('تنبيه "متوسط" (medium) يُعرض بلون تحذيري محايد لا صارخًا', out().includes('class="alert medium"'));
const originalAlerts = app.state.data.alerts;
app.state.data.alerts = [];
app.render();
assert('لا توجد تنبيهات: حالة فراغ صريحة إيجابية بدل قائمة فارغة صامتة', out().includes('لا توجد تنبيهات'));
app.state.data.alerts = originalAlerts;
app.render();
assert('لوحة الإدارة تعرض "آخر العمليات" بلا أي بيانات حساسة (لا كلمة مرور ولا تجزئة)',
  out().includes('آخر العمليات') && !/كلمة المرور|hash|salt/i.test(out()));

const originalModules = app.state.data.dashboardModules;
app.state.data.dashboardModules = null;
let moduleError = null;
try { app.render(); } catch (e) { moduleError = e; }
assert('غياب dashboardModules (بيانات قديمة مخزَّنة مؤقتًا) لا يُسقِط لوحة الإدارة — سقوط آمن بحالة هيكل عظمي',
  !moduleError && out().includes('class="sk sk-card"'));
app.state.data.dashboardModules = originalModules;
app.render();

setRole(ASSOCIATION_DATA);
app.state.page = 'dashboard';
app.render();
assert('وحدات لوحة الإدارة الست إدارية فقط، لا تظهر لبوابة الجمعية', !out().includes('class="modules-grid"'));
assert('بوابة الجمعية تحتفظ بلوحة "حالة التشغيل" ومؤشراتها كما كانت', out().includes('حالة التشغيل'));
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

app.state.page = 'beneficiaries';
app.render();
app.viewBeneficiary('BEN-000001');
const beneficiaryDetailBody = registry.modalRoot.innerHTML;
assert('تفاصيل المستفيد تعرض حاوية سجل التسليم مع رسالة تحميل أولية (تحميل كسول لا فوري)',
  beneficiaryDetailBody.includes('deliveryAttempts') && beneficiaryDetailBody.includes('جارٍ تحميل سجل التسليم'));
assert('فتح تفاصيل المستفيد يطلب سجل محاولات التسليم من الخادم (لا ضمن أي قائمة أو لوحة تحكم)',
  serverCalls.some(c => c.method === 'listBeneficiaryDeliveryAttempts' && c.args[1] === 'BEN-000001'));
assert('تفاصيل المستفيد تعرض حقل الحي وشارة حالة الموقع', beneficiaryDetailBody.includes('النرجس') && beneficiaryDetailBody.includes('موقع مؤكد'));
app.closeModal();

assert('renderDeliveryAttempts تعرض زر عرض الإثبات لمحاولة تحمل صورة',
  app.renderDeliveryAttempts([{ id: 'DLV-000001', status: 'تم التسليم', at: '2026/07/20 09:00', delegateName: 'سعد القحطاني', hasProof: true }]).includes('view-proof'));
assert('renderDeliveryAttempts تعرض حالة فراغ صريحة لمحاولة بلا صورة إثبات بدل عنصر مكسور',
  app.renderDeliveryAttempts([{ id: 'DLV-000002', status: 'تعذر التسليم', at: '2026/07/19 09:00', delegateName: 'سعد القحطاني', hasProof: false, reason: 'لا يرد' }]).includes('لا توجد صورة إثبات'));
assert('renderDeliveryAttempts تعرض حالة فراغ صريحة عند عدم وجود أي محاولات', app.renderDeliveryAttempts([]).includes('لا توجد محاولات تسليم'));

app.viewProofImage('DLV-000001');
assert('viewProofImage يطلب صورة الإثبات من الخادم عبر المسار المحروس getDeliveryProofImage',
  serverCalls.some(c => c.method === 'getDeliveryProofImage' && c.args[1] === 'DLV-000001'));

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
assert('تسليم موثَّق بصورة يعرض زر عرض الإثبات (لا شارة "موثّق" ثابتة بلا فعل)', out().includes('view-proof') && out().includes('DLV-000001'));
const historyNoProof = JSON.parse(JSON.stringify(DELEGATE_DATA));
historyNoProof.history[0].hasProof = false;
setRole(historyNoProof);
app.renderDelegate();
assert('تسليم بلا صورة إثبات يعرض حالة صريحة بدل زر لن يعمل', out().includes('بلا صورة إثبات') && !out().includes('view-proof'));
setRole(DELEGATE_DATA);

app.state.delegatePage = 'route';
app.state.delegateRoute = null;
app.renderDelegate();
// حالة فراغ خاصة بالمسار: كل المستفيدين بلا إحداثيات فلا ترتيب ممكن
// أصلًا — مختلفة تمامًا عن "أنجزت مهامك" ومختلفة عن "المسار لم يُحسب بعد".
assert('كل المستفيدين بلا إحداثيات: حالة فراغ خاصة بالمسار توضّح السبب والبديل',
  out().includes('لا يمكن ترتيب مسار اليوم بعد') && out().includes('العنوان النصي'));
assert('حالة الفراغ هذه تختلف صراحةً عن حالة "أنجزت جميع مهامك"', !out().includes('أنجزت جميع مهامك'));
assert('وتقدّم إجراءً مباشرًا للانتقال إلى قائمة المهام', out().includes('dg-tab-list'));

// مستفيد واحد بإحداثيات وآخر بدونها: المسار ممكن، والحالة الوسيطة
// (لم يُحسب بعد) تعرض زر الترتيب مع بيان كم مستفيدًا يمكن ترتيبه.
const ROUTE_MIXED = JSON.parse(JSON.stringify(DELEGATE_DATA));
ROUTE_MIXED.beneficiaries[0].lat = 24.71;
ROUTE_MIXED.beneficiaries[0].lng = 46.61;
ROUTE_MIXED.beneficiaries.push(Object.assign({}, DELEGATE_DATA.beneficiaries[0], {id: 'BEN-NOGEO', name: 'مستفيد بلا موقع'}));
setRole(ROUTE_MIXED);
app.state.delegatePage = 'route';
app.state.delegateRoute = null;
app.renderDelegate();
assert('تبويب مسار اليوم يعرض زر تحديد الموقع', out().includes('delegate-locate'));
assert('الحالة الوسيطة توضّح كم مستفيدًا جاهزًا للترتيب قبل حسابه', out().includes('المسار جاهز للترتيب'));
assert('مستفيد بلا إحداثيات يظهر في قائمة منفصلة قبل حساب المسار', out().includes('بلا إحداثيات'));

assert('haversineKm تُعيد صفرًا لنفس النقطة', app.haversineKm(24.7, 46.6, 24.7, 46.6) === 0);
const riyadhJeddahKm = app.haversineKm(24.7136, 46.6753, 21.4858, 39.1925);
assert('haversineKm تحسب مسافة واقعية تقريبًا بين الرياض وجدة (٨٠٠–٩٥٠ كم)',
  riyadhJeddahKm > 800 && riyadhJeddahKm < 950);

app.state.delegateRoute = {
  origin: {lat: 24.7, lng: 46.6},
  ordered: [{item: Object.assign({}, ROUTE_MIXED.beneficiaries[0], {lat: 24.71, lng: 46.61}), distanceKm: 1.4}]
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

/* ---------------- 8ب) تطبيع الجوال ورابط واتساب لمشاركة بيانات الدخول ---------------- */

assert('normalizePhoneForShare يطبّع صيغة سعودية محلية (05...) إلى 9665...',
  app.normalizePhoneForShare('0550791650') === '966550791650');
assert('normalizePhoneForShare يطبّع 9 أرقام سعودية بلا صفر بادئ',
  app.normalizePhoneForShare('550791650') === '966550791650');
assert('normalizePhoneForShare يترك الصيغة الدولية الصحيحة (9665...) كما هي',
  app.normalizePhoneForShare('966550791650') === '966550791650');
assert('normalizePhoneForShare يزيل + والمسافات ورمز الاتصال الدولي 00',
  app.normalizePhoneForShare('+966 55 079 1650') === '966550791650'
  && app.normalizePhoneForShare('00966550791650') === '966550791650');
assert('normalizePhoneForShare يقبل رقمًا دوليًا غير سعودي صالح الطول (مصر مثلًا)',
  app.normalizePhoneForShare('+201001234567') === '201001234567');
assert('normalizePhoneForShare يرفض رقمًا قصيرًا جدًا أو فارغًا (null صريح لا رابط فاسد)',
  app.normalizePhoneForShare('12345') === null && app.normalizePhoneForShare('') === null && app.normalizePhoneForShare(null) === null);

assert('buildWhatsAppShareUrl يبني رابط wa.me برقم دولي ونص مُرمَّز بشكل صحيح',
  app.buildWhatsAppShareUrl('0550791650', 'مرحبًا').indexOf('https://wa.me/966550791650?text=') === 0);
assert('buildWhatsAppShareUrl يرمّز الرموز الخاصة والأسطر الجديدة بأمان (encodeURIComponent)',
  app.buildWhatsAppShareUrl('0550791650', 'س\n&=?').includes(encodeURIComponent('س\n&=?')));
assert('buildWhatsAppShareUrl يعيد null لرقم غير صالح بدل رابط فاسد', app.buildWhatsAppShareUrl('12', 'x') === null);

assert('associationAcceptMessage يتضمّن اسم الجمعية والبريد وكلمة المرور المؤقتة دون نص تسويقي إضافي',
  (function () {
    var msg = app.associationAcceptMessage('جمعية تجريبية', 'a@b.com', 'Tmp-XYZ');
    return msg.includes('جمعية تجريبية') && msg.includes('a@b.com') && msg.includes('Tmp-XYZ') && msg.includes('رابط الدخول');
  }()));
assert('delegateWelcomeMessage يتضمّن اسم المندوب ورمز الدخول',
  (function () {
    var msg = app.delegateWelcomeMessage('مندوب تجريبي', 'MND-999999');
    return msg.includes('مندوب تجريبي') && msg.includes('MND-999999') && msg.includes('رابط الدخول');
  }()));

// نافذة عرض السرّ الموحَّدة (كلمة مرور جمعية أو رمز مندوب): تعرض السرّ
// بزر نسخ، وزر نسخ الرسالة كاملة، وزر واتساب فقط إن كان الرقم صالحًا.
app.showCredentialShareModal({
  title: 'تم إنشاء الجمعية', personLabel: 'اسم الجمعية', personName: 'جمعية تجريبية',
  email: 'a@b.com', secretLabel: 'كلمة المرور المؤقتة', secretValue: 'Tmp-XYZ999',
  phone: '0550791650', message: app.associationAcceptMessage('جمعية تجريبية', 'a@b.com', 'Tmp-XYZ999'),
  note: 'ملاحظة تجريبية'
});
assert('نافذة مشاركة بيانات الدخول تعرض السرّ وزر نسخه',
  registry.modalRoot.innerHTML.includes('Tmp-XYZ999') && registry.modalRoot.innerHTML.includes('data-act="copy-secret"'));
assert('نافذة مشاركة بيانات الدخول تعرض زر نسخ الرسالة كاملة', registry.modalRoot.innerHTML.includes('data-act="copy-message"'));
assert('نافذة مشاركة بيانات الدخول تعرض زر إرسال واتساب لرقم صالح، ورابطه يحمل الرسالة كاملة',
  registry.modalRoot.innerHTML.includes('data-act="send-whatsapp"') && registry.modalRoot.innerHTML.includes('wa.me/966550791650'));

app.showCredentialShareModal({
  title: 'تم إنشاء المندوب', personLabel: 'اسم المندوب', personName: 'مندوب تجريبي',
  secretLabel: 'رمز دخول المندوب', secretValue: 'MND-000123',
  phone: 'غير صالح', message: app.delegateWelcomeMessage('مندوب تجريبي', 'MND-000123'),
  note: 'ملاحظة'
});
assert('رقم جوال غير صالح: لا يظهر زر واتساب، ويظهر تنبيه واضح بدل رابط فاسد',
  !registry.modalRoot.innerHTML.includes('data-act="send-whatsapp"') && registry.modalRoot.innerHTML.includes('غير صالح لإرسال واتساب'));
assert('زر نسخ الرسالة كاملة يبقى متاحًا حتى مع رقم جوال غير صالح (بديل يدوي دائم)',
  registry.modalRoot.innerHTML.includes('data-act="copy-message"'));

assert('إجراءا copy-message و send-whatsapp مسجَّلان في جدول التوزيع (CLICK_ACTIONS)',
  typeof app.CLICK_ACTIONS['copy-message'] === 'function' && typeof app.CLICK_ACTIONS['send-whatsapp'] === 'function');

// سجل عمليات المندوب داخل النافذة المنبثقة: خط زمني بديل عن جدول عريض
// (كان يترك مساحة فارغة واضحة أسفله على الجوال بأعمدة قصيرة/فارغة).
const logItems = [
  { action: 'تعيين مندوب', section: 'المستفيدون', notes: 'المندوب: MND-000001', at: '2026/07/20 09:00' },
  { action: 'تأكيد تسليم', section: 'التسليمات', notes: '', at: '2026/07/21 10:15' }
];
const logHtml = app.delegateLogTimeline(logItems);
assert('سجل عمليات المندوب يُعرض كخط زمني (ol.tl) لا جدول عريض', logHtml.includes('<ol class="tl') && !logHtml.includes('<table'));
assert('كل عملية تعرض نوعها وقسمها ووقتها', logHtml.includes('تعيين مندوب') && logHtml.includes('المستفيدون') && logHtml.includes('2026/07/20 09:00'));
assert('الملاحظة تُعرض فقط عند وجودها فعليًا', logHtml.includes('المندوب: MND-000001') && (logHtml.match(/log-tl-note/g) || []).length === 1);
assert('لا عنصر فارغ أو رمز "—" لملاحظة غير موجودة (لا عنصر غير فعّال أسفل السجل)', !logHtml.includes('>—<'));
assert('سجل عمليات فارغ يعرض حالة فراغ صريحة بدل جدول أو خط زمني فارغ',
  app.delegateLogTimeline([]).includes('لا توجد عمليات مسجَّلة'));

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
// تغيير مقصود: القوائم المعتمدة صارت مضمَّنة في الخادم وجاهزة دائمًا،
// فتعذُّر تحميلها خللٌ فعلي يستحق رسالة صريحة وزر إعادة محاولة — لا
// سقوطًا صامتًا إلى حقل نصي حر يُدخِل بيانات غير موحَّدة بلا علم أحد.
app.state.referenceLoading = true;
app.state.referenceError = '';
assert('أثناء تحميل القوائم: حالة تحميل صريحة بلا حقل نص حر ولا زر إعادة محاولة مبكر', (() => {
  const html = app.regionCityFields('الرياض', 'الرياض', 'f');
  return html.includes('ref-fallback') && html.includes('جارٍ تحميل')
    && !html.includes('reload-reference') && !html.includes('<input');
})());

app.state.referenceLoading = false;
app.state.referenceError = 'تعذّر الاتصال بالخادم.';
assert('تعذّر تحميل القوائم: رسالة صريحة وزر إعادة محاولة بدل حقل نص حر صامت', (() => {
  const html = app.regionCityFields('الرياض', 'الرياض', 'f');
  return html.includes('ref-fallback') && html.includes('reload-reference')
    && html.includes('role="alert"') && html.includes('تعذّر الاتصال بالخادم')
    && !html.includes('<input');
})());

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
app.state.referenceLoading = false;
app.state.referenceError = 'تعذّر الاتصال بالخادم.';
assert('تعذّر تحميل القوائم: حقل التصنيف يعرض حالة الخطأ وزر إعادة المحاولة (لا نص حر)', (() => {
  const html = app.associationCategoryField('');
  return html.includes('ref-fallback') && html.includes('reload-reference') && !html.includes('<input');
})());
assert('تعذّر تحميل القوائم: حقل نوع الجهاز كذلك لا يسقط لنص حر', (() => {
  const html = app.deviceTypeField('');
  return html.includes('ref-fallback') && html.includes('reload-reference') && !html.includes('<input');
})());

/* ---------------- 11) الهوية البصرية والجوال والوصول (المرحلة السابعة) ---------------- */

section('11) الهوية البصرية والجوال والوصول');

// خلل مؤكَّد اكتُشف واختُبر فعليًا عبر متصفح Chromium حقيقي (Playwright،
// محليًا في بيئة التطوير فقط — ليس جزءًا من أدوات المشروع المثبَّتة ولا
// من هذه المجموعة): كانت قاعدة RTL تُزيح الشريط الجانبي نحو اليمين
// لإخفائه، فيبقى نحو 89px منه ظاهرًا فوق المحتوى بدل الاختفاء الكامل.
// هذا الفحص يمنع عودة تلك القاعدة الخاطئة تحديدًا.
assert('لا تعود قاعدة RTL الخاطئة التي كانت تُبقي جزءًا من الشريط الجانبي ظاهرًا على الجوال',
  !/html\[dir=rtl\]\s*\.sidebar\{transform:translateX\(110%\)/.test(html));
assert('الشريط الجانبي يُخفى دائمًا بإزاحة سالبة واحدة (بصرف النظر عن الاتجاه) بعد الإصلاح',
  /\.sidebar\{transform:translateX\(-110%\)/.test(html));

assert('safe-area-inset مطبَّق على تذييل النافذة المنبثقة على الجوال', /modal-foot\{[^}]*env\(safe-area-inset-bottom\)/.test(html));
assert('safe-area-inset مطبَّق على حاوية التنبيهات (toasts) على الجوال', /\.toasts\{[^}]*env\(safe-area-inset-bottom\)/.test(html));

assert('حصر التركيز (focus trap) داخل النوافذ المنبثقة موجود ومفعَّل عبر Tab', /function trapModalFocus/.test(appCode) && /trapModalFocus\(event\)/.test(appCode));
assert('تتبّع تغييرات النافذة (modalDirty) مفعَّل على أحداث input/change داخل .modal فقط', /modalDirty\s*=\s*true/.test(appCode) && /closest\(['"]\.modal['"]\)/.test(appCode));
assert('التحذير قبل إغلاق نافذة فيها تغييرات غير محفوظة (dismissModalIfConfirmed) موجود ومربوط بـ Escape ونقر الخلفية فقط',
  /function dismissModalIfConfirmed/.test(appCode)
  && /Escape.*dismissModalIfConfirmed|dismissModalIfConfirmed.*Escape/s.test(appCode.replace(/\s+/g, ' '))
  && /backdrop.*dismissModalIfConfirmed/.test(appCode.replace(/\s+/g, ' ')));
assert('أزرار الإغلاق الصريحة (close-modal) تبقى فورية دون تحذير كما كانت — لا تغيير في سلوكها', /'close-modal':\s*closeModal/.test(appCode));

assert('كل الروابط الخارجية (target=_blank) تحمل rel="noopener noreferrer"', (() => {
  const links = [...html.matchAll(/<a\s[^>]*target="_blank"[^>]*>/g)];
  return links.length > 0 && links.every(m => /rel="noopener noreferrer"/.test(m[0]));
})());

assert('حاوية التنبيهات الرئيسية تحمل aria-live', /id="toasts"[^>]*aria-live="polite"/.test(html));
assert('دالة toast تضبط aria-live/role ديناميكيًا حسب نوع الرسالة (نجاح/تحذير/خطأ)', /setAttribute\(['"]aria-live['"]/.test(appCode) && /setAttribute\(['"]role['"]/.test(appCode));

assert('prefers-reduced-motion محترم عبر تعطيل مدة الحركات والانتقالات', /prefers-reduced-motion:reduce\)\{\*\{animation-duration:\.01ms/.test(html));

assert('النوافذ المنبثقة تحمل role="dialog" وaria-modal="true"', /role="dialog" aria-modal="true"/.test(appCode));
assert('حقول الدخول تحمل autocomplete مناسب (username/current-password/one-time-code)', /autocomplete="username"/.test(appCode) && /autocomplete="current-password"/.test(appCode) && /autocomplete="one-time-code"/.test(appCode));

/* ---------------- 12) انحدارات مؤكَّدة من الاختبار الحي 2026/08/01 ---------------- */

section('12) انحدارات مؤكَّدة من الاختبار الحي 2026/08/01');

// (3) إضافة أول مستفيد من بوابة الجمعية كانت تُظهر نجاحًا ثم تُبقي
// القائمة فارغة حتى تسجيل خروج ودخول: renderBeneficiaries تقرأ
// bundle.total بينما upsertEntity كانت تزيد items فقط.
setRole(ASSOCIATION_DATA);
app.state.page = 'beneficiaries';
app.state.data.beneficiaries = [];
app.state.lazy.beneficiaries = {loading: false, items: [], total: 0, page: 1, totalPages: 1, pageSize: 25};
assert('قبل الإضافة: القائمة تعرض حالة "لم يُضف أي مستفيد بعد"', app.renderBeneficiaries().includes('لم يُضف أي مستفيد بعد'));
app.upsertEntity('beneficiaries', {id: 'BEN-NEW-1', name: 'مستفيد جديد', city: 'الرياض', region: 'الرياض',
  deliveryStatus: 'لم يبدأ', status: 'جديد', needs: [], familyCount: 4});
assert('بعد الإضافة مباشرة: العدّاد الكلي زاد (لا يبقى صفرًا)', app.state.lazy.beneficiaries.total === 1);
assert('بعد الإضافة مباشرة: القائمة تعرض المستفيد الجديد بلا إعادة تحميل ولا خروج ودخول', (() => {
  const html = app.renderBeneficiaries();
  return html.includes('مستفيد جديد') && !html.includes('لم يُضف أي مستفيد بعد');
})());
app.upsertEntity('beneficiaries', {id: 'BEN-NEW-1', name: 'مستفيد جديد معدَّل', city: 'الرياض', region: 'الرياض',
  deliveryStatus: 'لم يبدأ', status: 'جديد', needs: [], familyCount: 5});
assert('تعديل سجل قائم لا يزيد العدّاد (الزيادة عند الإدراج الجديد فقط)', app.state.lazy.beneficiaries.total === 1);
assert('removeEntity يُنقص العدّاد ويحذف العنصر معًا', (() => {
  app.removeEntity('beneficiaries', 'BEN-NEW-1');
  return app.state.lazy.beneficiaries.total === 0 && app.state.lazy.beneficiaries.items.length === 0;
})());

// (4) لوحة الجمعية كانت تعرض "آخر العمليات" مرتين بنفس المحتوى.
setRole(ASSOCIATION_DATA);
app.state.page = 'dashboard';
assert('لوحة الجمعية لا تكرّر قسم "آخر العمليات" مرتين', (() => {
  const html = app.renderDashboard();
  return (html.match(/آخر العمليات/g) || []).length === 1;
})());
assert('الجانب في لوحة الجمعية صار "حالة التشغيل" بمؤشرات قابلة للنقر لا تكرارًا للسجل',
  app.renderDashboard().includes('حالة التشغيل'));

// (9) بعد تعذّر التسليم كانت الأجهزة تختفي من بطاقة المندوب وتظهر
// "لا توجد أجهزة مخصصة" ويتعطّل التأكيد، بلا زر إعادة محاولة.
const FAILED_TASK = JSON.parse(JSON.stringify(DELEGATE_DATA));
FAILED_TASK.beneficiaries[0].deliveryStatus = 'تعذر التسليم';
FAILED_TASK.beneficiaries[0].attempts = [
  {id: 'DLV-000009', status: 'تعذر التسليم', reason: 'لا يرد', at: '2026/08/01 09:10', devices: ['DEV-000001'], hasProof: false}
];
setRole(FAILED_TASK);
const failedCardHtml = app.renderDelegateList();
assert('بعد التعذّر: الأجهزة ما زالت ظاهرة في البطاقة (لا "لا توجد أجهزة مخصصة")',
  failedCardHtml.includes('DEV-000001') && !failedCardHtml.includes('لا توجد أجهزة مخصصة'));
assert('بعد التعذّر: يظهر زر «إعادة المحاولة» صريحًا', failedCardHtml.includes('dg-retry') && failedCardHtml.includes('إعادة المحاولة'));
assert('بعد التعذّر: سبب آخر محاولة وتاريخها ظاهران (سجل المحاولات لا يُمحى)',
  failedCardHtml.includes('لا يرد') && failedCardHtml.includes('2026/08/01 09:10'));
assert('بعد التعذّر: زر التأكيد معطَّل مع سبب مكتوب يوجّه لإعادة المحاولة أولًا',
  /a-deliver[^>]*disabled[^>]*إعادة المحاولة/.test(failedCardHtml));
assert('بعد التعذّر: البطاقة توضّح نصًا أن الأجهزة ما زالت مع المندوب',
  failedCardHtml.includes('الأجهزة ما زالت معك'));

// نفس المهمة بعد إعادة المحاولة: تعود قابلة للتأكيد فورًا.
const RESUMED_TASK = JSON.parse(JSON.stringify(FAILED_TASK));
RESUMED_TASK.beneficiaries[0].deliveryStatus = 'خرج مع المندوب';
setRole(RESUMED_TASK);
const resumedHtml = app.renderDelegateList();
assert('بعد إعادة المحاولة: زر التأكيد يعود مفعّلًا وزر التعذّر يعود مكان زر الإعادة',
  !/a-deliver[^>]*disabled/.test(resumedHtml) && resumedHtml.includes('dg-status') && !resumedHtml.includes('dg-retry'));

// (11) زر "تم التسليم" كان مفعّلًا قبل إرفاق الصورة والموافقة على التعهد.
setRole(DELEGATE_DATA);
app.state.proofData = '';
app.deliveryModal('BEN-000001');
assert('نافذة التسليم: الزر يبدأ معطَّلًا قبل الصورة والتعهد',
  /id="deliverySubmit"[^>]*disabled/.test(registry.modalRoot.innerHTML));
assert('نافذة التسليم: سبب التعطيل مكتوب صراحةً قبل الضغط لا بعده', (() => {
  registry.deliveryConfirm.checked = false;
  app.state.proofData = '';
  app.updateDeliveryGate();
  const hint = registry.deliveryGateHint;
  return hint.textContent.includes('إرفاق صورة الإثبات') && hint.textContent.includes('الموافقة على التعهد');
})());
assert('نافذة التسليم: الزر مربوط بسبب التعطيل عبر aria-describedby',
  /aria-describedby="deliveryGateHint"/.test(registry.modalRoot.innerHTML));
assert('نافذة التسليم: صورة بلا تعهد تُبقي الزر معطَّلًا', (() => {
  app.state.proofData = 'data:image/png;base64,AAAA';
  registry.deliveryConfirm.checked = false;
  app.updateDeliveryGate();
  return registry.deliverySubmit.disabled === true
    && registry.deliveryGateHint.textContent.includes('الموافقة على التعهد');
})());
assert('نافذة التسليم: تعهد بلا صورة يُبقي الزر معطَّلًا', (() => {
  app.state.proofData = '';
  registry.deliveryConfirm.checked = true;
  app.updateDeliveryGate();
  return registry.deliverySubmit.disabled === true
    && registry.deliveryGateHint.textContent.includes('إرفاق صورة الإثبات');
})());
assert('نافذة التسليم: استيفاء الشرطين معًا يفعّل الزر', (() => {
  app.state.proofData = 'data:image/png;base64,AAAA';
  registry.deliveryConfirm.checked = true;
  app.updateDeliveryGate();
  return registry.deliverySubmit.disabled === false;
})());
assert('نافذة التسليم: إلغاء التعهد وحده يُعيد تعطيل الزر فورًا', (() => {
  registry.deliveryConfirm.checked = false;
  app.updateDeliveryGate();
  return registry.deliverySubmit.disabled === true;
})());
app.state.proofData = '';

// (5/6/7) القوائم المترابطة في نموذج تقديم الجمعية العام (بلا جلسة).
app.state.referenceData = {ready: true, source: 'builtin',
  regions: ['الرياض', 'مكة المكرمة'],
  citiesByRegion: {'الرياض': ['الرياض', 'الخرج'], 'مكة المكرمة': ['جدة']},
  deviceTypes: ['ثلاجة'], socialStatuses: ['أرملة'], associationCategories: ['جمعية أهلية'],
  associationSectors: ['رعاية الأيتام', 'أخرى'],
  applicationQuestions: [{key: 'الترخيص ساري', label: 'هل الترخيص ساري؟'}, {key: 'المشروع ضمن نطاق الجمعية', label: 'هل المشروع ضمن نطاق عمل الجمعية؟'}],
  pledgeText: 'أقر بصحة البيانات.'};
app.state.screen = 'apply';
app.state.apply.step = 1;
app.renderApplyForm();
assert('نموذج تقديم الجمعية العام (مرحلة 1) يستخدم قوائم منسدلة للمنطقة والمدينة ومجال العمل (لا حقول نصية)', (() => {
  const html = out();
  return html.includes('name="region"') && html.includes('name="city"') && html.includes('name="sector"')
    && !/<input[^>]*name="region"/.test(html) && !/<input[^>]*name="sector"/.test(html);
})());
assert('نموذج التقديم يربط المدينة بالمنطقة عبر data-city-target', /data-act="region-select"[^>]*data-city-target/.test(out()));
assert('نموذج التقديم يعرض مؤشر المراحل الثلاث', out().includes('class="apply-steps"'));
assert('نموذج التقديم يتضمن حقل honeypot مخفيًا عن المستخدم الحقيقي', /name="website"/.test(out()) && /class="hidden"[^>]*aria-hidden="true"/.test(out()));
app.state.apply.step = 2;
app.renderApplyForm();
assert('نموذج التقديم (مرحلة 2) يعرض أسئلة نعم/لا بأزرار لمس لا مربعات اختيار ملتبسة', (() => {
  const html = out();
  return html.includes('class="yesno-toggle"') && html.includes('type="radio"') && !html.includes('type="checkbox" name="q0"');
})());
app.state.apply.step = 3;
app.renderApplyForm();
assert('نموذج التقديم (مرحلة 3) يطلب ملف الترخيص والإقرار الإلزامي', (() => {
  const html = out();
  return html.includes('data-act="license-file"') && html.includes('name="pledgeAccepted"') && html.includes('أقر بصحة البيانات');
})());
app.state.apply.step = 1;
app.state.screen = '';

/* ---------------- 13) اللوحة التنفيذية للأنشطة ---------------- */

section('13) اللوحة التنفيذية للأنشطة (بديل الجدول التقليدي)');

setRole(ADMIN_DATA);
app.state.page = 'activities';
app.state.activityTab = '';
const execHtml = app.renderActivities();
assert('اللوحة تعرض المسار التنفيذي لا جدول <table> تقليديًا',
  execHtml.includes('المسار التنفيذي للمشروع') && !execHtml.includes('<table'));
assert('شريط توزيع الحالات موجود ومُعرَّف لقارئ الشاشة',
  execHtml.includes('class="flow-bar"') && execHtml.includes('role="img"') && execHtml.includes('aria-label="توزيع الأنشطة على الحالات"'));
assert('مسار المراحل خط زمني دلالي (<ol>) لا مجرد صناديق',
  execHtml.includes('<ol class="tl">') && execHtml.includes('tl-node'));
assert('اللوحة تعرض الحالات الأربع: مكتمل وجارٍ ومتأخر وقادم',
  ['مكتمل', 'جارٍ', 'متأخر', 'قادم'].every(label => execHtml.includes(label)));
assert('كل بطاقة نشاط تعرض نسبة الإنجاز والمسؤول والموعد',
  execHtml.includes('الإنجاز') && execHtml.includes('المسؤول') && execHtml.includes('act-meter'));
assert('البطاقات مجمَّعة تحت نشاطها الرئيسي مع عدّاد المكتمل',
  execHtml.includes('act-group') && execHtml.includes('مكتمل'));
assert('الشاهد يظهر كرابط عند وجوده وكحالة صريحة "لا شاهد مرفوع" عند غيابه',
  execHtml.includes('الشاهد ↗') || execHtml.includes('لا شاهد مرفوع'));
assert('الحالة لا تُنقل باللون وحده: لكل بطاقة شارة نصية ورمز (WCAG 1.4.1)',
  execHtml.includes('act-card is-') && /class="status/.test(execHtml));
assert('نسبة الإنجاز مقروءة لقارئ الشاشة عبر aria-label لا لونًا فقط',
  execHtml.includes('aria-label="نسبة الإنجاز'));
assert('قسم "يحتاج تدخّلًا" يعرض الأنشطة المتأخرة أو حالة فراغ صريحة',
  execHtml.includes('يحتاج تدخّلًا'));
app.state.activityTab = 'مكتمل';
assert('التصفية تعمل على اللوحة الجديدة كما كانت',
  app.renderActivities().includes('act-group') || app.renderActivities().includes('لا توجد أنشطة مطابقة'));
app.state.activityTab = '';

assert('الشعارات أكبر وأوضح دون أي تشويه للنِّسب (object-fit محفوظ، بلا خلفية أو قصّ)',
  /\.lockup-logo\{height:54px[^}]*object-fit:contain/.test(html)
  && !/\.lockup-logo\{[^}]*background:(?!none)/.test(html));
assert('شاشة الدخول تعرض الشعارين بأحجام أكبر متجاوبة (clamp)',
  /\.login-panel \.lockup-logo\{height:clamp\(72px/.test(html));
assert('رأس بوابة المندوب يكبّر الشعارين للجوال', /\.dg-top \.lockup-logo\{height:58px\}/.test(html));

/* ---------------- النتيجة ---------------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
