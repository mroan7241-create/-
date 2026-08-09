#!/usr/bin/env node
/**
 * اختبارات Phase 2 + Phase 2.1 (تصليب وتكامل): دورة اعتماد المستفيد
 * والاحتياج (BeneficiaryNeeds.gs). بيئة محاكاة كاملة في الذاكرة فقط —
 * لا علاقة لها بأي شيت حي، ولا تُشغِّل applyReleaseSchema_ أو
 * setupSheets_ على أي بيانات حقيقية.
 *
 * محاكاة القفل هنا **واقعية عمدًا** (لا waitLock()/releaseLock() فارغتين
 * كما في الإصدار الأول من هذا الملف): تحتفظ بحالة ممسوك/محرَّر فعليًا،
 * وترفض أي إعادة استحواذ متداخلة (nested lock) وأي تحرير بلا استحواذ —
 * هذا وحده كان كافيًا لفضح عطل القفل المتداخل الأصلي في
 * setBeneficiaryNeeds_ (Phase 2) قبل إصلاحه في Phase 2.1.
 *
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
      appendRow: row => { rows.push(row.slice().map(stripForceText_)); },
      deleteRow: rowNum => { rows.splice(rowNum - 1, 1); }
    };
  }
  return {
    getSheetByName: name => (data[name] ? makeSheet(name) : null),
    insertSheet: name => makeSheet(name),
    getSheets: () => Object.keys(data).map(makeSheet)
  };
}

/**
 * محاكاة LockService واقعية: حالة ممسوك/محرَّر فعلية مشتركة بين كل
 * getScriptLock() (يطابق دلالات ScriptLock الحقيقية — قفل واحد على
 * مستوى المشروع، لا كائن مستقل لكل استدعاء). ترفض أي استحواذ متداخل
 * وأي تحرير بلا استحواذ سابق، بدلًا من waitLock()/releaseLock() فارغتين.
 */
function buildLockService_() {
  let locked = false;
  let acquireCount = 0;
  function makeLock() {
    return {
      waitLock: () => {
        if (locked) throw new Error('LockService المحاكاة: استحواذ متداخل مرفوض — القفل ممسوك بالفعل ولم يُحرَّر بعد (nested ScriptLock)');
        locked = true;
        acquireCount++;
      },
      releaseLock: () => {
        if (!locked) throw new Error('LockService المحاكاة: محاولة تحرير قفل غير ممسوك أصلًا');
        locked = false;
      }
    };
  }
  const service = { getScriptLock: makeLock };
  Object.defineProperty(service, '__state', { value: () => ({ locked, acquireCount }), enumerable: false });
  return service;
}

function buildSandbox() {
  const props = {};
  const cache = {};
  const logs = [];
  const mockSs = buildMockSpreadsheet();
  const lockService = buildLockService_();
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
    LockService: lockService,
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
  sandbox.__lock = lockService;
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

/**
 * جمعية + مستفيد واحد بدأ باحتياج واحد ("ثلاجة") — Phase 2.2 تمنع وجود
 * مستفيد بلا احتياج إطلاقًا (لا مسار ينشئ سجلًا فارغًا بعد الآن)، فهذا
 * هو أدنى سيناريو أساسي ممكن أصلًا. الاختبارات التي تحتاج "مستفيدًا
 * طازجًا بلا احتياجات مسبقة لاختبار الإنشاء نفسه" تستدعي saveBeneficiary
 * مباشرة بنفسها بدل استخدام هذا الملحق المشترك.
 */
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
    phone: '0500000021', familyCount: 3, socialStatus: 'أرملة',
    lat: '24.7', lng: '46.6', deviceTypes: ['ثلاجة']
  });
  return { S, admin, assoc, assocSession, beneficiaryId: beneficiary.id };
}

let phoneSeq = 40;
function freshPhone_() { phoneSeq++; return '05000000' + phoneSeq; }

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

  const acquireBefore = S.__lock.__state().acquireCount;
  const one = S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  assert('جمعية تضيف مستفيدًا باحتياج واحد', one.ok && one.needs.length === 1);
  assert('حالة الاحتياج الافتراضية "بانتظار المراجعة"', one.needs[0].decisionStatus === 'بانتظار المراجعة');
  assert('حالة مراجعة المستفيد أصبحت "تحت المراجعة"', String(beneficiaryRow(S, beneficiaryId)['حالة مراجعة المستفيد']) === 'تحت المراجعة');
  assert('توليد المعرّف الجديد (nextIdsLocked_) لم يُمسك القفل مرتين — استحواذ واحد فقط لكامل الاستدعاء (إصلاح القفل المتداخل)',
    S.__lock.__state().acquireCount === acquireBefore + 1);
  assert('القفل مُحرَّر تمامًا بعد انتهاء الاستدعاء', S.__lock.__state().locked === false);

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

  throws('لا يمكن اعتماد احتياج لمستفيد مرفوض بعد ذلك (منع تنفيذ القرار مرتين أيضًا)',
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

  // Phase 3.1 (القسم 0): سبب رفض الاحتياج الفردي أصبح اختياريًا — رفض
  // احتياج بلا سبب لا يُرفض لهذا السبب بذاته (يبقى الشرط الوحيد وجود
  // احتياج معتمد واحد على الأقل لقبول المستفيد نفسه).
  const beneficiaryTwoNeeds = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد سبب اختياري', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: freshPhone_(), familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  S.saveBeneficiaryWithNeeds(assocSession.token, { id: beneficiaryTwoNeeds.id, name: 'مستفيد سبب اختياري', region: 'الرياض', city: 'الرياض',
    address: 'حي', district: 'حي', phone: beneficiaryTwoNeeds.record.phone, familyCount: 1, socialStatus: 'أرملة', deviceTypes: ['ثلاجة', 'فرن'] });
  const twoNeeds = needRows(S, beneficiaryTwoNeeds.id);
  const fridgeNeedId = twoNeeds.find(n => n.deviceType === 'ثلاجة').id;
  const ovenNeedId = twoNeeds.find(n => n.deviceType === 'فرن').id;
  const optionalReasonResult = S.reviewBeneficiaryNeeds(admin.token, beneficiaryTwoNeeds.id, {
    beneficiaryDecision: 'معتمد',
    needDecisions: [{ needId: fridgeNeedId, decision: 'معتمد' }, { needId: ovenNeedId, decision: 'مرفوض' }]
  });
  assert('احتياج مرفوض بلا سبب: القرار ينجح دون أي خطأ (السبب اختياري)', optionalReasonResult.ok === true);
  assert('احتياج مرفوض بلا سبب: سبب الرفض المخزَّن فارغ كما أُرسل',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ovenNeedId)['سبب الرفض'] || '') === '');

  throws('احتياج غير موجود لهذا المستفيد يُرفض',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: 'NED-999999', decision: 'معتمد' }] }),
    'احتياج غير موجود');
}

/* ================================================================
   5) idempotency مقفلة (opId داخل نفس القفل)
   ================================================================ */
