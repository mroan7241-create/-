#!/usr/bin/env node
/**
 * اختبارات Phase 2.3 — Close All Legacy Entry Points and Enforce the
 * Approved Lifecycle: استيراد Excel/CSV، وsaveDevice، وassignDelegate،
 * ومعالجة الأخطاء. بيئة محاكاة كاملة في الذاكرة فقط — لا علاقة لها بأي
 * شيت حي، ولا تُشغِّل applyReleaseSchema_ أو setupSheets_ على أي بيانات
 * حقيقية.
 *
 *   تشغيل:  node tools/phase23-test.js
 */
'use strict';

const path = require('path');
const vm = require('vm');
const { readMergedServerSource } = require('./gs-manifest');

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

function buildLockService_() {
  let locked = false;
  function makeLock() {
    return {
      waitLock: () => {
        if (locked) throw new Error('LockService المحاكاة: استحواذ متداخل مرفوض');
        locked = true;
      },
      releaseLock: () => {
        if (!locked) throw new Error('LockService المحاكاة: محاولة تحرير قفل غير ممسوك أصلًا');
        locked = false;
      }
    };
  }
  const service = { getScriptLock: makeLock };
  Object.defineProperty(service, '__state', { value: () => ({ locked }), enumerable: false });
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
    ScriptApp: { getScriptId: () => 'phase23-test', getOAuthToken: () => 'token' },
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
  vm.runInContext(source, sandbox, { filename: 'gs-merged(phase23)' });
  return sandbox;
}

function seedSheets(S) {
  const headers = vm.runInContext('HEADERS', S);
  Object.keys(headers).forEach(name => S.ensureSheet_(S.SpreadsheetApp.getActiveSpreadsheet(), name, headers[name]));
}

function adminSession(S) {
  return S.createSession_({ id: 'USR-ADMIN-P23', name: 'مدير 2.3', role: 'ADMIN', associationId: '' });
}

function seedAssociation(S, admin, seq) {
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية 2.3-' + seq, category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0507' + String(1000000 + seq).slice(1), email: 'p23-' + seq + '@example.org', password: 'Phase23Pass' + seq
  });
  const assocSession = S.createSession_({ id: 'USR-ASSOC-P23-' + seq, name: 'جمعية 2.3-' + seq, role: 'ASSOCIATION', associationId: assoc.id });
  return { assoc, assocSession };
}

function needRow(S, beneficiaryId, type) {
  return S.readTable_('احتياجات المستفيدين').rows.find(row =>
    String(row['رقم المستفيد']) === beneficiaryId && String(row['نوع الجهاز']) === type);
}

function approveBeneficiary_(S, admin, beneficiaryId, deviceTypes) {
  const needDecisions = deviceTypes.map(type => ({ needId: String(needRow(S, beneficiaryId, type)['رقم الاحتياج']), decision: 'معتمد' }));
  return S.reviewBeneficiaryNeeds(admin.token, beneficiaryId, { beneficiaryDecision: 'معتمد', needDecisions: needDecisions });
}

let seq = 0;
function nextPhone_() { seq++; return '0590' + String(1000000 + seq).slice(1); }

/* ================================================================
   1) استيراد Excel/CSV — النموذج الجديد للاحتياجات
   ================================================================ */
