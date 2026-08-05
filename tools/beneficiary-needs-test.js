#!/usr/bin/env node
/**
 * اختبارات Phase 2: دورة اعتماد المستفيد والاحتياج (BeneficiaryNeeds.gs).
 * بيئة محاكاة كاملة في الذاكرة فقط (مطابقة لنمط tools/state-test.js) —
 * لا علاقة لها بأي شيت حي، ولا تُشغِّل applyReleaseSchema_ أو
 * setupSheets_ على أي بيانات حقيقية.
 *   تشغيل:  node tools/beneficiary-needs-test.js
 */
'use strict';

const path = require('path');
const vm = require('vm');
const { readMergedServerSource } = require('./gs-manifest');

const source = readMergedServerSource(path.join(__dirname, '..'));

let failures = 0;
const assert = (name, condition, detail) => {
  if (condition) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const throws = (name, fn, fragment) => {
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
  const logs = [];
  const mockSs = buildMockSpreadsheet();
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
      newBlob: () => ({ getBytes: () => [] }),
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
    ScriptApp: { getScriptId: () => 'needs-test', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: {
      createFolder: () => ({
        getId: () => 'folder-id', getUrl: () => 'https://drive.example/folder',
        createFile: () => ({ getId: () => 'FILE-TEST', getUrl: () => 'https://drive.example/file' })
      }),
      getFolderById: () => ({ createFile: () => ({ getId: () => 'FILE-TEST', getUrl: () => 'https://drive.example/file' }) })
    },
    UrlFetchApp: {}, Logger: { log: msg => { logs.push(String(msg)); } }
  };
  sandbox.globalThis = sandbox;
  sandbox.__logs = logs;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'gs-merged(needs)' });
  return sandbox;
}

/** يزرع كل الأوراق مباشرة من HEADERS الحقيقي في الملف (لا نسخة مكرَّرة قد تنحرف عنه). */
function seedSheets(S) {
  const headers = vm.runInContext('HEADERS', S);
  Object.keys(headers).forEach(name => S.ensureSheet_(S.SpreadsheetApp.getActiveSpreadsheet(), name, headers[name]));
}

function adminSession(S) {
  return S.createSession_({ id: 'USR-ADMIN-NT', name: 'مدير الاحتياجات', role: 'ADMIN', associationId: '' });
}

/** جمعية + مستفيد واحد بلا احتياجات مسجَّلة بعد. */
function seedScenario(S) {
  seedSheets(S);
  const admin = adminSession(S);
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية الاحتياجات', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000020', email: 'needs-assoc@example.org', password: 'NeedsPass123'
  });
  const assocSession = S.createSession_({ id: 'USR-ASSOC-NT', name: 'جمعية الاحتياجات', role: 'ASSOCIATION', associationId: assoc.id });
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    name: 'مستفيد الاحتياجات', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0500000021', familyCount: 3, socialStatus: 'أرملة', needs: [],
    lat: '24.7', lng: '46.6'
  });
  return { S, admin, assoc, assocSession, beneficiaryId: beneficiary.id };
}

function beneficiaryRow(S, beneficiaryId) { return S.findById_('المستفيدون', 'رقم المستفيد', beneficiaryId); }
function needRows(S, beneficiaryId) { return S.beneficiaryNeeds_(beneficiaryId); }

function grantToken_(S) {
  S.__logs.length = 0;
  S.grantMaintenanceAccess_();
  const line = S.__logs.find(l => l.indexOf('رمز وصول الصيانة') >= 0);
  if (!line) throw new Error('لم يُطبع رمز وصول الصيانة في السجل (اختبار)');
  return line.split(': ').pop();
}

/* ================================================================
   1) تسجيل الاحتياجات (setBeneficiaryNeeds)
   ================================================================ */
section('1) تسجيل احتياجات المستفيد');
{
  const ctx = seedScenario(buildSandbox());
  const { S, assocSession, beneficiaryId } = ctx;

  const one = S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  assert('جمعية تضيف مستفيدًا باحتياج واحد', one.ok && one.needs.length === 1);
  assert('حالة الاحتياج الافتراضية "بانتظار المراجعة"', one.needs[0].decisionStatus === 'بانتظار المراجعة');
  assert('حالة مراجعة المستفيد أصبحت "تحت المراجعة"', String(beneficiaryRow(S, beneficiaryId)['حالة مراجعة المستفيد']) === 'تحت المراجعة');

  const three = S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة', 'فرن', 'غسالة']);
  assert('جمعية تضيف مستفيدًا بثلاثة احتياجات (بلا تكرار الثلاجة الموجودة أصلًا)', three.needs.length === 3);

  throws('نوع جهاز غير مسموح به يُرفض', () => S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['مكيف']), 'غير مسموح به');

  const otherSession = S.createSession_({ id: 'USR-OTHER', name: 'جمعية أخرى', role: 'ASSOCIATION', associationId: 'ASC-999999' });
  throws('جمعية أخرى لا تستطيع تسجيل احتياج لمستفيد ليس لها',
    () => S.setBeneficiaryNeeds(otherSession.token, beneficiaryId, ['ثلاجة']),
    'ليس لديك صلاحية');
}