section('5) idempotency: opId داخل نفس القفل — لا تكرار كتابة ولا تعارض');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;
  const payload = { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }], opId: 'OP-FIXED-1' };

  const auditCountBefore = S.readTable_('سجل العمليات').rows.length;
  const first = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, payload);
  assert('أول تنفيذ ناجح', first.ok);
  const auditAfterFirst = S.readTable_('سجل العمليات').rows.length;
  const second = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, payload);
  assert('إعادة إرسال نفس opId تُعيد نفس النتيجة الأصلية دون خطأ "سبق اتخاذ قرار"', second.ok && second.approvedCount === first.approvedCount);
  const auditAfterSecond = S.readTable_('سجل العمليات').rows.length;
  assert('إعادة الإرسال لا تُنشئ سجل audit ثانيًا (fn() لم تُنفَّذ مرة ثانية أصلًا)', auditAfterSecond === auditAfterFirst && auditAfterFirst === auditCountBefore + 1);

  assert('القفل مُحرَّر تمامًا بعد كلا الاستدعاءين', S.__lock.__state().locked === false);
}

/* ================================================================
   6) مؤشرات الكميات — تعريف دقيق ولا احتساب مزدوج
   ================================================================ */
section('6) needsSummaryByDeviceType_ — مؤشرات دقيقة تعتمد ربط الجهاز الفعلي بالاحتياج، بلا احتساب مزدوج');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, assoc, beneficiaryId } = ctx;
  // beneficiaryId يحمل أصلًا احتياج "ثلاجة" (من seedScenario) — نضيف "فرن" فوقه.
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['فرن']);
  const needs = needRows(S, beneficiaryId);
  const byType = {}; needs.forEach(n => { byType[n.deviceType] = n; });
  S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, {
    beneficiaryDecision: 'معتمد',
    needDecisions: [
      { needId: byType['ثلاجة'].id, decision: 'معتمد' },
      { needId: byType['فرن'].id, decision: 'مرفوض', rejectReason: 'غير متاح' }
    ]
  });
  const fridgeNeedId = byType['ثلاجة'].id;

  // مستفيد ثانٍ بنفس الجمعية باحتياج ثلاجة معتمد أيضًا — لاختبار readyOrAllocated=2 (جهازان مرتبطان صحيحًا).
  const beneficiary2 = S.saveBeneficiary(assocSession.token, {
    name: 'مستفيد ثانٍ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: '0500000029', familyCount: 2, socialStatus: 'أرملة', lat: '24.7', lng: '46.6', deviceTypes: ['ثلاجة']
  });
  const need2Id = needRows(S, beneficiary2.id)[0].id;
  S.reviewBeneficiaryNeeds(admin.token, beneficiary2.id, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: need2Id, decision: 'معتمد' }] });

  // خمسة أجهزة ثلاجة بحالات/روابط مختلفة لاختبار كل فرع من فروع الحساب معًا.
  const warehouse = S.saveDevice(admin.token, { name: 'ثلاجة مستودع', type: 'ثلاجة', associationId: assoc.id });
  const allocated = S.saveDevice(admin.token, { name: 'ثلاجة مخصصة', type: 'ثلاجة', associationId: assoc.id });
  S.linkDeviceToNeed(admin.token, allocated.id, fridgeNeedId); // بالمستودع → مخصص + ربط صحيح
  const withDelegate = S.saveDevice(admin.token, { name: 'ثلاجة مع مندوب', type: 'ثلاجة', associationId: assoc.id });
  S.linkDeviceToNeed(admin.token, withDelegate.id, need2Id);
  S.updateById_('الأجهزة', 'رقم الجهاز', withDelegate.id, { 'حالة الجهاز': 'مع المندوب' });
  // Phase 2.3: saveDevice لم يعد يقبل ربط جهاز بمستفيد دون احتياج معتمد
  // متاح فعليًا — فلا يمكن بعد الآن محاكاة "مسار قديم بلا رقم احتياج"
  // عبر الواجهة العامة نفسها؛ يُكتب الصفّان مباشرة في الجدول (كما يمثّل
  // فعليًا سجلات موجودة سلفًا في الشيت الحي قبل تطبيق هذا المخطط).
  const deliveredId = S.nextId_('DEV');
  S.appendObject_('الأجهزة', {
    'رقم الجهاز': deliveredId, 'اسم الجهاز': 'ثلاجة مسلَّمة', 'النوع': 'ثلاجة', 'رقم الجمعية': assoc.id,
    'رقم المستفيد': beneficiaryId, 'رقم الاحتياج': '', 'حالة الجهاز': 'تم التسليم',
    'تاريخ الإضافة': S.now_(), 'تاريخ التسليم': '', 'ملاحظات': ''
  });
  const delivered = {id: deliveredId};
  const broken = S.saveDevice(admin.token, { name: 'ثلاجة تالفة', type: 'ثلاجة', associationId: assoc.id });
  S.updateById_('الأجهزة', 'رقم الجهاز', broken.id, { 'حالة الجهاز': 'تالف' });
  // جهاز مخصص بمستفيد لكن **بلا ربط رقم احتياج** (محاكاة مسار قديم) — يجب ألا يُحسب في readyOrAllocated.
  const legacyAllocatedId = S.nextId_('DEV');
  S.appendObject_('الأجهزة', {
    'رقم الجهاز': legacyAllocatedId, 'اسم الجهاز': 'ثلاجة مسار قديم', 'النوع': 'ثلاجة', 'رقم الجمعية': assoc.id,
    'رقم المستفيد': beneficiaryId, 'رقم الاحتياج': '', 'حالة الجهاز': 'مخصص',
    'تاريخ الإضافة': S.now_(), 'تاريخ التسليم': '', 'ملاحظات': ''
  });
  const legacyAllocated = {id: legacyAllocatedId};

  const summary = S.needsSummaryByDeviceType_(assoc.id);
  assert('requestedTotal للثلاجة = 2 (مستفيدان)', summary['ثلاجة'].requestedTotal === 2);
  assert('approvedTotal للثلاجة = 2', summary['ثلاجة'].approvedTotal === 2);
  assert('rejectedTotal للفرن = 1', summary['فرن'].rejectedTotal === 1);
  assert('deliveredTotal للثلاجة = 0 (الجهاز المسلَّم غير مرتبط باستحقاق في هذا الاختبار)', summary['ثلاجة'].deliveredTotal === 0);
  assert('outstandingApproved للثلاجة = 2 (معتمد - مسلَّم = 2 - 0)', summary['ثلاجة'].outstandingApproved === 2);
  assert('physicalAvailable = 1 فقط (المستودع غير المرتبط)', summary['ثلاجة'].physicalAvailable === 1);
  assert('readyOrAllocated = 2 (جهازان مرتبطان فعليًا برقم احتياج معتمد صحيح، لا الجهاز غير المرتبط رغم كونه "مخصص")',
    summary['ثلاجة'].readyOrAllocated === 2);
  assert('shortage للثلاجة = 0 (معتمد معلَّق 2 ≤ متاح+جاهز 3)', summary['ثلاجة'].shortage === 0);
  assert('shortage للفرن = 0 (لا احتياج معتمد أصلًا)', summary['فرن'].shortage === 0);
  assert('historicalUnlinkedCount للثلاجة = 1 (الجهاز المسار القديم المخصَّص بلا رقم احتياج فقط، لا المسلَّم ولا التالف)',
    summary['ثلاجة'].historicalUnlinkedCount === 1);

  throws('ربط جهاز ثانٍ بنفس الاحتياج مرفوض (لا يجوز أكثر من جهاز واحد لكل استحقاق)',
    () => S.linkDeviceToNeed(admin.token, warehouse.id, fridgeNeedId), 'مرتبط بالفعل بجهاز آخر');
  throws('ربط جهاز باحتياج غير معتمد (بانتظار المراجعة) مرفوض', () => {
    const pendingBeneficiary = S.saveBeneficiary(assocSession.token, {
      name: 'مستفيد بانتظار المراجعة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: '0500000028', familyCount: 1, socialStatus: 'أرملة', lat: '24.7', lng: '46.6', deviceTypes: ['غسالة']
    });
    const pendingNeed = needRows(S, pendingBeneficiary.id)[0];
    const washer = S.saveDevice(admin.token, { name: 'غسالة', type: 'غسالة', associationId: assoc.id });
    S.linkDeviceToNeed(admin.token, washer.id, pendingNeed.id);
  }, 'لم يُبتّ فيه بعد');
  throws('ربط جهاز بنوع مختلف عن نوع الاحتياج مرفوض', () => {
    const oven = S.saveDevice(admin.token, { name: 'فرن', type: 'فرن', associationId: assoc.id });
    S.linkDeviceToNeed(admin.token, oven.id, need2Id);
  }, 'لا يطابق نوع الاحتياج');

  const ctx2 = seedScenario(buildSandbox());
  const otherSummary = ctx2.S.needsSummaryByDeviceType_(ctx2.assoc.id);
  assert('عزل الجمعيات: تجميع جمعية أخرى يرى احتياجاتها هي فقط (احتياج "ثلاجة" الأساسي من seedScenario الخاص بها وحدها)',
    otherSummary['ثلاجة'].requestedTotal === 1 && otherSummary['ثلاجة'].requestedTotal !== summary['ثلاجة'].requestedTotal);

  const projectWide = S.needsSummaryByDeviceType_(); // بلا associationId — تجميع كامل المشروع لـADMIN
  assert('تجميع كامل المشروع (بلا associationId) يشمل نفس الأرقام على الأقل', projectWide['ثلاجة'].requestedTotal >= summary['ثلاجة'].requestedTotal);
}

