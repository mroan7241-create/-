#!/usr/bin/env node
/**
 * قياس أداء حقيقي: يحمّل النسخة الحالية من Code.gs ونسخة "قبل" من
 * تاريخ Git (آخر commit قبل إصلاح الأداء)، يبني بيانات وهمية بحجم
 * واقعي (٦٠٠ مستفيد، ٦٠٠ جهاز، ٤٠ مندوبًا، ١٢ جمعية، ٣٠٠٠ سجل تدقيق)،
 * ثم يشغّل نفس السيناريوهين على النسختين ويقارن عدد قراءات الأوراق
 * الفعلية (getDataRange().getValues()) — لا وقتًا وهميًا، بل عددًا
 * حقيقيًا وقابلًا للتكرار لعمليات القراءة المكلفة فعليًا في Sheets.
 *   تشغيل:  node tools/perf-bench.js  [commit-قبل، افتراضيًا c188f74]
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..');
const BEFORE_COMMIT = process.argv[2] || 'c188f74';

function loadSourceAt(ref) {
  if (ref === 'WORKTREE') {
    // بعد تقسيم Code.gs إلى ملفات .gs متعددة (منظّمة عبر tools/gs-manifest.js)،
    // النسخة "بعد" هي دمج كل هذه الملفات — سلوكيًا مطابق تمامًا لملف Code.gs
    // الأصلي الواحد (Apps Script يدمجها بنفس الطريقة داخل نطاق عام واحد).
    return require('./gs-manifest').readMergedServerSource(REPO_ROOT);
  }
  // "قبل" يشير إلى commit سابق للتقسيم، حين كان كل شيء في Code.gs واحد.
  return execSync(`git show ${ref}:Code.gs`, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

/* ---------------- بيانات وهمية بحجم واقعي (بذرة ثابتة لقابلية التكرار) ---------------- */

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function buildFakeData() {
  const rnd = seededRandom(42);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  const associations = Array.from({ length: 12 }, (_, i) => {
    const id = 'ASC-' + String(i + 1).padStart(6, '0');
    return [id, 'جمعية رقم ' + (i + 1), 'جمعية أهلية', 'الرياض', 'الرياض', '0501234567', 'a' + i + '@example.org', 'نشطة', '2026/01/01'];
  });
  const delegates = Array.from({ length: 40 }, (_, i) => {
    const id = 'MND-' + String(i + 1).padStart(6, '0');
    const assoc = associations[i % associations.length][0];
    return [id, assoc, 'مندوب ' + (i + 1), '0501234567', 'HASH', 'SALT', 'نشط', '2026/01/01', ''];
  });
  const beneficiaries = Array.from({ length: 600 }, (_, i) => {
    const id = 'BEN-' + String(i + 1).padStart(6, '0');
    const assoc = associations[i % associations.length][0];
    const delegate = delegates[i % delegates.length][0];
    return [id, assoc, 'مستفيد ' + (i + 1), 'الرياض', 'الرياض', 'حي تجريبي', '0501234567', '', 5, 'لا',
      'متزوج/متزوجة', 3000, 'ثلاجة', 'معتمد', pick(['لم يبدأ', 'جاري التجهيز', 'تم التسليم']), delegate, '', '2026/01/01', '', '2026/01/01'];
  });
  const devices = Array.from({ length: 600 }, (_, i) => {
    const id = 'DEV-' + String(i + 1).padStart(6, '0');
    const assoc = associations[i % associations.length][0];
    const ben = beneficiaries[i % beneficiaries.length][0];
    return [id, 'جهاز ' + (i + 1), 'ثلاجة', assoc, ben, pick(['بالمستودع', 'مخصص', 'تم التسليم']), '2026/01/01', '', ''];
  });
  const audit = Array.from({ length: 3000 }, (_, i) => {
    return ['OP-' + i, 'USR-000001', 'مستخدم', 'ADMIN', 'عملية', 'قسم', 'BEN-000001', '', '2026/01/01 10:00'];
  });
  const activities = Array.from({ length: 20 }, (_, i) =>
    [1, 'مرحلة', i + 1, 'نشاط رئيسي', 'نشاط فرعي ' + i, 'مسؤول', '2026/01/01', '2026/06/01', 50, 'جارٍ', '', '']);

  return {
    'الجمعيات': associations, 'المستفيدون': beneficiaries, 'الأجهزة': devices,
    'المناديب': delegates, 'سجل العمليات': audit, 'إدارة الأنشطة': activities,
    'شواهد الأنشطة الرئيسية': [], 'المستخدمون': [], 'التسليمات': [], 'إعدادات المشروع': [],
    'البيانات المرجعية': []
  };
}

