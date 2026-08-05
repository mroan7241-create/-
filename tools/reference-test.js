#!/usr/bin/env node
/**
 * اختبارات المرحلة الرابعة: توحيد البيانات المرجعية (مناطق/مدن/تصنيفات/حالات)،
 * التحقق الخادمي اللين المتوافق مع البيانات القديمة، أداتا التشخيص
 * (diagnoseReferenceDataIssues) والترحيل الآمن (migrateLegacyReferenceValues)
 * — تُستدعيان هنا فقط داخل بيئة محاكاة في الذاكرة، وأيضًا إصلاحا الصفر
 * الأول في الهاتف وتنسيق التاريخ العربي بتوقيت الرياض.
 *
 *   تشغيل:  node tools/reference-test.js
 */
'use strict';

const path = require('path');
const vm = require('vm');
const { readMergedServerSource } = require('./gs-manifest');
const { createDriveMock } = require('./drive-mock');
const { applicationFixture } = require('./application-fixtures');

const source = readMergedServerSource(path.join(__dirname, '..'));

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

/* -------- بيئة محاكاة (مطابقة لتلك المستخدَمة في state-test.js/server-test.js) -------- */

/** يحاكي سلوك Sheets الحقيقي: علامة الاقتباس البادئة "فرض نص" تُخزَّن كإشارة فقط ولا تصبح جزءًا من القيمة الفعلية عند القراءة. */
function stripForceText_(value) {
  return (typeof value === 'string' && value.charAt(0) === "'") ? value.slice(1) : value;
}

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
        setValues: values => { values.forEach((row, i) => { rows[r1 - 1 + i] = row.slice().map(stripForceText_); }); },
        setValue: value => { rows[r1 - 1] = rows[r1 - 1] || []; rows[r1 - 1][c1 - 1] = stripForceText_(value); },
        setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; },
        setHorizontalAlignment() { return this; }, setWrap() { return this; }, setDataValidation() { return this; }
      }),
      setFrozenRows: () => {}, autoResizeColumns: () => {}, getMaxRows: () => rows.length,
      appendRow: row => { rows.push(row.slice().map(stripForceText_)); }
    };
  }
  return {
    getSheetByName: name => (data[name] ? makeSheet(name) : null),
    insertSheet: name => makeSheet(name),
    getSheets: () => Object.keys(data).map(makeSheet)
  };
}

function buildSandbox() {
  const props = {};
  const cache = {};
  const logs = [];
  const mockSs = buildMockSpreadsheet();
  const tzCalls = [];
  const driveMock = createDriveMock();
  const sandbox = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error,
    isNaN, isFinite, parseInt, parseFloat, Set,
    Utilities: {
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      computeDigest: (_alg, text) => {
        const crypto = require('crypto');
        return Array.from(crypto.createHash('sha256').update(String(text)).digest());
      },
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      base64Decode: b64 => Array.from(Buffer.from(b64, 'base64')),
      formatString: (pattern, value) => String(value).padStart(6, '0'),
      formatDate: (date, tz, pattern) => {
        tzCalls.push(tz);
        const p = n => String(n).padStart(2, '0');
        const base = date.getFullYear() + '/' + p(date.getMonth() + 1) + '/' + p(date.getDate());
        return pattern.indexOf('HH') >= 0 ? base + ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) : base;
      },
      newBlob: driveMock.newBlob,
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }, sleep: () => {}
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: k => { delete props[k]; }
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
    MailApp: { sendEmail: () => {} },
    ScriptApp: { getScriptId: () => 'reference-test', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: driveMock.DriveApp,
    UrlFetchApp: {}, Logger: { log: msg => { logs.push(String(msg)); } }
  };
  sandbox.globalThis = sandbox;
  sandbox.__tzCalls = tzCalls;
  sandbox.__logs = logs;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'gs-merged(reference)' });
  return sandbox;
}

/** يستخرج رمز وصول صيانة جديد صالح لسندبوكس معطى — يحاكي القناة الوحيدة الحقيقية (سجل تنفيذ المحرر). */
function grantToken_(S) {
  S.__logs.length = 0;
  S.grantMaintenanceAccess_();
  const line = S.__logs.find(l => l.indexOf('رمز وصول الصيانة') >= 0);
  if (!line) throw new Error('لم يُطبع رمز وصول الصيانة في السجل (اختبار)');
  return line.split(': ').pop();
}

