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
  ], true, assoc.id);
  assert('صف بنوع واحد (ثلاجة) يُقبل', single.ok === true && single.imported === 1);

  const triple = S.importBeneficiaries(admin.token, [
    { name: 'صف ثلاثة أنواع', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 2, socialStatus: 'أرملة', needs: 'ثلاجة، فرن، غسالة', associationId: assoc.id }
  ], true, assoc.id);
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
  ], true, assoc.id);
  assert('فاصلة إنجليزية (,) بين نوعين تُقبل وتُقسَّم بشكل صحيح', commaEnglish.ok === true);

  const dashSeparated = S.importBeneficiaries(admin.token, [
    { name: 'صف شرطة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة - غسالة', associationId: assoc.id }
  ], true, assoc.id);
  assert('شرطة (-) بين نوعين مع مسافات زائدة تُقبل وتُقسَّم بشكل صحيح', dashSeparated.ok === true);

  const duplicateType = S.importBeneficiaries(admin.token, [
    { name: 'صف نوع مكرر', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة، ثلاجة', associationId: assoc.id }
  ], true, assoc.id);
  assert('نوع مكرر داخل نفس الخلية يُختزل إلى صف احتياج واحد فريد لا خطأ', duplicateType.ok === true);

  const disallowedType = S.importBeneficiaries(admin.token, [
    { name: 'صف نوع غير مسموح', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'مكيف', associationId: assoc.id }
  ], true, assoc.id);
  assert('نوع تاريخي غير مسموح به (مكيف) في سجل جديد يُرفض بخطأ يسمّي النوع ورقم الصف',
    disallowedType.ok === false && /غير مسموح به/.test(disallowedType.errors[0].message) && disallowedType.errors[0].row === 2);

  const emptyNeed = S.importBeneficiaries(admin.token, [
    { name: 'صف احتياج فارغ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: '', associationId: assoc.id }
  ], true, assoc.id);
  assert('احتياج فارغ تمامًا يُرفض بخطأ واضح لا سجل ناقص صامت', emptyNeed.ok === false);

  const beforeBadBatch = S.readTable_('المستفيدون').rows.length;
  const mixedBatch = S.importBeneficiaries(admin.token, [
    { name: 'صف سليم في دفعة فاسدة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة', associationId: assoc.id },
    { name: 'صف فاسد في نفس الدفعة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'فريزر', associationId: assoc.id }
  ], true, assoc.id);
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
    ], true, assoc.id);
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
    ], true, assoc.id);
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
  // Phase 2.3.1 (القسم 8): هذا هو الاحتياج المعتمد الوحيد لهذا المستفيد
  // — فور اكتمال ربطه يتقدَّم تلقائيًا كمجموعة (من عنصر واحد هنا) إلى
  // "بانتظار تعيين مندوب"، لا يبقى معلَّقًا على "جهاز جاهز".
  assert('حالة تنفيذ الاحتياج المرتبط تقدَّمت تلقائيًا إلى "بانتظار تعيين مندوب" (اكتمال فوري لاحتياج وحيد)',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', linkedNeedId)['حالة التنفيذ']) === 'بانتظار تعيين مندوب');

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
  // Phase 2.3.1 (القسم 7) + Phase 2.3.3 (القسم 5): الإرجاع قبل تعيين مندوب
  // يعيد الاحتياج تحديدًا إلى "بانتظار توفر الجهاز" (لا "استحقاق معتمد"
  // مباشرة) عبر assertDeviceUnlinkFulfillment_.
  assert('حالة تنفيذ الاحتياج بعد الإرجاع تعود "بانتظار توفر الجهاز" لا تبقى "بانتظار تعيين مندوب"',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', linkedNeedId)['حالة التنفيذ']) === 'بانتظار توفر الجهاز');

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

/* ================================================================
   6) Phase 2.3.1 القسم 1: rollback كامل + حقن فشل في assignDelegate
   ================================================================ */
section('6) assignDelegate: rollback كامل بلقطات خام لكل سجل متأثر');
{
  function readyBeneficiaryWithTwoDevices_(S, admin, assocSession, assoc, seqLabel) {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة', 'فرن'], name: 'مستفيد rollback ' + seqLabel, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6'
    });
    approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة', 'فرن']);
    S.saveDevice(admin.token, { name: 'ثلاجة ' + seqLabel, type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id });
    S.saveDevice(admin.token, { name: 'فرن ' + seqLabel, type: 'فرن', associationId: assoc.id, beneficiaryId: beneficiary.id });
    const need1 = String(needRow(S, beneficiary.id, 'ثلاجة')['رقم الاحتياج']);
    const need2 = String(needRow(S, beneficiary.id, 'فرن')['رقم الاحتياج']);
    return { beneficiary, need1, need2 };
  }

  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 20);
  const delegate = S.saveDelegate(assocSession.token, { name: 'مندوب rollback', phone: nextPhone_() });

  // 1) فشل أول تحديث احتياج: لا شيء كُتب بعد — لا حاجة لتراجع، رفض نظيف فقط.
  {
    const ctx = readyBeneficiaryWithTwoDevices_(S, admin, assocSession, assoc, 'أ');
    const original = S.updateById_;
    let calls = 0;
    S.updateById_ = function (sheetName, keyField, id, values) {
      if (sheetName === 'احتياجات المستفيدين') {
        calls++;
        if (calls === 1) throw new Error('فشل محاكى في أول تحديث احتياج');
      }
      return original.apply(this, arguments);
    };
    let threw = false;
    try { S.assignDelegate(admin.token, ctx.beneficiary.id, delegate.id); }
    catch (error) { threw = /تعذّر إتمام تعيين المندوب/.test(error.message); }
    finally { S.updateById_ = original; }
    assert('(1) فشل أول تحديث احتياج: العملية تُرفض برسالة واضحة', threw === true);
    assert('(1) لا حالة جزئية: كلا الاحتياجين ما زالا كما قبل المحاولة (بانتظار تعيين مندوب)',
      String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ctx.need1)['حالة التنفيذ']) === 'بانتظار تعيين مندوب'
      && String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ctx.need2)['حالة التنفيذ']) === 'بانتظار تعيين مندوب');
    assert('(1) رقم المندوب لم يُسجَّل على المستفيد', !String(S.findById_('المستفيدون', 'رقم المستفيد', ctx.beneficiary.id)['رقم المندوب'] || ''));
  }

  // 2) فشل ثاني تحديث احتياج: الأول كُتب فعلًا — يجب أن يتراجع تلقائيًا.
  {
    const ctx = readyBeneficiaryWithTwoDevices_(S, admin, assocSession, assoc, 'ب');
    const original = S.updateById_;
    let calls = 0;
    S.updateById_ = function (sheetName, keyField, id, values) {
      if (sheetName === 'احتياجات المستفيدين') {
        calls++;
        if (calls === 2) throw new Error('فشل محاكى في ثاني تحديث احتياج');
      }
      return original.apply(this, arguments);
    };
    let threw = false;
    try { S.assignDelegate(admin.token, ctx.beneficiary.id, delegate.id); }
    catch (error) { threw = /تعذّر إتمام تعيين المندوب/.test(error.message); }
    finally { S.updateById_ = original; }
    assert('(2) فشل ثاني تحديث احتياج: العملية تُرفض', threw === true);
    assert('(2) الاحتياج الأول المكتوب فعليًا يتراجع تلقائيًا إلى "بانتظار تعيين مندوب" (لا يبقى "معيّن للمندوب")',
      String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ctx.need1)['حالة التنفيذ']) === 'بانتظار تعيين مندوب');
    assert('(2) الاحتياج الثاني (فشل الكتابة عنده) لم يتغيّر أصلًا', String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ctx.need2)['حالة التنفيذ']) === 'بانتظار تعيين مندوب');
    assert('(2) لا رقم مندوب على المستفيد بعد الفشل الكامل', !String(S.findById_('المستفيدون', 'رقم المستفيد', ctx.beneficiary.id)['رقم المندوب'] || ''));
  }

  // 3+4+5) الاحتياجات تنجح جميعًا، وكتابة سجل المستفيد نفسها تفشل (رقم
  // المندوب/حالة التسليم/آخر تحديث تُكتب معًا في تحديث واحد ذرّي على صف
  // المستفيد في هذا التصميم — فشل أي منها يعني فشل الكتابة نفسها).
  {
    const ctx = readyBeneficiaryWithTwoDevices_(S, admin, assocSession, assoc, 'ج');
    const original = S.updateById_;
    S.updateById_ = function (sheetName, keyField, id, values) {
      if (sheetName === 'المستفيدون') throw new Error('فشل محاكى في كتابة سجل المستفيد (رقم المندوب/حالة التسليم)');
      return original.apply(this, arguments);
    };
    let threw = false;
    try { S.assignDelegate(admin.token, ctx.beneficiary.id, delegate.id); }
    catch (error) { threw = /تعذّر إتمام تعيين المندوب/.test(error.message); }
    finally { S.updateById_ = original; }
    assert('(3-5) نجاح الاحتياجات وفشل كتابة سجل المستفيد: العملية تُرفض كاملة', threw === true);
    assert('(3-5) كلا الاحتياجين يتراجعان تلقائيًا إلى "بانتظار تعيين مندوب" رغم كتابتهما بنجاح قبل الفشل',
      String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ctx.need1)['حالة التنفيذ']) === 'بانتظار تعيين مندوب'
      && String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ctx.need2)['حالة التنفيذ']) === 'بانتظار تعيين مندوب');
    assert('(3-5) لا رقم مندوب ولا حالة تسليم جديدة على المستفيد', !String(S.findById_('المستفيدون', 'رقم المستفيد', ctx.beneficiary.id)['رقم المندوب'] || '')
      && String(S.findById_('المستفيدون', 'رقم المستفيد', ctx.beneficiary.id)['حالة التسليم'] || 'لم يبدأ') !== 'جاري التجهيز');
  }

  // 6) فشل جزئي أثناء التراجع نفسه: رسالة "حرجة" صريحة تسمّي ما تعذّر إعادته.
  {
    const ctx = readyBeneficiaryWithTwoDevices_(S, admin, assocSession, assoc, 'د');
    const original = S.updateById_;
    let needCalls = 0;
    S.updateById_ = function (sheetName, keyField, id, values) {
      if (sheetName === 'المستفيدون') throw new Error('فشل محاكى في كتابة سجل المستفيد');
      if (sheetName === 'احتياجات المستفيدين') {
        needCalls++;
        // الكتابتان الأوليان (التقدُّم الفعلي) تنجحان، لكن أي محاولة تالية
        // (وهي محاولات التراجع نفسها) تفشل — يحاكي عطلًا أثناء الاستعادة.
        if (needCalls > 2) throw new Error('فشل محاكى أثناء التراجع نفسه');
      }
      return original.apply(this, arguments);
    };
    let message = '';
    try { S.assignDelegate(admin.token, ctx.beneficiary.id, delegate.id); }
    catch (error) { message = error.message; }
    finally { S.updateById_ = original; }
    assert('(6) فشل جزئي أثناء التراجع نفسه ينتج رسالة "حرجة" صريحة بدل رسالة تراجع ناجح مضلِّلة',
      /تعذّر التراجع الكامل/.test(message) && /traceId/.test(message));
  }

  // idempotency (القسم 3): إعادة نفس الطلب بنفس opId تُعيد نفس النتيجة، بلا تكرار كتابة أو audit.
  {
    const ctx = readyBeneficiaryWithTwoDevices_(S, admin, assocSession, assoc, 'ه');
    const auditBefore = S.readTable_('سجل العمليات').rows.length;
    const first = S.assignDelegate(admin.token, ctx.beneficiary.id, delegate.id, 'op-assign-idem-1');
    const auditAfterFirst = S.readTable_('سجل العمليات').rows.length;
    const second = S.assignDelegate(admin.token, ctx.beneficiary.id, delegate.id, 'op-assign-idem-1');
    const auditAfterSecond = S.readTable_('سجل العمليات').rows.length;
    assert('opId مكرَّر: النتيجة الثانية مطابقة للأولى (لا إعادة تنفيذ)', second.ok === true && second.record.id === first.record.id);
    assert('opId مكرَّر: سطر audit واحد فقط أُضيف (لا تكرار)', auditAfterFirst === auditBefore + 1 && auditAfterSecond === auditAfterFirst);
  }
}