/* ================================================================
   2) رفض المستفيد
   ================================================================ */
section('2) ADMIN يرفض المستفيد مع سبب');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة', 'فرن']);

  throws('رفض بلا سبب يُرفض', () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'مرفوض' }), 'سبب رفض المستفيد إلزامي');

  const result = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'مرفوض', beneficiaryRejectReason: 'بيانات غير مكتملة' });
  assert('رفض المستفيد ناجح', result.ok && result.beneficiaryDecision === 'مرفوض');
  assert('كل الاحتياجات المعلَّقة رُفضت تلقائيًا معه', result.rejectedCount === 2 && result.approvedCount === 0);
  const needsAfter = needRows(S, beneficiaryId);
  assert('كل صفوف الاحتياج فعليًا "مرفوض"', needsAfter.every(n => n.decisionStatus === 'مرفوض'));
  assert('لا حالة تنفيذ لاحتياج مرفوض (لا استحقاق)', needsAfter.every(n => n.fulfillmentStatus === ''));

  throws('لا يمكن اعتماد احتياج لمستفيد مرفوض بعد ذلك',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد' }),
    'غير مسموح');
}

/* ================================================================
   3) قبول المستفيد واعتماد احتياج واحد من عدة
   ================================================================ */
section('3) ADMIN يقبل المستفيد ويعتمد جهازين ويرفض الثالث');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة', 'فرن', 'غسالة']);
  const needs = needRows(S, beneficiaryId);
  const byType = {}; needs.forEach(n => { byType[n.deviceType] = n; });

  const result = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, {
    beneficiaryDecision: 'معتمد',
    needDecisions: [
      { needId: byType['ثلاجة'].id, decision: 'معتمد' },
      { needId: byType['فرن'].id, decision: 'معتمد' },
      { needId: byType['غسالة'].id, decision: 'مرفوض', rejectReason: 'غير متاح حاليًا' }
    ]
  });
  assert('قبول المستفيد واعتماد جهازين ورفض الثالث', result.ok && result.approvedCount === 2 && result.rejectedCount === 1);
  const after = needRows(S, beneficiaryId);
  assert('الثلاجة والفرن أصبحا استحقاقًا معتمدًا فورًا', after.filter(n => n.fulfillmentStatus === 'استحقاق معتمد').length === 2);
  assert('الغسالة مرفوضة وبلا حالة تنفيذ', after.find(n => n.deviceType === 'غسالة').fulfillmentStatus === '');
  assert('المستفيد نفسه معتمد الآن', String(beneficiaryRow(S, beneficiaryId)['حالة مراجعة المستفيد']) === 'معتمد');

  throws('منع تنفيذ قرار الاعتماد مرتين لنفس المستفيد',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد' }), 'غير مسموح');
}

/* ================================================================
   4) قيود إضافية
   ================================================================ */
section('4) قيود الاعتماد الإلزامية');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;

  throws('منع القبول النهائي دون اعتماد احتياج واحد على الأقل',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'مرفوض', rejectReason: 'سبب' }] }),
    'دون اعتماد احتياج واحد');

  throws('طلب ناقص (احتياج معلَّق لم يُذكر) عند القبول يُرفض بوضوح',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [] }),
    'يجب البتّ في كل احتياجات المستفيد المعلَّقة');

  throws('احتياج مرفوض بلا سبب يُرفض',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'مرفوض' }] }),
    'سبب رفض الاحتياج');

  throws('احتياج غير موجود لهذا المستفيد يُرفض',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: 'NEED-999999', decision: 'معتمد' }] }),
    'احتياج غير موجود');
}

/* ================================================================
   5) idempotency (opId) — منع كتابة ثانية عند إعادة نفس الطلب
   ================================================================ */
section('5) إعادة تنفيذ نفس opId لا تكتب مرتين');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;
  const payload = { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }], opId: 'OP-FIXED-1' };

  const first = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, payload);
  assert('أول تنفيذ ناجح', first.ok);
  const second = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, payload);
  assert('إعادة إرسال نفس opId تُعيد نفس النتيجة الأصلية دون خطأ "سبق اتخاذ قرار"', second.ok && second.approvedCount === first.approvedCount);
}