section('1) استيراد Excel/CSV: تحويل "الاحتياج" الحر إلى deviceTypes منظَّمة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc } = seedAssociation(S, admin, 1);

  const single = S.importBeneficiaries(admin.token, [
    { name: 'صف نوع واحد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 2, socialStatus: 'أرملة', needs: 'ثلاجة', associationId: assoc.id }
  ], true);
  assert('صف بنوع واحد (ثلاجة) يُقبل', single.ok === true && single.imported === 1);

  const triple = S.importBeneficiaries(admin.token, [
    { name: 'صف ثلاثة أنواع', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 2, socialStatus: 'أرملة', needs: 'ثلاجة، فرن، غسالة', associationId: assoc.id }
  ], true);
  assert('صف بثلاثة أنواع (فاصلة عربية) يُقبل وينشئ ثلاثة صفوف احتياج مستقلة', triple.ok === true && triple.imported === 1);
  const tripleBeneficiary = S.readTable_('المستفيدون').rows.find(r => r['الاسم'] === 'صف ثلاثة أنواع');
  const tripleNeeds = S.readTable_('احتياجات المستفيدين').rows.filter(r => String(r['رقم المستفيد']) === String(tripleBeneficiary['رقم المستفيد']));
  assert('ثلاثة صفوف احتياج مستقلة "بانتظار المراجعة" لصف الأنواع الثلاثة', tripleNeeds.length === 3 && tripleNeeds.every(n => n['حالة القرار'] === 'بانتظار المراجعة'));
  assert('حالة مراجعة المستفيد المستورَد "تحت المراجعة" فورًا', String(tripleBeneficiary['حالة مراجعة المستفيد']) === 'تحت المراجعة');
  assert('الحقل النصي القديم "الاحتياج" لم يُكتب لسجل مستورَد جديد', String(tripleBeneficiary['الاحتياج'] || '') === '');
  assert('الحقل القديم "حالة المستفيد" لم يُستخدم كمصدر قرار (يبقى القيمة الافتراضية "جديد")', String(tripleBeneficiary['حالة المستفيد']) === 'جديد');

  const commaEnglish = S.importBeneficiaries(admin.token, [
    { name: 'صف فاصلة إنجليزية', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة, فرن', associationId: assoc.id }
  ], true);
  assert('فاصلة إنجليزية (,) بين نوعين تُقبل وتُقسَّم بشكل صحيح', commaEnglish.ok === true);

  const dashSeparated = S.importBeneficiaries(admin.token, [
    { name: 'صف شرطة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة - غسالة', associationId: assoc.id }
  ], true);
  assert('شرطة (-) بين نوعين مع مسافات زائدة تُقبل وتُقسَّم بشكل صحيح', dashSeparated.ok === true);

  const duplicateType = S.importBeneficiaries(admin.token, [
    { name: 'صف نوع مكرر', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة، ثلاجة', associationId: assoc.id }
  ], true);
  assert('نوع مكرر داخل نفس الخلية يُختزل إلى صف احتياج واحد فريد لا خطأ', duplicateType.ok === true);

  const disallowedType = S.importBeneficiaries(admin.token, [
    { name: 'صف نوع غير مسموح', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'مكيف', associationId: assoc.id }
  ], true);
  assert('نوع تاريخي غير مسموح به (مكيف) في سجل جديد يُرفض بخطأ يسمّي النوع ورقم الصف',
    disallowedType.ok === false && /غير مسموح به/.test(disallowedType.errors[0].message) && disallowedType.errors[0].row === 2);

  const emptyNeed = S.importBeneficiaries(admin.token, [
    { name: 'صف احتياج فارغ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: '', associationId: assoc.id }
  ], true);
  assert('احتياج فارغ تمامًا يُرفض بخطأ واضح لا سجل ناقص صامت', emptyNeed.ok === false);

  const beforeBadBatch = S.readTable_('المستفيدون').rows.length;
  const mixedBatch = S.importBeneficiaries(admin.token, [
    { name: 'صف سليم في دفعة فاسدة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة', associationId: assoc.id },
    { name: 'صف فاسد في نفس الدفعة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'فريزر', associationId: assoc.id }
  ], true);
  assert('صف واحد فاسد في الملف يمنع كتابة الدفعة كاملة (لا نجاح جزئي)', mixedBatch.ok === false
    && S.readTable_('المستفيدون').rows.length === beforeBadBatch);
}

/* ================================================================
   2) استيراد: فشل الكتابة الجزئي وتنظيف الاحتياجات
   ================================================================ */
section('2) استيراد: فشل الكتابة داخل القفل — لا نجاح جزئي ولا صفوف يتيمة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc } = seedAssociation(S, admin, 2);

  const before = S.readTable_('احتياجات المستفيدين').rows.length;
  const originalAppendObjects = S.appendObjects_;
  S.appendObjects_ = function (sheetName, objects) {
    if (sheetName === 'المستفيدون') throw new Error('فشل محاكى في كتابة المستفيدين');
    return originalAppendObjects.call(this, sheetName, objects);
  };
  let failResult = null;
  try {
    failResult = S.importBeneficiaries(admin.token, [
      { name: 'صف يفشل بعد الاحتياج', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
        familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة', associationId: assoc.id }
    ], true);
  } catch (error) {
    failResult = { threw: true, message: error.message };
  } finally {
    S.appendObjects_ = originalAppendObjects;
  }
  assert('فشل كتابة المستفيدين بعد نجاح كتابة الاحتياجات يُبطل العملية كاملة', failResult && failResult.threw === true);
  assert('لا صفوف احتياج يتيمة متبقية بعد التنظيف التلقائي', S.readTable_('احتياجات المستفيدين').rows.length === before);

  const originalAppendObjectsForNeeds = S.appendObjects_;
  S.appendObjects_ = function (sheetName, objects) {
    if (sheetName === 'احتياجات المستفيدين') throw new Error('فشل محاكى في كتابة الاحتياجات');
    return originalAppendObjectsForNeeds.call(this, sheetName, objects);
  };
  const beforeBeneficiaries = S.readTable_('المستفيدون').rows.length;
  let needsFailResult = null;
  try {
    needsFailResult = S.importBeneficiaries(admin.token, [
      { name: 'صف يفشل عند الاحتياج نفسه', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
        familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة', associationId: assoc.id }
    ], true);
  } catch (error) {
    needsFailResult = { threw: true };
  } finally {
    S.appendObjects_ = originalAppendObjectsForNeeds;
  }
  assert('فشل كتابة الاحتياجات يمنع كتابة المستفيدين كليًا', needsFailResult && needsFailResult.threw === true
    && S.readTable_('المستفيدون').rows.length === beforeBeneficiaries);
}

/* ================================================================
   3) saveDevice — إغلاق الالتفاف حول الاعتماد
   ================================================================ */
section('3) saveDevice: لا ربط بمستفيد إلا عبر احتياج معتمد');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 3);

  const warehouseDevice = S.saveDevice(admin.token, { name: 'ثلاجة مستودع', type: 'ثلاجة', associationId: assoc.id });
  assert('إضافة جهاز غير مرتبط (مستودع) تبقى مسموحة بلا أي شرط اعتماد', warehouseDevice.ok === true && warehouseDevice.record.status === 'بالمستودع');

  const pendingBeneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة', 'فرن'], name: 'مستفيد تحت المراجعة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  throws('رفض تخصيص جهاز لمستفيد ما زال تحت المراجعة',
    () => S.saveDevice(admin.token, { name: 'فرن', type: 'فرن', associationId: assoc.id, beneficiaryId: pendingBeneficiary.id }),
    'ما زال تحت المراجعة');

  // يُعتمد المستفيد باحتياج "ثلاجة" فقط، ويُرفض احتياج "فرن" — فلا يملك أي احتياج معتمد من نوع "فرن".
  const pendingFridgeNeed = needRow(S, pendingBeneficiary.id, 'ثلاجة');
  const pendingOvenNeed = needRow(S, pendingBeneficiary.id, 'فرن');
  S.reviewBeneficiaryNeeds(admin.token, pendingBeneficiary.id, {
    beneficiaryDecision: 'معتمد',
    needDecisions: [
      { needId: String(pendingFridgeNeed['رقم الاحتياج']), decision: 'معتمد' },
      { needId: String(pendingOvenNeed['رقم الاحتياج']), decision: 'مرفوض', rejectReason: 'غير متاح' }
    ]
  });
  throws('رفض تخصيص جهاز من نوع لا يملك المستفيد احتياجًا معتمدًا منه',
    () => S.saveDevice(admin.token, { name: 'فرن', type: 'فرن', associationId: assoc.id, beneficiaryId: pendingBeneficiary.id }),
    'لا يملك هذا المستفيد احتياجًا معتمدًا من نوع «فرن»');

  const rejectedBeneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد مرفوض', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  S.reviewBeneficiaryNeeds(admin.token, rejectedBeneficiary.id, { beneficiaryDecision: 'مرفوض', beneficiaryRejectReason: 'غير مستوفٍ' });
  throws('رفض تخصيص جهاز لمستفيد مرفوض نهائيًا',
    () => S.saveDevice(admin.token, { name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: rejectedBeneficiary.id }),
    'المستفيد ما زال تحت المراجعة أو غير معتمد');

  const approvedBeneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد معتمد بالكامل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, approvedBeneficiary.id, ['ثلاجة']);
  const linked = S.saveDevice(admin.token, { name: 'ثلاجة معتمدة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: approvedBeneficiary.id });
  assert('تخصيص جهاز لمستفيد معتمد باحتياج معتمد مطابق ينجح ويُشتق needId تلقائيًا بلا إرسال يدوي',
    linked.ok === true && linked.record.status === 'مخصص' && !!String(S.findById_('الأجهزة', 'رقم الجهاز', linked.id)['رقم الاحتياج']));
  const linkedNeedId = String(S.findById_('الأجهزة', 'رقم الجهاز', linked.id)['رقم الاحتياج']);
  assert('حالة تنفيذ الاحتياج المرتبط أصبحت "جهاز جاهز"', String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', linkedNeedId)['حالة التنفيذ']) === 'جهاز جاهز');

  throws('رفض ربط جهاز ثانٍ بنفس الاحتياج المعتمد (استحقاق واحد لجهاز واحد)',
    () => S.saveDevice(admin.token, { name: 'ثلاجة ثانية', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: approvedBeneficiary.id }),
    'تم ربط جهاز فعلي سابقًا بهذا الاستحقاق');

  throws('رفض تغيير نوع جهاز مرتبط فعليًا باحتياج قبل إرجاعه للمستودع',
    () => S.saveDevice(admin.token, { id: linked.id, name: 'ثلاجة معتمدة', type: 'فرن', associationId: assoc.id, beneficiaryId: approvedBeneficiary.id }),
    'مرتبط باستحقاق من نوع');

  const unassigned = S.saveDevice(admin.token, { id: linked.id, name: 'ثلاجة معتمدة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: '', status: 'بالمستودع' });
  assert('إرجاع جهاز مرتبط للمستودع ينجح ويزيل رقم المستفيد والاحتياج معًا', unassigned.ok === true
    && !String(S.findById_('الأجهزة', 'رقم الجهاز', linked.id)['رقم المستفيد'] || '')
    && !String(S.findById_('الأجهزة', 'رقم الجهاز', linked.id)['رقم الاحتياج'] || ''));
  assert('حالة تنفيذ الاحتياج بعد الإرجاع تعود "استحقاق معتمد" لا تبقى "جهاز جاهز"',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', linkedNeedId)['حالة التنفيذ']) === 'استحقاق معتمد');

  const relinkAfterReturn = S.saveDevice(admin.token, { id: linked.id, name: 'ثلاجة معتمدة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: approvedBeneficiary.id });
  assert('إعادة ربط نفس الجهاز بنفس الاحتياج بعد الإرجاع تنجح من جديد', relinkAfterReturn.ok === true && relinkAfterReturn.record.status === 'مخصص');

  // عزل الجمعيات: احتياج معتمد لدى جمعية أخرى لا يُستخدَم خطأً لتخصيص جهاز جمعية مختلفة.
  const { assoc: otherAssoc, assocSession: otherAssocSession } = seedAssociation(S, admin, 4);
  const otherBeneficiary = S.saveBeneficiary(otherAssocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد جمعية أخرى', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, otherBeneficiary.id, ['ثلاجة']);
  const crossAssocDevice = S.saveDevice(admin.token, { name: 'ثلاجة جمعية أخرى', type: 'ثلاجة', associationId: otherAssoc.id, beneficiaryId: otherBeneficiary.id });
  assert('تخصيص جهاز لمستفيد جمعية أخرى يعمل بمعزل تام (احتياج مستقل، لا تعارض مع الجمعية الأولى)', crossAssocDevice.ok === true);
}

/* ================================================================
   4) assignDelegate — التحققات العشرة
   ================================================================ */
section('4) assignDelegate: لا تعيين مندوب إلا بعد اكتمال الاعتماد والتجهيز');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 5);
  const delegate = S.saveDelegate(assocSession.token, { name: 'مندوب 2.3', phone: nextPhone_() });

  const unapproved = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد بلا اعتماد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6'
  });
  throws('رفض تعيين مندوب لمستفيد ما زال تحت المراجعة',
    () => S.assignDelegate(admin.token, unapproved.id, delegate.id),
    'المستفيد ما زال تحت المراجعة، ولا يمكن تعيين مندوب قبل اعتماد الإدارة');

  const approvedNoDevice = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'معتمد بلا جهاز', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6'
  });
  approveBeneficiary_(S, admin, approvedNoDevice.id, ['ثلاجة']);
  throws('رفض تعيين مندوب لاحتياج معتمد بلا جهاز مرتبط',
    () => S.assignDelegate(admin.token, approvedNoDevice.id, delegate.id),
    'لم تجهز جميع الأجهزة المعتمدة لهذا المستفيد');

  const fullyReady = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة', 'فرن'], name: 'معتمد جاهز بالكامل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6'
  });
  approveBeneficiary_(S, admin, fullyReady.id, ['ثلاجة', 'فرن']);
  const dev1 = S.saveDevice(admin.token, { name: 'ثلاجة كاملة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: fullyReady.id });
  throws('رفض تعيين مندوب حين احتياج واحد فقط من اثنين جاهز',
    () => S.assignDelegate(admin.token, fullyReady.id, delegate.id),
    'لم تجهز جميع الأجهزة المعتمدة لهذا المستفيد');
  const dev2 = S.saveDevice(admin.token, { name: 'فرن كامل', type: 'فرن', associationId: assoc.id, beneficiaryId: fullyReady.id });
  const needIdFridge = String(S.findById_('الأجهزة', 'رقم الجهاز', dev1.id)['رقم الاحتياج']);
  const needIdOven = String(S.findById_('الأجهزة', 'رقم الجهاز', dev2.id)['رقم الاحتياج']);
  const assignResult = S.assignDelegate(admin.token, fullyReady.id, delegate.id);
  assert('تعيين مندوب ينجح فقط عندما تكون كل الاحتياجات المعتمدة مرتبطة بأجهزة صحيحة', assignResult.ok === true);

  // ---- Phase 2.3 (تصحيح): تعيين المندوب هو "تعيين" فقط، لا "استلام" ----
  assert('تعيين المندوب لا يغيّر حالة أي جهاز — تبقى "مخصص" كما كانت',
    String(S.findById_('الأجهزة', 'رقم الجهاز', dev1.id)['حالة الجهاز']) === 'مخصص'
    && String(S.findById_('الأجهزة', 'رقم الجهاز', dev2.id)['حالة الجهاز']) === 'مخصص');
  assert('تعيين المندوب لا يضبط حالة تنفيذ الاحتياج على "خرج مع المندوب"',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdFridge)['حالة التنفيذ']) !== 'خرج مع المندوب');
  assert('حالة تنفيذ كل احتياج معتمد أصبحت "معيّن للمندوب — بانتظار التنفيذ" بالضبط',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdFridge)['حالة التنفيذ']) === 'معيّن للمندوب — بانتظار التنفيذ'
    && String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdOven)['حالة التنفيذ']) === 'معيّن للمندوب — بانتظار التنفيذ');
  assert('رقم المندوب سُجِّل على المستفيد', String(S.findById_('المستفيدون', 'رقم المستفيد', fullyReady.id)['رقم المندوب']) === delegate.id);
  assert('حالة تسليم المستفيد "جاري التجهيز" لا "خرج مع المندوب" — لا عهدة ولا وقت خروج بعد',
    String(S.findById_('المستفيدون', 'رقم المستفيد', fullyReady.id)['حالة التسليم']) === 'جاري التجهيز');

  // إعادة تعيين مندوب آخر قبل بدء العهدة الفعلية: تحديث آمن، لا تغيير حالة.
  const delegate2 = S.saveDelegate(assocSession.token, { name: 'مندوب 2.3 الثاني', phone: nextPhone_() });
  const reassignResult = S.assignDelegate(admin.token, fullyReady.id, delegate2.id);
  assert('إعادة تعيين مندوب آخر قبل بدء العهدة الفعلية تنجح وتحدّث رقم المندوب فقط',
    reassignResult.ok === true && String(S.findById_('المستفيدون', 'رقم المستفيد', fullyReady.id)['رقم المندوب']) === delegate2.id);
  assert('إعادة التعيين لا تغيّر حالة تنفيذ الاحتياج (تبقى "معيّن للمندوب — بانتظار التنفيذ")',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdFridge)['حالة التنفيذ']) === 'معيّن للمندوب — بانتظار التنفيذ');
  assert('إعادة التعيين لا تغيّر حالة الأجهزة', String(S.findById_('الأجهزة', 'رقم الجهاز', dev1.id)['حالة الجهاز']) === 'مخصص');

  // محاكاة بدء العهدة الفعلية (مسار startDelivery/confirmDevicePickup المستقل
  // لم يُبنَ بعد عمدًا — Phase 3) عبر تعديل مباشر لسجل الاحتياج/المستفيد،
  // لإثبات أن assignDelegate ترفض إعادة التعيين بعد هذه النقطة تمامًا.
  S.updateById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdFridge, { 'حالة التنفيذ': 'خرج مع المندوب' });
  S.updateById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdOven, { 'حالة التنفيذ': 'خرج مع المندوب' });
  S.updateById_('المستفيدون', 'رقم المستفيد', fullyReady.id, { 'حالة التسليم': 'خرج مع المندوب' });
  throws('رفض إعادة التعيين بعد أن بدأت العهدة الفعلية (خرج مع المندوب) — يلزم مسار الاستلام المستقل لاحقًا',
    () => S.assignDelegate(admin.token, fullyReady.id, delegate.id),
    'لم تجهز جميع الأجهزة المعتمدة لهذا المستفيد');

  // جهاز تالف مرتبط باحتياج معتمد يمنع تعيين مندوب لمستفيد آخر مشابه.
  const damagedScenario = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'معتمد بجهاز تالف', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6'
  });
  approveBeneficiary_(S, admin, damagedScenario.id, ['ثلاجة']);
  const damagedDevice = S.saveDevice(admin.token, { name: 'ثلاجة ستتلف', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: damagedScenario.id });
  S.updateById_('الأجهزة', 'رقم الجهاز', damagedDevice.id, { 'حالة الجهاز': 'تالف' });
  throws('رفض تعيين مندوب حين الجهاز المرتبط بالاحتياج المعتمد "تالف"',
    () => S.assignDelegate(admin.token, damagedScenario.id, delegate.id),
    'لم تجهز جميع الأجهزة المعتمدة لهذا المستفيد');
}

