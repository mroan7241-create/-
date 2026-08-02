#!/usr/bin/env node
/**
 * اختبارات المرحلة الثالثة (الأداء): ترقيم الصفحات الخادمي والبحث
 * والفلاتر مع عزل الأدوار، الاستجابات الجزئية بدل getBootstrapData
 * الكامل بعد كل حفظ، invalidation الصحيح للذاكرة المؤقتة بعد الكتابة،
 * وعدم تسريب بيانات جمعية أخرى عبر أي دالة list*.
 *
 *   تشغيل:  node tools/perf-test.js
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

/* -------- بيئة محاكاة (مطابقة لبقية الأدوات) -------- */

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
      getRange: (r1, c1, numRows) => ({
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
  const mockSs = buildMockSpreadsheet();
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
      formatDate: (date, _tz, pattern) => {
        const p = n => String(n).padStart(2, '0');
        const base = date.getFullYear() + '/' + p(date.getMonth() + 1) + '/' + p(date.getDate());
        return pattern.indexOf('HH') >= 0 ? base + ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) : base;
      },
      newBlob: driveMock.newBlob,
      sleep: () => {},
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }
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
    ScriptApp: { getScriptId: () => 'perf-test', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: driveMock.DriveApp,
    UrlFetchApp: {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'gs-merged(perf)' });
  return sandbox;
}