/* ================================================================
   7) previewNeedsMigration_ — قراءة فقط
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
  const assocUser = { id: 'USR-ASSOC-MIG', name: 'جمعية الترحيل', role: 'ASSOCIATION', associationId: assoc.id };
  const assocSession = S.createSession_(assocUser);
  // بيانات تاريخية محاكاة: تُنشأ عبر saveBeneficiary_ الداخلية مباشرة
  // (لا saveBeneficiary العامة المُقفَلة الآن) — تحاكي سجلات موجودة فعلًا
  // على الشيت الحي من *قبل* إغلاق الممر القديم في Phase 2.2، وهذا بالضبط
  // ما previewNeedsMigration_ مصمَّمة لمسحه ومعاينته.
  const legacyConvertible = S.saveBeneficiary_(assocUser, {
    name: 'مستفيد قديم قابل للتحويل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: '0500000031', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة', 'فرن'], lat: '24.7', lng: '46.6'
  });
  const legacyManual = S.saveBeneficiary_(assocUser, {
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

/* ================================================================
   8) سباق حقيقي: اعتماد الإدارة أثناء انتظار طلب الجمعية للقفل
   ================================================================ */
section('8) سباق: الإدارة تعتمد المستفيد بينما طلب الجمعية بانتظار القفل — يجب رفض الطلب المتأخر ولا صف يُضاف');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;

  const originalGetLock = S.LockService.getScriptLock;
  let injected = false;
  S.LockService.getScriptLock = function () {
    const lock = originalGetLock();
    const originalWait = lock.waitLock;
    lock.waitLock = function () {
      if (!injected) {
        injected = true;
        // يُحاكي: بينما طلب الجمعية "بالطريق" لهذا القفل، اكتمل قرار
        // الإدارة بالكامل (قفله الخاص + تحريره) قبل أن يصل طلب الجمعية فعليًا.
        S.LockService.getScriptLock = originalGetLock;
        S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }] });
      }
      originalWait.call(lock);
    };
    return lock;
  };

  throws('طلب الجمعية لإضافة احتياج آخر يُرفض لأن الإدارة اعتمدت المستفيد أثناء الانتظار (إعادة القراءة داخل القفل تكتشف ذلك)',
    () => S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['فرن']), 'تم اتخاذ قرار مراجعة نهائي');
  S.LockService.getScriptLock = originalGetLock;
  assert('لم يُضَف أي صف احتياج جديد (فرن) نتيجة الطلب المرفوض', needRows(S, beneficiaryId).filter(n => n.deviceType === 'فرن').length === 0);
}

/* ================================================================
   9) failure-injection + rollback في reviewBeneficiaryNeeds_
   ================================================================ */
section('9) فشل كتابة وسطية → تراجع تعويضي كامل');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة', 'فرن']);
  const needs = needRows(S, beneficiaryId);
  const need1 = needs[0].id, need2 = needs[1].id;

  // Phase 2.3.2 (القسم 1): يفشل الاستدعاء **الأول فقط** لهذا الصف (الكتابة
  // الأصلية) ثم ينجح ما بعده (محاولة التراجع) — هذا بالضبط ما يثبت
  // الإصلاح: "written" الآن يُسجَّل قبل الاستدعاء، فتُحاوَل استعادة
  // need2 فعليًا رغم أن كتابته الأصلية هي التي فشلت (لا يُتجاهَل بصمت
  // كما كان يحدث سابقًا حين كان التسجيل يتم بعد نجاح الاستدعاء فقط).
  const original = S.updateById_;
  let need2Calls = 0;
  S.updateById_ = function (sheetName, idHeader, id, changes) {
    if (sheetName === 'احتياجات المستفيدين' && id === need2) {
      need2Calls++;
      if (need2Calls === 1) throw new Error('فشل كتابة الاحتياج الثاني محاكى');
    }
    return original(sheetName, idHeader, id, changes);
  };
  throws('فشل كتابة الاحتياج الثاني بعد نجاح المستفيد والاحتياج الأول يُعيد الكل لحالته السابقة',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: need1, decision: 'معتمد' }, { needId: need2, decision: 'معتمد' }] }),
    'أُعيدت كل السجلات المتأثرة لحالتها السابقة');
  S.updateById_ = original;
  assert('(القسم 1) الاحتياج الثاني (الذي فشلت كتابته الأصلية) استُعيد فعليًا أيضًا — لم يُتجاهَل رغم فشل استدعائه هو نفسه',
    need2Calls === 2 && needRows(S, beneficiaryId).find(n => n.id === need2).decisionStatus === 'بانتظار المراجعة');

  assert('المستفيد عاد لحالة "تحت المراجعة" بعد التراجع (لا "معتمد" جزئي)', String(beneficiaryRow(S, beneficiaryId)['حالة مراجعة المستفيد']) === 'تحت المراجعة');
  const after = needRows(S, beneficiaryId);
  assert('الاحتياج الأول عاد "بانتظار المراجعة" (لا اعتماد جزئي متروك)', after.find(n => n.id === need1).decisionStatus === 'بانتظار المراجعة');
  assert('لا حالة تنفيذ متروكة على الاحتياج الأول بعد التراجع', after.find(n => n.id === need1).fulfillmentStatus === '');
  assert('القفل مُحرَّر رغم الفشل والتراجع (finally نُفِّذت)', S.__lock.__state().locked === false);
}

