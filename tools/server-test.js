#!/usr/bin/env node
/**
 * اختبار منطق الخادم: يحمّل Code.gs داخل بيئة تُحاكي خدمات Apps Script،
 * ثم يفحص دوال التحقق والتنقية والأمان.
 *   تشغيل:  node tools/server-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

let failures = 0;
let checks = 0;
const assert = (name, condition, detail) => {
  checks++;
  if (condition) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const throws = (name, fn, fragment) => {
  checks++;
  try {
    fn();
    failures++;
    console.log('  ✗ ' + name + ' — لم تُرمَ أي استثناء');
  } catch (error) {
    if (!fragment || error.message.includes(fragment)) console.log('  ✓ ' + name);
    else { failures++; console.log('  ✗ ' + name + ' — رسالة غير متوقعة: ' + error.message); }
  }
};
const section = t => console.log('\n' + t);

/* -------- محاكاة خدمات Apps Script -------- */

const props = {};
const cache = {};
const sandbox = {
  console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error,
  isNaN, isFinite, parseInt, parseFloat, Set,
  Utilities: {
    getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
    computeDigest: (_alg, text) => {
      const bytes = [];
      const s = String(text);
      for (let i = 0; i < 32; i++) bytes.push((s.charCodeAt(i % s.length) + i * 7) % 256);
      return bytes;
    },
    base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
    base64Decode: b64 => Array.from(Buffer.from(b64, 'base64')),
    formatString: (pattern, value) => String(value).padStart(6, '0'),
    formatDate: (date, _tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      const base = date.getFullYear() + '/' + p(date.getMonth() + 1) + '/' + p(date.getDate());
      return pattern.indexOf('HH') >= 0 ? base + ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) : base;
    },
    newBlob: () => ({ getBytes: () => [] }),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: k => (k in cache ? cache[k] : null),
      put: (k, v) => { cache[k] = v; },
      remove: k => { delete cache[k]; }
    })
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ScriptApp: { getScriptId: () => 'script-id-test', getOAuthToken: () => 'token' },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
  DriveApp: {}, UrlFetchApp: {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

section('0) تحميل Code.gs');
try {
  vm.runInContext(source, sandbox, { filename: 'Code.gs' });
  assert('تم تحميل Code.gs دون خطأ', true);
} catch (error) {
  assert('تحميل Code.gs', false, error.message);
  process.exit(1);
}
const S = sandbox;

/* -------- 1) منع Formula Injection -------- */

section('1) منع Formula Injection عند الكتابة إلى Sheets');
assert('يحيّد الصيغة =', S.safeCell_('=HYPERLINK("http://x","x")').charAt(0) === "'");
assert('يحيّد الصيغة +', S.safeCell_('+1+1').charAt(0) === "'");
assert('يحيّد الصيغة -', S.safeCell_('-1+1').charAt(0) === "'");
assert('يحيّد الأمر @', S.safeCell_('@SUM(A1)').charAt(0) === "'");
assert('لا يمس الاسم العربي', S.safeCell_('محمد العتيبي') === 'محمد العتيبي');
assert('لا يمس رقم الجوال النصي', S.safeCell_('0501234567') === '0501234567');
assert('لا يمس الأرقام (نوع Number)', S.safeCell_(1500) === 1500);
assert('لا يمس القيمة الفارغة', S.safeCell_('') === '');

/* -------- 2) تنقية النصوص -------- */

section('2) تنقية مدخلات النص');
assert('يزيل محارف التحكم', S.cleanText_('a' + String.fromCharCode(1) + 'b', 50) === 'ab');
assert('يحافظ على العربية كاملة', S.cleanText_('  فاطمة العتيبي  ', 50) === 'فاطمة العتيبي');
assert('يقصّ عند الحد الأقصى', S.cleanText_('abcdefghij', 4) === 'abcd');
assert('يتعامل مع null', S.cleanText_(null, 50) === '');
throws('يرفض النص المطلوب الفارغ', () => S.requiredText_('   ', 'الاسم', 50), 'مطلوب');

/* -------- 3) المعرّفات (منع IDOR بالتخمين) -------- */

section('3) التحقق من المعرّفات');
assert('يقبل معرّفًا صحيحًا', S.cleanId_('BEN-000123') === 'BEN-000123');
assert('يرفض معرّفًا مشوّهًا', S.cleanId_('BEN-12') === '');
assert('يرفض محاولة حقن', S.cleanId_("BEN-000001' OR 1=1") === '');
assert('يرفض الفراغ', S.cleanId_('') === '');
assert('يرفض المسار النسبي', S.cleanId_('../../secret') === '');

/* -------- 4) أرقام الجوال -------- */

section('4) تطبيع أرقام الجوال السعودية');
assert('يقبل 05XXXXXXXX', S.normalizePhone_('0501234567') === '0501234567');
assert('يحوّل +9665 إلى 05', S.normalizePhone_('+966501234567') === '0501234567');
assert('يحوّل 9665 إلى 05', S.normalizePhone_('966501234567') === '0501234567');
assert('يتجاهل الفواصل والمسافات', S.normalizePhone_('050 123 45 67') === '0501234567');
assert('يطبّع 9 أرقام بلا صفر بادئ (العطل المرصود حيًّا: 550791650)',
  S.normalizePhone_('550791650') === '0550791650');
assert('التخزين الموحّد: كل الصيغ الأربع تنتج نفس القيمة',
  new Set(['0550791650', '550791650', '966550791650', '+966550791650'].map(S.normalizePhone_)).size === 1);
throws('يرفض رقمًا قصيرًا', () => S.normalizePhone_('05012'), 'غير صحيح');
throws('يرفض رقمًا لا يبدأ بـ 5', () => S.normalizePhone_('0401234567'), 'غير صحيح');
throws('يرفض نصًا', () => S.normalizePhone_('ليس رقمًا'), 'غير صحيح');

/* -------- 5) الأرقام والحدود -------- */

section('5) الحدود العددية');
assert('يقبل عدد أفراد صحيحًا', S.boundedNumber_(5, 1, 99, 'عدد الأفراد') === 5);
throws('يرفض صفرًا', () => S.boundedNumber_(0, 1, 99, 'عدد الأفراد'), 'غير صحيح');
throws('يرفض تجاوز الحد', () => S.boundedNumber_(500, 1, 99, 'عدد الأفراد'), 'غير صحيح');
throws('يرفض قيمة غير رقمية', () => S.boundedNumber_('كثير', 1, 99, 'عدد الأفراد'), 'غير صحيح');
assert('safeNumber_ يعالج النسبة المئوية', S.safeNumber_('60%') === 60);
assert('safeNumber_ يعيد صفرًا للقيم الفاسدة', S.safeNumber_('abc') === 0);

/* -------- 6) البريد والروابط -------- */

section('6) البريد والروابط');
assert('يقبل بريدًا صحيحًا', S.requiredEmail_('Info@Alzad.ORG') === 'info@alzad.org');
throws('يرفض بريدًا فاسدًا', () => S.requiredEmail_('not-an-email'), 'غير صحيح');
assert('safeUrl_ يقبل https', S.safeUrl_('https://drive.google.com/x') !== '');
assert('safeUrl_ يرفض javascript:', S.safeUrl_('javascript:alert(1)') === '');
assert('safeUrl_ يرفض data:', S.safeUrl_('data:text/html,<script>') === '');

/* -------- 7) كلمات المرور والأسرار -------- */

section('7) كلمات المرور ومقارنة الأسرار');
assert('يقبل كلمة مرور قوية', S.assertStrongPassword_('Zad2026Pass') === 'Zad2026Pass');
throws('يرفض كلمة قصيرة', () => S.assertStrongPassword_('Zad1'), '10 خانات');
throws('يرفض كلمة بلا أرقام', () => S.assertStrongPassword_('ZadPassword'), '10 خانات');
throws('يرفض كلمة بلا حروف', () => S.assertStrongPassword_('1234567890'), '10 خانات');

const salt = 'salt-1';
const hashed = S.hashSecret_('secret', salt);
assert('التجزئة تُنتج قيمة غير النص الأصلي', hashed !== 'secret' && hashed.length > 10);
assert('نفس المدخلات تعطي نفس التجزئة', S.hashSecret_('secret', salt) === hashed);
assert('ملح مختلف يعطي تجزئة مختلفة', S.hashSecret_('secret', 'salt-2') !== hashed);
assert('المقارنة تنجح للمتطابق', S.constantTimeEquals_(hashed, hashed) === true);
assert('المقارنة تفشل للمختلف', S.constantTimeEquals_(hashed, hashed + 'x') === false);
assert('المقارنة تتعامل مع null', S.constantTimeEquals_(null, null) === true);

/* -------- 8) تقييد المحاولات -------- */

section('8) تقييد محاولات الدخول');
for (const key in cache) delete cache[key];
let allowed = 0;
let blocked = false;
for (let i = 0; i < 12; i++) {
  try { S.throttle_('test-bucket', 8, 900); allowed++; }
  catch (error) { blocked = true; break; }
}
assert('يسمح بالمحاولات ضمن الحد', allowed === 8, 'سُمح بـ ' + allowed);
assert('يمنع بعد تجاوز الحد', blocked);

/* -------- 9) ترقيم المعرّفات -------- */

section('9) توليد المعرّفات');
for (const key in props) delete props[key];
const batch = S.nextIds_('BEN', 3);
assert('يولّد دفعة بترقيم متسلسل', batch.join(',') === 'BEN-000001,BEN-000002,BEN-000003');
assert('الاستدعاء التالي يكمل التسلسل', S.nextId_('BEN') === 'BEN-000004');
assert('لا يستهلك أرقامًا عند العدد صفر', S.nextIds_('BEN', 0).length === 0 && S.nextId_('BEN') === 'BEN-000005');
assert('بادئة مختلفة لها عدّاد مستقل', S.nextId_('DEV') === 'DEV-000001');

/* -------- 10) القوائم والتواريخ -------- */

section('10) القوائم والتواريخ');
assert('splitList_ يفصل بالفاصلة العربية', S.splitList_('ثلاجة، غسالة').join('|') === 'ثلاجة|غسالة');
assert('splitList_ يفصل بالفاصلة اللاتينية', S.splitList_('a, b').join('|') === 'a|b');
assert('normalizeNeeds_ يوحّد المصفوفة', S.normalizeNeeds_(['ثلاجة', 'غسالة']) === 'ثلاجة، غسالة');
assert('normalizeNeeds_ يتجاهل الفراغات', S.normalizeNeeds_(['ثلاجة', '', '  ']) === 'ثلاجة');
assert('normalizeNeeds_ يحدّ العدد بـ 20', S.normalizeNeeds_(new Array(40).fill('جهاز')).split('، ').length === 20);
assert('parseDate_ يقرأ التاريخ', S.parseDate_('2026/07/29') instanceof Date);
assert('parseDate_ يعيد null للفاسد', S.parseDate_('ليس تاريخًا') === null);
assert('formatDate_ يتعامل مع null', S.formatDate_(null) === '');

/* -------- 11) الثوابت وسلامة الأعمدة -------- */

section('11) توافق بنية الجداول');
// ثوابت const لا تُعلَّق على كائن الـ sandbox، لذا تُقرأ بتقييم داخل السياق.
const read = expr => vm.runInContext(expr, sandbox);
const HEADERS = read('HEADERS');
const expectedSheets = ['إعدادات المشروع', 'المستخدمون', 'الجمعيات', 'المستفيدون', 'الأجهزة',
  'المناديب', 'التسليمات', 'إدارة الأنشطة', 'شواهد الأنشطة الرئيسية', 'سجل العمليات'];
assert('أسماء الأوراق العشرة كما هي', expectedSheets.every(name => name in HEADERS));
assert('أعمدة المستفيدين لم تتغير', HEADERS['المستفيدون'].length === 20
  && HEADERS['المستفيدون'][0] === 'رقم المستفيد'
  && HEADERS['المستفيدون'][19] === 'آخر تحديث');
assert('عمود "رقم جوال إضافي" ما زال موجودًا', HEADERS['المستفيدون'].includes('رقم جوال إضافي'));
assert('حالات الجهاز الخمس كما هي', read('DEVICE_STATUSES').length === 5);
assert('أسباب التعذر الستة كما هي', read('FAILED_REASONS').length === 6);
assert('doGet ما زال يقرأ الملف Index', /createHtmlOutputFromFile\('Index'\)/.test(source));
assert('setupSheets موجودة ولم تُستدعَ تلقائيًا',
  /function setupSheets\(/.test(source) && !/^\s*setupSheets\(\);/m.test(source));

/* -------- 12) المصادر المرجعية (مناطق/مدن) -------- */

section('12) المصادر المرجعية والتحقق اللين');

assert('جدول البيانات المرجعية إضافي فقط ولم يمس أوراقًا قائمة',
  expectedSheets.every(name => name in HEADERS) && 'البيانات المرجعية' in HEADERS);
assert('أعمدة البيانات المرجعية كما صُممت', HEADERS['البيانات المرجعية'].join('|')
  === ['المعرف', 'النوع', 'القيمة', 'يتبع', 'الترتيب', 'نشط'].join('|'));

assert('migrateReferenceData لم تُستدعَ تلقائيًا من أي مكان',
  /function migrateReferenceData\(/.test(source) && !/^\s*migrateReferenceData\(\);/m.test(source));

assert('getReferenceData تتعامل بأمان مع غياب الجدول (بلا استثناء)', (() => {
  try {
    const result = S.getReferenceData();
    return result && result.ready === false && Array.isArray(result.regions) && result.regions.length === 0;
  } catch (error) { return false; }
})());

assert('validateRegionCity_ يتصرف كنص حر قبل تشغيل الترحيل (توافق خلفي)', (() => {
  const result = S.validateRegionCity_('منطقة اختبارية', 'مدينة اختبارية');
  return result.region === 'منطقة اختبارية' && result.city === 'مدينة اختبارية';
})());

throws('validateRegionCity_ يرفض منطقة فارغة قبل الترحيل أيضًا',
  () => S.validateRegionCity_('', 'أي مدينة'), 'مطلوب');

assert('بذرة المناطق تغطي المناطق الإدارية الثلاث عشرة', Object.keys(read('REFERENCE_SEED_REGIONS_CITIES')).length === 13);
assert('كل منطقة في البذرة لها مدينة واحدة على الأقل', Object.values(read('REFERENCE_SEED_REGIONS_CITIES'))
  .every(cities => Array.isArray(cities) && cities.length >= 3));
assert('لا تكرار داخل قائمة مدن أي منطقة', Object.values(read('REFERENCE_SEED_REGIONS_CITIES'))
  .every(cities => new Set(cities).size === cities.length));

assert('saveBeneficiary يستخدم التحقق الموحّد من المنطقة/المدينة',
  /validateRegionCity_\(payload\.region, payload\.city\)/.test(source));
assert('importBeneficiaries يستخدم التحقق الموحّد من المنطقة/المدينة',
  /validateRegionCity_\(row\.region, row\.city\)/.test(source));
assert('saveAssociation يستخدم التحقق الموحّد من المنطقة/المدينة',
  (source.match(/validateRegionCity_\(payload\.region, payload\.city\)/g) || []).length >= 2);
assert('inspectBeneficiaryExcel يستخدم التحقق الموحّد من المنطقة/المدينة',
  /validateRegionCity_\(row\.region, row\.city\)/.test(source));

/* -------- 13) تصحيح صيغة الجوال (معاينة آمنة، بلا كتابة عمياء) -------- */

section('13) معاينة وترحيل أرقام الجوال');
assert('previewPhoneNormalization معرّفة', /function previewPhoneNormalization\(/.test(source));
assert('migratePhoneNumbers معرّفة ولم تُستدعَ تلقائيًا',
  /function migratePhoneNumbers\(/.test(source) && !/^\s*migratePhoneNumbers\(\);/m.test(source));
assert('الترحيل يعتمد على المعاينة نفسها (مصدر حقيقة واحد)', (() => {
  const start = source.indexOf('function migratePhoneNumbers(');
  const body = source.slice(start, start + 400);
  return body.includes('previewPhoneNormalization()');
})());
throws('previewPhoneNormalization يفشل بأمان بلا شيت مرتبط (بيئة الاختبار) بدل قراءة بيانات فاسدة',
  () => S.previewPhoneNormalization());

/* -------- 14) بوابة تقديم الجمعيات ودورة الاعتماد (بمحاكاة شيت كاملة) -------- */

section('14) بوابة تقديم الجمعيات: تقديم، قبول، رفض');

function buildMockSpreadsheet() {
  const data = {};
  function makeSheet(name) {
    if (!data[name]) data[name] = [];
    const rows = data[name];
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] || []).length,
      getDataRange: () => ({
        getValues: () => rows.map(r => r.slice()),
        getDisplayValues: () => rows.map(r => r.map(String))
      }),
      getRange: (r1, c1, numRows, numCols) => ({
        getValues: () => {
          if (r1 === 1 && numRows === undefined) return [rows[0] || []];
          return rows.slice(r1 - 1, r1 - 1 + (numRows || rows.length - r1 + 1)).map(r => r.slice());
        },
        getDisplayValues: () => [(rows[0] || []).map(String)],
        setValues: values => { values.forEach((row, i) => { rows[r1 - 1 + i] = row.slice(); }); },
        setValue: value => { rows[r1 - 1] = rows[r1 - 1] || []; rows[r1 - 1][c1 - 1] = value; },
        setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; },
        setHorizontalAlignment() { return this; }, setWrap() { return this; }, setDataValidation() { return this; }
      }),
      setFrozenRows: () => {}, autoResizeColumns: () => {}, getMaxRows: () => rows.length,
      appendRow: row => { rows.push(row.slice()); }
    };
  }
  return {
    getSheetByName: name => (data[name] ? makeSheet(name) : null),
    insertSheet: name => makeSheet(name),
    getSheets: () => Object.keys(data).map(makeSheet)
  };
}

const props2 = {}; const cache2 = {};
const sandbox2 = Object.assign({}, sandbox, {
  Utilities: sandbox.Utilities,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props2 ? props2[k] : null), setProperty: (k, v) => { props2[k] = String(v); }, deleteProperty: k => { delete props2[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in cache2 ? cache2[k] : null), put: (k, v) => { cache2[k] = v; }, remove: k => { delete cache2[k]; } }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => mockSs }
});
const mockSs = buildMockSpreadsheet();
sandbox2.globalThis = sandbox2;
vm.createContext(sandbox2);
vm.runInContext(source, sandbox2, { filename: 'Code.gs(applications)' });
const S2 = sandbox2;
const ALL_HEADERS = {
  'إعدادات المشروع': ['المفتاح', 'القيمة', 'الوصف'],
  'المستخدمون': ['رقم المستخدم', 'الاسم', 'البريد الإلكتروني', 'كلمة المرور المشفرة', 'الملح', 'الدور', 'رقم الجمعية', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول'],
  'الجمعيات': ['رقم الجمعية', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'الحالة', 'تاريخ الإنشاء'],
  'المستفيدون': ['رقم المستفيد', 'رقم الجمعية', 'الاسم', 'المنطقة', 'المدينة', 'العنوان', 'رقم الجوال', 'رقم جوال إضافي', 'عدد الأفراد', 'ضمان اجتماعي', 'الحالة الاجتماعية', 'مبلغ الدخل', 'الاحتياج', 'حالة المستفيد', 'حالة التسليم', 'رقم المندوب', 'الملاحظات', 'تاريخ الإنشاء', 'تاريخ التسليم', 'آخر تحديث'],
  'الأجهزة': ['رقم الجهاز', 'اسم الجهاز', 'النوع', 'رقم الجمعية', 'رقم المستفيد', 'حالة الجهاز', 'تاريخ الإضافة', 'تاريخ التسليم', 'ملاحظات'],
  'المناديب': ['رقم المندوب', 'رقم الجمعية', 'اسم المندوب', 'رقم الجوال', 'رمز الدخول المشفر', 'الملح', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول'],
  'التسليمات': ['رقم التسليم', 'رقم المستفيد', 'رقم المندوب', 'أرقام الأجهزة', 'الحالة', 'سبب التعذر', 'الملاحظات', 'رابط الإثبات', 'تاريخ ووقت التسليم', 'تاريخ الإنشاء'],
  'إدارة الأنشطة': ['ترتيب المرحلة', 'اسم المرحلة', 'ترتيب النشاط الرئيسي', 'اسم النشاط الرئيسي', 'اسم النشاط الفرعي', 'المسؤول', 'تاريخ البداية', 'تاريخ النهاية', 'نسبة الإنجاز', 'الحالة', 'رابط الشاهد', 'ملاحظات'],
  'شواهد الأنشطة الرئيسية': ['اسم المرحلة', 'اسم النشاط الرئيسي', 'رابط الشاهد', 'حالة الاعتماد', 'ملاحظات', 'تاريخ الرفع'],
  'سجل العمليات': ['رقم العملية', 'رقم المستخدم', 'اسم المستخدم', 'الدور', 'العملية', 'القسم', 'رقم السجل', 'ملاحظات', 'التاريخ والوقت'],
  'طلبات انضمام الجمعيات': ['رقم الطلب', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'اسم المسؤول', 'ملاحظات مقدّم الطلب', 'الحالة', 'سبب الرفض', 'رقم الجمعية الناتجة', 'تاريخ التقديم', 'تاريخ المراجعة', 'المراجع']
};
Object.keys(ALL_HEADERS).forEach(name => S2.ensureSheet_(mockSs, name, ALL_HEADERS[name]));

assert('استقبال الطلبات غير مفعّل بلا شيت (يفشل بأمان لا يكسر التطبيق)', (() => {
  const emptySandbox = { console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error, isNaN, isFinite, parseInt, parseFloat, Set, Utilities: sandbox.Utilities, PropertiesService: sandbox.PropertiesService, CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) }, LockService: sandbox.LockService, ScriptApp: sandbox.ScriptApp, SpreadsheetApp: { getActiveSpreadsheet: () => null }, HtmlService: sandbox.HtmlService, DriveApp: {}, UrlFetchApp: {} };
  emptySandbox.globalThis = emptySandbox;
  vm.createContext(emptySandbox);
  vm.runInContext(source, emptySandbox, { filename: 'Code.gs(noSheet)' });
  try { emptySandbox.submitAssociationApplication({name: 'جمعية', category: 'جمعية أهلية', region: 'الرياض', city: 'الرياض', contactName: 'أحمد', phone: '0501234567', email: 'a@example.org'}); return false; }
  catch (error) { return error.message.indexOf('غير مفعّل') >= 0; }
})());