/* ================================================================
   7) Phase 2.3.1 القسم 4: منع الحالات اليتيمة في saveDevice
   ================================================================ */
section('7) saveDevice: لا حالات يتيمة بلا مستفيد');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc } = seedAssociation(S, admin, 21);

  throws('جهاز جديد بلا مستفيد وحالة "مخصص" صراحةً يُرفض', () =>
    S.saveDevice(admin.token, { name: 'جهاز يتيم', type: 'ثلاجة', associationId: assoc.id, status: 'مخصص' }),
    'مخصص');

  const warehouse = S.saveDevice(admin.token, { name: 'جهاز مستودع', type: 'ثلاجة', associationId: assoc.id });
  assert('جهاز بالمستودع بلا مستفيد ينجح', warehouse.ok === true && warehouse.record.status === 'بالمستودع');

  const damaged = S.saveDevice(admin.token, { name: 'جهاز تالف', type: 'ثلاجة', associationId: assoc.id, status: 'تالف' });
  assert('جهاز تالف بلا مستفيد ينجح', damaged.ok === true && damaged.record.status === 'تالف');

  // محاكاة سجل تاريخي فاسد (خارج saveDevice تمامًا): جهاز "مخصص" بلا
  // رقم مستفيد إطلاقًا (بيانات قديمة يدوية) — إعادة حفظه عبر saveDevice
  // بلا مستفيد يجب ألا يُبقيه "مخصص" بصمت، بل يُصحِّحه صراحة.
  const corruptId = S.nextId_('DEV');
  S.appendObject_('الأجهزة', {
    'رقم الجهاز': corruptId, 'اسم الجهاز': 'جهاز فاسد قديم', 'النوع': 'ثلاجة', 'رقم الجمعية': assoc.id,
    'رقم المستفيد': '', 'رقم الاحتياج': '', 'حالة الجهاز': 'مخصص', 'ملاحظات': '',
    'تاريخ الإضافة': S.now_(), 'تاريخ التسليم': ''
  });
  const fixed = S.saveDevice(admin.token, { id: corruptId, name: 'جهاز فاسد قديم', type: 'ثلاجة', associationId: assoc.id });
  assert('حذف/تصحيح مستفيد جهاز فاسد قديم (مخصص بلا مستفيد) لا ينتج جهازًا يتيمًا — يُعاد "بالمستودع" تلقائيًا',
    fixed.ok === true && fixed.record.status === 'بالمستودع');

  // إزالة مستفيد من جهاز مرتبط فعليًا: يجب أن يصبح "بالمستودع" صراحةً لا "مخصص".
  const { assocSession } = seedAssociation(S, admin, 22);
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد إزالة الربط', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
  const linked = S.saveDevice(admin.token, { name: 'ثلاجة مرتبطة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id });
  throws('إزالة المستفيد بمحاولة إبقاء حالة "مخصص" تُرفض صراحةً (حالة يتيمة محظورة)',
    () => S.saveDevice(admin.token, { id: linked.id, name: 'ثلاجة مرتبطة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: '', status: 'مخصص' }),
    'مخصص');
  const unlinked = S.saveDevice(admin.token, { id: linked.id, name: 'ثلاجة مرتبطة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: '' });
  assert('إزالة المستفيد (بلا تحديد حالة) تنجح وتُعيده "بالمستودع" صراحةً، وتمسح رقم الاحتياج أيضًا',
    unlinked.ok === true && unlinked.record.status === 'بالمستودع'
    && !String(S.findById_('الأجهزة', 'رقم الجهاز', linked.id)['رقم المستفيد'] || '')
    && !String(S.findById_('الأجهزة', 'رقم الجهاز', linked.id)['رقم الاحتياج'] || ''));
}

/* ================================================================
   8) Phase 2.3.1 القسم 5: منع تجاوز العهدة عبر saveDevice
   ================================================================ */
section('8) saveDevice: جهاز في عهدة المندوب محمي من أي تعديل رابط/حالة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 23);
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد عهدة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
  const device = S.saveDevice(admin.token, { name: 'ثلاجة عهدة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id });
  // محاكاة استلام فعلي (المسار المستقل لم يُبنَ بعد عمدًا — Phase 3): نضبط
  // حالة الجهاز يدويًا إلى "مع المندوب" لاختبار حماية saveDevice تحديدًا.
  S.updateById_('الأجهزة', 'رقم الجهاز', device.id, { 'حالة الجهاز': 'مع المندوب' });

  throws('محاولة إعادة جهاز "مع المندوب" إلى "مخصص" عبر saveDevice تُرفض', () =>
    S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة عهدة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, status: 'مخصص' }),
    'في عهدة المندوب');
  throws('محاولة إعادة جهاز "مع المندوب" إلى "بالمستودع" (فكّ الربط) عبر saveDevice تُرفض', () =>
    S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة عهدة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: '', status: 'بالمستودع' }),
    'في عهدة المندوب');
  throws('محاولة تغيير نوع جهاز "مع المندوب" عبر saveDevice تُرفض', () =>
    S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة عهدة', type: 'فرن', associationId: assoc.id, beneficiaryId: beneficiary.id }),
    'في عهدة المندوب');

  const descriptiveEdit = S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة عهدة (اسم محدَّث)', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, notes: 'ملاحظة جديدة' });
  assert('تعديل وصفي محدود (اسم/ملاحظات) لجهاز "مع المندوب" ينجح مع حفظ كل حقول الربط/الحالة حرفيًا',
    descriptiveEdit.ok === true && descriptiveEdit.record.name === 'ثلاجة عهدة (اسم محدَّث)'
    && descriptiveEdit.record.status === 'مع المندوب' && descriptiveEdit.record.beneficiaryId === beneficiary.id);

  // نفس الحماية لجهاز "تم التسليم".
  S.updateById_('الأجهزة', 'رقم الجهاز', device.id, { 'حالة الجهاز': 'تم التسليم' });
  throws('محاولة تغيير حالة جهاز "تم التسليم" عبر saveDevice تُرفض', () =>
    S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة عهدة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, status: 'بالمستودع' }),
    'في عهدة المندوب');
}

/* ================================================================
   9) Phase 2.3.1 القسم 6: saveDevice كعملية مترابطة مع rollback وidempotency
   ================================================================ */
section('9) saveDevice: ربط الجهاز والاحتياج معاملة واحدة مترابطة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 24);

  function readyBeneficiary_(label) {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد ربط ' + label, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
    return beneficiary;
  }

  // Phase 2.3.2 (القسم 4): الترتيب الآن الاحتياجات أولًا ثم الجهاز آخرًا
  // — فشل تحديث الاحتياج يعني ألا يُضاف الجهاز الجديد إطلاقًا (لا "جهاز
  // شبح" يحتاج تنظيفًا لاحقًا؛ ببساطة لم يُكتب من الأصل).
  {
    const beneficiary = readyBeneficiary_('أ');
    const before = S.readTable_('الأجهزة').rows.length;
    const originalUpdate = S.updateById_;
    S.updateById_ = function (sheetName, keyField, id, values) {
      if (sheetName === 'احتياجات المستفيدين') throw new Error('فشل محاكى في تحديث الاحتياج الأول');
      return originalUpdate.apply(this, arguments);
    };
    let threw = false;
    try { S.saveDevice(admin.token, { name: 'ثلاجة فشل احتياج', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id }); }
    catch (error) { threw = /تعذّر إتمام حفظ الجهاز/.test(error.message); }
    finally { S.updateById_ = originalUpdate; }
    assert('(القسم 4) فشل تحديث الاحتياج الأول: العملية تُرفض', threw === true);
    assert('(القسم 4) الاحتياج لم يتغيّر (بقي "استحقاق معتمد")', String(needRow(S, beneficiary.id, 'ثلاجة')['حالة التنفيذ']) === 'استحقاق معتمد');
    assert('(القسم 4) فشل تحديث الاحتياج الأول: لا جهاز جديد يُضاف إطلاقًا (الاحتياجات تُكتب قبل الجهاز)',
      S.readTable_('الأجهزة').rows.length === before && !S.readTable_('الأجهزة').rows.some(r => r['اسم الجهاز'] === 'ثلاجة فشل احتياج'));
  }

  // فشل تحديث احتياج التقدم الجماعي (لا الاحتياج الأساسي نفسه): مستفيد
  // له احتياجان، الأول جاهز بالفعل والثاني قيد الربط الآن — فشل تحديث
  // خطة التقدُّم الجماعي (الاحتياج الأول) يُرجع كل شيء ولا يُضاف الجهاز.
  {
    const groupBeneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة', 'فرن'], name: 'مستفيد تقدُّم جماعي فاشل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    approveBeneficiary_(S, admin, groupBeneficiary.id, ['ثلاجة', 'فرن']);
    S.saveDevice(admin.token, { name: 'ثلاجة جاهزة سلفًا', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: groupBeneficiary.id });
    const fridgeNeedId = String(needRow(S, groupBeneficiary.id, 'ثلاجة')['رقم الاحتياج']);
    assert('الاحتياج الأول (ثلاجة) وحده يبقى "جهاز جاهز" (لم يكتمل بعد احتياج ثانٍ)',
      String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', fridgeNeedId)['حالة التنفيذ']) === 'جهاز جاهز');

    const beforeOven = S.readTable_('الأجهزة').rows.length;
    const originalUpdate2 = S.updateById_;
    let needCalls = 0;
    S.updateById_ = function (sheetName, keyField, id, values) {
      if (sheetName === 'احتياجات المستفيدين') {
        needCalls++;
        // الاستدعاء الأول يخصّ احتياج التقدُّم الجماعي (الثلاجة الجاهزة
        // سلفًا) — تفشيله يحاكي فشل جزء من خطة التقدُّم لا الاحتياج الأساسي.
        if (needCalls === 1) throw new Error('فشل محاكى في تحديث احتياج التقدُّم الجماعي');
      }
      return originalUpdate2.apply(this, arguments);
    };
    let threwGroup = false;
    try { S.saveDevice(admin.token, { name: 'فرن فشل تقدُّم جماعي', type: 'فرن', associationId: assoc.id, beneficiaryId: groupBeneficiary.id }); }
    catch (error) { threwGroup = /تعذّر إتمام حفظ الجهاز/.test(error.message); }
    finally { S.updateById_ = originalUpdate2; }
    assert('(القسم 4) فشل تحديث احتياج التقدُّم الجماعي: العملية تُرفض', threwGroup === true);
    assert('(القسم 4) الاحتياج الأول (كان جزءًا من خطة التقدُّم) يبقى "جهاز جاهز" كما كان — لا حالة جزئية',
      String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', fridgeNeedId)['حالة التنفيذ']) === 'جهاز جاهز');
    assert('(القسم 4) الاحتياج الثاني (الفرن) لم يتغيّر أصلًا (بقي "استحقاق معتمد")',
      String(needRow(S, groupBeneficiary.id, 'فرن')['حالة التنفيذ']) === 'استحقاق معتمد');
    assert('(القسم 4) فشل تحديث احتياج التقدُّم الجماعي: لا جهاز جديد (فرن) يُضاف إطلاقًا',
      S.readTable_('الأجهزة').rows.length === beforeOven && !S.readTable_('الأجهزة').rows.some(r => r['اسم الجهاز'] === 'فرن فشل تقدُّم جماعي'));
  }

  // فشل append للجهاز نفسه (بعد نجاح كتابة الاحتياج): الاحتياج يعود لحالته السابقة، ولا جهاز جديد.
  {
    const beneficiary = readyBeneficiary_('ب');
    const originalAppend = S.appendObject_;
    S.appendObject_ = function (sheetName, values) {
      if (sheetName === 'الأجهزة') throw new Error('فشل محاكى في إنشاء الجهاز');
      return originalAppend.apply(this, arguments);
    };
    let threw = false;
    try { S.saveDevice(admin.token, { name: 'ثلاجة فشل جهاز', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id }); }
    catch (error) { threw = true; }
    finally { S.appendObject_ = originalAppend; }
    assert('(القسم 4) فشل append للجهاز: الاحتياج يعود لحالته السابقة ("استحقاق معتمد")',
      threw === true && String(needRow(S, beneficiary.id, 'ثلاجة')['حالة التنفيذ']) === 'استحقاق معتمد');
    assert('(القسم 4) فشل append للجهاز: لا جهاز جديد موجود إطلاقًا (لا سجل باسمه في الجدول)',
      !S.readTable_('الأجهزة').rows.some(r => r['اسم الجهاز'] === 'ثلاجة فشل جهاز'));
  }

  // idempotency (القسم 3): opId مكرَّر على saveDevice لا يُنشئ جهازًا مزدوجًا (لا حتى بعد رفض أولي).
  {
    const beneficiary = readyBeneficiary_('ج');
    const before = S.readTable_('الأجهزة').rows.length;
    const first = S.saveDevice(admin.token, { name: 'ثلاجة idempotent', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, opId: 'op-device-idem-1' });
    const afterFirst = S.readTable_('الأجهزة').rows.length;
    const second = S.saveDevice(admin.token, { name: 'ثلاجة idempotent', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, opId: 'op-device-idem-1' });
    const afterSecond = S.readTable_('الأجهزة').rows.length;
    assert('opId مكرَّر على saveDevice: لا جهاز مزدوج يُنشَأ', afterFirst === before + 1 && afterSecond === afterFirst);
    assert('opId مكرَّر: النتيجة الثانية مطابقة للأولى', second.id === first.id);
  }
}

/* ================================================================
   9ب) Phase 2.3.2 القسم 5: توحيد linkDeviceToNeed مع معاملة saveDevice
   ================================================================ */
section('9ب) linkDeviceToNeed: نفس معاملة saveDevice حرفيًا، لا مسار مستقل');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 28);

  const beneficiaryA = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد linkDeviceToNeed', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, beneficiaryA.id, ['ثلاجة']);
  const needIdA = String(needRow(S, beneficiaryA.id, 'ثلاجة')['رقم الاحتياج']);
  const warehouseDeviceA = S.saveDevice(admin.token, { name: 'ثلاجة مستودع أ', type: 'ثلاجة', associationId: assoc.id });
  const linkResult = S.linkDeviceToNeed(admin.token, warehouseDeviceA.id, needIdA);
  assert('linkDeviceToNeed تنجح وتربط الجهاز بنفس قواعد saveDevice', linkResult.ok === true && linkResult.device.status === 'مخصص');
  assert('linkDeviceToNeed تُنتج نفس نتيجة التقدُّم الفوري (اكتمال احتياج وحيد ← بانتظار تعيين مندوب) التي ينتجها saveDevice تمامًا لنفس الحالة',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdA)['حالة التنفيذ']) === 'بانتظار تعيين مندوب');

  // نفس السيناريو تمامًا عبر saveDevice المباشر — يجب أن تتطابق النتيجة حرفيًا.
  const beneficiaryB = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد saveDevice مقابل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, beneficiaryB.id, ['ثلاجة']);
  const needIdB = String(needRow(S, beneficiaryB.id, 'ثلاجة')['رقم الاحتياج']);
  const viaSaveDevice = S.saveDevice(admin.token, { name: 'ثلاجة مباشرة ب', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiaryB.id });
  assert('linkDeviceToNeed وsaveDevice ينتجان نفس الحالة النهائية لنفس السيناريو (بانتظار تعيين مندوب)',
    viaSaveDevice.record.status === linkResult.device.status
    && String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdB)['حالة التنفيذ'])
      === String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', needIdA)['حالة التنفيذ']));

  // نفس rollback: فشل كتابة الاحتياج بعد استدعاء linkDeviceToNeed يُرجع الجهاز أيضًا (نفس معاملة commitDeviceWithNeed_).
  const beneficiaryC = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد rollback link', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, beneficiaryC.id, ['ثلاجة']);
  const needIdC = String(needRow(S, beneficiaryC.id, 'ثلاجة')['رقم الاحتياج']);
  const warehouseDeviceC = S.saveDevice(admin.token, { name: 'ثلاجة مستودع ج', type: 'ثلاجة', associationId: assoc.id });
  const originalUpdateLink = S.updateById_;
  S.updateById_ = function (sheetName, keyField, id, values) {
    if (sheetName === 'احتياجات المستفيدين') throw new Error('فشل محاكى في تحديث الاحتياج عبر linkDeviceToNeed');
    return originalUpdateLink.apply(this, arguments);
  };
  let linkThrew = false;
  try { S.linkDeviceToNeed(admin.token, warehouseDeviceC.id, needIdC); }
  catch (error) { linkThrew = /تعذّر إتمام حفظ الجهاز/.test(error.message); }
  finally { S.updateById_ = originalUpdateLink; }
  assert('linkDeviceToNeed: فشل تحديث الاحتياج يُرجع العملية بالكامل (نفس rollback معاملة saveDevice)', linkThrew === true);
  assert('linkDeviceToNeed: الجهاز يبقى "بالمستودع" غير مرتبط بعد فشل الربط بالكامل',
    String(S.findById_('الأجهزة', 'رقم الجهاز', warehouseDeviceC.id)['حالة الجهاز']) === 'بالمستودع'
    && !String(S.findById_('الأجهزة', 'رقم الجهاز', warehouseDeviceC.id)['رقم الاحتياج'] || ''));
}