section('10) فشل الكتابة الأولى (المستفيد نفسه) — لا شيء كُتب أصلًا فلا حاجة لتراجع');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;

  const original = S.updateById_;
  S.updateById_ = function (sheetName, idHeader, id, changes) {
    if (sheetName === 'المستفيدون' && id === beneficiaryId) throw new Error('فشل كتابة المستفيد محاكى');
    return original(sheetName, idHeader, id, changes);
  };
  throws('فشل تحديث المستفيد نفسه يُرفض بوضوح', () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }] }));
  S.updateById_ = original;
  assert('حالة الاحتياج بقيت "بانتظار المراجعة" (لم تُكتب أصلًا)', needRows(S, beneficiaryId)[0].decisionStatus === 'بانتظار المراجعة');
}

section('11) فشل الكتابة الأخيرة يُتراجَع عنه أيضًا');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة', 'فرن', 'غسالة']);
  const needs = needRows(S, beneficiaryId);
  const [n1, n2, n3] = needs.map(n => n.id);

  const original = S.updateById_;
  let n3Calls = 0;
  S.updateById_ = function (sheetName, idHeader, id, changes) {
    if (sheetName === 'احتياجات المستفيدين' && id === n3) {
      n3Calls++;
      if (n3Calls === 1) throw new Error('فشل كتابة الاحتياج الثالث محاكى');
    }
    return original(sheetName, idHeader, id, changes);
  };
  throws('فشل الاحتياج الثالث (الأخير) يُعيد المستفيد والاحتياجين الأولين لحالتهما السابقة',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: n1, decision: 'معتمد' }, { needId: n2, decision: 'معتمد' }, { needId: n3, decision: 'معتمد' }] }),
    'أُعيدت كل السجلات المتأثرة');
  S.updateById_ = original;
  const after = needRows(S, beneficiaryId);
  assert('الاحتياج الأول والثاني عادا "بانتظار المراجعة"', after.find(n => n.id === n1).decisionStatus === 'بانتظار المراجعة' && after.find(n => n.id === n2).decisionStatus === 'بانتظار المراجعة');
  assert('المستفيد عاد "تحت المراجعة"', String(beneficiaryRow(S, beneficiaryId)['حالة مراجعة المستفيد']) === 'تحت المراجعة');
  assert('(القسم 1) الاحتياج الثالث (فشلت كتابته الأصلية) استُعيد فعليًا أيضًا رغم أنه نفسه من فشل',
    n3Calls === 2 && after.find(n => n.id === n3).decisionStatus === 'بانتظار المراجعة');
}

section('12) فشل التراجع نفسه يُبلَّغ كحالة حرجة صريحة');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;

  let beneficiaryUpdateCount = 0;
  const original = S.updateById_;
  S.updateById_ = function (sheetName, idHeader, id, changes) {
    if (sheetName === 'المستفيدون' && id === beneficiaryId) {
      beneficiaryUpdateCount++;
      if (beneficiaryUpdateCount === 2) throw new Error('فشل رولباك محاكى');
    }
    if (sheetName === 'احتياجات المستفيدين' && id === needId) throw new Error('فشل كتابة الاحتياج محاكى');
    return original(sheetName, idHeader, id, changes);
  };
  S.__logs.length = 0;
  throws('فشل الكتابة الوسطية مع فشل التراجع معًا يُبلَّغ بوضوح دون بيانات حساسة (معرّفات فقط)',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }] }),
    'تعذّر التراجع الكامل، يتطلب مراجعة يدوية فورية للسجلات');
  S.updateById_ = original;
  assert('سجل الأخطاء يحتوي إشارة "حرج جدًا" للمراجعة اليدوية', S.__logs.some(l => l.indexOf('حرج جدًا') !== -1));
  assert('القفل مُحرَّر رغم الفشل المزدوج', S.__lock.__state().locked === false);
}

section('13) فشل audit بعد نجاح القرار فعليًا لا يُفشل القرار نفسه');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;
  const originalAudit = S.audit_;
  S.audit_ = () => { throw new Error('فشل تسجيل العملية محاكى'); };
  S.__logs.length = 0;
  const result = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }] });
  S.audit_ = originalAudit;
  assert('فشل audit لا يفشل القرار نفسه (ok: true رغم تعذّر السجل)', result.ok === true);
  assert('حالة مراجعة المستفيد اعتُمدت فعليًا رغم فشل audit', String(beneficiaryRow(S, beneficiaryId)['حالة مراجعة المستفيد']) === 'معتمد');
  assert('سجل الأخطاء يحتوي تحذيرًا بفشل تسجيل العملية (لا خطأ حرج)', S.__logs.some(l => l.indexOf('تحذير') !== -1 && l.indexOf('سجل العمليات') !== -1));
}

/* ================================================================
   14) توحيد مسار saveBeneficiaryWithNeeds
   ================================================================ */
