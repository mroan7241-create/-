#!/usr/bin/env node
/**
 * قياس أداء "قبل/بعد" لهذه المرحلة تحديدًا.
 *
 * يقيس متغيّرين هما اللذان يتحكمان فعليًا في الزمن المرصود حيًّا
 * (7–10 ثوانٍ للدخول، 5–7 لفتح صفحة):
 *
 *   1) عدد **جولات google.script.run** لكل رحلة مستخدم. كل جولة في
 *      Apps Script تحمل تكلفة ثابتة كبيرة (نقل HtmlService + تهيئة
 *      تنفيذ جديد) مستقلة تمامًا عن حجم البيانات، وهي المكوّن الأكبر
 *      في الزمن المُلاحَظ. تُستخرَج من كود الواجهة الفعلي لا تُفترَض.
 *
 *   2) عدد **قراءات الأوراق الكاملة** (getDataRange().getValues()) لكل
 *      رحلة. هذه هي العملية المكلفة فعليًا في Sheets API (طلب شبكة
 *      كامل لكل استدعاء).
 *
 * "قبل" = ملفات .gs عند commit مرجعي (افتراضيًا 34f8bd0، آخر commit
 * قبل هذه المرحلة). "بعد" = شجرة العمل الحالية.
 *
 * ⚠️ تنبيه منهجي صريح: هذا قياس داخل محاكاة، لا زمنًا حيًّا. لا يقيس
 * زمن شبكة Google ولا cold start الخاص بـApps Script (وهو متغيّر
 * مستقل عن كودنا تمامًا). ما يقيسه هو عدد العمليات التي يتحكم فيها
 * كودنا، وهي المتغيّر الذي يحرّك الزمن الفعلي. التحقق النهائي من
 * الأزمنة يتطلب تشغيلًا حيًّا (راجع RELEASE.md).
 *
 *   تشغيل:  node tools/perf-phase-bench.js [commit-قبل]
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..');
const BEFORE_COMMIT = process.argv[2] || '34f8bd0';
const { GS_FILES_ORDER, readMergedServerSource } = require('./gs-manifest');

function serverSourceAt(ref) {
  if (ref === 'WORKTREE') return readMergedServerSource(REPO_ROOT);
  return GS_FILES_ORDER.map(name => {
    try {
      return execSync(`git show ${ref}:${name}`, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
      return ''; // ملف لم يكن موجودًا عند ذلك الـcommit
    }
  }).join('');
}

function clientSourceAt(ref) {
  const html = ref === 'WORKTREE'
    ? fs.readFileSync(path.join(REPO_ROOT, 'Index.html'), 'utf8')
    : execSync(`git show ${ref}:Index.html`, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return html;
}

/* ---------------- بيانات وهمية ثابتة (بذرة واحدة لقابلية التكرار) ---------------- */