/* ================================================================
   10) Phase 2.3.1 القسم 9: بيانات تاريخية فاسدة — جهازان لنفس الاحتياج
   ================================================================ */
section('10) assignDelegate: رفض حاسم عند وجود أكثر من جهاز لنفس الاحتياج');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 25);
  const delegate = S.saveDelegate(assocSession.token, { name: 'مندوب بيانات فاسدة', phone: nextPhone_() });
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد بيانات فاسدة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6'
  });
  approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
  const need = needRow(S, beneficiary.id, 'ثلاجة');
  const needId = String(need['رقم الاحتياج']);
  // محاكاة فساد بيانات تاريخي (لا يمكن أن ينتج عن saveDevice الحالية، لكن
  // قد يوجد من مسار قديم/تعديل يدوي مباشر على الشيت): جهازان يحملان نفس
  // رقم الاحتياج معًا.
  ['أ', 'ب'].forEach(label => {
    const devId = S.nextId_('DEV');
    S.appendObject_('الأجهزة', {
      'رقم الجهاز': devId, 'اسم الجهاز': 'ثلاجة مكرَّرة ' + label, 'النوع': 'ثلاجة', 'رقم الجمعية': assoc.id,
      'رقم المستفيد': beneficiary.id, 'رقم الاحتياج': needId, 'حالة الجهاز': 'مخصص', 'ملاحظات': '',
      'تاريخ الإضافة': S.now_(), 'تاريخ التسليم': ''
    });
  });
  S.updateById_('احتياجات المستفيدين', 'رقم الاحتياج', needId, { 'حالة التنفيذ': 'جهاز جاهز' });
  throws('assignDelegate ترفض حاسمًا عند وجود أكثر من جهاز مرتبط بنفس الاحتياج، برسالة توضّح خلل سلامة البيانات',
    () => S.assignDelegate(admin.token, beneficiary.id, delegate.id),
    'يوجد أكثر من جهاز مرتبط بالاستحقاق نفسه');
}