section('14) saveBeneficiaryWithNeeds — مصدر حقيقة واحد، بلا كتابة موازية للحقل القديم');
{
  const ctx = seedScenario(buildSandbox());
  const { S, assocSession, assoc, beneficiaryId } = ctx;
  const result = S.saveBeneficiaryWithNeeds(assocSession.token, {
    name: 'مستفيد موحّد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: '0500000099', familyCount: 2, socialStatus: 'أرملة', lat: '24.7', lng: '46.6',
    deviceTypes: ['ثلاجة', 'فرن']
  });
  assert('إنشاء مستفيد + احتياجاته في عملية واحدة ناجحة', result.ok && result.needs.length === 2);
  const row = beneficiaryRow(S, result.id);
  assert('الحقل النصي القديم "الاحتياج" يبقى فارغًا لسجل أُنشئ عبر المسار الموحَّد', String(row['الاحتياج'] || '') === '');
  assert('حالة مراجعة المستفيد "تحت المراجعة" فورًا', String(row['حالة مراجعة المستفيد']) === 'تحت المراجعة');

  throws('نوع احتياج غير مسموح به يُرفض قبل إنشاء أي سجل مستفيد إطلاقًا (لا حذف فعلي لأي سجل مستفيد في هذا النظام)',
    () => S.saveBeneficiaryWithNeeds(assocSession.token, {
      name: 'مستفيد فاشل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: '0500000098', familyCount: 1, socialStatus: 'أرملة', lat: '24.7', lng: '46.6',
      deviceTypes: ['مكيف']
    }), 'غير مسموح به');
  assert('لم يُنشأ أي سجل مستفيد أصلًا لهذا الجوال (فُحص الصيغة قبل أي كتابة)', !S.findConfirmedDuplicateBeneficiary_(assoc.id, '0500000098', null));

  // Phase 2.2 (القسم 2): الآن ذرّي بالكامل — فشل كتابة الاحتياجات (لا
  // خطأ صيغة) يعني عدم كتابة صف المستفيد إطلاقًا (الاحتياجات تُكتب أولًا
  // في الترتيب الجديد)، لا "مستفيد ناجٍ بلا احتياجات" كما كان في Phase 2.1.
  const originalAppendObjects = S.appendObjects_;
  S.appendObjects_ = function (sheetName, objects) {
    if (sheetName === 'احتياجات المستفيدين') throw new Error('فشل كتابة احتياجات محاكى');
    return originalAppendObjects(sheetName, objects);
  };
  throws('فشل كتابة الاحتياجات (أول كتابة في الترتيب الجديد) يمنع إنشاء المستفيد بالكامل', () => {
    S.saveBeneficiaryWithNeeds(assocSession.token, {
      name: 'مستفيد يفشل عند الاحتياج', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: '0500000096', familyCount: 1, socialStatus: 'أرملة', lat: '24.7', lng: '46.6',
      deviceTypes: ['ثلاجة']
    });
  }, 'تعذّر إنشاء المستفيد');
  S.appendObjects_ = originalAppendObjects;
  assert('لا يوجد أي مستفيد بهذا الجوال بعد فشل كتابة الاحتياجات (لم يُكتب المستفيد أصلًا)',
    !S.findConfirmedDuplicateBeneficiary_(assoc.id, '0500000096', null));

  // فشل كتابة المستفيد نفسه (بعد نجاح كتابة الاحتياجات) → الاحتياجات
  // المعلَّقة الجديدة تُزال تلقائيًا (تنظيف تعويضي، لا يتيم يبقى).
  const originalAppendObject = S.appendObject_;
  S.appendObject_ = function (sheetName, object) {
    if (sheetName === 'المستفيدون') throw new Error('فشل كتابة المستفيد محاكى');
    return originalAppendObject(sheetName, object);
  };
  throws('فشل كتابة المستفيد بعد نجاح الاحتياجات يُزيل الاحتياجات المعلَّقة الجديدة تلقائيًا',
    () => S.saveBeneficiaryWithNeeds(assocSession.token, {
      name: 'مستفيد يفشل بعد الاحتياج', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: '0500000095', familyCount: 1, socialStatus: 'أرملة', lat: '24.7', lng: '46.6',
      deviceTypes: ['ثلاجة', 'فرن']
    }), 'تعذّر إنشاء المستفيد');
  S.appendObject_ = originalAppendObject;
  const needsSheetRows = S.readTable_('احتياجات المستفيدين').rows;
  assert('لا صفوف احتياج يتيمة متبقية لمستفيد "يفشل بعد الاحتياج" (لا رقم مستفيد له أصلًا)',
    !needsSheetRows.some(r => String(r['رقم الجمعية']) === assoc.id && !S.findById_('المستفيدون', 'رقم المستفيد', String(r['رقم المستفيد']))));

  // نجاح فعلي كامل بعد ذلك يثبت أن الأدوات لم تُترك في حالة معطوبة.
  const succeeded = S.saveBeneficiaryWithNeeds(assocSession.token, {
    name: 'مستفيد ناجح بعد الفشل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: '0500000094', familyCount: 1, socialStatus: 'أرملة', lat: '24.7', lng: '46.6',
    deviceTypes: ['ثلاجة']
  });
  assert('إنشاء ناجح لاحق يعمل بلا مشاكل بعد اختبارات الفشل أعلاه', succeeded.ok && succeeded.needs.length === 1);

  // Phase 2.3.4 (القسم 1): saveBeneficiary العامة لتعديل سجل قائم لم تعد
  // تكتب الحقل النصي القديم "الاحتياج" ولا تتأثر بـpayload.needs إطلاقًا —
  // تمر الآن عبر updateBeneficiaryWithNeeds_ حصرًا (نفس معاملة saveBeneficiaryWithNeeds).
  const beforeLegacyField = String(beneficiaryRow(S, beneficiaryId)['الاحتياج'] || '');
  const beforeNeedsCount = needRows(S, beneficiaryId).length;
  const editedLegacy = S.saveBeneficiary(assocSession.token, {
    id: beneficiaryId, name: 'مستفيد الاحتياجات (مُعدَّل)', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0500000021', familyCount: 3, socialStatus: 'أرملة', needs: ['ثلاجة', 'فرن'], lat: '24.7', lng: '46.6'
  });
  assert('تعديل سجل قائم عبر saveBeneficiary العام ينجح عبر updateBeneficiaryWithNeeds_ (الاسم يُحدَّث فعليًا)',
    editedLegacy.ok === true && String(beneficiaryRow(S, editedLegacy.id)['الاسم']) === 'مستفيد الاحتياجات (مُعدَّل)');
  assert('الحقل النصي القديم "الاحتياج" لم يتغيّر رغم payload.needs المُرسَل (يبقى كما كان حرفيًا)',
    String(beneficiaryRow(S, editedLegacy.id)['الاحتياج'] || '') === beforeLegacyField);
  assert('payload.needs عند التعديل لا يضيف أو يحذف أي صف احتياج (لا deviceTypes صريحة أُرسلت)',
    needRows(S, beneficiaryId).length === beforeNeedsCount);
}

/* ================================================================
   15) إزالة احتياج معلَّق قبل المراجعة
   ================================================================ */