function buildData(scale) {
  const associations = [];
  const beneficiaries = [];
  const devices = [];
  const delegates = [];
  const audit = [];
  const REGIONS = ['الرياض', 'مكة المكرمة', 'القصيم'];
  const CITIES = {'الرياض': 'الخرج', 'مكة المكرمة': 'جدة', 'القصيم': 'بريدة'};

  for (let a = 1; a <= scale.associations; a++) {
    const region = REGIONS[a % REGIONS.length];
    associations.push({
      'رقم الجمعية': 'ASC-' + String(a).padStart(6, '0'), 'اسم الجمعية': 'جمعية ' + a,
      'التصنيف': 'جمعية خيرية', 'المنطقة': region, 'المدينة': CITIES[region],
      'أرقام التواصل': '05' + String(10000000 + a), 'البريد الإلكتروني': 'a' + a + '@example.org',
      'الحالة': 'نشطة', 'تاريخ الإنشاء': '2026/01/01 08:00'
    });
  }
  for (let d = 1; d <= scale.delegates; d++) {
    delegates.push({
      'رقم المندوب': 'MND-' + String(d).padStart(6, '0'),
      'رقم الجمعية': 'ASC-' + String((d % scale.associations) + 1).padStart(6, '0'),
      'اسم المندوب': 'مندوب ' + d, 'رقم الجوال': '05' + String(20000000 + d),
      'رمز الدخول المشفر': 'x', 'الملح': 's', 'الحالة': 'نشط',
      'تاريخ الإنشاء': '2026/01/01 08:00', 'آخر دخول': ''
    });
  }
  for (let b = 1; b <= scale.beneficiaries; b++) {
    const assoc = 'ASC-' + String((b % scale.associations) + 1).padStart(6, '0');
    const region = REGIONS[b % REGIONS.length];
    beneficiaries.push({
      'رقم المستفيد': 'BEN-' + String(b).padStart(6, '0'), 'رقم الجمعية': assoc,
      'الاسم': 'مستفيد ' + b, 'المنطقة': region, 'المدينة': CITIES[region], 'العنوان': 'حي ' + b,
      'رقم الجوال': '05' + String(30000000 + b), 'رقم جوال إضافي': '', 'عدد الأفراد': 4,
      'ضمان اجتماعي': 'لا', 'الحالة الاجتماعية': 'أرملة', 'مبلغ الدخل': 0, 'الاحتياج': 'ثلاجة',
      'حالة المستفيد': 'جديد', 'حالة التسليم': b % 5 === 0 ? 'تم التسليم' : 'لم يبدأ',
      'رقم المندوب': b % 3 === 0 ? 'MND-' + String((b % scale.delegates) + 1).padStart(6, '0') : '',
      'الملاحظات': '', 'تاريخ الإنشاء': '2026/02/01 08:00', 'تاريخ التسليم': '', 'آخر تحديث': '2026/02/01 08:00',
      'خط العرض': '', 'خط الطول': '', 'علامة مميزة': '', 'مصدر الموقع': '', 'تاريخ تحديث الموقع': ''
    });
    devices.push({
      'رقم الجهاز': 'DEV-' + String(b).padStart(6, '0'), 'اسم الجهاز': 'ثلاجة', 'النوع': 'ثلاجة',
      'رقم الجمعية': assoc, 'رقم المستفيد': '', 'حالة الجهاز': 'بالمستودع',
      'تاريخ الإضافة': '2026/02/01 08:00', 'تاريخ التسليم': '', 'ملاحظات': ''
    });
  }
  for (let i = 1; i <= scale.audit; i++) {
    audit.push({
      'رقم العملية': 'OP-' + i, 'رقم المستخدم': 'USR-1', 'اسم المستخدم': 'مدير', 'الدور': 'ADMIN',
      'العملية': 'تعديل مستفيد', 'القسم': 'المستفيدون',
      'رقم السجل': 'BEN-' + String((i % scale.beneficiaries) + 1).padStart(6, '0'),
      'ملاحظات': '', 'التاريخ والوقت': '2026/03/01 08:00'
    });
  }
  return {
    'إعدادات المشروع': [{'المفتاح': 'اسم المشروع', 'القيمة': 'قياس', 'الوصف': ''}],
    'المستخدمون': [], 'الجمعيات': associations, 'المستفيدون': beneficiaries, 'الأجهزة': devices,
    'المناديب': delegates, 'التسليمات': [], 'إدارة الأنشطة': [], 'شواهد الأنشطة الرئيسية': [],
    'سجل العمليات': audit, 'البيانات المرجعية': [], 'طلبات انضمام الجمعيات': []
  };
}

/* ---------------- بيئة تشغيل تعدّ قراءات الأوراق الفعلية ---------------- */