/* ================================================================
   11) Phase 2.3.1 القسم 10: حسم سلوك استيراد ADMIN
   ================================================================ */
section('11) استيراد ADMIN: جمعية واحدة إلزامية على مستوى الطلب');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 26);
  const { assoc: otherAssoc } = seedAssociation(S, admin, 27);

  throws('ADMIN بلا associationId يُرفض قبل أي تحويل/معالجة للملف',
    () => S.importBeneficiaries(admin.token, [
      { name: 'صف بلا جمعية', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
        familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة' }
    ], true),
    'رقم الجمعية مطلوب لاستيراد الإدارة');

  throws('ADMIN برقم جمعية غير موجود يُرفض برسالة واضحة',
    () => S.importBeneficiaries(admin.token, [
      { name: 'صف جمعية وهمية', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
        familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة' }
    ], true, 'ASC-999999'),
    'رقم جمعية غير موجود');

  const adminImport = S.importBeneficiaries(admin.token, [
    { name: 'صف إدارة أول', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة', associationId: otherAssoc.id }, // يُتجاهَل — الجمعية من الطلب فقط
    { name: 'صف إدارة ثانٍ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'فرن' }
  ], true, assoc.id);
  assert('ADMIN بجمعية صحيحة: الاستيراد ينجح', adminImport.ok === true && adminImport.imported === 2);
  const importedByAdmin = S.readTable_('المستفيدون').rows.filter(r => r['الاسم'] === 'صف إدارة أول' || r['الاسم'] === 'صف إدارة ثانٍ');
  assert('ADMIN: رقم الجمعية من مستوى الطلب يُحقَن في كل الصفوف — لا اعتماد على أي عمود جمعية داخل الصف نفسه',
    importedByAdmin.length === 2 && importedByAdmin.every(r => String(r['رقم الجمعية']) === assoc.id));

  // جمعية تحاول تمرير associationId لجمعية أخرى: يُتجاهَل تمامًا، تُستخدَم جمعيتها هي دائمًا.
  const assocImport = S.importBeneficiaries(assocSession.token, [
    { name: 'صف جمعية بمحاولة انتحال', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة', associationId: otherAssoc.id }
  ], true, otherAssoc.id);
  assert('جمعية تحاول تمرير associationId لجمعية أخرى: يُتجاهَل — تُستخدَم جمعيتها الحقيقية دائمًا',
    assocImport.ok === true
    && String(S.readTable_('المستفيدون').rows.find(r => r['الاسم'] === 'صف جمعية بمحاولة انتحال')['رقم الجمعية']) === assoc.id);
}

/* ================================================================
   12) Phase 2.3.2 القسم 1(د): صف جهاز — استعادة فعلية بعد فشل كتابته هو نفسه
   ================================================================ */
section('12) commitDeviceWithNeed_: صف الجهاز يُستعاد فعليًا حتى لو فشل استدعاؤه هو نفسه');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 29);
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد صف جهاز', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
  const device = S.saveDevice(admin.token, { name: 'ثلاجة صف', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id });
  // إرجاع الجهاز للمستودع (تحديث existing، لا append) — نفحص هنا استعادة
  // "صف جهاز" تحديدًا (لا صف احتياج) عند فشل الاستدعاء الأول لتحديثه.
  const originalUpdate = S.updateById_;
  let deviceCalls = 0;
  S.updateById_ = function (sheetName, keyField, id, values) {
    if (sheetName === 'الأجهزة' && id === device.id) {
      deviceCalls++;
      if (deviceCalls === 1) throw new Error('فشل محاكى في أول تحديث لصف الجهاز نفسه');
    }
    return originalUpdate.apply(this, arguments);
  };
  let threw = false;
  try { S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة صف', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: '', status: 'بالمستودع' }); }
  catch (error) { threw = /تعذّر إتمام حفظ الجهاز/.test(error.message); }
  finally { S.updateById_ = originalUpdate; }
  assert('فشل أول تحديث لصف الجهاز نفسه: العملية تُرفض', threw === true);
  assert('صف الجهاز استُعيد فعليًا رغم أن استدعاءه هو نفسه من فشل (لا يُتجاهَل بصمت)',
    deviceCalls === 2 && String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['رقم المستفيد']) === beneficiary.id
    && String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['حالة الجهاز']) === 'مخصص');
}

/* ================================================================
   13) Phase 2.3.2 القسم 6: مقاومة فشل ما بعد نجاح الكتابة (post-commit)
   ================================================================ */
section('13) فشل الإثراء بعد نجاح الكتابة الأساسية لا يُسقِط العملية');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 30);

  // saveDevice: فشل computeCoreSummary_ بعد نجاح كتابة الجهاز فعليًا.
  {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد post-commit جهاز', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
    const originalSummary = S.computeCoreSummary_;
    S.computeCoreSummary_ = function () { throw new Error('فشل محاكى في computeCoreSummary_ بعد نجاح الكتابة'); };
    let result = null;
    try { result = S.saveDevice(admin.token, { name: 'ثلاجة post-commit', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id }); }
    finally { S.computeCoreSummary_ = originalSummary; }
    assert('saveDevice: فشل الملخّص بعد نجاح الكتابة يُعيد ok:true مع refreshRequired:true (لا استثناء)',
      result && result.ok === true && result.refreshRequired === true);
    assert('saveDevice: البيانات الأساسية كُتبت فعليًا رغم فشل الملخّص (الجهاز مرتبط فعلًا في الجدول)',
      S.readTable_('الأجهزة').rows.some(r => r['اسم الجهاز'] === 'ثلاجة post-commit' && r['رقم المستفيد'] === beneficiary.id));
  }

  // assignDelegate: فشل computeCoreSummary_ بعد نجاح تعيين المندوب فعليًا.
  {
    const delegate = S.saveDelegate(assocSession.token, { name: 'مندوب post-commit', phone: nextPhone_() });
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد post-commit تعيين', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6'
    });
    approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
    S.saveDevice(admin.token, { name: 'ثلاجة تعيين post-commit', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id });
    const originalSummary2 = S.computeCoreSummary_;
    S.computeCoreSummary_ = function () { throw new Error('فشل محاكى في computeCoreSummary_ بعد نجاح التعيين'); };
    let assignResult = null;
    try { assignResult = S.assignDelegate(admin.token, beneficiary.id, delegate.id); }
    finally { S.computeCoreSummary_ = originalSummary2; }
    assert('assignDelegate: فشل الملخّص بعد نجاح الكتابة يُعيد ok:true مع refreshRequired:true (لا استثناء)',
      assignResult && assignResult.ok === true && assignResult.refreshRequired === true);
    assert('assignDelegate: رقم المندوب سُجِّل فعليًا رغم فشل الملخّص',
      String(S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['رقم المندوب']) === delegate.id);

    // opId على نفس المحاولة: لا تُعاد الكتابة مرة ثانية ولا audit مكرَّر
    // — النتيجة الدنيا refreshRequired تُخزَّن أيضًا كنتيجة idempotency صالحة.
    const delegate2 = S.saveDelegate(assocSession.token, { name: 'مندوب post-commit آخر', phone: nextPhone_() });
    const auditBefore = S.readTable_('سجل العمليات').rows.length;
    S.computeCoreSummary_ = function () { throw new Error('فشل محاكى دائم'); };
    let firstOp = null, secondOp = null;
    try {
      firstOp = S.assignDelegate(admin.token, beneficiary.id, delegate2.id, 'op-postcommit-1');
      secondOp = S.assignDelegate(admin.token, beneficiary.id, delegate2.id, 'op-postcommit-1');
    } finally { S.computeCoreSummary_ = originalSummary2; }
    const auditAfter = S.readTable_('سجل العمليات').rows.length;
    assert('opId مع نتيجة refreshRequired: الاستدعاء الثاني لا يُعيد تنفيذ الكتابة (audit مرة واحدة فقط)',
      firstOp.refreshRequired === true && secondOp.refreshRequired === true && auditAfter === auditBefore + 1);
  }

  // importBeneficiaries: فشل computeCoreSummary_ بعد نجاح كتابة الدفعة فعليًا.
  {
    const originalSummary3 = S.computeCoreSummary_;
    S.computeCoreSummary_ = function () { throw new Error('فشل محاكى في computeCoreSummary_ بعد نجاح الاستيراد'); };
    let importResult = null;
    try {
      importResult = S.importBeneficiaries(admin.token, [
        { name: 'صف post-commit استيراد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
          familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة' }
      ], true, assoc.id);
    } finally { S.computeCoreSummary_ = originalSummary3; }
    assert('importBeneficiaries: فشل الملخّص بعد نجاح الدفعة يُعيد ok:true مع refreshRequired:true (لا يظهر كفشل يستدعي إعادة الاستيراد)',
      importResult && importResult.ok === true && importResult.refreshRequired === true && importResult.imported === 1);
    assert('importBeneficiaries: السجل مكتوب فعليًا رغم فشل الملخّص',
      S.readTable_('المستفيدون').rows.some(r => r['الاسم'] === 'صف post-commit استيراد'));
  }
}