section('15) removePendingBeneficiaryNeed — إزالة قبل المراجعة فقط');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة', 'فرن']);
  const needs = needRows(S, beneficiaryId);
  const oven = needs.find(n => n.deviceType === 'فرن');

  const removed = S.removePendingBeneficiaryNeed(assocSession.token, oven.id);
  assert('إزالة احتياج معلَّق تنجح وتترك احتياجًا واحدًا فقط', removed.ok && removed.needs.length === 1 && removed.needs[0].deviceType === 'ثلاجة');

  const lastOne = removed.needs[0];
  throws('لا يمكن ترك المستفيد بلا أي احتياج', () => S.removePendingBeneficiaryNeed(assocSession.token, lastOne.id), 'لا يمكن ترك المستفيد بلا أي احتياج');

  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['غسالة']);
  const withWasher = needRows(S, beneficiaryId);
  const fridgeNeed = withWasher.find(n => n.deviceType === 'ثلاجة');
  const washerNeed = withWasher.find(n => n.deviceType === 'غسالة');
  S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, {
    beneficiaryDecision: 'معتمد',
    needDecisions: [{ needId: fridgeNeed.id, decision: 'معتمد' }, { needId: washerNeed.id, decision: 'مرفوض', rejectReason: 'سبب' }]
  });
  throws('لا يمكن إزالة احتياج بعد اعتماد المستفيد نهائيًا (لم يعد "تحت المراجعة")', () => S.removePendingBeneficiaryNeed(admin.token, fridgeNeed.id), 'ليس تحت المراجعة حاليًا');

  const ctx2 = seedScenario(buildSandbox());
  ctx2.S.setBeneficiaryNeeds(ctx2.assocSession.token, ctx2.beneficiaryId, ['ثلاجة', 'فرن']);
  const otherNeeds = needRows(ctx2.S, ctx2.beneficiaryId);
  const otherSession = ctx2.S.createSession_({ id: 'USR-OTHER-REM', name: 'جمعية أخرى', role: 'ASSOCIATION', associationId: 'ASC-999999' });
  throws('جمعية أخرى لا يمكنها إزالة احتياج ليس لها', () => ctx2.S.removePendingBeneficiaryNeed(otherSession.token, otherNeeds[0].id), 'ليس لديك صلاحية');
}

/* ================================================================
   16) بادئة معرّف الاحتياج NED تمر عبر cleanId_
   ================================================================ */
section('16) بادئة معرّف الاحتياج NED صحيحة (ثلاثة أحرف، تمر عبر cleanId_)');
{
  const ctx = seedScenario(buildSandbox());
  const { S, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;
  assert('رقم الاحتياج يطابق الصيغة NED-000000', /^NED-\d{6}$/.test(needId));
  assert('رقم الاحتياج يمر عبر cleanId_ بنجاح (لا يُرفض كفارغ)', S.cleanId_(needId) === needId);
}

/* ================================================================
   17) diagnoseNeedsIntegrity_
   ================================================================ */
section('17) diagnoseNeedsIntegrity_ — قراءة فقط، تكتشف الأعطال دون إصلاح تلقائي');
{
  const S = buildSandbox();
  seedSheets(S);
  const token = grantToken_(S);
  const emptyReport = S.diagnoseNeedsIntegrity_(token);
  assert('لا مشاكل على ورقة فارغة نظيفة', emptyReport.ok && emptyReport.issueCount === 0);

  const scenario = seedScenario(S);
  S.setBeneficiaryNeeds(scenario.assocSession.token, scenario.beneficiaryId, ['ثلاجة']);
  const needId = S.beneficiaryNeeds_(scenario.beneficiaryId)[0].id;
  // إفساد مباشر يحاكي تعديلًا يدويًا خارج مسار BeneficiaryNeeds.gs.
  S.updateById_('احتياجات المستفيدين', 'رقم الاحتياج', needId, {'نوع الجهاز': 'مكيف صحراوي', 'حالة القرار': 'قيد كذا'});
  const report = S.diagnoseNeedsIntegrity_(token);
  assert('يكتشف نوع جهاز غير معروف', report.issues.some(i => i.type === 'UNKNOWN_DEVICE_TYPE'));
  assert('يكتشف حالة قرار غير معروفة', report.issues.some(i => i.type === 'UNKNOWN_DECISION_STATUS'));
  assert('لا يُصلح أي شيء تلقائيًا (القيم الفاسدة ما زالت كما هي)', S.beneficiaryNeeds_(scenario.beneficiaryId)[0].deviceType === 'مكيف صحراوي');
}

/* ================================================================
   18) Phase 3.2A — bulkReviewBeneficiaries (wrapper الاعتماد بالجملة)
   ================================================================ */
section('18) bulkReviewBeneficiaries: يعيد success/failed/skipped بدقة، ADMIN فقط، بلا تكرار قواعد المراجعة');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assoc, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId1 = needRows(S, beneficiaryId)[0].id;

  const beneficiary2 = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['فرن'], name: 'مستفيد دفعة 2', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: freshPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  const needId2 = needRows(S, beneficiary2.id)[0].id;

  // مستفيد ثالث: كل احتياجاته سترفض (يفشل شرط "احتياج معتمد واحد على الأقل" عمدًا لاختبار فشل عنصر واحد بلا إفساد البقية).
  const beneficiary3 = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['غسالة'], name: 'مستفيد دفعة 3 فاشل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: freshPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  const needId3 = needRows(S, beneficiary3.id)[0].id;

  const otherAssocSession = S.createSession_({ id: 'USR-OTHER-BULK', name: 'جمعية أخرى', role: 'ASSOCIATION', associationId: 'ASC-999999' });
  throws('ASSOCIATION لا يستطيع استدعاء bulkReviewBeneficiaries إطلاقًا',
    () => S.bulkReviewBeneficiaries(otherAssocSession.token, { items: [{ beneficiaryId: beneficiaryId, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId1, decision: 'معتمد' }] }] }),
    'صلاحية');

  const result = S.bulkReviewBeneficiaries(admin.token, {
    items: [
      { beneficiaryId: beneficiaryId, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId1, decision: 'معتمد' }] },
      { beneficiaryId: beneficiary2.id, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId2, decision: 'معتمد' }] },
      { beneficiaryId: beneficiary3.id, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId3, decision: 'مرفوض', rejectReason: 'غير مؤهل' }] },
      { beneficiaryId: '', beneficiaryDecision: 'معتمد', needDecisions: [] }
    ]
  });
  assert('success يحمل بالضبط العنصرين الناجحين', result.success.length === 2
    && result.success.some(s => s.beneficiaryId === beneficiaryId) && result.success.some(s => s.beneficiaryId === beneficiary2.id));
  assert('failed يحمل العنصر الثالث (لا احتياج معتمد متبقٍّ) برسالة الخطأ', result.failed.length === 1
    && result.failed[0].beneficiaryId === beneficiary3.id && /دون اعتماد احتياج واحد/.test(result.failed[0].error));
  assert('skipped يحمل العنصر الرابع (رقم مستفيد فارغ)', result.skipped.length === 1);

  assert('المستفيد الأول اعتُمد فعليًا', String(beneficiaryRow(S, beneficiaryId)['حالة مراجعة المستفيد']) === 'معتمد');
  assert('المستفيد الثاني اعتُمد فعليًا', String(beneficiaryRow(S, beneficiary2.id)['حالة مراجعة المستفيد']) === 'معتمد');
  assert('فشل المستفيد الثالث لم يُنتج أي اعتماد خاطئ له — حالته لا تزال تحت المراجعة كما كانت',
    String(beneficiaryRow(S, beneficiary3.id)['حالة مراجعة المستفيد']) === 'تحت المراجعة');
  assert('احتياج المستفيد الثالث لم يُمَسّ (لا يزال بانتظار المراجعة)',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needId3)['حالة القرار']) === 'بانتظار المراجعة');
}