const __headerSandbox = buildSandbox();
const ALL_HEADERS = {
  'إعدادات المشروع': ['المفتاح', 'القيمة', 'الوصف'],
  'المستخدمون': ['رقم المستخدم', 'الاسم', 'البريد الإلكتروني', 'كلمة المرور المشفرة', 'الملح', 'الدور', 'رقم الجمعية', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول', 'يجب تغيير كلمة المرور', 'كلمة مرور سابقة مشفرة', 'ملح سابق'],
  'الجمعيات': ['رقم الجمعية', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'الحالة', 'تاريخ الإنشاء'],
  'المستفيدون': ['رقم المستفيد', 'رقم الجمعية', 'الاسم', 'المنطقة', 'المدينة', 'العنوان', 'رقم الجوال', 'رقم جوال إضافي', 'عدد الأفراد', 'ضمان اجتماعي', 'الحالة الاجتماعية', 'مبلغ الدخل', 'الاحتياج', 'حالة المستفيد', 'حالة التسليم', 'رقم المندوب', 'الملاحظات', 'تاريخ الإنشاء', 'تاريخ التسليم', 'آخر تحديث', 'خط العرض', 'خط الطول', 'علامة مميزة', 'مصدر الموقع', 'تاريخ تحديث الموقع', 'الحي'],
  'الأجهزة': ['رقم الجهاز', 'اسم الجهاز', 'النوع', 'رقم الجمعية', 'رقم المستفيد', 'حالة الجهاز', 'تاريخ الإضافة', 'تاريخ التسليم', 'ملاحظات'],
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
  return S.createSession_({ id: 'USR-ADMIN-PF', name: 'مدير الاختبار', role: 'ADMIN', associationId: '' });
}

/** جمعيتان، كل واحدة بعدد من المستفيدين، لاختبار الترقيم والبحث والعزل معًا. */
function seedScenario(S, countPerAssociation) {
  seedSheets(S);
  const admin = adminSession(S);
  const assocA = S.saveAssociation(admin.token, {
    name: 'جمعية الأداء أ', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000030', email: 'perf-a@example.org', password: 'PerfPassA123'
  });
  const assocB = S.saveAssociation(admin.token, {
    name: 'جمعية الأداء ب', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000031', email: 'perf-b@example.org', password: 'PerfPassB123'
  });
  const assocASession = S.createSession_({ id: 'USR-PF-A', name: 'جمعية الأداء أ', role: 'ASSOCIATION', associationId: assocA.id });
  const assocBSession = S.createSession_({ id: 'USR-PF-B', name: 'جمعية الأداء ب', role: 'ASSOCIATION', associationId: assocB.id });

  for (let i = 0; i < countPerAssociation; i++) {
    S.saveBeneficiary(assocASession.token, {
      name: 'مستفيد أ رقم ' + i, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
      phone: '05' + String(10000000 + i).padStart(8, '0').slice(-8), familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة']
    });
    S.saveBeneficiary(assocBSession.token, {
      name: 'مستفيد ب رقم ' + i, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
      phone: '05' + String(20000000 + i).padStart(8, '0').slice(-8), familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة']
    });
  }
  // مستفيد باسم مميّز للبحث
  S.saveBeneficiary(assocASession.token, {
    name: 'فاطمة الباحثة عنها', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0500099999', familyCount: 1, socialStatus: 'أرملة', needs: []
  });

  return { S, admin, assocA, assocB, assocASession, assocBSession };
}

/* ================================================================
   1) ترقيم صفحات المستفيدين + بحث + عزل الأدوار
   ================================================================ */

section('1) listBeneficiaries — ترقيم، بحث، فلترة، عزل الأدوار');
{
  const { S, admin, assocA, assocB, assocASession, assocBSession } = seedScenario(buildSandbox(), 30);

  const page1 = S.listBeneficiaries(assocASession.token, { page: 1, pageSize: 10 });
  assert('الصفحة الأولى تعيد 10 عناصر بالضبط (حجم الصفحة المطلوب)', page1.items.length === 10);
  assert('الإجمالي يعكس كل مستفيدي الجمعية أ (30 + 1 بحث = 31)', page1.total === 31);
  assert('totalPages محسوبة صحيحًا (⌈31/10⌉ = 4)', page1.totalPages === 4);

  const page4 = S.listBeneficiaries(assocASession.token, { page: 4, pageSize: 10 });
  assert('الصفحة الأخيرة تحتوي الباقي فقط (31 - 30 = 1)', page4.items.length === 1);

  const outOfRange = S.listBeneficiaries(assocASession.token, { page: 999, pageSize: 10 });
  assert('طلب صفحة تتجاوز العدد يُعاد للصفحة الأخيرة الصالحة بدل خطأ أو فراغ مربك', outOfRange.page === 4 && outOfRange.items.length === 1);

  const searched = S.listBeneficiaries(assocASession.token, { page: 1, pageSize: 10, search: 'الباحثة' });
  assert('البحث بجزء من الاسم يُرجع نتيجة واحدة دقيقة', searched.total === 1 && searched.items[0].name === 'فاطمة الباحثة عنها');

  const noMatch = S.listBeneficiaries(assocASession.token, { page: 1, pageSize: 10, search: 'اسم غير موجود إطلاقًا' });
  assert('بحث بلا تطابق يُرجع صفحة فارغة صحيحة (لا خطأ)', noMatch.total === 0 && noMatch.items.length === 0);

  const bOnly = S.listBeneficiaries(assocBSession.token, { page: 1, pageSize: 100 });
  assert('جمعية ب لا ترى أيًا من مستفيدي جمعية أ (عزل كامل)', bOnly.items.every(x => x.name.indexOf('مستفيد ب') === 0));
  assert('عدد مستفيدي جمعية ب صحيح (30 فقط، بلا سجل البحث الخاص بأ)', bOnly.total === 30);

  throws('جمعية أ لا تستطيع طلب صفحة مستفيدين تخص جمعية أخرى عبر associationId', () => {
    const forced = S.listBeneficiaries(assocASession.token, { page: 1, pageSize: 100, associationId: assocB.id });
    if (forced.items.some(x => x.name.indexOf('مستفيد ب') === 0)) throw new Error('تسريب بيانات جمعية أخرى');
    // إن لم يحدث تسريب فالدالة تتجاهل associationId من الجمعية أصلًا (تنجح بأمان) — نتحقق من ذلك بدل توقّع استثناء حرفي
    throw new Error('تم تجاهل associationId بأمان');
  }, 'تم تجاهل associationId بأمان');

  const adminAll = S.listAssociations(admin.token, { page: 1, pageSize: 10 });
  assert('listAssociations (ADMIN) يعيد الجمعيتين معًا', adminAll.total === 2);
  throws('غير الإدارة لا تستطيع استدعاء listAssociations', () => S.listAssociations(assocASession.token, {}), 'صلاحية');
}

/* ================================================================
   2) استجابات جزئية بدل getBootstrapData الكامل بعد كل حفظ
   ================================================================ */

section('2) استجابات الحفظ لا تُعيد getBootstrapData كاملًا');
{
  const { S, admin, assocA, assocASession } = seedScenario(buildSandbox(), 2);

  const saveResult = S.saveBeneficiary(assocASession.token, {
    name: 'اختبار استجابة جزئية', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0500011111', familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  assert('saveBeneficiary لا تُعيد حقل data (Bootstrap كامل)', saveResult.data === undefined);
  assert('saveBeneficiary تُعيد record بالسجل المحدَّث فقط', !!saveResult.record && saveResult.record.name === 'اختبار استجابة جزئية');
  assert('saveBeneficiary تُعيد summary مصغَّرًا (بلا مصفوفات كاملة)', !!saveResult.summary && typeof saveResult.summary.beneficiaries === 'number');
  assert('حجم استجابة الحفظ الجزئية أصغر بكثير من Bootstrap كامل', JSON.stringify(saveResult).length < 2000);

  const device = S.saveDevice(admin.token, { name: 'ثلاجة', type: 'ثلاجة', associationId: assocA.id });
  assert('saveDevice لا تُعيد data كاملة', device.data === undefined);
  assert('saveDevice تُعيد record فقط', !!device.record);

  const delegateResult = S.saveDelegate(assocASession.token, { name: 'مندوب أداء', phone: '0500022222' });
  assert('saveDelegate لا تُعيد data كاملة', delegateResult.data === undefined);
  assert('saveDelegate تُعيد accessCode وrecord فقط', !!delegateResult.accessCode && !!delegateResult.record);

  const activityResult = S.saveActivity(admin.token, {
    stage: 'مرحلة أداء', stageOrder: 1, mainActivity: 'نشاط أداء', mainOrder: 1,
    subActivity: 'فرعي أداء', owner: 'فريق', progress: 10
  });
  assert('saveActivity لا تُعيد data كاملة (بل activities/stages/summary فقط)', activityResult.data === undefined && !!activityResult.activities);
}

/* ================================================================
   3) invalidation الصحيح للذاكرة المؤقتة بعد الكتابة
   ================================================================ */

section('3) إبطال الذاكرة المؤقتة (Bootstrap) فور أي كتابة');
{
  const { S, admin, assocASession } = seedScenario(buildSandbox(), 1);

  const before = S.getBootstrapData(admin.token);
  const cachedAgain = S.getBootstrapData(admin.token);
  // `_meta` (traceId/serverMs) يختلف بين طلبين عمدًا — هو قياس الطلب لا
  // بياناته. المقارنة تستثنيه وتتحقق منه على حدة أدناه.
  const withoutMeta = payload => { const copy = Object.assign({}, payload); delete copy._meta; return JSON.stringify(copy); };
  assert('طلب Bootstrap ثانٍ فوري بلا تعديل يعيد نفس القيم من الذاكرة المؤقتة', withoutMeta(before) === withoutMeta(cachedAgain));
  assert('كل طلب يحمل traceId مستقلًا (تتبّع فعلي لا قيمة ثابتة)',
    before._meta && cachedAgain._meta && before._meta.traceId !== cachedAgain._meta.traceId);
  assert('الطلب الثاني المخدوم من الذاكرة المؤقتة لا يقرأ أي ورقة إطلاقًا', cachedAgain._meta.reads === 0);
  assert('عدّادات perfTime_ لا تُنتج قيمًا سالبة أبدًا حين يُصفَّر الطلب داخلها', (() => {
    return S.perfDelta_(0, 5) === 5 && S.perfDelta_(9, 3) === 3 && S.perfDelta_(2, 2) === 0;
  })());
  assert('قياس الطلب لا يحمل أي حقل حساس (رمز/كلمة مرور)', (() => {
    const serialized = JSON.stringify(before._meta);
    return serialized.indexOf('token') === -1 && serialized.indexOf('password') === -1
      && serialized.indexOf('كلمة المرور') === -1;
  })());

  const cache = S.CacheService.getScriptCache();
  S.saveDevice(admin.token, { name: 'جهاز جديد', type: 'ثلاجة', associationId: '' });
  assert('clearDashboardCache تُبطل مفتاح bootstrap:ADMIN فور الكتابة، قبل أي طلب Bootstrap تالٍ', cache.get('bootstrap:ADMIN') === null);

  const afterWrite = S.getBootstrapData(admin.token);
  assert('Bootstrap يعكس فورًا جهازًا أُضيف بعد الكتابة (لا كاش قديم)', afterWrite.devices.length === before.devices.length + 1);
}

/* ================================================================
   4) سجل العمليات وطلبات الانضمام: عزل وترقيم وعدم تسريب
   ================================================================ */

section('4) listAuditLog وlistApplications — ترقيم وعزل');
{
  const { S, admin, assocA, assocB, assocASession, assocBSession } = seedScenario(buildSandbox(), 5);

  const auditA = S.listAuditLog(assocASession.token, { page: 1, pageSize: 5 });
  assert('سجل عمليات جمعية أ لا يحتوي على أي سطر خاص بجمعية ب', !auditA.items.some(row => row.notes && row.notes.indexOf('مستفيد ب') >= 0));
  const auditAdmin = S.listAuditLog(admin.token, { page: 1, pageSize: 5 });
  assert('الإدارة ترى سجل عمليات أكبر أو يساوي أي جمعية بمفردها', auditAdmin.total >= auditA.total);

  throws('جمعية لا تستطيع تمرير associationId جمعية أخرى في listAuditLog للتحايل', () => {
    const attempt = S.listAuditLog(assocASession.token, { page: 1, pageSize: 100, associationId: assocB.id });
    // الدور ASSOCIATION يتجاهل associationId المُرسَل ويُقيَّد بجمعيته دائمًا من الخادم
    if (attempt.total !== auditA.total) throw new Error('تسرّب نطاق جمعية أخرى');
    throw new Error('تم فرض النطاق من الخادم بأمان');
  }, 'تم فرض النطاق من الخادم بأمان');

  S.submitAssociationApplication(applicationFixture({
    name: 'جمعية طلب أداء', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500033333', email: 'perf-app@example.org', contactName: 'مسؤول', notes: '',
    licenseNumber: 'LIC-PERF-1'
  }));
  const apps = S.listApplications(admin.token, { page: 1, pageSize: 10 });
  assert('listApplications تُرجع الطلب المُقدَّم حديثًا', apps.total >= 1 && apps.items.some(a => a.email === 'perf-app@example.org'));
  throws('غير الإدارة لا تستطيع استدعاء listApplications', () => S.listApplications(assocASession.token, {}), 'صلاحية');
}

/* ================================================================
   5) لا تراجع في قواعد الحالات أو إدارة الحسابات
   ================================================================ */

section('5) عدم تراجع سلامة الحالات وإدارة الحسابات بهذه المرحلة');
{
  const S = buildSandbox();
  assert('assertDeviceTransition_ ما زالت مفروضة', (() => {
    try { S.assertDeviceTransition_('بالمستودع', 'تم التسليم'); return false; } catch (e) { return e.message.indexOf('غير مسموح') >= 0; }
  })());
  assert('withIdempotency_ موجودة ومُستخدَمة في confirmDelivery/saveAssociation/saveDelegate', (() => {
    const uses = (source.match(/withIdempotency_\(/g) || []).length;
    return uses >= 4; // تعريفها + 3 استخدامات على الأقل
  })());
  assert('perfTime_ مستخدَمة في نقاط دخول رئيسية (login/Bootstrap/list/save/assign/confirm)', (() => {
    const uses = (source.match(/perfTime_\(/g) || []).length;
    return uses >= 8;
  })());
}

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