const submitted = S2.submitAssociationApplication({
  name: 'جمعية الأمل الخيرية', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
  contactName: 'سالم العتيبي', phone: '0501234567', email: 'amal@example.org', notes: 'طلب أول'
});
assert('submitAssociationApplication ينجح ويعيد رقم طلب', submitted.ok && /^APP-/.test(submitted.id));

throws('يرفض طلبًا مكررًا بنفس البريد وهو قيد المراجعة', () => S2.submitAssociationApplication({
  name: 'جمعية أخرى', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
  contactName: 'سالم', phone: '0559876543', email: 'amal@example.org'
}), 'قيد المراجعة');

throws('يرفض طلبًا مكررًا بنفس رقم الجوال وهو قيد المراجعة', () => S2.submitAssociationApplication({
  name: 'جمعية ثالثة', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
  contactName: 'سالم', phone: '0501234567', email: 'other@example.org'
}), 'قيد المراجعة');

const adminSession = S2.createSession_({id: 'USR-ADMIN-TEST', name: 'مدير الاختبار', role: 'ADMIN', associationId: ''});
const beforeAccept = S2.listAssociationApplications(adminSession.token);
assert('listAssociationApplications يُعيد الطلب قيد المراجعة', beforeAccept.applications.length === 1 && beforeAccept.applications[0].status === 'قيد المراجعة');