/* ================================================================
   19) Phase 3.2A — فتح شاشة المراجعة لا يكتب شيئًا (Default checked واجهة فقط)
   ================================================================ */
section('19) استدعاء listBeneficiaries لا يكتب أي شيء — التحديد الافتراضي في الواجهة فقط، لا أثر خادمي');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const beforeNeed = Object.assign({}, S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needRows(S, beneficiaryId)[0].id));
  const beforeBeneficiary = Object.assign({}, beneficiaryRow(S, beneficiaryId));
  const auditCountBefore = S.readTable_('سجل العمليات').rows.length;

  const list = S.listBeneficiaries(admin.token, { page: 1, pageSize: 25 });
  assert('listBeneficiaries تنجح وتعيد المستفيد مع احتياجه بانتظار المراجعة (proposed-accepted لاحقًا في الواجهة فقط)',
    list.ok && list.items.some(i => i.id === beneficiaryId && (i.pendingNeeds || []).length === 1));

  const afterNeed = S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needRows(S, beneficiaryId)[0].id);
  const afterBeneficiary = beneficiaryRow(S, beneficiaryId);
  assert('صف الاحتياج لم يتغيّر إطلاقًا بمجرد القراءة/العرض', JSON.stringify(beforeNeed) === JSON.stringify(afterNeed));
  assert('صف المستفيد لم يتغيّر إطلاقًا بمجرد القراءة/العرض', JSON.stringify(beforeBeneficiary) === JSON.stringify(afterBeneficiary));
  assert('لا سجل عمليات جديد نتيجة القراءة وحدها', S.readTable_('سجل العمليات').rows.length === auditCountBefore);
}

/** Patch 3.2A.1: يراقب استدعاءات runAutoAllocation_ (associationId فقط) دون تعديل AutoAllocation.gs نفسها — استبدال الدالة في الـsandbox مؤقتًا مع الحفاظ على سلوكها الحقيقي (call-through). */
function trackAllocationCalls_(S) {
  const calls = [];
  const original = S.runAutoAllocation_;
  S.runAutoAllocation_ = function (associationId) {
    calls.push(String(associationId));
    return original.apply(this, arguments);
  };
  return { calls: calls, restore: function () { S.runAutoAllocation_ = original; } };
}

/* ================================================================
   20) Patch 3.2A.1 — المراجعة الفردية: لا تغيير — التخصيص يُشغَّل مرة واحدة كما هو
   ================================================================ */
section('20) Patch 3.2A.1 — reviewBeneficiaryNeeds (فردي) ما زال يشغّل AutoAllocation مرة واحدة فور الاعتماد');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;
  const tracker = trackAllocationCalls_(S);
  try {
    const result = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, {
      beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }]
    });
    assert('قرار المراجعة الفردي نجح', result.ok && result.beneficiaryDecision === 'معتمد');
    assert('AutoAllocation شُغِّل مرة واحدة بالضبط لهذه الجمعية', tracker.calls.length === 1 && tracker.calls[0] === ctx.assoc.id);
  } finally { tracker.restore(); }
}

/* ================================================================
   21) Patch 3.2A.1 — Bulk، جمعية واحدة: تشغيل واحد فقط لعدة مستفيدين
   ================================================================ */
section('21) Patch 3.2A.1 — bulkReviewBeneficiaries: 5 مستفيدين من نفس الجمعية → AutoAllocation مرة واحدة فقط');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية دفعة واحدة', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000030', email: 'bulk-one-assoc@example.org', password: 'BulkPass123'
  });
  const assocSession = S.createSession_({ id: 'USR-ASSOC-BULK1', name: 'جمعية دفعة واحدة', role: 'ASSOCIATION', associationId: assoc.id });

  const items = [];
  for (let i = 0; i < 5; i++) {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد جمعية واحدة ' + i, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: freshPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    const needId = needRows(S, beneficiary.id)[0].id;
    items.push({ beneficiaryId: beneficiary.id, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }] });
  }

  const tracker = trackAllocationCalls_(S);
  try {
    const result = S.bulkReviewBeneficiaries(admin.token, { items: items });
    assert('كل الخمسة نجحوا', result.success.length === 5 && result.failed.length === 0);
    assert('AutoAllocation شُغِّل مرة واحدة بالضبط (لا 5 مرات) لجمعية واحدة تأثرت',
      tracker.calls.length === 1 && tracker.calls[0] === assoc.id);
  } finally { tracker.restore(); }
}

/* ================================================================
   22) Patch 3.2A.1 — Bulk، جمعيتان: تشغيل مرتين فقط، مرة لكل جمعية
   ================================================================ */
section('22) Patch 3.2A.1 — bulkReviewBeneficiaries: مستفيدون من جمعيتين → AutoAllocation مرتين فقط (مرة لكل جمعية)');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const assocA = S.saveAssociation(admin.token, {
    name: 'جمعية أ للدفعة', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000031', email: 'bulk-assoc-a@example.org', password: 'BulkPassA123'
  });
  const assocB = S.saveAssociation(admin.token, {
    name: 'جمعية ب للدفعة', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000032', email: 'bulk-assoc-b@example.org', password: 'BulkPassB123'
  });
  const sessionA = S.createSession_({ id: 'USR-ASSOC-BULK-A', name: 'جمعية أ للدفعة', role: 'ASSOCIATION', associationId: assocA.id });
  const sessionB = S.createSession_({ id: 'USR-ASSOC-BULK-B', name: 'جمعية ب للدفعة', role: 'ASSOCIATION', associationId: assocB.id });

  const items = [];
  for (let i = 0; i < 3; i++) {
    const beneficiary = S.saveBeneficiary(sessionA.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد أ ' + i, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: freshPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    const needId = needRows(S, beneficiary.id)[0].id;
    items.push({ beneficiaryId: beneficiary.id, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }] });
  }
  for (let i = 0; i < 2; i++) {
    const beneficiary = S.saveBeneficiary(sessionB.token, {
      deviceTypes: ['فرن'], name: 'مستفيد ب ' + i, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: freshPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    const needId = needRows(S, beneficiary.id)[0].id;
    items.push({ beneficiaryId: beneficiary.id, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }] });
  }

  const tracker = trackAllocationCalls_(S);
  try {
    const result = S.bulkReviewBeneficiaries(admin.token, { items: items });
    assert('كل الخمسة نجحوا (3 من أ، 2 من ب)', result.success.length === 5 && result.failed.length === 0);
    assert('AutoAllocation شُغِّل مرتين بالضبط، مرة لكل جمعية فريدة', tracker.calls.length === 2);
    assert('الجمعيتان معًا وبلا تكرار لأي منهما', new Set(tracker.calls).size === 2
      && tracker.calls.indexOf(assocA.id) !== -1 && tracker.calls.indexOf(assocB.id) !== -1);
  } finally { tracker.restore(); }
}

/* ================================================================
   23) Patch 3.2A.1 — مستفيد فشل داخل الدفعة لا يوقف البقية ولا يضيف جمعيته للتخصيص
   ================================================================ */