const __headerSandbox = buildSandbox();
const ALL_HEADERS = {
  'إعدادات المشروع': ['المفتاح', 'القيمة', 'الوصف'],
  'المستخدمون': ['رقم المستخدم', 'الاسم', 'البريد الإلكتروني', 'كلمة المرور المشفرة', 'الملح', 'الدور', 'رقم الجمعية', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول'],
  'الجمعيات': ['رقم الجمعية', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'الحالة', 'تاريخ الإنشاء'],
  'المستفيدون': ['رقم المستفيد', 'رقم الجمعية', 'الاسم', 'المنطقة', 'المدينة', 'العنوان', 'رقم الجوال', 'رقم جوال إضافي', 'عدد الأفراد', 'ضمان اجتماعي', 'الحالة الاجتماعية', 'مبلغ الدخل', 'الاحتياج', 'حالة المستفيد', 'حالة التسليم', 'رقم المندوب', 'الملاحظات', 'تاريخ الإنشاء', 'تاريخ التسليم', 'آخر تحديث', 'خط العرض', 'خط الطول', 'علامة مميزة', 'مصدر الموقع', 'تاريخ تحديث الموقع', 'الحي', 'حالة مراجعة المستفيد', 'سبب رفض المستفيد', 'مراجع اعتماد المستفيد', 'تاريخ مراجعة المستفيد'],
  'احتياجات المستفيدين': ['رقم الاحتياج', 'رقم المستفيد', 'رقم الجمعية', 'نوع الجهاز', 'حالة القرار', 'سبب الرفض', 'المراجع', 'تاريخ القرار', 'حالة التنفيذ', 'تاريخ الإنشاء', 'آخر تحديث'],
  'الأجهزة': ['رقم الجهاز', 'اسم الجهاز', 'النوع', 'رقم الجمعية', 'رقم المستفيد', 'حالة الجهاز', 'تاريخ الإضافة', 'تاريخ التسليم', 'ملاحظات', 'رقم الاحتياج'],
  'المناديب': ['رقم المندوب', 'رقم الجمعية', 'اسم المندوب', 'رقم الجوال', 'رمز الدخول المشفر', 'الملح', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول'],
  'التسليمات': ['رقم التسليم', 'رقم المستفيد', 'رقم المندوب', 'أرقام الأجهزة', 'الحالة', 'سبب التعذر', 'الملاحظات', 'رابط الإثبات', 'تاريخ ووقت التسليم', 'تاريخ الإنشاء'],
  'إدارة الأنشطة': ['ترتيب المرحلة', 'اسم المرحلة', 'ترتيب النشاط الرئيسي', 'اسم النشاط الرئيسي', 'اسم النشاط الفرعي', 'المسؤول', 'تاريخ البداية', 'تاريخ النهاية', 'نسبة الإنجاز', 'الحالة', 'رابط الشاهد', 'ملاحظات'],
  'شواهد الأنشطة الرئيسية': ['اسم المرحلة', 'اسم النشاط الرئيسي', 'رابط الشاهد', 'حالة الاعتماد', 'ملاحظات', 'تاريخ الرفع'],
  'سجل العمليات': ['رقم العملية', 'رقم المستخدم', 'اسم المستخدم', 'الدور', 'العملية', 'القسم', 'رقم السجل', 'ملاحظات', 'التاريخ والوقت'],
  'طلبات انضمام الجمعيات': vm.runInContext("HEADERS['طلبات انضمام الجمعيات']", __headerSandbox),
  'البيانات المرجعية': ['المعرف', 'النوع', 'القيمة', 'يتبع', 'الترتيب', 'نشط']
};

function seedSheets(S) {
  Object.keys(ALL_HEADERS).forEach(name => S.ensureSheet_(S.SpreadsheetApp.getActiveSpreadsheet(), name, ALL_HEADERS[name]));
}
function adminSession(S) {
  return S.createSession_({ id: 'USR-ADMIN-REF', name: 'مدير الاختبار', role: 'ADMIN', associationId: '' });
}

/* ================================================================
   1) ترابط المنطقة والمدينة (بعد تشغيل الترحيل في المحاكاة فقط)
   ================================================================ */

section('1) ترابط المنطقة والمدينة عبر validateRegionCity_');
{
  const S = buildSandbox();
  seedSheets(S);
  S.migrateReferenceData_(grantToken_(S));

  assert('منطقة ومدينة صحيحتان تمران دون تعديل', (() => {
    const place = S.validateRegionCity_('الرياض', 'الخرج');
    return place.region === 'الرياض' && place.city === 'الخرج';
  })());

  throws('منطقة غير معروفة تُرفض', () => S.validateRegionCity_('منطقة وهمية', 'أي مدينة'), 'المنطقة غير معروفة');
}

/* ================================================================
   2) منع مدينة لا تتبع المنطقة
   ================================================================ */

section('2) رفض مدينة لا تتبع المنطقة المختارة');
{
  const S = buildSandbox();
  seedSheets(S);
  S.migrateReferenceData_(grantToken_(S));

  throws('مدينة تتبع منطقة أخرى (جدة تحت الرياض) تُرفض صراحة',
    () => S.validateRegionCity_('الرياض', 'جدة'), 'لا تتبع منطقة');
  assert('نفس المدينة تُقبل تحت منطقتها الصحيحة',
    S.validateRegionCity_('مكة المكرمة', 'جدة').city === 'جدة');
}

/* ================================================================
   3) القيم القديمة وغير المعروفة: قبل الترحيل (توافق) وبعده (تشخيص)
   ================================================================ */

section('3) التوافق قبل الترحيل + تشخيص القيم القديمة بعده');
{
  const S = buildSandbox();
  seedSheets(S);

  // تغيير مقصود في هذه المرحلة (كان: سقوط صامت إلى نص حر قبل الترحيل):
  // القائمة المعتمدة المضمَّنة في الكود صارت مصدرًا صالحًا فورًا، فلا تُقبل
  // قيمة خارجها حتى قبل تشغيل أي ترحيل — هذا ما يجعل القوائم المنسدلة
  // المترابطة تعمل في كل النماذج بلا كتابة أي شيء في الملف الحي.
  assert('بلا ورقة مرجعية: المصدر المضمَّن جاهز فورًا (ready:true, source:builtin)', (() => {
    const data = S.getReferenceData();
    return data.ready === true && data.source === 'builtin' && data.regions.length > 0;
  })());
  assert('بلا ورقة مرجعية: المدن مترابطة بمنطقتها في المصدر المضمَّن',
    S.getReferenceData().citiesByRegion['مكة المكرمة'].indexOf('جدة') >= 0);
  throws('بلا ورقة مرجعية: منطقة خارج القائمة المعتمدة تُرفض (لا سقوط صامت لنص حر)',
    () => S.validateRegionCity_('منطقة قديمة غير معروفة', 'مدينة قديمة'), 'غير معروفة');
  throws('بلا ورقة مرجعية: تصنيف جمعية خارج القائمة يُرفض',
    () => S.validateAssociationCategory_('تصنيف قديم غريب'), 'غير معروف');
  throws('بلا ورقة مرجعية: نوع جهاز خارج القائمة يُرفض',
    () => S.validateDeviceType_('نوع قديم غريب'), 'غير معروف');

  // تمرير القيم التاريخية: القيمة المخزَّنة مسبقًا في السجل نفسه تُقبل
  // كما هي، فلا يتعطّل تعديل حقل آخر تمامًا في سجل قديم.
  assert('قيمة منطقة/مدينة قديمة مخزَّنة في السجل نفسه تُقبل عند تعديله (grandfathering)',
    S.validateRegionCity_('منطقة قديمة', 'مدينة قديمة', {region: 'منطقة قديمة', city: 'مدينة قديمة'}).city === 'مدينة قديمة');
  assert('تصنيف جمعية قديم مخزَّن يُقبل عند تعديل نفس السجل',
    S.validateAssociationCategory_('تصنيف قديم غريب', 'تصنيف قديم غريب') === 'تصنيف قديم غريب');
  assert('نوع جهاز قديم مخزَّن يُقبل عند تعديل نفس السجل',
    S.validateDeviceType_('نوع قديم غريب', 'نوع قديم غريب') === 'نوع قديم غريب');
  throws('لكن قيمة قديمة لا تطابق المخزَّن فعلًا لا تُمرَّر (لا ثغرة "أي نص يمر بادعاء أنه قديم")',
    () => S.validateRegionCity_('منطقة مخترَعة', 'مدينة مخترَعة', {region: 'منطقة قديمة', city: 'مدينة قديمة'}), 'غير معروفة');
  assert('التشخيص جاهز فورًا بالمصدر المضمَّن (ready:true) بلا أي ترحيل', (() => {
    const report = S.diagnoseReferenceDataIssues_(grantToken_(S));
    return report.ready === true;
  })());

  S.migrateReferenceData_(grantToken_(S));
  const admin = adminSession(S);
  // نُدخل بيانات تحمل قيمًا قديمة/غير معروفة مباشرة عبر appendObject_ لمحاكاة
  // سجلات موجودة قبل الترحيل (تفاديًا لرفض القوالب الصارمة عبر saveAssociation).
  S.appendObject_('الجمعيات', {
    'رقم الجمعية': 'ASC-OLD-1', 'اسم الجمعية': 'جمعية قديمة', 'التصنيف': 'تصنيف غير معروف',
    'المنطقة': 'مكة', 'المدينة': 'جدة', 'أرقام التواصل': '0500000099',
    'البريد الإلكتروني': 'old@example.org', 'الحالة': 'نشطة', 'تاريخ الإنشاء': S.now_()
  });
  S.appendObject_('المستفيدون', {
    'رقم المستفيد': 'BEN-OLD-1', 'رقم الجمعية': 'ASC-OLD-1', 'الاسم': 'مستفيد قديم',
    'المنطقة': 'الرياض', 'المدينة': 'جدة', 'العنوان': 'حي قديم', 'رقم الجوال': '0500000098',
    'رقم جوال إضافي': '', 'عدد الأفراد': 3, 'ضمان اجتماعي': 'لا', 'الحالة الاجتماعية': 'حالة غير معروفة',
    'مبلغ الدخل': 0, 'الاحتياج': '', 'حالة المستفيد': 'جديد', 'حالة التسليم': 'لم يبدأ',
    'رقم المندوب': '', 'الملاحظات': '', 'تاريخ الإنشاء': S.now_(), 'تاريخ التسليم': '', 'آخر تحديث': S.now_(),
    'خط العرض': '', 'خط الطول': ''
  });
  S.appendObject_('الأجهزة', {
    'رقم الجهاز': 'DEV-OLD-1', 'اسم الجهاز': 'جهاز قديم', 'النوع': 'نوع غير معروف',
    'رقم الجمعية': 'ASC-OLD-1', 'رقم المستفيد': '', 'حالة الجهاز': 'بالمستودع',
    'تاريخ الإضافة': S.now_(), 'تاريخ التسليم': '', 'ملاحظات': ''
  });
  S.invalidateTableCache_('الجمعيات'); S.invalidateTableCache_('المستفيدون'); S.invalidateTableCache_('الأجهزة');

  const report = S.diagnoseReferenceDataIssues_(grantToken_(S));
  assert('بعد الترحيل: التشخيص جاهز (ready:true)', report.ready === true);
  assert('يكتشف مدينة لا تتبع منطقتها المسجَّلة لدى المستفيد (جدة تحت الرياض)',
    report.issues.some(i => i.type === 'CITY_REGION_MISMATCH' && i.sheet === 'المستفيدون' && i.id === 'BEN-OLD-1'));
  assert('يكتشف منطقة غير معروفة لدى الجمعية ("مكة" اختصار قديم)',
    report.issues.some(i => i.type === 'UNKNOWN_REGION' && i.sheet === 'الجمعيات' && i.id === 'ASC-OLD-1'));
  assert('يكتشف حالة اجتماعية غير معروفة', report.issues.some(i => i.type === 'UNKNOWN_SOCIAL_STATUS' && i.id === 'BEN-OLD-1'));
  assert('يكتشف تصنيف جمعية غير معروف', report.issues.some(i => i.type === 'UNKNOWN_CATEGORY' && i.id === 'ASC-OLD-1'));
  assert('يكتشف نوع جهاز غير معروف', report.issues.some(i => i.type === 'UNKNOWN_DEVICE_TYPE' && i.id === 'DEV-OLD-1'));
  assert('عدد السجلات المتأثرة موجود بالتصنيف الإجمالي (byType/bySeverity)',
    report.issueCount === report.issues.length && report.issueCount >= 5);

  assert('diagnoseReferenceDataIssues قراءة فقط — لا يكتب أي شيء (نفس البيانات قبل وبعد الاستدعاء)', (() => {
    const before = JSON.stringify(S.readTable_('المستفيدون').rows);
    S.diagnoseReferenceDataIssues_(grantToken_(S));
    const after = JSON.stringify(S.readTable_('المستفيدون').rows);
    return before === after;
  })());
}

/* ================================================================
   3ب) تصنيف "جمعية بر" الرسمي، والاسم السابق "بر"
   ================================================================ */

section('3ب) تصنيف "جمعية بر" واسمه السابق "بر"');
{
  const S = buildSandbox();
  seedSheets(S);

  assert('"جمعية بر" ضمن القائمة المعتمدة المضمَّنة فورًا', S.getReferenceData().associationCategories.indexOf('جمعية بر') >= 0);
  assert('اختيار "جمعية بر" مباشرة يمر دون تعديل', S.validateAssociationCategory_('جمعية بر') === 'جمعية بر');
  assert('القيمة السابقة "بر" تُطبَّع تلقائيًا إلى "جمعية بر" عند أي إنشاء أو تعديل جديد',
    S.validateAssociationCategory_('بر') === 'جمعية بر');
  assert('التطبيع يعمل أيضًا عند تعديل سجل قديم كانت قيمته المخزَّنة "بر"',
    S.validateAssociationCategory_('بر', 'بر') === 'جمعية بر');

  // سجل قديم لم يُعدَّل إطلاقًا (بلا أي استدعاء لـ validateAssociationCategory_)
  // يبقى محتفظًا بـ"بر" كما هي — لا ترحيل تلقائي جماعي في الخلفية.
  const admin = adminSession(S);
  S.appendObject_('الجمعيات', {
    'رقم الجمعية': 'ASC-BER-1', 'اسم الجمعية': 'جمعية بر قديمة', 'التصنيف': 'بر',
    'المنطقة': 'الرياض', 'المدينة': 'الرياض', 'أرقام التواصل': '0500000077',
    'البريد الإلكتروني': 'ber-old@example.org', 'الحالة': 'نشطة', 'تاريخ الإنشاء': S.now_()
  });
  S.invalidateTableCache_('الجمعيات');
  const stored = S.readTable_('الجمعيات').rows.find(r => r['رقم الجمعية'] === 'ASC-BER-1');
  assert('سجل قديم بقيمة "بر" يبقى مخزَّنًا كما هو حرفيًا بلا أي تعديل تلقائي', stored && stored['التصنيف'] === 'بر');

  const report = S.diagnoseReferenceDataIssues_(grantToken_(S));
  assert('"بر" لا تُعتبر تصنيفًا مجهولًا في التشخيص (اسم سابق معروف، لا مخالفة)',
    !report.issues.some(i => i.type === 'UNKNOWN_CATEGORY' && i.id === 'ASC-BER-1'));

  // نموذج تقديم الجمعية العام (المرحلة الأولى) لا يحمل حقل "التصنيف" أصلًا
  // (أُزيل من نموذج التقديم في مرحلة سابقة)، فالتغطية هنا تقتصر على مسار
  // الإدارة (saveAssociation) الذي يستخدم نفس validateAssociationCategory_.
  const assocNew = S.saveAssociation(admin.token, {
    name: 'جمعية بر جديدة', category: 'بر', region: 'الرياض', city: 'الرياض',
    phone: '0500000078', email: 'ber-new@example.org', password: 'BerPass123'
  });
  assert('إنشاء جمعية جديدة عبر لوحة الإدارة بقيمة "بر" يُخزَّن بالاسم الرسمي "جمعية بر"',
    assocNew.ok && assocNew.record.category === 'جمعية بر');
}

/* ================================================================
   4) وضع dry-run لا يعدّل شيئًا إطلاقًا
   ================================================================ */

function seedLegacyValuesForMigration(S) {
  seedSheets(S);
  S.migrateReferenceData_(grantToken_(S));
  S.appendObject_('الجمعيات', {
    'رقم الجمعية': 'ASC-M-1', 'اسم الجمعية': 'جمعية الترحيل', 'التصنيف': 'جمعية خيرية',
    'المنطقة': 'مكة', 'المدينة': 'جدة', 'أرقام التواصل': '0500000097',
    'البريد الإلكتروني': 'mig@example.org', 'الحالة': 'نشطة', 'تاريخ الإنشاء': S.now_()
  });
  S.appendObject_('المستفيدون', {
    'رقم المستفيد': 'BEN-M-1', 'رقم الجمعية': 'ASC-M-1', 'الاسم': 'مستفيد الترحيل',
    'المنطقة': 'الشرقيه', 'المدينة': 'الدمام', 'العنوان': 'حي', 'رقم الجوال': '0500000096',
    'رقم جوال إضافي': '', 'عدد الأفراد': 2, 'ضمان اجتماعي': 'لا', 'الحالة الاجتماعية': 'أرملة',
    'مبلغ الدخل': 0, 'الاحتياج': '', 'حالة المستفيد': 'جديد', 'حالة التسليم': 'لم يبدأ',
    'رقم المندوب': '', 'الملاحظات': '', 'تاريخ الإنشاء': S.now_(), 'تاريخ التسليم': '', 'آخر تحديث': S.now_(),
    'خط العرض': '', 'خط الطول': ''
  });
  // مستفيد بقيمة غامضة تمامًا (لا مرادف معروف ولا مدينة فريدة الانتماء) — يجب ألّا يُخمَّن لها بديل أبدًا.
  S.appendObject_('المستفيدون', {
    'رقم المستفيد': 'BEN-M-2', 'رقم الجمعية': 'ASC-M-1', 'الاسم': 'مستفيد غامض',
    'المنطقة': 'منطقة مجهولة تمامًا', 'المدينة': 'مدينة مجهولة', 'العنوان': 'حي', 'رقم الجوال': '0500000095',
    'رقم جوال إضافي': '', 'عدد الأفراد': 1, 'ضمان اجتماعي': 'لا', 'الحالة الاجتماعية': 'حالة غامضة تمامًا',
    'مبلغ الدخل': 0, 'الاحتياج': '', 'حالة المستفيد': 'جديد', 'حالة التسليم': 'لم يبدأ',
    'رقم المندوب': '', 'الملاحظات': '', 'تاريخ الإنشاء': S.now_(), 'تاريخ التسليم': '', 'آخر تحديث': S.now_(),
    'خط العرض': '', 'خط الطول': ''
  });
  S.invalidateTableCache_('الجمعيات'); S.invalidateTableCache_('المستفيدون');
}

section('4) وضع المعاينة (dry-run) لا يعدّل أي بيانات');
{
  const S = buildSandbox();
  seedLegacyValuesForMigration(S);

  const beforeAssoc = JSON.stringify(S.readTable_('الجمعيات').rows);
  const beforeBen = JSON.stringify(S.readTable_('المستفيدون').rows);

  const preview = S.migrateLegacyReferenceValues_(grantToken_(S), true);
  assert('dryRun افتراضيًا true بلا تمرير وسيط', S.migrateLegacyReferenceValues_(grantToken_(S)).dryRun === true);
  assert('المعاينة تقترح تصحيح المنطقة "مكة" ← "مكة المكرمة"',
    preview.proposals.some(p => p.sheet === 'الجمعيات' && p.field === 'المنطقة' && p.oldValue === 'مكة' && p.newValue === 'مكة المكرمة'));
  assert('المعاينة تقترح تصحيح "الشرقيه" ← "الشرقية"',
    preview.proposals.some(p => p.field === 'المنطقة' && p.oldValue === 'الشرقيه' && p.newValue === 'الشرقية'));
  assert('القيم الغامضة كليًا تُرفض ولا يُخمَّن لها بديل (تذهب إلى ambiguous فقط)',
    preview.ambiguous.some(a => a.id === 'BEN-M-2' && a.field === 'المنطقة')
    && !preview.proposals.some(p => p.id === 'BEN-M-2' && p.field === 'المنطقة'));
  assert('الحالة الاجتماعية الغامضة تُرفض أيضًا دون تخمين', preview.ambiguous.some(a => a.id === 'BEN-M-2' && a.field === 'الحالة الاجتماعية'));

  assert('لا تعديل فعلي على الجمعيات في وضع المعاينة', JSON.stringify(S.readTable_('الجمعيات').rows) === beforeAssoc);
  assert('لا تعديل فعلي على المستفيدين في وضع المعاينة', JSON.stringify(S.readTable_('المستفيدون').rows) === beforeBen);
  assert('appliedCount صفر دائمًا في وضع المعاينة', preview.appliedCount === 0);
}

/* ================================================================
   5) الترحيل الفعلي قابل لإعادة التشغيل بأمان دون تكرار أو إفساد
   ================================================================ */

section('5) الترحيل الفعلي (dryRun=false) قابل لإعادة التشغيل بأمان');
{
  const S = buildSandbox();
  seedLegacyValuesForMigration(S);

  const first = S.migrateLegacyReferenceValues_(grantToken_(S), false);
  assert('التشغيل الأول يطبّق التعديلات المؤكَّدة فقط', first.appliedCount === first.proposedCount && first.appliedCount > 0);
  assert('التشغيل الأول لا يطبّق أي تعديل على السجل الغامض', !first.proposals.some(p => p.id === 'BEN-M-2'));

  const associationAfterFirst = S.findById_('الجمعيات', 'رقم الجمعية', 'ASC-M-1');
  assert('المنطقة أصبحت "مكة المكرمة" فعليًا بعد التشغيل الأول', String(associationAfterFirst['المنطقة']) === 'مكة المكرمة');

  const second = S.migrateLegacyReferenceValues_(grantToken_(S), false);
  assert('التشغيل الثاني على نفس البيانات لا يقترح شيئًا جديدًا (لا تكرار)', second.proposedCount === 0 && second.appliedCount === 0);
  assert('التشغيل الثاني لا يزال يبلّغ عن نفس السجل الغامض (لم يُفسَد ولم يُخفَ)',
    second.ambiguous.some(a => a.id === 'BEN-M-2' && a.field === 'المنطقة'));

  const beneficiaryAfter = S.findById_('المستفيدون', 'رقم المستفيد', 'BEN-M-1');
  assert('بيانات المستفيد غير الغامض بقيت متّسقة (منطقة/مدينة معتمدتان) بعد إعادة التشغيل',
    String(beneficiaryAfter['المنطقة']) === 'الشرقية' && String(beneficiaryAfter['المدينة']) === 'الدمام');
  const ambiguousBeneficiary = S.findById_('المستفيدون', 'رقم المستفيد', 'BEN-M-2');
  assert('بيانات المستفيد الغامض بقيت كما هي دون أي تغيير (لم تُفسَد بتخمين)',
    String(ambiguousBeneficiary['المنطقة']) === 'منطقة مجهولة تمامًا');
}

/* ================================================================
   6) بوابة تقديم الجمعية العامة، حفظ المستفيد، والاستيراد الجماعي
      مع القوائم المرجعية الموحَّدة
   ================================================================ */

section('6) تقديم الجمعية + حفظ المستفيد + الاستيراد الجماعي عبر التحقق الموحَّد');
{
  const S = buildSandbox();
  seedSheets(S);
  S.migrateReferenceData_(grantToken_(S));

  assert('submitAssociationApplication ينجح بتصنيف معتمد ومنطقة/مدينة صحيحتين', (() => {
    const result = S.submitAssociationApplication(applicationFixture({
      name: 'جمعية جديدة', category: 'جمعية أهلية', region: 'الرياض', city: 'الرياض',
      phone: '0501112222', email: 'apply@example.org', contactName: 'مسؤول', licenseNumber: 'LIC-REF-1'
    }));
    return result.ok && !!result.id;
  })());

  throws('submitAssociationApplication يرفض تصنيفًا غير معروف بعد الترحيل',
    () => S.submitAssociationApplication(applicationFixture({
      name: 'جمعية أخرى', category: 'تصنيف غير موجود إطلاقًا', region: 'الرياض', city: 'الرياض',
      phone: '0501112223', email: 'apply2@example.org', contactName: 'مسؤول', licenseNumber: 'LIC-REF-2'
    })), 'غير معروف');

  throws('submitAssociationApplication يرفض مدينة لا تتبع المنطقة',
    () => S.submitAssociationApplication(applicationFixture({
      name: 'جمعية ثالثة', category: 'جمعية أهلية', region: 'الرياض', city: 'جدة',
      phone: '0501112224', email: 'apply3@example.org', contactName: 'مسؤول', licenseNumber: 'LIC-REF-3'
    })), 'لا تتبع منطقة');

  const admin = adminSession(S);
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية الاختبار المرجعي', category: 'جمعية خيرية', region: 'الرياض', city: 'الخرج',
    phone: '0500000050', email: 'ref-assoc@example.org', password: 'RefPass123'
  });
  const assocSession = S.createSession_({ id: 'USR-ASSOC-REF', name: 'جمعية الاختبار المرجعي', role: 'ASSOCIATION', associationId: assoc.id });

  assert('saveBeneficiary ينجح بحالة اجتماعية معتمدة', (() => {
    const b = S.saveBeneficiary(assocSession.token, { deviceTypes: ['ثلاجة'],
      name: 'مستفيد مرجعي', region: 'الرياض', city: 'الخرج', address: 'حي', district: 'حي الاختبار',
      phone: '0500000051', familyCount: 2, socialStatus: 'يتيم', needs: ['ثلاجة']
    });
    return b.ok && b.record.socialStatus === 'يتيم';
  })());

  throws('saveBeneficiary يرفض حالة اجتماعية غير معروفة بعد الترحيل',
    () => S.saveBeneficiary(assocSession.token, { deviceTypes: ['ثلاجة'],
      name: 'مستفيد آخر', region: 'الرياض', city: 'الخرج', address: 'حي', district: 'حي الاختبار',
      phone: '0500000052', familyCount: 1, socialStatus: 'حالة مخترعة', needs: []
    }), 'غير معروفة');

  assert('importBeneficiaries يستورد صفًا بحالة اجتماعية معتمدة بنجاح', (() => {
    const result = S.importBeneficiaries(assocSession.token, [{
      name: 'مستورد مرجعي', region: 'الرياض', city: 'الخرج', address: 'حي', district: 'حي الاختبار',
      phone: '0500000053', familyCount: 3, socialStatus: 'متزوج/متزوجة', needs: 'ثلاجة'
    }], true);
    return result.ok && result.imported === 1;
  })());

  assert('importBeneficiaries يرفض صفًا بحالة اجتماعية غير معروفة كخطأ سطر واضح (لا يفشل الاستيراد كله بلا توضيح)', (() => {
    const result = S.importBeneficiaries(assocSession.token, [
      { name: 'صف سليم', region: 'الرياض', city: 'الخرج', address: 'حي', district: 'حي الاختبار', phone: '0500000054', familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة' },
      { name: 'صف فاسد', region: 'الرياض', city: 'الخرج', address: 'حي', district: 'حي الاختبار', phone: '0500000055', familyCount: 1, socialStatus: 'حالة غير موجودة', needs: 'ثلاجة' }
    ], true);
    return result.ok === false && result.errorCount === 1 && result.validCount === 1
      && result.errors[0].message.includes('غير معروفة');
  })());

  assert('saveDevice يرفض نوع جهاز غير معروف بعد الترحيل', (() => {
    try { S.saveDevice(admin.token, { name: 'جهاز', type: 'نوع مخترع', associationId: assoc.id }); return false; }
    catch (error) { return error.message.includes('غير معروف'); }
  })());
  assert('saveDevice ينجح بنوع معتمد', S.saveDevice(admin.token, { name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id }).ok);
}

/* ================================================================
   7) حفظ الصفر الأول في رقم الجوال (كتابة وقراءة فعليتان)
   ================================================================ */

section('7) حفظ الصفر الأول في رقم الجوال');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية الهاتف', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0555555555', email: 'phone-assoc@example.org', password: 'PhonePass123'
  });
  assert('رقم جوال الجمعية يحتفظ بالصفر الأول عند القراءة بعد الحفظ', assoc.phone === '0555555555' || (() => {
    const row = S.findById_('الجمعيات', 'رقم الجمعية', assoc.id);
    return String(row['أرقام التواصل']) === '0555555555';
  })());

  const assocSession = S.createSession_({ id: 'USR-ASSOC-PH', name: 'جمعية الهاتف', role: 'ASSOCIATION', associationId: assoc.id });
  const beneficiary = S.saveBeneficiary(assocSession.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد الهاتف', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501234567', phone2: '0559876543', familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  assert('رقم الجوال الأساسي محفوظ بصفره الأول في السجل الخام على الشيت',
    String(S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['رقم الجوال']) === '0501234567');
  assert('الرقم الإضافي أيضًا محفوظ بصفره الأول', String(S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['رقم جوال إضافي']) === '0559876543');
  assert('normalizeBeneficiary_/القراءة عبر الواجهة تعيد الرقمين بصفريهما الأولين',
    beneficiary.record.phone === '0501234567' && beneficiary.record.phone2 === '0559876543');

  assert('displayPhone_ يعيد بناء الصفر الأول المفقود لبيانات قديمة فاسدة (سلامة قراءة فقط، لا يغيّر أي قيمة مخزَّنة)',
    S.displayPhone_('501234567') === '0501234567');
  assert('displayPhone_ لا يمس رقمًا يبدأ بصفر بالفعل', S.displayPhone_('0501234567') === '0501234567');
  assert('displayPhone_ يتعامل مع صيغة +966 فيعيد صيغة محلية بصفر أول',
    S.displayPhone_('+966501234567') === '0501234567');
  assert('safeCell_ يسبق رقم الجوال النصي الذي يبدأ بصفر بعلامة نص صريحة قبل الكتابة (يمنع Sheets من تحويله إلى رقم فيفقد الصفر)',
    S.safeCell_('0501234567').charAt(0) === "'");
}