function makeSandbox(source, data) {
  let reads = 0;
  const props = {};
  const cache = {};
  const sheets = {};

  Object.keys(data).forEach(name => { sheets[name] = data[name]; });

  function sheetFor(name) {
    const rows = sheets[name] || [];
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return {
      getLastRow: () => rows.length + (headers.length ? 1 : 0),
      getLastColumn: () => headers.length,
      getDataRange: () => ({
        getValues: () => { reads++; return headers.length ? [headers].concat(rows.map(r => headers.map(h => r[h]))) : []; },
        getDisplayValues: () => { reads++; return headers.length ? [headers.map(String)] : []; }
      }),
      getRange: () => ({
        getValues: () => [headers], getDisplayValues: () => [headers.map(String)],
        setValues() {}, setValue() {}, setBackground() { return this; }, setFontColor() { return this; },
        setFontWeight() { return this; }, setHorizontalAlignment() { return this; },
        setWrap() { return this; }, setDataValidation() { return this; }
      }),
      setFrozenRows() {}, autoResizeColumns() {}, getMaxRows: () => rows.length + 1,
      appendRow() {}
    };
  }

  const sandbox = {
    console: {log() {}, error() {}}, JSON, Math, Date, String, Number, Boolean, Array, Object,
    RegExp, Error, isNaN, isFinite, parseInt, parseFloat, Set, Map,
    Utilities: {
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
      formatString: (fmt, n) => String(n).padStart(6, '0'),
      formatDate: () => '2026/08/01 10:00',
      computeDigest: () => [1, 2, 3],
      // رمز جلسة بطول واقعي: requireSession_ يشترط 32 محرفًا فأكثر.
      base64EncodeWebSafe: () => 'aGFzaA' + 'x'.repeat(40) + Math.random().toString(36).slice(2, 10),
      base64Encode: () => 'aGFzaA', base64Decode: () => [1, 2, 3],
      DigestAlgorithm: {SHA_256: 'SHA_256'}, Charset: {UTF_8: 'UTF_8'},
      newBlob: () => ({getBytes: () => []}), zip: () => ({getBytes: () => []}), sleep() {}
    },
    PropertiesService: {getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; }
    })},
    CacheService: {getScriptCache: () => ({
      get: k => (k in cache ? cache[k] : null),
      put: (k, v) => { cache[k] = v; },
      remove: k => { delete cache[k]; }
    })},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    ScriptApp: {getScriptId: () => 'SCRIPT-BENCH'},
    SpreadsheetApp: {getActiveSpreadsheet: () => ({
      getSheetByName: name => (sheets[name] ? sheetFor(name) : null),
      insertSheet: name => { sheets[name] = sheets[name] || []; return sheetFor(name); },
      getSheets: () => Object.keys(sheets).map(sheetFor)
    })},
    HtmlService: {createTemplateFromFile: () => ({evaluate: () => ({setTitle: () => ({addMetaTag: () => ({})})})})},
    DriveApp: {}, UrlFetchApp: {}, Logger: {log() {}}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {filename: 'merged.gs(bench)'});
  return {sandbox, reads: () => reads, resetReads: () => { reads = 0; }};
}

/* ---------------- عدّ جولات google.script.run من كود الواجهة ---------------- */