/* ================================================================
   14) Phase 2.3.3 القسم 1: نتيجة linkDeviceToNeed بعد نجاح المعاملة
   ================================================================ */
section('14) linkDeviceToNeed: لا إثراء إضافي خارج حماية commitDeviceWithNeed_');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 40);

  function readyLinkedNeed_(label) {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد §1 ' + label, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
    const needId = String(needRow(S, beneficiary.id, 'ثلاجة')['رقم الاحتياج']);
    const device = S.saveDevice(admin.token, { name: 'ثلاجة مستودع §1 ' + label, type: 'ثلاجة', associationId: assoc.id });
    return { beneficiary, needId, device };
  }

  // الحالة الطبيعية: نجاح كامل بلا فشل إثراء — device موجود وok:true.
  {
    const { needId, device } = readyLinkedNeed_('أ');
    const result = S.linkDeviceToNeed(admin.token, device.id, needId);
    assert('linkDeviceToNeed: نجاح عادي يُعيد ok:true مع device كاملًا', result.ok === true && !!result.device && result.device.id === device.id);
  }

  // normalizeDevice_ يفشل داخل المعاملة نفسها (بعد نجاح الكتابة الأساسية) —
  // يجب ألا تُعاد أي محاولة إثراء إضافية خارج commitDeviceWithNeed_، بل
  // النتيجة الدنيا الصريحة {ok:true, deviceId, needId, refreshRequired:true}.
  {
    const { needId, device } = readyLinkedNeed_('ب');
    const originalNormalize = S.normalizeDevice_;
    S.normalizeDevice_ = function () { throw new Error('فشل محاكى في normalizeDevice_ بعد نجاح الكتابة'); };
    let result = null;
    try { result = S.linkDeviceToNeed(admin.token, device.id, needId); }
    finally { S.normalizeDevice_ = originalNormalize; }
    assert('linkDeviceToNeed: فشل normalizeDevice_ داخل المعاملة يُعيد ok:true وrefreshRequired:true (لا استثناء ولا device)',
      result && result.ok === true && result.refreshRequired === true && result.device === undefined);
    assert('linkDeviceToNeed: deviceId/needId محفوظان في النتيجة الدنيا رغم فشل الإثراء',
      result.deviceId === device.id && result.needId === needId);
    assert('linkDeviceToNeed: الربط تم فعليًا رغم فشل الإثراء (الجهاز مرتبط بالفعل في الجدول)',
      String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['رقم الاحتياج']) === needId);
  }

  // إعادة نفس opId بعد فشل الإثراء لا تُعيد تنفيذ الكتابة ولا audit مكرَّر.
  {
    const { needId, device } = readyLinkedNeed_('ج');
    const originalNormalize = S.normalizeDevice_;
    S.normalizeDevice_ = function () { throw new Error('فشل محاكى دائم'); };
    const auditBefore = S.readTable_('سجل العمليات').rows.length;
    let first = null, second = null;
    try {
      first = S.linkDeviceToNeed(admin.token, device.id, needId, 'op-link-postcommit-1');
      second = S.linkDeviceToNeed(admin.token, device.id, needId, 'op-link-postcommit-1');
    } finally { S.normalizeDevice_ = originalNormalize; }
    const auditAfter = S.readTable_('سجل العمليات').rows.length;
    assert('linkDeviceToNeed: opId مكرَّر بعد فشل الإثراء لا يُعيد تنفيذ الكتابة (audit مرة واحدة فقط)',
      first.refreshRequired === true && second.refreshRequired === true && auditAfter === auditBefore + 1);
  }
}