/* ================================================================
   8) تنسيق التاريخ العربي بتوقيت الرياض، بلا Date string تقني
   ================================================================ */

section('8) تنسيق التاريخ العربي (yyyy/MM/dd) بتوقيت Asia/Riyadh دون Date تقني');
{
  const S = buildSandbox();
  seedSheets(S);

  assert('formatDate_/formatDateTime_ يستخدمان Asia/Riyadh دائمًا (توقيت المشروع المُعلَن)',
    /timezone:\s*'Asia\/Riyadh'/.test(source));

  const stamp = S.now_();
  assert('now_ ينتج نصًا بصيغة yyyy/MM/dd HH:mm عربية/رقمية بلا صيغة إنجليزية تقنية',
    /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(stamp));
  assert('التنسيق لا يحتوي مطلقًا على "GMT" أو أسماء أيام إنجليزية (Thu/Mon...) — عطل Date string التقني', (() => {
    const englishArtifact = /GMT|Mon|Tue|Wed|Thu|Fri|Sat|Sun/;
    return !englishArtifact.test(stamp);
  })());

  if (!S.applicationsSheetReady_()) {
    // لا شيء — applicationsSheetReady_ فقط دالة قراءة، لا تلمس أي بيانات.
  }
  S.SpreadsheetApp.getActiveSpreadsheet().insertSheet('طلبات انضمام الجمعيات');
  const submitted = S.submitAssociationApplication(applicationFixture({
    name: 'جمعية التاريخ', category: 'جمعية أهلية', region: 'الرياض', city: 'الرياض',
    phone: '0501230000', email: 'date-app@example.org', contactName: 'مسؤول', licenseNumber: 'LIC-REF-DATE'
  }));
  const record = S.getAssociationApplications_().find(a => a.id === submitted.id);
  assert('تاريخ تقديم طلب الجمعية منسَّق عربيًا/رقميًا وليس كائن JS Date خامًا (إصلاح عطل Applications.gs المرصود حيًّا)',
    /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(record.submittedAt));
  assert('تاريخ المراجعة الفارغ يُعاد كنص فارغ آمن لا "Invalid Date"', record.reviewedAt === '');
}