const HEADERS_MAP = {
  'الجمعيات': ['رقم الجمعية', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'الحالة', 'تاريخ الإنشاء'],
  'المستفيدون': ['رقم المستفيد', 'رقم الجمعية', 'الاسم', 'المنطقة', 'المدينة', 'العنوان', 'رقم الجوال', 'رقم جوال إضافي', 'عدد الأفراد', 'ضمان اجتماعي', 'الحالة الاجتماعية', 'مبلغ الدخل', 'الاحتياج', 'حالة المستفيد', 'حالة التسليم', 'رقم المندوب', 'الملاحظات', 'تاريخ الإنشاء', 'تاريخ التسليم', 'آخر تحديث'],
  'الأجهزة': ['رقم الجهاز', 'اسم الجهاز', 'النوع', 'رقم الجمعية', 'رقم المستفيد', 'حالة الجهاز', 'تاريخ الإضافة', 'تاريخ التسليم', 'ملاحظات'],
  'المناديب': ['رقم المندوب', 'رقم الجمعية', 'اسم المندوب', 'رقم الجوال', 'رمز الدخول المشفر', 'الملح', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول'],
  'سجل العمليات': ['رقم العملية', 'رقم المستخدم', 'اسم المستخدم', 'الدور', 'العملية', 'القسم', 'رقم السجل', 'ملاحظات', 'التاريخ والوقت'],
  'إدارة الأنشطة': ['ترتيب المرحلة', 'اسم المرحلة', 'ترتيب النشاط الرئيسي', 'اسم النشاط الرئيسي', 'اسم النشاط الفرعي', 'المسؤول', 'تاريخ البداية', 'تاريخ النهاية', 'نسبة الإنجاز', 'الحالة', 'رابط الشاهد', 'ملاحظات'],
  'شواهد الأنشطة الرئيسية': ['اسم المرحلة', 'اسم النشاط الرئيسي', 'رابط الشاهد', 'حالة الاعتماد', 'ملاحظات', 'تاريخ الرفع'],
  'المستخدمون': ['رقم المستخدم', 'الاسم', 'البريد الإلكتروني', 'كلمة المرور المشفرة', 'الملح', 'الدور', 'رقم الجمعية', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول', 'يجب تغيير كلمة المرور', 'كلمة مرور سابقة مشفرة', 'ملح سابق'],
  'التسليمات': ['رقم التسليم', 'رقم المستفيد', 'رقم المندوب', 'أرقام الأجهزة', 'الحالة', 'سبب التعذر', 'الملاحظات', 'رابط الإثبات', 'تاريخ ووقت التسليم', 'تاريخ الإنشاء'],
  'إعدادات المشروع': ['المفتاح', 'القيمة', 'الوصف'],
  'البيانات المرجعية': ['المعرف', 'النوع', 'القيمة', 'يتبع', 'الترتيب', 'نشط']
};

/* ---------------- بناء بيئة محاكاة مع عدّاد قراءات حقيقي ---------------- */

function runScenario(source, data) {
  const readCounts = {}; // اسم الورقة → عدد مرات استدعاء getDataRange().getValues()
  let totalReads = 0;

  function makeSheet(name) {
    const rows = [HEADERS_MAP[name] || []].concat(data[name] || []);
    return {
      getDataRange: () => ({
        getValues: () => {
          readCounts[name] = (readCounts[name] || 0) + 1;
          totalReads++;
          return rows.map(r => r.slice());
        },
        getDisplayValues: () => rows.map(r => r.map(String))
      }),
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] || []).length,
      getRange: (...args) => ({
        getValues: () => rows.slice(1).map(r => r.slice()),
        getDisplayValues: () => [HEADERS_MAP[name] || []].map(r => r.map(String)),
        setValue: (v) => { /* الكتابة غير مقاسة هنا — القراءة هي المقياس */ },
        setValues: (v) => {},
        setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; },
        setHorizontalAlignment() { return this; }, setWrap() { return this; }, setDataValidation() { return this; }
      }),
      setFrozenRows: () => {}, autoResizeColumns: () => {}, getMaxRows: () => rows.length
    };
  }

  const props = {};
  const cache = {};
  const sandbox = {
    console: { log: () => {} }, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error,
    isNaN, isFinite, parseInt, parseFloat, Set,
    Utilities: {
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
      computeDigest: (algo, raw) => {
        const crypto = require('crypto');
        return Array.from(crypto.createHash('sha256').update(String(raw)).digest());
      },
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      base64Decode: b64 => Array.from(Buffer.from(b64, 'base64')),
      formatString: (p, v) => String(v).padStart(6, '0'),
      formatDate: (date) => date.getFullYear() + '/01/01 10:00',
      newBlob: () => ({ getBytes: () => [] }),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }, sleep: () => {}
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getScriptId: () => 'bench', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => makeSheet(name), insertSheet: name => makeSheet(name), getSheets: () => Object.keys(data).map(makeSheet) }) },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: {}, UrlFetchApp: {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'Code.gs(bench)' });

  return { sandbox, readCounts: () => ({ total: totalReads, bySheet: Object.assign({}, readCounts) }) };
}