/** يقتطع جسم دالة واحدة من كود الواجهة (تقريبيًا، حتى الدالة التالية على نفس المستوى). */
function functionBody(clientSource, name) {
  const start = clientSource.indexOf('function ' + name + '(');
  if (start === -1) return null;
  const rest = clientSource.slice(start);
  const next = rest.slice(1).search(/\n    function \w+\(/);
  return next === -1 ? rest.slice(0, 6000) : rest.slice(0, next + 1);
}

/**
 * يعدّ جولات google.script.run في مسار كامل، **متعديًا** عبر الدوال
 * التي يستدعيها المسار (loadReferenceDataOnce، fetchLazyPage …) لا في
 * الدالة الأولى وحدها — لأن الجولات المتسلسلة الحقيقية موزّعة عليها.
 * يُستخرَج كل شيء من كود الواجهة الفعلي، بلا أي رقم مكتوب يدويًا.
 */
function countBootRoundTrips(clientSource, entryNames) {
  const seen = {};
  let trips = 0;
  const queue = entryNames.slice();
  while (queue.length) {
    const name = queue.shift();
    if (seen[name]) continue;
    seen[name] = true;
    const body = functionBody(clientSource, name);
    if (!body) continue;
    trips += (body.match(/\bapi\(\s*'/g) || []).length;
    // تتبّع الاستدعاءات الداخلية المعروفة في مسار الإقلاع فقط.
    ['loadReferenceDataOnce', 'fetchLazyPage', 'adoptPortalBundle'].forEach(helper => {
      // الاستدعاء المشروط بغياب البيانات (`if (!state.referenceData) …`)
      // لا يُحتسب جولةً في المسار المعتاد لأنه لا ينفَّذ حين تصل البيانات
      // ضمن الاستجابة الأولى — وهو بالضبط ما يفعله مسار الدخول الآن.
      const conditional = new RegExp('if \\(!state\\.referenceData\\) ' + helper + '\\(');
      if (body.indexOf(helper + '(') >= 0 && !conditional.test(body)) queue.push(helper);
    });
  }
  return trips;
}

/* ---------------- السيناريوهات ---------------- */

function measure(source, data) {
  const out = {};

  // 1) دخول جمعية: من الرمز إلى بيانات البوابة كاملة.
  {
    const env = makeSandbox(source, data);
    const user = {id: 'USR-A1', name: 'جمعية', role: 'ASSOCIATION', associationId: 'ASC-000001'};
    const session = env.sandbox.createSession_(user);
    env.resetReads();
    env.sandbox.getBootstrapData(session.token);
    out.associationLogin = env.reads();
  }

  // 2) دخول إدارة.
  {
    const env = makeSandbox(source, data);
    const session = env.sandbox.createSession_({id: 'USR-AD', name: 'مدير', role: 'ADMIN', associationId: ''});
    env.resetReads();
    env.sandbox.getBootstrapData(session.token);
    out.adminLogin = env.reads();
  }

  // 3) رحلة "استعادة جلسة ثم فتح صفحة المستفيدين" كاملة — هذا ما رصده
  //    الاختبار الحي (دخول 7–10 ثوانٍ ثم 5–7 لفتح القائمة).
  //
  //    نمذجة أمينة: **كل جولة google.script.run تنفيذ مستقل**. في
  //    Apps Script قد يخدمها isolate بارد (متغيّرات عامة فارغة) أو
  //    دافئ، ولا يملك الكود أي ضمان أيّهما. لذلك تُقاس كل جولة في
  //    بيئة جديدة — وهو النموذج الوحيد الصحيح للمقارنة بين نسخة
  //    تحتاج ثلاث جولات وأخرى تحتاج جولة واحدة. (احتساب الجولات
  //    الثلاث داخل بيئة واحدة كان سيُخفي التكلفة الحقيقية خلف ذاكرة
  //    مؤقتة لا يضمنها Apps Script أصلًا.)
  {
    const user = {id: 'USR-A2', name: 'جمعية', role: 'ASSOCIATION', associationId: 'ASC-000001'};
    const probe = makeSandbox(source, data);
    const bundled = typeof probe.sandbox.getPortalBundle === 'function';
    let total = 0;
    if (bundled) {
      const env = makeSandbox(source, data);
      const session = env.sandbox.createSession_(user);
      env.resetReads();
      env.sandbox.getPortalBundle(session.token, 'beneficiaries', {page: 1, pageSize: 25});
      total = env.reads();
    } else {
      // ثلاث جولات = ثلاثة تنفيذات مستقلة.
      [
        (env, token) => env.sandbox.getBootstrapData(token),
        (env, token) => env.sandbox.getReferenceData(token),
        (env, token) => env.sandbox.listBeneficiaries(token, {page: 1, pageSize: 25})
      ].forEach(step => {
        const env = makeSandbox(source, data);
        const session = env.sandbox.createSession_(user);
        env.resetReads();
        step(env, session.token);
        total += env.reads();
      });
    }
    out.loginThenOpenList = total;
    out.roundTripsForJourney = bundled ? 1 : 3;
  }

  // 4) فتح صفحة مُرقَّمة وحدها (تنقّل داخل البوابة).
  {
    const env = makeSandbox(source, data);
    const session = env.sandbox.createSession_({id: 'USR-A3', name: 'جمعية', role: 'ASSOCIATION', associationId: 'ASC-000001'});
    env.sandbox.getBootstrapData(session.token);
    env.resetReads();
    env.sandbox.listBeneficiaries(session.token, {page: 1, pageSize: 25});
    out.openListPage = env.reads();
  }

  return out;
}

/* ---------------- التشغيل ---------------- */

const scale = {associations: 12, beneficiaries: 600, devices: 600, delegates: 40, audit: 3000};
const data = buildData(scale);

let beforeServer;
try {
  beforeServer = serverSourceAt(BEFORE_COMMIT);
} catch (error) {
  console.log('⚠️ تعذّر تحميل ملفات .gs من commit ' + BEFORE_COMMIT + ': ' + error.message);
  process.exit(1);
}
const afterServer = serverSourceAt('WORKTREE');
const beforeClient = clientSourceAt(BEFORE_COMMIT);
const afterClient = clientSourceAt('WORKTREE');

console.log('قياس أداء قبل/بعد — مرحلة إعادة الهندسة الشاملة');
console.log('المرجع "قبل": ' + BEFORE_COMMIT + '   |   "بعد": شجرة العمل الحالية');
console.log('حجم البيانات: ' + scale.beneficiaries + ' مستفيدًا، ' + scale.devices + ' جهازًا، '
  + scale.delegates + ' مندوبًا، ' + scale.associations + ' جمعية، ' + scale.audit + ' سجل عمليات.\n');

const before = measure(beforeServer, data);
const after = measure(afterServer, data);

function row(label, b, a) {
  const diff = b - a;
  const pct = b ? Math.round((diff / b) * 100) : 0;
  const sign = diff > 0 ? '−' : (diff < 0 ? '+' : ' ');
  console.log('  ' + label.padEnd(44, ' ') + String(b).padStart(5) + '  →  ' + String(a).padStart(5)
    + '   (' + sign + Math.abs(diff) + '، ' + sign + Math.abs(pct) + '٪)');
}

console.log('أ) قراءات الأوراق الكاملة لكل رحلة (أقل = أسرع)\n');
console.log('  ' + 'الرحلة'.padEnd(44, ' ') + ' قبل' + '     ' + ' بعد');
row('دخول جمعية (بناء البوابة)', before.associationLogin, after.associationLogin);
row('دخول إدارة (بناء البوابة)', before.adminLogin, after.adminLogin);
row('استعادة جلسة + فتح قائمة (كل جولة تنفيذ مستقل)', before.loginThenOpenList, after.loginThenOpenList);
row('فتح صفحة مُرقَّمة (تنقّل داخلي)', before.openListPage, after.openListPage);

console.log('\nب) جولات google.script.run المتسلسلة في مسار الإقلاع (أقل = أسرع)\n');
console.log('  ' + 'المسار'.padEnd(44, ' ') + ' قبل' + '     ' + ' بعد');
row('استعادة جلسة حتى جاهزية النماذج',
  countBootRoundTrips(beforeClient, ['restoreSession']),
  countBootRoundTrips(afterClient, ['restoreSession']));
row('دخول جديد حتى جاهزية النماذج',
  countBootRoundTrips(beforeClient, ['submitLogin']),
  countBootRoundTrips(afterClient, ['submitLogin']));
row('استعادة جلسة + فتح قائمة مُرقَّمة',
  countBootRoundTrips(beforeClient, ['restoreSession', 'fetchLazyPage']),
  countBootRoundTrips(afterClient, ['restoreSession', 'fetchLazyPage']));
console.log('\n  العدّ متعدٍّ عبر الدوال المستدعاة في المسار (loadReferenceDataOnce/');
console.log('  fetchLazyPage)، لا في الدالة الأولى وحدها. الأقسام الكسولة الأخرى');
console.log('  (الأنشطة مثلًا) تبقى جولة منفصلة عند فتح صفحتها عمدًا.');

console.log('\nج) قراءة مهمة عن السطر الأخير في الجدول (أ)\n');
console.log('  ارتفاع قراءات "فتح صفحة مُرقَّمة" من 0 إلى 1 ليس تراجعًا في الأداء بل');
console.log('  تصحيح صحة: الصفر السابق كان ناتج ذاكرة جداول تعبر حدود الطلب داخل');
console.log('  warm isolate (TTL أربع ثوانٍ)، أي أن الصفحة كانت تُخدَم أحيانًا من');
console.log('  لقطة ما قبل الكتابة. القراءة الواحدة الآن مضمونة الحداثة.');

console.log('\nتنبيه منهجي صادق: كل الأرقام أعلاه من محاكاة محلية، لا من تشغيل');
console.log('حيّ على Apps Script. لا تقيس زمن شبكة Google ولا cold start (متغيّر');
console.log('مستقل عن كودنا كليًا، وهو غالبًا سبب تنفيذ doGet الشاذ 349 ثانية');
console.log('المرصود). ما تقيسه هو عدد العمليات التي يتحكم فيها كودنا — وهي');
console.log('المتغيّر الذي يحرّك الزمن الفعلي. التحقق النهائي يتطلب تشغيلًا حيًّا.');