/* ================================================================
   9) عزل صلاحيات الجمعيات لم يتأثر بتغييرات التحقق المرجعي
   ================================================================ */

section('9) عزل صلاحيات الجمعيات (بلا تراجع بعد إضافة التحقق المرجعي)');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const assocA = S.saveAssociation(admin.token, {
    name: 'جمعية أ', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000060', email: 'assoc-a@example.org', password: 'PassA12345'
  });
  const assocB = S.saveAssociation(admin.token, {
    name: 'جمعية ب', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000061', email: 'assoc-b@example.org', password: 'PassB12345'
  });
  const sessionA = S.createSession_({ id: 'USR-A', name: 'جمعية أ', role: 'ASSOCIATION', associationId: assocA.id });
  const beneficiaryA = S.saveBeneficiary(sessionA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد أ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0500000062', familyCount: 1, socialStatus: 'أرملة', needs: []
  });

  assert('جمعية ب لا ترى مستفيدي جمعية أ عبر listBeneficiaries رغم القوائم الموحَّدة الجديدة', (() => {
    const sessionB = S.createSession_({ id: 'USR-B', name: 'جمعية ب', role: 'ASSOCIATION', associationId: assocB.id });
    const listB = S.listBeneficiaries(sessionB.token, {});
    return listB.items.every(item => item.id !== beneficiaryA.id);
  })());

  throws('جمعية ب لا تستطيع تعديل مستفيد جمعية أ (محاولة تمرير id مباشرة)', () => {
    const sessionB = S.createSession_({ id: 'USR-B2', name: 'جمعية ب', role: 'ASSOCIATION', associationId: assocB.id });
    S.saveBeneficiary(sessionB.token, {
      id: beneficiaryA.id, name: 'تعديل متطفل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
      phone: '0500000063', familyCount: 1, socialStatus: 'أرملة', needs: []
    });
  }, 'ليس لديك صلاحية');
}