/* ================================================================
   15) Phase 2.3.3 القسم 2: تراجع جماعي عند فقدان الجاهزية (فكّ ربط)
   ================================================================ */
section('15) فقدان الجاهزية الجماعية: تراجع الاحتياجات الأخرى إلى "جهاز جاهز"');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 41);

  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة', 'فرن'], name: 'مستفيد §2 تراجع جماعي', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة', 'فرن']);

  const fridge = S.saveDevice(admin.token, { name: 'ثلاجة §2', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id });
  const oven = S.saveDevice(admin.token, { name: 'فرن §2', type: 'فرن', associationId: assoc.id, beneficiaryId: beneficiary.id });
  const fridgeNeedId = String(needRow(S, beneficiary.id, 'ثلاجة')['رقم الاحتياج']);
  const ovenNeedId = String(needRow(S, beneficiary.id, 'فرن')['رقم الاحتياج']);

  assert('(القسم 2) قبل الفكّ: كلا الاحتياجين "بانتظار تعيين مندوب" معًا (اكتمال جماعي)',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', fridgeNeedId)['حالة التنفيذ']) === 'بانتظار تعيين مندوب'
    && String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ovenNeedId)['حالة التنفيذ']) === 'بانتظار تعيين مندوب');

  // فكّ ربط الثلاجة فقط: الثلاجة تعود "بانتظار توفر الجهاز"، والفرن (لا يزال
  // مرتبطًا بجهاز صالح) يتراجع إلى "جهاز جاهز" — لا يبقى معلَّقًا في حالة
  // لم تعد صحيحة بعد فقدان اكتمال المجموعة.
  const unlinkedFridge = S.saveDevice(admin.token, { id: fridge.id, name: 'ثلاجة §2', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: '' });
  assert('(القسم 2) فكّ ربط الثلاجة نجح', unlinkedFridge.ok === true);
  assert('(القسم 2) الاحتياج الأول (ثلاجة، فُكّ ربطه) أصبح "بانتظار توفر الجهاز"',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', fridgeNeedId)['حالة التنفيذ']) === 'بانتظار توفر الجهاز');
  assert('(القسم 2) الاحتياج الثاني (فرن، ما زال مرتبطًا بجهاز صالح) تراجع إلى "جهاز جاهز" لا يبقى "بانتظار تعيين مندوب"',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ovenNeedId)['حالة التنفيذ']) === 'جهاز جاهز');

  // إعادة ربط الثلاجة تُعيد كليهما معًا إلى "بانتظار تعيين مندوب" (اكتمال جماعي من جديد).
  const relinkedFridge = S.saveDevice(admin.token, { id: fridge.id, name: 'ثلاجة §2 معادة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id });
  assert('(القسم 2) إعادة ربط الثلاجة نجحت', relinkedFridge.ok === true);
  assert('(القسم 2) بعد إعادة الربط: كلا الاحتياجين عادا معًا "بانتظار تعيين مندوب"',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', fridgeNeedId)['حالة التنفيذ']) === 'بانتظار تعيين مندوب'
    && String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ovenNeedId)['حالة التنفيذ']) === 'بانتظار تعيين مندوب');

  // فشل جزئي أثناء فكّ ربط ثانٍ: الفرن (ثانيًا) هذه المرة — فشل تحديث خطة
  // التراجع الجماعي (الاحتياج الآخر) يُرجع الجهاز وكل الاحتياجات المتأثرة معًا.
  const beforeOvenStatus = String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ovenNeedId)['حالة التنفيذ']);
  const beforeFridgeStatus = String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', fridgeNeedId)['حالة التنفيذ']);
  const beforeOvenDeviceRow = Object.assign({}, S.findById_('الأجهزة', 'رقم الجهاز', oven.id));
  const originalUpdate = S.updateById_;
  let needUpdateCalls = 0;
  S.updateById_ = function (sheetName, keyField, id, values) {
    if (sheetName === 'احتياجات المستفيدين') {
      needUpdateCalls++;
      if (needUpdateCalls === 2) throw new Error('فشل محاكى في تحديث خطة التراجع الجماعي');
    }
    return originalUpdate.apply(this, arguments);
  };
  let unlinkThrew = false;
  try { S.saveDevice(admin.token, { id: oven.id, name: 'فرن §2', type: 'فرن', associationId: assoc.id, beneficiaryId: '' }); }
  catch (error) { unlinkThrew = /تعذّر إتمام حفظ الجهاز/.test(error.message); }
  finally { S.updateById_ = originalUpdate; }
  assert('(القسم 2) فشل تحديث خطة التراجع الجماعي: العملية تُرفض', unlinkThrew === true);
  assert('(القسم 2) الاحتياج الأساسي (فرن) عاد لحالته السابقة',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ovenNeedId)['حالة التنفيذ']) === beforeOvenStatus);
  assert('(القسم 2) الاحتياج الآخر المتأثر (ثلاجة) عاد لحالته السابقة أيضًا',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', fridgeNeedId)['حالة التنفيذ']) === beforeFridgeStatus);
  assert('(القسم 2) جهاز الفرن نفسه عاد لحالته السابقة (لم يبقَ فكّ ربط جزئي)',
    String(S.findById_('الأجهزة', 'رقم الجهاز', oven.id)['رقم الاحتياج'] || '') === String(beforeOvenDeviceRow['رقم الاحتياج'] || ''));
}

/* ================================================================
   16) Phase 2.3.3 القسم 3: تصليب saveDeviceDescriptiveOnly_
   ================================================================ */