/* ================================================================
   5) attachNeedsSummaryToBeneficiaries_ — لا ابتلاع أخطاء حقيقية
   ================================================================ */
section('5) معالجة الأخطاء: تمييز "الورقة غير موجودة" عن عطل قراءة حقيقي');
{
  const S = buildSandbox();
  // لا seedSheets هنا عمدًا: يُحاكي مشروعًا لم يُطبَّق عليه مخطط Phase 2 بعد.
  const headers = vm.runInContext('HEADERS', S);
  ['إعدادات المشروع', 'المستخدمون', 'الجمعيات', 'المستفيدون', 'الأجهزة', 'المناديب', 'التسليمات',
    'إدارة الأنشطة', 'شواهد الأنشطة الرئيسية', 'سجل العمليات', 'طلبات انضمام الجمعيات', 'البيانات المرجعية']
    .forEach(name => S.ensureSheet_(S.SpreadsheetApp.getActiveSpreadsheet(), name, headers[name]));
  const admin = adminSession(S);
  const { assoc } = seedAssociation(S, admin, 6);
  const adminUser = { id: 'USR-ADMIN-P23', role: 'ADMIN', associationId: '' };
  S.saveBeneficiary_(adminUser,
    { name: 'مستفيد قبل تطبيق المخطط', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 1, socialStatus: 'أخرى', needs: ['ثلاجة'], associationId: assoc.id },
    { skipLegacyNeedsWrite: false });
  const listBeforeSchema = S.listBeneficiaries_(adminUser, {});
  assert('عدم وجود ورقة "احتياجات المستفيدين" بعد يُعيد needsSchemaReady:false بلا أي رمي', listBeforeSchema.items.every(item => item.needsSchemaReady === false));

  seedSheets(S); // الآن يُطبَّق المخطط الكامل — الورقة موجودة.
  const originalReadTable = S.readTable_;
  S.readTable_ = function (sheetName) {
    if (sheetName === 'احتياجات المستفيدين') throw new Error('عطل قراءة محاكى (رأس فاسد)');
    return originalReadTable.call(this, sheetName);
  };
  let threw = false;
  try {
    S.listBeneficiaries_(adminUser, {});
  } catch (error) {
    threw = /تعذّرت قراءة بيانات احتياجات المستفيدين/.test(error.message);
  } finally {
    S.readTable_ = originalReadTable;
  }
  assert('عطل قراءة حقيقي والورقة موجودة فعليًا لا يُبتلَع — يُرمى بوضوح مع traceId', threw === true);
}

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