/* ================================================================
   10) عدم تراجع اختبارات الحالات والحسابات والأداء بهذه المرحلة
   ================================================================ */

section('10) عدم تراجع قواعد سلامة الحالات وإدارة الحسابات والأداء');
{
  const S = buildSandbox();
  assert('assertDeviceTransition_ ما زالت مفروضة وترفض تجاوز المراحل', (() => {
    try { S.assertDeviceTransition_('بالمستودع', 'تم التسليم'); return false; }
    catch (error) { return error.message.includes('غير مسموح'); }
  })());
  assert('repairStateIntegrityIssues_ ما زالت غير مُستدعاة تلقائيًا من أي دالة أخرى في المصدر',
    (source.match(/repairStateIntegrityIssues_\(/g) || []).length === 1);
  assert('migrateLegacyReferenceValues_ ما زالت غير مُستدعاة تلقائيًا من أي دالة أخرى في المصدر (لن تعمل تلقائيًا أبدًا)',
    !/^\s*migrateLegacyReferenceValues_\(/m.test(source.replace(/function migrateLegacyReferenceValues_[\s\S]*?\n}\n/, '')));
  assert('diagnoseReferenceDataIssues_ لا يستدعيها إلا تعريفها وpreflightRelease_ القراءة-فقط (لا مسار تلقائي آخر)',
    (source.match(/diagnoseReferenceDataIssues_\(/g) || []).length === 2 && /function preflightRelease_\(token\)[\s\S]*?diagnoseReferenceDataIssues_\(/.test(source));
  assert('كل دوال الصيانة تنتهي بشرطة سفلية (خاصة، لا تُستدعى من الواجهة) وتتطلب requireMaintenanceAccess_',
    ['setupSheets_', 'migrateReferenceData_', 'migrateLegacyReferenceValues_', 'previewPhoneNormalization_',
      'migratePhoneNumbers_', 'diagnoseReferenceDataIssues_', 'diagnoseStateIntegrity_', 'repairStateIntegrityIssues_',
      'preflightRelease_', 'applyReleaseSchema_', 'previewNeedsMigration_', 'diagnoseNeedsIntegrity_'].every(name => {
      const match = source.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{([\\s\\S]{0,120})'));
      return match && /requireMaintenanceAccess_\(/.test(match[1]);
    }));
  assert('perfTime_ ما زالت مستخدَمة في saveBeneficiary رغم إضافة validateSocialStatus_', /function saveBeneficiary[\s\S]{0,80}perfTime_/.test(source));
}

console.log('\n========================================================');
if (failures === 0) {
  console.log('نجحت جميع الاختبارات: ' + checks + '/' + checks);
  console.log('========================================================');
  process.exit(0);
} else {
  console.log('فشل ' + failures + ' من ' + checks + ' اختبارًا');
  console.log('========================================================');
  process.exit(1);
}