const accepted = S2.reviewAssociationApplication(adminSession.token, submitted.id, 'accept', '');
assert('قبول الطلب ينشئ جمعية ورقم جمعية', accepted.ok && /^ASC-/.test(accepted.associationId));
assert('قبول الطلب يعيد كلمة مرور مؤقتة قوية', (() => {
  try { S2.assertStrongPassword_(accepted.temporaryPassword); return true; } catch (e) { return false; }
})());

const loginResult = S2.loginUser_('amal@example.org', accepted.temporaryPassword);
assert('الحساب المُنشأ تلقائيًا يعمل فورًا بكلمة المرور المؤقتة', loginResult.ok && loginResult.user.role === 'ASSOCIATION');

throws('لا يمكن البتّ في طلب سبق قبوله', () => S2.reviewAssociationApplication(adminSession.token, submitted.id, 'accept', ''), 'سبق البتّ');

const submitted2 = S2.submitAssociationApplication({
  name: 'جمعية النور', category: 'جمعية أهلية', region: 'مكة المكرمة', city: 'جدة',
  contactName: 'منى القحطاني', phone: '0559998877', email: 'noor@example.org'
});
throws('الرفض يتطلب سببًا نصيًا', () => S2.reviewAssociationApplication(adminSession.token, submitted2.id, 'reject', '  '), 'مطلوب');
const rejected = S2.reviewAssociationApplication(adminSession.token, submitted2.id, 'reject', 'بيانات غير مكتملة');
assert('الرفض ينجح دون إنشاء حساب', rejected.ok && !S2.findUserByEmail_('noor@example.org'));
const afterReject = S2.listAssociationApplications(adminSession.token);
const rejectedRow = afterReject.applications.find(x => x.id === submitted2.id);
assert('حالة الطلب المرفوض وسببه محفوظان', rejectedRow.status === 'مرفوض' && rejectedRow.rejectionReason === 'بيانات غير مكتملة');

throws('غير الإدارة لا يمكنه مراجعة الطلبات', () => {
  const assocSession = S2.createSession_({id: 'USR-ASSOC-TEST', name: 'جمعية', role: 'ASSOCIATION', associationId: accepted.associationId});
  S2.reviewAssociationApplication(assocSession.token, submitted2.id, 'accept', '');
});

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