section('16) saveDeviceDescriptiveOnly_: لقطة/تراجع/post-commit لجهاز في عهدة المندوب');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 42);

  function custodyDevice_(label) {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد §3 ' + label, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    approveBeneficiary_(S, admin, beneficiary.id, ['ثلاجة']);
    const device = S.saveDevice(admin.token, { name: 'ثلاجة §3 ' + label, type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id });
    // محاكاة استلام فعلي يدويًا (لا endpoint بعد) كما في بقية الاختبارات —
    // يضع الجهاز في عهدة المندوب حتى يدخل مسار saveDeviceDescriptiveOnly_.
    S.updateById_('الأجهزة', 'رقم الجهاز', device.id, { 'حالة الجهاز': 'مع المندوب' });
    S.invalidateTableCache_('الأجهزة');
    return { beneficiary, device };
  }

  // نجاح عادي: تعديل الاسم/الملاحظات فقط لجهاز في عهدة المندوب. الحقول
  // الأخرى (النوع/الجمعية/المستفيد/الحالة) تُرسَل مطابقة للحالية تمامًا —
  // أي محاولة تغييرها فعليًا تُرفض دائمًا (Phase 2.3.1 القسم 5)، فهذا
  // ليس ما يُختبَر هنا.
  {
    const { beneficiary, device } = custodyDevice_('أ');
    const result = S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة §3 أ معدَّلة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, notes: 'ملاحظة جديدة' });
    assert('(القسم 3) تعديل وصفي عادي ينجح ويعيد السجل المُحدَّث',
      result.ok === true && result.record && result.record.name === 'ثلاجة §3 أ معدَّلة');
  }

  // فشل جزئي: الاسم ينجح، لكن الاستدعاء (الخلية الثانية منطقيًا) يفشل — يُعاد الجهاز لحالته السابقة كاملة.
  {
    const { beneficiary, device } = custodyDevice_('ب');
    const beforeSnapshot = Object.assign({}, S.findById_('الأجهزة', 'رقم الجهاز', device.id));
    const originalUpdate = S.updateById_;
    S.updateById_ = function (sheetName, keyField, id, values) {
      if (sheetName === 'الأجهزة' && id === device.id) throw new Error('فشل محاكى في تحديث صف الجهاز الوصفي');
      return originalUpdate.apply(this, arguments);
    };
    let threw = false;
    try { S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة §3 ب فشل', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, notes: 'لن تُكتب' }); }
    catch (error) { threw = /تعذّر إتمام التعديل الوصفي/.test(error.message); }
    finally { S.updateById_ = originalUpdate; }
    assert('(القسم 3) فشل الكتابة الوصفية: العملية تُرفض', threw === true);
    const afterSnapshot = S.findById_('الأجهزة', 'رقم الجهاز', device.id);
    assert('(القسم 3) فشل جزئي: كل الحقول (بما فيها الاسم) عادت لقيمتها السابقة حرفيًا',
      afterSnapshot['اسم الجهاز'] === beforeSnapshot['اسم الجهاز'] && afterSnapshot['ملاحظات'] === beforeSnapshot['ملاحظات']);
  }

  // فشل الإثراء بعد نجاح الكتابة الوصفية فعليًا: refreshRequired بدل استثناء.
  {
    const { beneficiary, device } = custodyDevice_('ج');
    const originalNormalize = S.normalizeDevice_;
    S.normalizeDevice_ = function () { throw new Error('فشل محاكى في normalizeDevice_ بعد تعديل وصفي ناجح'); };
    let result = null;
    try { result = S.saveDevice(admin.token, { id: device.id, name: 'ثلاجة §3 ج ناجحة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, notes: 'ملاحظة' }); }
    finally { S.normalizeDevice_ = originalNormalize; }
    assert('(القسم 3) فشل الإثراء بعد نجاح الكتابة الوصفية يُعيد ok:true وrefreshRequired:true',
      result && result.ok === true && result.refreshRequired === true);
    assert('(القسم 3) الاسم كُتب فعليًا رغم فشل الإثراء',
      String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['اسم الجهاز']) === 'ثلاجة §3 ج ناجحة');
  }

  // opId على saveDevice لجهاز وصفي: إعادة نفس الطلب لا تُعيد الكتابة أو audit مكرَّر.
  {
    const { beneficiary, device } = custodyDevice_('د');
    const auditBefore = S.readTable_('سجل العمليات').rows.length;
    const payload = { id: device.id, name: 'ثلاجة §3 د', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiary.id, notes: 'أولى', opId: 'op-descriptive-1' };
    const first = S.saveDevice(admin.token, payload);
    const second = S.saveDevice(admin.token, payload);
    const auditAfter = S.readTable_('سجل العمليات').rows.length;
    assert('(القسم 3) opId مكرَّر على تعديل وصفي: لا كتابة مزدوجة ولا audit مكرَّر',
      first.id === second.id && auditAfter === auditBefore + 1);
  }
}

/* ================================================================
   17) Phase 2.3.3 القسم 4: updateBeneficiaryWithNeeds_ وpost-commit
   ================================================================ */
section('17) updateBeneficiaryWithNeeds_/إنشاء/مراجعة: تراجع جزئي وpost-commit');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 43);

  // فشل جزئي داخل صف المستفيد نفسه أثناء التعديل: لا احتياجات تُضاف أو تُحذف كأثر جانبي.
  {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد §4 تعديل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    const beforeName = String(S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['الاسم']);
    const beforeNeedsCount = S.readTable_('احتياجات المستفيدين').rows.filter(r => String(r['رقم المستفيد']) === beneficiary.id).length;
    const originalUpdate = S.updateById_;
    S.updateById_ = function (sheetName, keyField, id, values) {
      if (sheetName === 'المستفيدون' && id === beneficiary.id) throw new Error('فشل محاكى في تحديث صف المستفيد');
      return originalUpdate.apply(this, arguments);
    };
    let threw = false;
    try {
      S.saveBeneficiaryWithNeeds(assocSession.token, {
        id: beneficiary.id, name: 'اسم لن يُكتب', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
        phone: beneficiary.record ? beneficiary.record.phone : undefined, familyCount: 3, socialStatus: 'أرملة',
        deviceTypes: ['ثلاجة', 'فرن']
      });
    } catch (error) { threw = /تعذّر إتمام تعديل المستفيد/.test(error.message); }
    finally { S.updateById_ = originalUpdate; }
    assert('(القسم 4) فشل تحديث صف المستفيد: العملية تُرفض', threw === true);
    assert('(القسم 4) اسم المستفيد لم يتغيّر (عاد لقيمته السابقة)',
      String(S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['الاسم']) === beforeName);
    assert('(القسم 4) لا احتياجات أُضيفت كأثر جانبي رغم طلب إضافة "فرن"',
      S.readTable_('احتياجات المستفيدين').rows.filter(r => String(r['رقم المستفيد']) === beneficiary.id).length === beforeNeedsCount);
  }

  // post-commit للإنشاء: فشل الإثراء بعد نجاح الإنشاء فعليًا.
  {
    const originalSummary = S.computeCoreSummary_;
    S.computeCoreSummary_ = function () { throw new Error('فشل محاكى في computeCoreSummary_ بعد إنشاء ناجح'); };
    let result = null;
    try {
      result = S.saveBeneficiary(assocSession.token, {
        deviceTypes: ['ثلاجة'], name: 'مستفيد §4 إنشاء post-commit', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
        phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
      });
    } finally { S.computeCoreSummary_ = originalSummary; }
    assert('(القسم 4) فشل الإثراء بعد إنشاء ناجح يُعيد ok:true وrefreshRequired:true',
      result && result.ok === true && result.refreshRequired === true);
    assert('(القسم 4) المستفيد مكتوب فعليًا رغم فشل الإثراء',
      !!S.findById_('المستفيدون', 'رقم المستفيد', result.id));
  }

  // post-commit للتعديل: فشل الإثراء بعد نجاح التعديل فعليًا.
  {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد §4 تعديل post-commit', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    const originalSummary = S.computeCoreSummary_;
    S.computeCoreSummary_ = function () { throw new Error('فشل محاكى في computeCoreSummary_ بعد تعديل ناجح'); };
    let result = null;
    try {
      result = S.saveBeneficiaryWithNeeds(assocSession.token, {
        id: beneficiary.id, name: 'مستفيد §4 تعديل post-commit مُحدَّث', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
        phone: beneficiary.record.phone, familyCount: 3, socialStatus: 'أرملة'
      });
    } finally { S.computeCoreSummary_ = originalSummary; }
    assert('(القسم 4) فشل الإثراء بعد تعديل ناجح يُعيد ok:true وrefreshRequired:true',
      result && result.ok === true && result.refreshRequired === true);
    assert('(القسم 4) الاسم الجديد مكتوب فعليًا رغم فشل الإثراء',
      String(S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['الاسم']) === 'مستفيد §4 تعديل post-commit مُحدَّث');
  }

  // post-commit لقرار المراجعة: فشل بناء استجابة الاحتياجات بعد نجاح القرار فعليًا — الشكل الأدنى الدقيق المطلوب.
  {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد §4 مراجعة post-commit', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    const needId = String(needRow(S, beneficiary.id, 'ثلاجة')['رقم الاحتياج']);
    const originalBeneficiaryNeeds = S.beneficiaryNeeds_;
    S.beneficiaryNeeds_ = function () { throw new Error('فشل محاكى في قراءة قائمة الاحتياجات بعد نجاح القرار'); };
    let result = null;
    try {
      result = S.reviewBeneficiaryNeeds(admin.token, beneficiary.id, {
        beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'معتمد' }]
      });
    } finally { S.beneficiaryNeeds_ = originalBeneficiaryNeeds; }
    assert('(القسم 4) فشل قراءة قائمة الاحتياجات بعد نجاح القرار: الشكل الأدنى المطلوب حرفيًا',
      result && result.ok === true && result.beneficiaryId === beneficiary.id && result.beneficiaryDecision === 'معتمد'
      && result.approvedCount === 1 && result.rejectedCount === 0 && result.refreshRequired === true && result.needs === undefined);
    assert('(القسم 4) قرار الاعتماد نفسه سُجِّل فعليًا رغم فشل الإثراء',
      String(S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['حالة مراجعة المستفيد']) === 'معتمد');
  }
}