section('23) Patch 3.2A.1 — فشل مستفيد داخل bulk: البقية تنجح، وجمعية الفاشل لا تدخل قائمة التخصيص إلا إن نجح غيره من نفس الجمعية');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية فشل جزئي', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000033', email: 'bulk-partial-fail@example.org', password: 'BulkPassC123'
  });
  const assocSession = S.createSession_({ id: 'USR-ASSOC-BULK-FAIL', name: 'جمعية فشل جزئي', role: 'ASSOCIATION', associationId: assoc.id });

  const goodBeneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد ناجح', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: freshPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  const goodNeedId = needRows(S, goodBeneficiary.id)[0].id;

  // مستفيد وحيد الاحتياج في جمعية أخرى منفصلة، سيُرفض احتياجه فيفشل شرط "احتياج معتمد واحد على الأقل" رغم قرار "معتمد".
  const otherAssoc = S.saveAssociation(admin.token, {
    name: 'جمعية الفاشل وحده', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000034', email: 'bulk-fail-only@example.org', password: 'BulkPassD123'
  });
  const otherAssocSession = S.createSession_({ id: 'USR-ASSOC-BULK-FAIL2', name: 'جمعية الفاشل وحده', role: 'ASSOCIATION', associationId: otherAssoc.id });
  const failBeneficiary = S.saveBeneficiary(otherAssocSession.token, {
    deviceTypes: ['غسالة'], name: 'مستفيد فاشل وحيد بجمعيته', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: freshPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  const failNeedId = needRows(S, failBeneficiary.id)[0].id;

  const tracker = trackAllocationCalls_(S);
  try {
    const result = S.bulkReviewBeneficiaries(admin.token, {
      items: [
        { beneficiaryId: goodBeneficiary.id, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: goodNeedId, decision: 'معتمد' }] },
        { beneficiaryId: failBeneficiary.id, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: failNeedId, decision: 'مرفوض', rejectReason: 'غير مؤهل' }] }
      ]
    });
    assert('المستفيد الجيد نجح والفاشل فشل', result.success.length === 1 && result.success[0].beneficiaryId === goodBeneficiary.id
      && result.failed.length === 1 && result.failed[0].beneficiaryId === failBeneficiary.id);
    assert('AutoAllocation شُغِّل مرة واحدة فقط، لجمعية المستفيد الناجح دون جمعية الفاشل',
      tracker.calls.length === 1 && tracker.calls[0] === assoc.id && tracker.calls.indexOf(otherAssoc.id) === -1);
  } finally { tracker.restore(); }
}

/* ================================================================
   24) Patch 3.2A.1 — مستفيد مرفوض كليًا وعنصر skipped لا يسببان أي تشغيل تخصيص
   ================================================================ */
section('24) Patch 3.2A.1 — رفض مستفيد كليًا وعنصر skipped لا يشغّلان AutoAllocation إطلاقًا');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  const needId = needRows(S, beneficiaryId)[0].id;

  const tracker = trackAllocationCalls_(S);
  try {
    const result = S.bulkReviewBeneficiaries(admin.token, {
      items: [
        { beneficiaryId: beneficiaryId, beneficiaryDecision: 'مرفوض', beneficiaryRejectReason: 'غير مستوفٍ للشروط', needDecisions: [{ needId: needId, decision: 'مرفوض' }] },
        { beneficiaryId: '', beneficiaryDecision: 'معتمد', needDecisions: [] }
      ]
    });
    assert('المستفيد رُفض بنجاح، والعنصر الثاني تُجوهِل', result.success.length === 1 && result.success[0].beneficiaryId === beneficiaryId
      && result.skipped.length === 1 && result.failed.length === 0);
    assert('لا استدعاء لـAutoAllocation إطلاقًا (لا اعتماد ناجح بأي احتياج معتمد)', tracker.calls.length === 0);
  } finally { tracker.restore(); }
}

/* ================================================================
   25) Patch 3.2A.1 — فشل AutoAllocation المؤجَّل بعد نجاح الاعتمادات لا يفسدها
   ================================================================ */
section('25) Patch 3.2A.1 — فشل محرك التخصيص المؤجَّل بعد نجاح الاعتمادات: تبقى success، لا تتحول إلى failed');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  S.setBeneficiaryNeeds(assocSession.token, beneficiaryId, ['ثلاجة']);
  const needId = needRows(S, beneficiaryId)[0].id;

  const original = S.runAutoAllocation_;
  S.runAutoAllocation_ = function () { throw new Error('عطل محاكى في محرك التخصيص'); };
  S.__logs.length = 0;
  try {
    const result = S.bulkReviewBeneficiaries(admin.token, {
      items: [{ beneficiaryId: beneficiaryId, beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }] }]
    });
    assert('العنصر يبقى ضمن success رغم فشل التخصيص بعده', result.success.length === 1 && result.success[0].beneficiaryId === beneficiaryId);
    assert('لا شيء انتقل إلى failed بسبب فشل التخصيص', result.failed.length === 0);
    assert('القرار نفسه كُتب فعليًا رغم فشل التخصيص', String(beneficiaryRow(S, beneficiaryId)['حالة مراجعة المستفيد']) === 'معتمد');
    assert('allocationWarnings يحمل تحذيرًا بخصوص هذه الجمعية (حقل إضافي غير كاسر)',
      Array.isArray(result.allocationWarnings) && result.allocationWarnings.length === 1 && result.allocationWarnings[0].associationId === ctx.assoc.id);
    assert('تحذير مسجَّل في السجل (Logger) بدل إسقاط النتيجة الناجحة', S.__logs.some(l => l.indexOf('فشل محرك التخصيص التلقائي المؤجَّل') >= 0));
  } finally { S.runAutoAllocation_ = original; }
}

/* ================================================================
   26) Patch 3.2A.1 — قواعد reviewBeneficiaryNeeds الحالية لم تتغير
   ================================================================ */
section('26) Patch 3.2A.1 — قواعد المراجعة الفردية (سبب الرفض الإلزامي، احتياج معتمد واحد على الأقل) كما هي حرفيًا');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId } = ctx;
  const needId = needRows(S, beneficiaryId)[0].id;

  throws('رفض مستفيد بلا سبب ما زال يفشل', () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, {
    beneficiaryDecision: 'مرفوض', needDecisions: [{ needId: needId, decision: 'مرفوض' }]
  }), 'إلزامي');

  throws('اعتماد مستفيد برفض كل احتياجاته ما زال يفشل', () => S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, {
    beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'مرفوض', rejectReason: 'اختياري' }]
  }), 'دون اعتماد احتياج واحد');

  const ok = S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, {
    beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }]
  });
  assert('اعتماد مستفيد باحتياج معتمد ما زال ينجح كما هو', ok.ok && ok.beneficiaryDecision === 'معتمد' && ok.approvedCount === 1);
}

console.log(failures === 0 ? '\n=== ALL PASS ===' : '\n=== ' + failures + ' FAILURE(S) ===');
process.exit(failures === 0 ? 0 : 1);