/* ================================================================
   6) صحة التجميع حسب نوع الجهاز والجمعية
   ================================================================ */
section('6) تجميع الكميات حسب نوع الجهاز');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, assoc, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة', 'فرن']);
  const needs = needRows(S, beneficiaryId);
  const byType = {}; needs.forEach(n => { byType[n.deviceType] = n; });
  S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, {
    beneficiaryDecision: 'معتمد',
    needDecisions: [
      { needId: byType['ثلاجة'].id, decision: 'معتمد' },
      { needId: byType['فرن'].id, decision: 'مرفوض', rejectReason: 'غير متاح' }
    ]
  });
  S.saveDevice(admin.token, { name: 'ثلاجة مستودع', type: 'ثلاجة', associationId: assoc.id });

  const summary = S.needsSummaryByDeviceType_(assoc.id);
  assert('إجمالي الثلاجات المطلوبة = 1', summary['ثلاجة'].requested === 1);
  assert('إجمالي الثلاجات المعتمدة = 1', summary['ثلاجة'].approved === 1);
  assert('إجمالي الأفران المرفوضة = 1', summary['فرن'].rejected === 1);
  assert('الثلاجات المتوفرة فعليًا من ورقة الأجهزة = 1', summary['ثلاجة'].available === 1);
  assert('لا عجز في الثلاجات (معتمد 1، متوفر 1)', summary['ثلاجة'].shortage === 0);
  assert('عجز الأفران = 0 (لا احتياج معتمد أصلًا)', summary['فرن'].shortage === 0);

  const ctx2 = seedScenario(buildSandbox());
  const otherSummary = ctx2.S.needsSummaryByDeviceType_(ctx2.assoc.id);
  assert('عزل الجمعيات: تجميع جمعية أخرى لا يرى احتياجات هذه الجمعية', otherSummary['ثلاجة'].requested === 0);
}

/* ================================================================
   7) معاينة ترحيل الاحتياج النصي القديم (قراءة فقط)
   ================================================================ */
section('7) previewNeedsMigration_ — قراءة فقط، لا كتابة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية الترحيل', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000030', email: 'migration-assoc@example.org', password: 'MigrPass123'
  });
  const assocSession = S.createSession_({ id: 'USR-ASSOC-MIG', name: 'جمعية الترحيل', role: 'ASSOCIATION', associationId: assoc.id });
  const legacyConvertible = S.saveBeneficiary(assocSession.token, {
    name: 'مستفيد قديم قابل للتحويل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: '0500000031', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة', 'فرن'], lat: '24.7', lng: '46.6'
  });
  const legacyManual = S.saveBeneficiary(assocSession.token, {
    name: 'مستفيد قديم يحتاج مراجعة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: '0500000032', familyCount: 2, socialStatus: 'أرملة', needs: ['مكيف'], lat: '24.7', lng: '46.6'
  });

  throws('يتطلب رمز وصول صيانة صالح', () => S.previewNeedsMigration_('رمز-خاطئ'), null);

  const token = grantToken_(S);
  const report = S.previewNeedsMigration_(token);
  assert('لا يكتب أي شيء (لا صف احتياج جديد أُنشئ)', S.beneficiaryNeeds_(legacyConvertible.id).length === 0 && S.beneficiaryNeeds_(legacyManual.id).length === 0);
  assert('يحصي مستفيدَين بهما احتياج نصي قديم', report.totalBeneficiariesWithLegacyNeeds === 2);
  assert('يصنّف ثلاجة وفرن كقابلَين للتحويل', report.convertible.some(r => r.beneficiaryId === legacyConvertible.id && r.deviceType === 'ثلاجة')
    && report.convertible.some(r => r.beneficiaryId === legacyConvertible.id && r.deviceType === 'فرن'));
  assert('يصنّف "مكيف" كيحتاج مراجعة يدوية (خارج الأنواع الثلاثة الجديدة)', report.needsManualReview.some(r => r.beneficiaryId === legacyManual.id && r.rawValue === 'مكيف'));
  assert('لا اعتماد تلقائي ضمني — التقرير توزيع فقط بلا حقل "معتمد تلقائيًا"', report.legacyBeneficiaryStatusDistribution && typeof report.legacyBeneficiaryStatusDistribution === 'object');
}

console.log(failures === 0 ? '\n=== ALL PASS ===' : '\n=== ' + failures + ' FAILURE(S) ===');
process.exit(failures === 0 ? 0 : 1);