/* ================================================================
   18) Phase 2.3.3 القسم 5: مسارات صريحة — رفض انتقالات غير مصرَّح بها
   ================================================================ */
section('18) مسارات StateRules الصريحة: رفض انتقالات غير مسموحة صراحة');
{
  const S = buildSandbox();

  // "بانتظار تعيين مندوب" → "جهاز جاهز" مسموح فقط عبر assertGroupRegressionFulfillment_
  // (مسار التراجع الجماعي المحدَّد) — لا عبر assertDeviceLinkFulfillment_
  // (مسار الربط، الذي لا يقبل هذه الحالة الابتدائية إطلاقًا).
  throws('assertDeviceLinkFulfillment_ ترفض "بانتظار تعيين مندوب" كحالة ابتدائية (ليست مسار ربط)',
    () => S.assertDeviceLinkFulfillment_('بانتظار تعيين مندوب'), 'لا يمكن ربط جهاز');
  assert('assertGroupRegressionFulfillment_ تقبل نفس الانتقال ضمن مسارها المخصَّص فقط', (() => {
    try { S.assertGroupRegressionFulfillment_('بانتظار تعيين مندوب'); return true; } catch (e) { return false; }
  })());

  // "أعيد للجمعية/المستودع" → "تم التسليم" مباشرة ممنوع في كل المسارات الصريحة.
  throws('assertDeviceUnlinkFulfillment_ ترفض "أعيد للجمعية/المستودع" كحالة ابتدائية',
    () => S.assertDeviceUnlinkFulfillment_('أعيد للجمعية/المستودع'), 'لا يمكن فكّ ربط جهاز');
  throws('assertDelegateAssignFulfillment_ ترفض "أعيد للجمعية/المستودع" كحالة ابتدائية',
    () => S.assertDelegateAssignFulfillment_('أعيد للجمعية/المستودع'), 'لا يمكن تعيين مندوب');

  // "استحقاق معتمد" → "معيّن للمندوب" مباشرة بلا مرور بمسار الربط/الجاهزية الفعلي.
  throws('assertDelegateAssignFulfillment_ ترفض "استحقاق معتمد" كحالة ابتدائية (يلزم المرور بالربط والجاهزية أولًا)',
    () => S.assertDelegateAssignFulfillment_('استحقاق معتمد'), 'لا يمكن تعيين مندوب');

  // assertNeedFulfillmentPath_ الصريحة: مسار فارغ يُرفض، ومسار صحيح مُعطى صراحة يُقبل.
  throws('assertNeedFulfillmentPath_ ترفض مسارًا فارغًا', () => S.assertNeedFulfillmentPath_('استحقاق معتمد', []), 'فارغ');
  assert('assertNeedFulfillmentPath_ تقبل مسارًا صريحًا صحيحًا خطوة بخطوة', (() => {
    try { S.assertNeedFulfillmentPath_('استحقاق معتمد', ['بانتظار توفر الجهاز', 'جهاز جاهز']); return true; } catch (e) { return false; }
  })());

  // الدالة العامة القديمة (assertNeedFulfillmentChain_) لم تعد موجودة إطلاقًا في المصدر المدموج.
  assert('assertNeedFulfillmentChain_ (البحث العام القديم) أُزيلت كليًا — لا تعريف لها في السياق',
    typeof S.assertNeedFulfillmentChain_ === 'undefined');
}

/* ================================================================
   19) Phase 2.3.3 القسم 7: opId اختياري لمسارات المستفيد
   ================================================================ */
section('19) opId اختياري: إنشاء/تعديل مستفيد واستيراد لا يُكرَّران بنفس opId');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 44);

  // إنشاء: opId مكرَّر لا يُنشئ سجلًا ثانيًا (لا حتى بعد نجاح الأول فعليًا).
  {
    const beforeCount = S.readTable_('المستفيدون').rows.length;
    const payload = {
      deviceTypes: ['ثلاجة'], name: 'مستفيد §7 إنشاء', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: [], opId: 'op-create-beneficiary-1'
    };
    const first = S.saveBeneficiary(assocSession.token, payload);
    const second = S.saveBeneficiary(assocSession.token, payload);
    assert('(القسم 7) opId مكرَّر على إنشاء مستفيد: سجل واحد فقط يُنشأ',
      S.readTable_('المستفيدون').rows.length === beforeCount + 1 && first.id === second.id);
  }

  // نفس opId عبر saveBeneficiaryWithNeeds مباشرة (نطاق العملية مشترك مع saveBeneficiary).
  {
    const beforeCount = S.readTable_('المستفيدون').rows.length;
    const payload = {
      deviceTypes: ['فرن'], name: 'مستفيد §7 إنشاء موحَّد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', opId: 'op-create-beneficiary-shared-1'
    };
    const viaSaveBeneficiaryWithNeeds = S.saveBeneficiaryWithNeeds(assocSession.token, payload);
    const viaSaveBeneficiary = S.saveBeneficiary(assocSession.token, payload);
    assert('(القسم 7) نفس opId عبر saveBeneficiary وsaveBeneficiaryWithNeeds: نطاق عملية مشترك، لا سجل ثانٍ',
      S.readTable_('المستفيدون').rows.length === beforeCount + 1 && viaSaveBeneficiaryWithNeeds.id === viaSaveBeneficiary.id);
  }

  // تعديل: opId مكرَّر لا يُعيد تنفيذ الكتابة (audit مرة واحدة فقط).
  {
    const beneficiary = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['ثلاجة'], name: 'مستفيد §7 تعديل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    const auditBefore = S.readTable_('سجل العمليات').rows.length;
    const payload = {
      id: beneficiary.id, name: 'مستفيد §7 تعديل مُحدَّث', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: beneficiary.record.phone, familyCount: 4, socialStatus: 'أرملة', opId: 'op-update-beneficiary-1'
    };
    const first = S.saveBeneficiaryWithNeeds(assocSession.token, payload);
    const second = S.saveBeneficiaryWithNeeds(assocSession.token, payload);
    const auditAfter = S.readTable_('سجل العمليات').rows.length;
    assert('(القسم 7) opId مكرَّر على تعديل مستفيد: audit مرة واحدة فقط ونتيجة مطابقة',
      auditAfter === auditBefore + 1 && first.id === second.id);
  }

  // استيراد: opId مكرَّر لا يكتب دفعة ثانية.
  {
    const beforeCount = S.readTable_('المستفيدون').rows.length;
    const rows = [{ name: 'صف §7 استيراد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي', phone: nextPhone_(),
      familyCount: 1, socialStatus: 'أخرى', needs: 'ثلاجة' }];
    const first = S.importBeneficiaries(admin.token, rows, true, assoc.id, 'op-import-1');
    const second = S.importBeneficiaries(admin.token, rows, true, assoc.id, 'op-import-1');
    assert('(القسم 7) opId مكرَّر على استيراد: دفعة واحدة فقط تُكتب',
      S.readTable_('المستفيدون').rows.length === beforeCount + 1 && first.imported === second.imported);
  }
}

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