function fakeUser(role, associationId, id) {
  return { id: id || 'USR-BENCH', name: 'مستخدم القياس', role, associationId: associationId || '' };
}

function bench(label, source, data) {
  const { sandbox, readCounts } = runScenario(source, data);
  const results = {};

  // سيناريو 1: بناء بوابة الجمعية مباشرة (بدون كاش الجلسة) — يقيس
  // تكرار قراءة نفس الأوراق داخل طلب واحد.
  const assocUser = fakeUser('ASSOCIATION', 'ASC-000001');
  sandbox.buildAssociationPortal_(assocUser);
  results.singleAssociationBuild = readCounts().total;

  // سيناريو 2: بوابة الإدارة الكاملة مرة واحدة.
  const r2 = runScenario(source, data);
  r2.sandbox.buildAdminPortal_(fakeUser('ADMIN'));
  results.singleAdminBuild = r2.readCounts().total;

  // سيناريو 3: دخولان متتاليان لنفس الجمعية خلال نافذة قصيرة (محاكاة
  // تسجيل دخول ثم تحديث الصفحة أو مستخدم آخر بنفس الجمعية) — يقيس
  // فعالية التخزين المؤقت عبر الطلبات المنفصلة.
  const r3 = runScenario(source, data);
  const session = r3.sandbox.createSession_(assocUser);
  r3.sandbox.getBootstrapData(session.token);
  const afterFirst = r3.readCounts().total;
  r3.sandbox.getBootstrapData(session.token);
  const afterSecond = r3.readCounts().total;
  results.repeatedLoginFirstCall = afterFirst;
  results.repeatedLoginSecondCall = afterSecond - afterFirst;

  return results;
}

/* ---------------- التشغيل والمقارنة ---------------- */

const data = buildFakeData();
console.log('حجم البيانات الوهمية: ' + data['المستفيدون'].length + ' مستفيدًا، ' + data['الأجهزة'].length
  + ' جهازًا، ' + data['المناديب'].length + ' مندوبًا، ' + data['الجمعيات'].length + ' جمعية، '
  + data['سجل العمليات'].length + ' سجل تدقيق.\n');

let beforeSource, afterSource;
try {
  beforeSource = loadSourceAt(BEFORE_COMMIT);
} catch (error) {
  console.log('⚠️ تعذّر تحميل Code.gs من commit ' + BEFORE_COMMIT + ': ' + error.message);
  process.exit(1);
}
afterSource = loadSourceAt('WORKTREE');

const before = bench('قبل', beforeSource, data);
const after = bench('بعد', afterSource, data);

function row(label, b, a) {
  const diff = b - a;
  const pct = b ? Math.round((diff / b) * 100) : 0;
  console.log('  ' + label.padEnd(46, ' ') + String(b).padStart(6) + '  →  ' + String(a).padStart(6)
    + '   (' + (diff >= 0 ? '-' : '+') + Math.abs(diff) + '، ' + (diff >= 0 ? '-' : '+') + Math.abs(pct) + '٪)');
}

console.log('قراءات كاملة للأوراق (getDataRange().getValues()) — أقل = أسرع\n');
console.log('  ' + 'السيناريو'.padEnd(46, ' ') + 'قبل'.padStart(6) + '     ' + 'بعد'.padStart(6));
row('بناء بوابة جمعية واحدة (طلب واحد)', before.singleAssociationBuild, after.singleAssociationBuild);
row('بناء بوابة إدارة واحدة (طلب واحد)', before.singleAdminBuild, after.singleAdminBuild);
row('دخول أول لجمعية (getBootstrapData)', before.repeatedLoginFirstCall, after.repeatedLoginFirstCall);
row('دخول ثانٍ فوري لنفس الجمعية (خلال 60 ثانية)', before.repeatedLoginSecondCall, after.repeatedLoginSecondCall);

console.log('\nملاحظة منهجية: هذا عدد قراءات الورقة الكاملة (استدعاءات\n'
  + 'getDataRange().getValues())، وهو العملية المكلفة فعليًا في Google\n'
  + 'Sheets API (طلب شبكة كامل لكل استدعاء)، وليس زمنًا وهميًا. لا يقيس\n'
  + 'هذا زمن الشبكة الفعلي لأن ذلك يتطلب تشغيلًا حيًّا على Apps Script\n'
  + 'لا تتيحه بيئة هذه الجلسة — لكن تقليل عدد الاستدعاءات هو المتغيّر\n'
  + 'الذي يتحكم في ذلك الزمن مباشرة.');
