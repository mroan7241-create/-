#!/usr/bin/env node
/**
 * اختبارات Phase 3.1 — Receipt Batches and Automatic Allocation Core:
 * سياسة المراجعة المحدَّثة (القسم 0)، محاضر استلام دفعات الأجهزة
 * (القسمان 1-2)، إدخال المخزون تلقائيًا (القسم 3)، ومحرك التخصيص
 * التلقائي وإعادة الموازنة (الأقسام 4-6). بيئة محاكاة كاملة في الذاكرة
 * فقط — لا علاقة لها بأي شيت حي، ولا تُشغِّل applyReleaseSchema_ أو
 * setupSheets_ على أي بيانات حقيقية.
 *
 *   تشغيل:  node tools/phase31-test.js
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
  let fileSeq = 0;
  const trashedFiles = new Set();
  const filesById = {};
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
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      formatString: (pattern, value) => String(value).padStart(6, '0'),
      formatDate: (date, _tz, pattern) => {
        const p = n => String(n).padStart(2, '0');
        const base = date.getFullYear() + '/' + p(date.getMonth() + 1) + '/' + p(date.getDate());
        return pattern.indexOf('HH') >= 0 ? base + ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) : base;
      },
      newBlob: (bytes, mime, name) => ({ getBytes: () => bytes || [], getContentType: () => mime || 'application/octet-stream', getName: () => name || '' }),
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
    ScriptApp: { getScriptId: () => 'phase31-test', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: {
      createFolder: () => ({
        getId: () => 'folder-id', getUrl: () => 'https://drive.example/folder',
        createFile: blob => {
          fileSeq++;
          const id = 'FILE-' + fileSeq;
          filesById[id] = blob;
          return { getId: () => id, getUrl: () => 'https://drive.example/file/' + fileSeq, getBlob: () => blob };
        }
      }),
      getFolderById: () => ({
        createFile: blob => {
          fileSeq++;
          const id = 'FILE-' + fileSeq;
          filesById[id] = blob;
          return { getId: () => id, getUrl: () => 'https://drive.example/file/' + fileSeq, getBlob: () => blob };
        }
      }),
      getFileById: fileId => {
        if (!filesById[fileId] || trashedFiles.has(fileId)) throw new Error('الملف غير موجود أو محذوف (محاكاة)');
        return {
          getBlob: () => filesById[fileId],
          setTrashed: trashed => { if (trashed) trashedFiles.add(fileId); }
        };
      }
    },
    UrlFetchApp: {}, Logger: { log: msg => { logs.push(String(msg)); } }
  };
  sandbox.globalThis = sandbox;
  sandbox.__logs = logs;
  sandbox.__lock = lockService;
  sandbox.__trashedFiles = trashedFiles;
  sandbox.__filesById = filesById;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'gs-merged(phase31)' });
  return sandbox;
}

function seedSheets(S) {
  const headers = vm.runInContext('HEADERS', S);
  Object.keys(headers).forEach(name => S.ensureSheet_(S.SpreadsheetApp.getActiveSpreadsheet(), name, headers[name]));
}

function adminSession(S) {
  return S.createSession_({ id: 'USR-ADMIN-P31', name: 'مدير 3.1', role: 'ADMIN', associationId: '' });
}

function seedAssociation(S, admin, seq) {
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية 3.1-' + seq, category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0508' + String(1000000 + seq).slice(1), email: 'p31-' + seq + '@example.org', password: 'Phase31Pass' + seq
  });
  const assocSession = S.createSession_({ id: 'USR-ASSOC-P31-' + seq, name: 'جمعية 3.1-' + seq, role: 'ASSOCIATION', associationId: assoc.id });
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

function newApprovedBeneficiary_(S, admin, assocSession, deviceTypes, label) {
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: deviceTypes, name: 'مستفيد ' + label, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  approveBeneficiary_(S, admin, beneficiary.id, deviceTypes);
  return beneficiary;
}

let seq = 0;
function nextPhone_() { seq++; return '0591' + String(1000000 + seq).slice(1); }

function pngDataUrl_() {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const bytes = Buffer.from(sig.concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  return 'data:image/png;base64,' + bytes.toString('base64');
}

function createSentBatch_(S, admin, associationId, items, supplierName) {
  const created = S.createReceiptBatch(admin.token, {
    associationId: associationId, supplierName: supplierName || 'مورد اختبار',
    sentDate: '2026/01/01', notes: '', items: items
  });
  S.sendReceiptBatch(admin.token, created.id);
  return created.id;
}

function itemIdsOf_(S, batchId) {
  const items = S.readTable_('بنود محضر الاستلام').rows.filter(r => String(r['رقم المحضر']) === batchId);
  const byType = {};
  items.forEach(r => { byType[String(r['نوع الجهاز'])] = String(r['رقم البند']); });
  return byType;
}

function confirmFullReceipt_(S, assocSession, batchId) {
  return S.confirmReceiptBatch(assocSession.token, {
    batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_()
  });
}

/** يستخرج رمز وصول صيانة صالح — نفس نمط grantToken_ في reference-test.js. */
function grantMaintenance_(S) {
  S.__logs.length = 0;
  S.grantMaintenanceAccess_();
  const line = S.__logs.find(l => l.indexOf('رمز وصول الصيانة') >= 0);
  if (!line) throw new Error('لم يُطبع رمز وصول الصيانة في السجل (اختبار)');
  return line.split(': ').pop();
}

/** يزرع جهازًا "جاهزًا" (مخصَّصًا فعليًا) مباشرة على السجلات لاختبار حالة ابتدائية محدَّدة بدقة، بلا المرور بمحرك التخصيص. */
function seedReadyDevice_(S, assoc, beneficiaryId, needId, type, spec) {
  const id = S.nextId_('DEV');
  S.appendObject_('الأجهزة', {
    'رقم الجهاز': id, 'اسم الجهاز': type + ' — ' + spec, 'النوع': type,
    'رقم الجمعية': assoc.id, 'رقم المستفيد': beneficiaryId, 'حالة الجهاز': 'مخصص',
    'تاريخ الإضافة': '2026/01/01', 'تاريخ التسليم': '', 'ملاحظات': '', 'رقم الاحتياج': needId, 'رقم بند الاستلام': ''
  });
  S.updateById_('احتياجات المستفيدين', 'رقم الاحتياج', needId, {'حالة التنفيذ': 'جهاز جاهز'});
  return id;
}

/* ================================================================
   1) القسم 0: سبب رفض الاحتياج اختياري
   ================================================================ */
section('1) سبب رفض الاحتياج اختياري (القسم 0)');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assocSession } = seedAssociation(S, admin, 1);
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة', 'فرن'], name: 'مستفيد سبب اختياري', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  const fridgeNeedId = String(needRow(S, beneficiary.id, 'ثلاجة')['رقم الاحتياج']);
  const ovenNeedId = String(needRow(S, beneficiary.id, 'فرن')['رقم الاحتياج']);
  const result = S.reviewBeneficiaryNeeds(admin.token, beneficiary.id, {
    beneficiaryDecision: 'معتمد', needDecisions: [{ needId: fridgeNeedId, decision: 'معتمد' }, { needId: ovenNeedId, decision: 'مرفوض' }]
  });
  assert('رفض احتياج فردي بلا سبب لا يمنع نجاح القرار', result.ok === true);
  assert('سبب الرفض الفردي يبقى فارغًا (لم يُطلَب)',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', ovenNeedId)['سبب الرفض'] || '') === '');
}

/* ================================================================
   2) القسم 0: منع اعتماد مستفيد بلا احتياج معتمد
   ================================================================ */
section('2) منع اعتماد مستفيد بلا احتياج معتمد (القسم 0)');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assocSession } = seedAssociation(S, admin, 2);
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة'], name: 'مستفيد بلا اعتماد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  const needId = String(needRow(S, beneficiary.id, 'ثلاجة')['رقم الاحتياج']);
  throws('اعتماد مستفيد مع رفض احتياجه الوحيد يُرفض',
    () => S.reviewBeneficiaryNeeds(admin.token, beneficiary.id, { beneficiaryDecision: 'معتمد', needDecisions: [{ needId: needId, decision: 'مرفوض' }] }),
    'دون اعتماد احتياج واحد');
}

/* ================================================================
   3) القسم 0: رفض المستفيد يغلق الاحتياجات المعلقة بسبب موحد
   ================================================================ */
section('3) رفض المستفيد يغلق كل احتياجاته المعلَّقة بسبب موحَّد (القسم 0)');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assocSession } = seedAssociation(S, admin, 3);
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    deviceTypes: ['ثلاجة', 'فرن', 'غسالة'], name: 'مستفيد رفض موحَّد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  const fridgeNeedId = String(needRow(S, beneficiary.id, 'ثلاجة')['رقم الاحتياج']);
  const unifiedReason = 'الجمعية غير مؤهَّلة';
  const result = S.reviewBeneficiaryNeeds(admin.token, beneficiary.id, {
    beneficiaryDecision: 'مرفوض', beneficiaryRejectReason: unifiedReason,
    // احتياج واحد يُرسَل صراحة بسبب مختلف — يجب أن يُستبدَل بالسبب الموحَّد.
    needDecisions: [{ needId: fridgeNeedId, decision: 'مرفوض', rejectReason: 'سبب فردي مختلف تمامًا' }]
  });
  assert('رفض المستفيد ينجح', result.ok === true);
  const allNeeds = S.beneficiaryNeeds_(beneficiary.id);
  assert('كل الاحتياجات الثلاثة أصبحت "مرفوض"', allNeeds.every(n => n.decisionStatus === 'مرفوض'));
  assert('السبب الموحَّد استُخدم للاحتياج المُرسَل صراحة بسبب مختلف (تجاهل الفردي)',
    String(S.findById_('احتياجات المستفيدين', 'رقم الاحتياج', fridgeNeedId)['سبب الرفض']) === unifiedReason);
  assert('السبب الموحَّد استُخدم أيضًا للاحتياجات المُغلَقة تلقائيًا (لم تُذكر في الطلب)',
    allNeeds.every(n => n.rejectReason === unifiedReason));
}

/* ================================================================
   4) منع إنشاء محضر لجمعية مرفوضة أو غير نشطة
   ================================================================ */
section('4) منع إنشاء محضر استلام لجمعية غير نشطة أو غير موجودة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc } = seedAssociation(S, admin, 4);
  S.saveAssociation(admin.token, { id: assoc.id, name: assoc.record.name, category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: assoc.record.phone, email: assoc.record.email, status: 'غير نشطة' });

  throws('محضر لجمعية غير نشطة يُرفض',
    () => S.createReceiptBatch(admin.token, { associationId: assoc.id, supplierName: 'مورد', sentDate: '2026/01/01', items: [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }] }),
    'غير نشطة');
  throws('محضر لجمعية غير موجودة يُرفض',
    () => S.createReceiptBatch(admin.token, { associationId: 'ASC-999999', supplierName: 'مورد', sentDate: '2026/01/01', items: [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }] }),
    'غير موجودة');
}

/* ================================================================
   5) الاستلام الكامل
   ================================================================ */
section('5) تأكيد استلام كامل (السليم = المرسل، تالف/ناقص = صفر)');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 5);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 3 }]);
  const result = confirmFullReceipt_(S, assocSession, batchId);
  assert('التأكيد الكامل ينجح', result.ok === true);
  assert('حالة المحضر أصبحت "تم الاستلام كاملًا"', result.batch.status === 'تم الاستلام كاملًا');
  assert('الكمية السليمة = المرسلة، التالف والناقص صفر', result.batch.items[0].receivedQty === 3
    && result.batch.items[0].damagedQty === 0 && result.batch.items[0].missingQty === 0);
}

/* ================================================================
   6) الاستلام مع فروقات صحيحة
   ================================================================ */
section('6) تأكيد استلام مع فروقات (سليم + تالف + ناقص = مرسل)');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 6);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 5 }]);
  const items = itemIdsOf_(S, batchId);
  const result = S.confirmReceiptBatch(assocSession.token, {
    batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
    items: [{ itemId: items['ثلاجة'], receivedQty: 3, damagedQty: 1, missingQty: 1, differenceReason: 'نقص من المورد' }],
    damagePhotos: [{ itemIds: [items['ثلاجة']], photo: pngDataUrl_() }]
  });
  assert('التأكيد مع فروقات ينجح', result.ok === true);
  assert('حالة المحضر أصبحت "تم الاستلام مع فروقات"', result.batch.status === 'تم الاستلام مع فروقات');
  assert('الكميات مطابقة لما أُرسل', result.batch.items[0].receivedQty === 3 && result.batch.items[0].damagedQty === 1 && result.batch.items[0].missingQty === 1);
}

/* ================================================================
   7) رفض معادلة كميات غير متوازنة
   ================================================================ */
section('7) رفض معادلة كميات غير متوازنة قبل أي كتابة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 7);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 5 }]);
  const items = itemIdsOf_(S, batchId);
  throws('سليم+تالف+ناقص ≠ مرسل يُرفض',
    () => S.confirmReceiptBatch(assocSession.token, {
      batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
      items: [{ itemId: items['ثلاجة'], receivedQty: 3, damagedQty: 1, missingQty: 2 }]
    }), 'معادلة الكميات غير متوازنة');
  assert('المحضر بقي "بانتظار تأكيد الجمعية" (لا كتابة جزئية)',
    String(S.findById_('محاضر استلام الأجهزة', 'رقم المحضر', batchId)['الحالة']) === 'بانتظار تأكيد الجمعية');
}

/* ================================================================
   8) إلزام صورة الكمية العامة والتوقيع
   ================================================================ */
section('8) إلزام صورة الكمية العامة والتوقيع قبل التأكيد');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 8);
  const batchId1 = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 }]);
  throws('تأكيد بلا صورة كمية عامة يُرفض',
    () => S.confirmReceiptBatch(assocSession.token, { batchId: batchId1, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_() }),
    'صورة الكمية المستلمة');
  const batchId2 = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'فرن', spec: '5 شعلات', sentQty: 1 }]);
  throws('تأكيد بلا توقيع يُرفض',
    () => S.confirmReceiptBatch(assocSession.token, { batchId: batchId2, receiverTitle: 'مسؤول المستودع', quantityPhoto: pngDataUrl_() }),
    'توقيع المستلم');
}

/* ================================================================
   9) تلف جهاز واحد يتطلب صورة واحدة فقط
   ================================================================ */
section('9) تلف جهاز واحد يتطلب صورة تلف واحدة بالضبط');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 9);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 3 }]);
  const items = itemIdsOf_(S, batchId);
  throws('تلف واحد بلا أي صورة يُرفض',
    () => S.confirmReceiptBatch(assocSession.token, {
      batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
      items: [{ itemId: items['ثلاجة'], receivedQty: 2, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }]
    }), 'صورة تلف واحدة بالضبط');
  const result = S.confirmReceiptBatch(assocSession.token, {
    batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
    items: [{ itemId: items['ثلاجة'], receivedQty: 2, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }],
    damagePhotos: [{ itemIds: [items['ثلاجة']], photo: pngDataUrl_() }]
  });
  assert('تلف واحد بصورة واحدة بالضبط ينجح', result.ok === true);
}

/* ================================================================
   10) تلف أكثر من جهاز يسمح بعدة صور
   ================================================================ */
section('10) تلف أكثر من جهاز يتطلب صورة واحدة على الأقل ويسمح بعدة صور');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 10);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 5 }]);
  const items = itemIdsOf_(S, batchId);
  throws('تلف اثنين بلا أي صورة يُرفض',
    () => S.confirmReceiptBatch(assocSession.token, {
      batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
      items: [{ itemId: items['ثلاجة'], receivedQty: 3, damagedQty: 2, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }]
    }), 'صورة تلف واحدة على الأقل');
  const result = S.confirmReceiptBatch(assocSession.token, {
    batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
    items: [{ itemId: items['ثلاجة'], receivedQty: 3, damagedQty: 2, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }],
    damagePhotos: [{ itemIds: [items['ثلاجة']], photo: pngDataUrl_() }, { itemIds: [items['ثلاجة']], photo: pngDataUrl_() }]
  });
  assert('تلف اثنين بصورتين ينجح (يُسمح بأكثر من صورة)', result.ok === true);
}

/* ================================================================
   11) إنشاء DEV بعدد السليم فقط
   ================================================================ */
section('11) إنشاء سجلات الأجهزة بعدد الكمية السليمة فقط');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 11);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 5 }]);
  const items = itemIdsOf_(S, batchId);
  const beforeDeviceCount = S.readTable_('الأجهزة').rows.length;
  S.confirmReceiptBatch(assocSession.token, {
    batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
    items: [{ itemId: items['ثلاجة'], receivedQty: 3, damagedQty: 1, missingQty: 1, differenceReason: 'نقص من المورد' }],
    damagePhotos: [{ itemIds: [items['ثلاجة']], photo: pngDataUrl_() }]
  });
  const newDevices = S.readTable_('الأجهزة').rows.filter(r => String(r['رقم بند الاستلام']) === items['ثلاجة']);
  assert('عدد الأجهزة الجديدة = الكمية السليمة (3) لا المرسلة (5)', newDevices.length === 3
    && S.readTable_('الأجهزة').rows.length === beforeDeviceCount + 3);
  assert('كل الأجهزة الجديدة بحالة "بالمستودع" وجمعية المحضر', newDevices.every(d => String(d['حالة الجهاز']) === 'بالمستودع' && String(d['رقم الجمعية']) === assoc.id));
}

/* ================================================================
   12) منع تكرار الأجهزة عند إعادة opId
   ================================================================ */
section('12) إعادة نفس opId على تأكيد المحضر لا تُنشئ أجهزة مكرَّرة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 12);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }]);
  const beforeDeviceCount = S.readTable_('الأجهزة').rows.length;
  const payload = { batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(), opId: 'op-receipt-confirm-1' };
  const first = S.confirmReceiptBatch(assocSession.token, payload);
  const afterFirst = S.readTable_('الأجهزة').rows.length;
  const second = S.confirmReceiptBatch(assocSession.token, payload);
  const afterSecond = S.readTable_('الأجهزة').rows.length;
  assert('الاستدعاء الأول أنشأ جهازين', afterFirst === beforeDeviceCount + 2);
  assert('إعادة نفس opId لا تُنشئ أجهزة إضافية ولا تُغيّر النتيجة', afterSecond === afterFirst && second.id === first.id);
}

/* ================================================================
   13) سيناريو أحمد/صالح الإلزامي
   ================================================================ */
section('13) سيناريو أحمد/صالح: لا يُستهلَك جهاز لإكمال طلبية على حساب ترك أخرى ناقصة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 13);
  const ahmad = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة', 'فرن'], 'أحمد');
  const saleh = newApprovedBeneficiary_(S, admin, assocSession, ['فرن', 'غسالة'], 'صالح');
  const batchId = createSentBatch_(S, admin, assoc.id, [
    { deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 }, { deviceType: 'فرن', spec: '5 شعلات', sentQty: 1 }
  ]);
  confirmFullReceipt_(S, assocSession, batchId);

  const ahmadFridgeNeed = needRow(S, ahmad.id, 'ثلاجة');
  const ahmadOvenNeed = needRow(S, ahmad.id, 'فرن');
  const salehOvenNeed = needRow(S, saleh.id, 'فرن');
  const salehWasherNeed = needRow(S, saleh.id, 'غسالة');
  assert('أحمد أصبح مكتملًا: كلا احتياجيه "بانتظار تعيين مندوب"',
    ahmadFridgeNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب' && ahmadOvenNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب');
  assert('صالح لم يُستهلَك له الفرن: احتياجاه بقيا بلا أي جهاز (لم يُلمَسا إطلاقًا، لا "جهاز جاهز" ولا "بانتظار تعيين مندوب")',
    salehOvenNeed['حالة التنفيذ'] !== 'جهاز جاهز' && salehOvenNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب'
    && salehWasherNeed['حالة التنفيذ'] !== 'جهاز جاهز' && salehWasherNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب');
}

/* ================================================================
   14) التخصيص الجزئي عند عدم اكتمال أي طلبية
   ================================================================ */
section('14) التخصيص الجزئي عندما لا توجد فرصة لإكمال أي طلبية');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 14);
  const beneficiary = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة', 'فرن'], 'تخصيص جزئي');
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 }]);
  confirmFullReceipt_(S, assocSession, batchId);

  const fridgeNeed = needRow(S, beneficiary.id, 'ثلاجة');
  const ovenNeed = needRow(S, beneficiary.id, 'فرن');
  assert('الاحتياج المتوفر جهازه أصبح "جهاز جاهز" (تخصيص جزئي، لا اكتمال)', fridgeNeed['حالة التنفيذ'] === 'جهاز جاهز');
  assert('المستفيد لم يصل "بانتظار تعيين مندوب" لعدم اكتمال كل احتياجاته', ovenNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب');
}

/* ================================================================
   15) إعادة الموازنة لإكمال طلبية
   ================================================================ */
section('15) إعادة الموازنة: نقل جهاز جزئي من مستفيد لآخر لإكمال طلبيته');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 15);
  // صالح يحمل احتياجين (فرن + غسالة) حتى يبقى تخصيص الفرن له جزئيًا
  // (لا يكتمل بجهاز واحد) — بالضبط كمثال إعادة الموازنة الإلزامي.
  const saleh = newApprovedBeneficiary_(S, admin, assocSession, ['فرن', 'غسالة'], 'صالح إعادة موازنة');
  const ahmad = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة', 'فرن'], 'أحمد إعادة موازنة');

  const ovenBatch = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'فرن', spec: '5 شعلات', sentQty: 1 }]);
  confirmFullReceipt_(S, assocSession, ovenBatch);
  const salehOvenNeedBefore = needRow(S, saleh.id, 'فرن');
  assert('الفرن خُصِّص جزئيًا لصالح أولًا (جهاز جاهز، لا اكتمال لوجود احتياج الغسالة أيضًا)', salehOvenNeedBefore['حالة التنفيذ'] === 'جهاز جاهز');

  const fridgeBatch = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 }]);
  confirmFullReceipt_(S, assocSession, fridgeBatch);

  const ahmadFridgeNeed = needRow(S, ahmad.id, 'ثلاجة');
  const ahmadOvenNeed = needRow(S, ahmad.id, 'فرن');
  const salehOvenNeedAfter = needRow(S, saleh.id, 'فرن');
  assert('أحمد أصبح مكتملًا بعد إعادة الموازنة: كلا احتياجيه "بانتظار تعيين مندوب"',
    ahmadFridgeNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب' && ahmadOvenNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب');
  assert('احتياج صالح للفرن عاد إلى "بانتظار توفر الجهاز" بعد سحب جهازه',
    salehOvenNeedAfter['حالة التنفيذ'] === 'بانتظار توفر الجهاز');
}

/* ================================================================
   16) منع النقل بعد تعيين المندوب
   ================================================================ */
section('16) منع محرك التخصيص من نقل جهاز بعد تعيين مندوب لصاحبه');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 16);
  const delegate = S.saveDelegate(assocSession.token, { name: 'مندوب 3.1', phone: nextPhone_() });
  const saleh = newApprovedBeneficiary_(S, admin, assocSession, ['فرن'], 'صالح مندوب');
  S.saveBeneficiaryWithNeeds(assocSession.token, { id: saleh.id, name: 'صالح مندوب', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
    phone: saleh.record.phone, familyCount: 2, socialStatus: 'أرملة', lat: '24.7', lng: '46.6' });

  const ovenBatch = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'فرن', spec: '5 شعلات', sentQty: 1 }]);
  confirmFullReceipt_(S, assocSession, ovenBatch);
  // صالح مكتمل باحتياج واحد فقط — يصل مباشرة "بانتظار تعيين مندوب"، فيُعيَّن له مندوب الآن.
  S.assignDelegate(admin.token, saleh.id, delegate.id);
  const salehOvenNeed = needRow(S, saleh.id, 'فرن');
  assert('احتياج صالح أصبح "معيّن للمندوب — بانتظار التنفيذ" (عهدة بدأت)', salehOvenNeed['حالة التنفيذ'] === 'معيّن للمندوب — بانتظار التنفيذ');

  // اعتماد احتياج أحمد لنفس النوع يُشغِّل محرك التخصيص تلقائيًا (Phase 3.1
  // القسم 4 — بعد اعتماد احتياجات جديدة)؛ يجب ألا يمسّ جهاز صالح إطلاقًا.
  const ahmad = newApprovedBeneficiary_(S, admin, assocSession, ['فرن'], 'أحمد بعد مندوب');
  const salehOvenNeedAfter = needRow(S, saleh.id, 'فرن');
  assert('جهاز صالح لم يُنقَل رغم دخول احتياج أحمد لنفس النوع (العهدة بدأت بالفعل)',
    String(salehOvenNeedAfter['حالة التنفيذ']) === 'معيّن للمندوب — بانتظار التنفيذ');
  const ahmadOvenNeed = needRow(S, ahmad.id, 'فرن');
  assert('احتياج أحمد يبقى بلا جهاز (لا مخزون متاح فعليًا ولا نقل مسموح من صالح)', ahmadOvenNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب');
}

/* ================================================================
   17) منع التخصيص بين جمعيتين
   ================================================================ */
section('17) منع التخصيص التلقائي بين جمعيتين مختلفتين');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc: assocA, assocSession: sessionA } = seedAssociation(S, admin, 17);
  const { assocSession: sessionB } = seedAssociation(S, admin, 18);
  const beneficiaryB = newApprovedBeneficiary_(S, admin, sessionB, ['ثلاجة'], 'مستفيد جمعية ب');

  const batchForA = createSentBatch_(S, admin, assocA.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 3 }]);
  confirmFullReceipt_(S, sessionA, batchForA);

  const beneficiaryBNeed = needRow(S, beneficiaryB.id, 'ثلاجة');
  assert('مخزون جمعية أ لا يُخصَّص لمستفيد جمعية ب إطلاقًا', beneficiaryBNeed['حالة التنفيذ'] !== 'جهاز جاهز' && beneficiaryBNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب');
  assert('كل الأجهزة الجديدة سُجِّلت لجمعية أ فقط', S.readTable_('الأجهزة').rows
    .filter(d => String(d['رقم بند الاستلام']) && String(d['حالة الجهاز']) === 'بالمستودع')
    .every(d => String(d['رقم الجمعية']) === assocA.id));
}

/* ================================================================
   18) ترتيب ثابت عند التعادل
   ================================================================ */
section('18) ترتيب ثابت تقني حسب المعرفات عند تعادل الفرص وظيفيًا');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 19);
  const first = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة'], 'الأول تعادل');
  const second = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة'], 'الثاني تعادل');
  assert('معرّف المستفيد الأول أصغر من الثاني (ترتيب الإنشاء)', first.id < second.id);

  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 }]);
  confirmFullReceipt_(S, assocSession, batchId);

  const firstNeed = needRow(S, first.id, 'ثلاجة');
  const secondNeed = needRow(S, second.id, 'ثلاجة');
  assert('الجهاز الوحيد المتاح ذهب للمستفيد الأول (معرّف أصغر) عند تعادل الفرصة تمامًا',
    firstNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب' && secondNeed['حالة التنفيذ'] !== 'جهاز جاهز' && secondNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب');
}

/* ================================================================
   19) فشل كتابة جزئي يعيد المحضر والبنود والأجهزة والتخصيصات
   ================================================================ */
section('19) فشل كتابة جزئي أثناء تأكيد المحضر يتراجع بالكامل');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 20);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }]);
  const beforeDeviceCount = S.readTable_('الأجهزة').rows.length;
  const beforeBatchStatus = String(S.findById_('محاضر استلام الأجهزة', 'رقم المحضر', batchId)['الحالة']);
  const originalAppendObjects = S.appendObjects_;
  S.appendObjects_ = function (sheetName, objects) {
    if (sheetName === 'الأجهزة') throw new Error('فشل محاكى في إنشاء أجهزة المخزون');
    return originalAppendObjects.call(this, sheetName, objects);
  };
  let threw = false;
  try { confirmFullReceipt_(S, assocSession, batchId); }
  catch (error) { threw = /تعذّر إتمام تأكيد المحضر/.test(error.message); }
  finally { S.appendObjects_ = originalAppendObjects; }
  assert('فشل إنشاء الأجهزة (آخر كتابة): العملية تُرفض', threw === true);
  assert('لا أجهزة جديدة أُضيفت إطلاقًا', S.readTable_('الأجهزة').rows.length === beforeDeviceCount);
  assert('المحضر عاد لحالته السابقة "بانتظار تأكيد الجمعية"',
    String(S.findById_('محاضر استلام الأجهزة', 'رقم المحضر', batchId)['الحالة']) === beforeBatchStatus);
  const items = itemIdsOf_(S, batchId);
  assert('كميات البند عادت لحالتها السابقة (صفر)', Number(S.findById_('بنود محضر الاستلام', 'رقم البند', items['ثلاجة'])['الكمية السليمة']) === 0);
}

/* ================================================================
   20) فشل إثراء بعد commit يعيد نجاحًا مع refreshRequired
   ================================================================ */
section('20) فشل الإثراء بعد نجاح الكتابة الأساسية لا يُسقِط تأكيد المحضر');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 21);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }]);
  const originalDetail = S.receiptBatchDetail_;
  S.receiptBatchDetail_ = function () { throw new Error('فشل محاكى في بناء تفاصيل المحضر بعد نجاح التأكيد'); };
  let result = null;
  try { result = confirmFullReceipt_(S, assocSession, batchId); }
  finally { S.receiptBatchDetail_ = originalDetail; }
  assert('فشل الإثراء بعد نجاح التأكيد يُعيد ok:true وrefreshRequired:true', result && result.ok === true && result.refreshRequired === true);
  assert('البيانات الأساسية كُتبت فعليًا رغم فشل الإثراء (المحضر مؤكَّد فعلًا)',
    String(S.findById_('محاضر استلام الأجهزة', 'رقم المحضر', batchId)['الحالة']) === 'تم الاستلام كاملًا');
  assert('الأجهزة أُنشئت فعليًا رغم فشل الإثراء',
    S.readTable_('الأجهزة').rows.some(d => String(d['رقم بند الاستلام']) === itemIdsOf_(S, batchId)['ثلاجة']));
}

/* ================================================================
   21) Phase 3.1.1 القسم 1: لا يُنقل جهاز جاهز خطأً مع اعتبار مصدره مكتملًا
   ================================================================ */
section('21) لا يُنقل جهاز جاهز لمستفيد آخر ثم يُعتبر صاحبه الأصلي مكتملًا زورًا بالجهاز المتبقي وحده');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 21);
  const ahmad = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة', 'فرن'], 'أحمد قسم1');
  const saleh = newApprovedBeneficiary_(S, admin, assocSession, ['فرن', 'غسالة'], 'صالح قسم1');

  // أ لديه ثلاجة جاهزة ويحتاج فرنًا؛ ب لديه فرن جاهز ويحتاج غسالة — حالة ابتدائية مضبوطة مباشرة.
  seedReadyDevice_(S, assoc, ahmad.id, String(needRow(S, ahmad.id, 'ثلاجة')['رقم الاحتياج']), 'ثلاجة', '16 قدم');
  seedReadyDevice_(S, assoc, saleh.id, String(needRow(S, saleh.id, 'فرن')['رقم الاحتياج']), 'فرن', '5 شعلات');

  // تصل غسالة واحدة فقط.
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'غسالة', spec: 'أوتوماتيك 7 كجم', sentQty: 1 }]);
  confirmFullReceipt_(S, assocSession, batchId);

  const ahmadOvenNeed = needRow(S, ahmad.id, 'فرن');
  const salehOvenNeed = needRow(S, saleh.id, 'فرن');
  const salehWasherNeed = needRow(S, saleh.id, 'غسالة');

  assert('لم يُنقَل فرن صالح إلى أحمد — احتياج أحمد للفرن بقي بلا أي جهاز',
    ahmadOvenNeed['حالة التنفيذ'] !== 'جهاز جاهز' && ahmadOvenNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب');
  assert('فرن صالح بقي معه فعليًا (لم يُفكّ ربطه دون سبب)', salehOvenNeed['حالة التنفيذ'] === 'جهاز جاهز' || salehOvenNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب');
  assert('صالح لا يُعتبر مكتملًا إلا إذا كان فرنه فعليًا لا يزال معه (لا اكتمال زائف بجهاز منقول لغيره)',
    salehWasherNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب' || salehOvenNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب');
}

/* ================================================================
   22) Phase 3.1.1 القسم 2: تعظيم عدد الطلبيات المكتملة فعليًا
   ================================================================ */
section('22) تعظيم عدد الطلبيات المكتملة: يُفضَّل إكمال طلبيتين بدل طلبية واحدة عند تعارض الموارد');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 22);
  // المخزون: ثلاجة=1، فرن=2، غسالة=1.
  // أ: ثلاجة+غسالة | ب: ثلاجة+فرن | ج: فرن+غسالة.
  // النتيجة الصحيحة: اكتمال ب وج معًا (طلبيتان) لا أ وحده (طلبية واحدة).
  const a = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة', 'غسالة'], 'أ تعظيم');
  const b = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة', 'فرن'], 'ب تعظيم');
  const c = newApprovedBeneficiary_(S, admin, assocSession, ['فرن', 'غسالة'], 'ج تعظيم');

  const batchId = createSentBatch_(S, admin, assoc.id, [
    { deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 },
    { deviceType: 'فرن', spec: '5 شعلات', sentQty: 2 },
    { deviceType: 'غسالة', spec: 'أوتوماتيك 7 كجم', sentQty: 1 }
  ]);
  confirmFullReceipt_(S, assocSession, batchId);

  const bComplete = needRow(S, b.id, 'ثلاجة')['حالة التنفيذ'] === 'بانتظار تعيين مندوب' && needRow(S, b.id, 'فرن')['حالة التنفيذ'] === 'بانتظار تعيين مندوب';
  const cComplete = needRow(S, c.id, 'فرن')['حالة التنفيذ'] === 'بانتظار تعيين مندوب' && needRow(S, c.id, 'غسالة')['حالة التنفيذ'] === 'بانتظار تعيين مندوب';
  const aComplete = needRow(S, a.id, 'ثلاجة')['حالة التنفيذ'] === 'بانتظار تعيين مندوب' && needRow(S, a.id, 'غسالة')['حالة التنفيذ'] === 'بانتظار تعيين مندوب';

  assert('طلبية ب اكتملت بالكامل', bComplete);
  assert('طلبية ج اكتملت بالكامل', cComplete);
  assert('طلبية أ لم تكتمل (المخزون كان يكفي طلبيتين فقط من الثلاث)', !aComplete);
}

/* ================================================================
   23) Phase 3.1.1 القسم 3: تراجع الأجهزة حتى لو كُتبت فعليًا قبل الاستثناء
   ================================================================ */
section('23) استثناء بعد كتابة أجهزة المحضر فعليًا: لا يبقى أي جهاز، والمحضر/البنود تعود لحالتها السابقة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 23);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }]);
  const beforeDeviceCount = S.readTable_('الأجهزة').rows.length;
  const beforeBatchStatus = String(S.findById_('محاضر استلام الأجهزة', 'رقم المحضر', batchId)['الحالة']);
  const originalAppendObjects = S.appendObjects_;
  // محاكاة الحالة التي يحذّر منها الطلب صراحةً: appendObjects_ تكتب صفوف
  // الأجهزة فعليًا على الشيت (لا نفترض عدم الكتابة)، ثم يُرمى استثناء
  // بعدها مباشرة (يحاكي أي عطل لاحق ضمن نفس try) — التراجع يجب أن يحذف
  // هذه الصفوف الحقيقية المكتوبة فعلًا، لا أن يفترض عدم وجودها أصلًا.
  S.appendObjects_ = function (sheetName, objects) {
    const result = originalAppendObjects.call(this, sheetName, objects);
    if (sheetName === 'الأجهزة') throw new Error('عطل محاكى بعد كتابة الأجهزة فعليًا على الشيت');
    return result;
  };
  let threw = false;
  try { confirmFullReceipt_(S, assocSession, batchId); }
  catch (error) { threw = /تعذّر إتمام تأكيد المحضر/.test(error.message); }
  finally { S.appendObjects_ = originalAppendObjects; }
  assert('العملية تُرفض فعليًا', threw === true);
  assert('لا يبقى أي جهاز جديد — الصفوف المكتوبة فعليًا حُذفت في التراجع', S.readTable_('الأجهزة').rows.length === beforeDeviceCount);
  assert('المحضر عاد لحالته السابقة "بانتظار تأكيد الجمعية"',
    String(S.findById_('محاضر استلام الأجهزة', 'رقم المحضر', batchId)['الحالة']) === beforeBatchStatus);
  const items = itemIdsOf_(S, batchId);
  assert('كميات البند عادت لحالتها السابقة (صفر)', Number(S.findById_('بنود محضر الاستلام', 'رقم البند', items['ثلاجة'])['الكمية السليمة']) === 0);
}

/* ================================================================
   24) Phase 3.1.1 القسم 4: صورة واحدة تغطي صنفين تالفين معًا
   ================================================================ */
section('24) صورة تلف واحدة مرتبطة بصنفين تالفين معًا تغطيهما كليهما');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 24);
  const batchId = createSentBatch_(S, admin, assoc.id, [
    { deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }, { deviceType: 'فرن', spec: '5 شعلات', sentQty: 2 }
  ]);
  const items = itemIdsOf_(S, batchId);
  const result = S.confirmReceiptBatch(assocSession.token, {
    batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
    items: [
      { itemId: items['ثلاجة'], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' },
      { itemId: items['فرن'], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }
    ],
    damagePhotos: [{ itemIds: [items['ثلاجة'], items['فرن']], photo: pngDataUrl_() }]
  });
  assert('صورة واحدة تغطي صنفين تالفين تنجح', result.ok === true);
  const links = S.readTable_('صور تلف الاستلام').rows.filter(r => String(r['رقم المحضر']) === batchId);
  assert('صفّان مستقلان بمعرّف فريد لكل منهما (صف لكل ربط صورة↔بند)',
    links.length === 2 && String(links[0]['رقم الربط']) !== String(links[1]['رقم الربط']));
  assert('معرف الملف (fileId) نفسه مكرَّر بين الصفّين (نفس الصورة الفعلية)',
    String(links[0]['معرف الملف']) === String(links[1]['معرف الملف']) && !!String(links[0]['معرف الملف']));
  assert('كلا البندين مذكور ضمن صفوف الربط (ثلاجة وفرن معًا)',
    links.some(r => String(r['رقم البند']) === items['ثلاجة']) && links.some(r => String(r['رقم البند']) === items['فرن']));
}

/* ================================================================
   25) Phase 3.1.1 القسم 4: بند تالف بلا أي صورة تغطيه يُرفض
   ================================================================ */
section('25) بند يحمل كمية تالفة فعلية ولا تغطيه أي صورة تلف يُرفض قبل أي كتابة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 25);
  const batchId = createSentBatch_(S, admin, assoc.id, [
    { deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }, { deviceType: 'فرن', spec: '5 شعلات', sentQty: 2 }
  ]);
  const items = itemIdsOf_(S, batchId);
  const beforeDeviceCount = S.readTable_('الأجهزة').rows.length;
  throws('صورة تغطي بند الثلاجة فقط بينما الفرن أيضًا تالف بلا صورة تُرفض',
    () => S.confirmReceiptBatch(assocSession.token, {
      batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
      items: [
        { itemId: items['ثلاجة'], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' },
        { itemId: items['فرن'], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }
      ],
      damagePhotos: [{ itemIds: [items['ثلاجة']], photo: pngDataUrl_() }]
    }), 'بلا أي صورة تلف تغطيه');
  assert('لا أجهزة أُنشئت من محاولة مرفوضة', S.readTable_('الأجهزة').rows.length === beforeDeviceCount);
  assert('المحضر بقي بانتظار تأكيد الجمعية (لم يُلمَس)',
    String(S.findById_('محاضر استلام الأجهزة', 'رقم المحضر', batchId)['الحالة']) === 'بانتظار تأكيد الجمعية');
}

/* ================================================================
   26) Phase 3.1.1 القسم 6: توقيع حقيقي بصورة + endpoint إثباتات محروس
   ================================================================ */
section('26) التوقيع إثبات صورة حقيقي (لا نص)، وendpoint الإثباتات محروس بعزل الجمعية');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 26);
  const { assocSession: otherAssocSession } = seedAssociation(S, admin, 260);
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 }]);
  throws('توقيع نصي (لا صورة) يُرفض — signature النصية القديمة لم تعد كافية',
    () => S.confirmReceiptBatch(assocSession.token, {
      batchId: batchId, receiverTitle: 'مسؤول المستودع', signature: 'توقيع نصي قديم', quantityPhoto: pngDataUrl_()
    }), 'توقيع المستلم');
  const result = confirmFullReceipt_(S, assocSession, batchId);
  assert('التأكيد بصورة توقيع حقيقية ينجح', result.ok === true);
  const detail = S.receiptBatchDetail_(batchId);
  assert('hasSignature صحيح في تفاصيل المحضر', detail.hasSignature === true);
  assert('لا يوجد عمود "توقيع المستلم" النصي القديم في السجل الخام — فقط معرّف ملف',
    !!String(S.findById_('محاضر استلام الأجهزة', 'رقم المحضر', batchId)['معرف ملف توقيع المستلم']));

  const ownEvidence = S.getReceiptEvidenceImage(assocSession.token, batchId, 'signature');
  assert('الجمعية صاحبة المحضر تقرأ صورة توقيعها (data URL، لا رابط Drive عام)',
    ownEvidence.ok === true && /^data:image\//.test(ownEvidence.dataUrl));
  const quantityEvidence = S.getReceiptEvidenceImage(admin.token, batchId, 'quantity');
  assert('ADMIN يقرأ صورة الكمية العامة لأي محضر', quantityEvidence.ok === true && /^data:image\//.test(quantityEvidence.dataUrl));
  throws('جمعية أخرى لا تستطيع قراءة إثباتات محضر ليس لها',
    () => S.getReceiptEvidenceImage(otherAssocSession.token, batchId, 'signature'), 'صلاحية');
}

/* ================================================================
   27) Phase 3.1.1 القسم 5: تنظيف ملفات Drive عند فشل الرفع أو الكتابة قبل commit
   ================================================================ */
section('27) ملفات Drive المرفوعة تُنقَل للمهملات عند فشل العملية قبل commit، وتبقى بعد نجاحه');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 27);

  // أ) فشل رفع صورة لاحقة (صورة تلف) بعد نجاح صورة سابقة (الكمية+التوقيع) —
  // يجب نقل الصور الناجحة إلى المهملات.
  {
    const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }]);
    const items = itemIdsOf_(S, batchId);
    const before = S.__trashedFiles.size;
    const filesBeforeCount = Object.keys(S.__filesById).length;
    throws('فشل رفع صورة التلف بعد نجاح صورتي الكمية والتوقيع يُرفَض',
      () => S.confirmReceiptBatch(assocSession.token, {
        batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
        items: [{ itemId: items['ثلاجة'], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }],
        damagePhotos: [{ itemIds: [items['ثلاجة']], photo: 'data:image/png;base64,ليست-صورة-صالحة' }]
      }));
    const newFilesCount = Object.keys(S.__filesById).length - filesBeforeCount;
    assert('رُفعت صورتان فعليًا قبل فشل الصورة الثالثة (كمية + توقيع)', newFilesCount === 2);
    assert('كلا الملفين الناجحين نُقلا إلى المهملات بعد فشل الرفع الثالث', S.__trashedFiles.size === before + 2);
  }

  // ب) نجاح رفع كل الصور، ثم فشل كتابة الأجهزة (آخر كتابة) — يجب نقل كل الصور المرفوعة إلى المهملات أيضًا.
  {
    const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'فرن', spec: '5 شعلات', sentQty: 1 }]);
    const before = S.__trashedFiles.size;
    const filesBeforeCount = Object.keys(S.__filesById).length;
    const originalAppendObjects = S.appendObjects_;
    S.appendObjects_ = function (sheetName, objects) {
      if (sheetName === 'الأجهزة') throw new Error('فشل محاكى في إنشاء أجهزة المخزون');
      return originalAppendObjects.call(this, sheetName, objects);
    };
    try {
      throws('فشل كتابة الأجهزة بعد نجاح كل الرفع يُرفَض', () => confirmFullReceipt_(S, assocSession, batchId));
    } finally { S.appendObjects_ = originalAppendObjects; }
    const newFilesCount = Object.keys(S.__filesById).length - filesBeforeCount;
    assert('صورتان رُفعتا فعليًا (كمية + توقيع، بلا صور تلف هنا)', newFilesCount === 2);
    assert('كلا الملفين نُقلا إلى المهملات بعد فشل كتابة الأجهزة', S.__trashedFiles.size === before + 2);
  }

  // ج) نجاح كامل — لا يُنقَل أي ملف إلى المهملات إطلاقًا.
  {
    const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'غسالة', spec: 'أوتوماتيك 7 كجم', sentQty: 1 }]);
    const before = S.__trashedFiles.size;
    const result = confirmFullReceipt_(S, assocSession, batchId);
    assert('التأكيد الناجح يمر دون أي خطأ', result.ok === true);
    assert('لا مِلف واحد يُنقَل إلى المهملات بعد نجاح commit كامل', S.__trashedFiles.size === before);
  }
}

/* ================================================================
   28) Phase 3.1.1 القسم 7: إعادة تحقق نشاط الجمعية عند الإرسال والتأكيد والتخصيص
   ================================================================ */
section('28) جمعية تصبح غير نشطة بعد إنشاء المحضر: لا يُرسَل لها ولا يُؤكَّد ولا يُشغَّل لها تخصيص');
function deactivate_(S, admin, assoc) {
  S.saveAssociation(admin.token, {
    id: assoc.id, name: assoc.record.name, category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: assoc.record.phone, email: assoc.record.email, status: 'غير نشطة'
  });
}
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);

  // أ) تصبح غير نشطة بعد الإنشاء (مسودة) وقبل الإرسال.
  {
    const { assoc } = seedAssociation(S, admin, 281);
    const created = S.createReceiptBatch(admin.token, {
      associationId: assoc.id, supplierName: 'مورد', sentDate: '2026/01/01', items: [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 }]
    });
    deactivate_(S, admin, assoc);
    throws('إرسال محضر لجمعية أصبحت غير نشطة يُرفض', () => S.sendReceiptBatch(admin.token, created.id), 'غير نشطة');
  }

  // ب) تصبح غير نشطة بعد الإرسال وقبل التأكيد.
  {
    const { assoc, assocSession } = seedAssociation(S, admin, 282);
    const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'فرن', spec: '5 شعلات', sentQty: 1 }]);
    deactivate_(S, admin, assoc);
    throws('تأكيد محضر لجمعية أصبحت غير نشطة يُرفض', () => confirmFullReceipt_(S, assocSession, batchId), 'غير نشطة');
  }

  // ج) محرك التخصيص التلقائي لا يعمل لجمعية غير نشطة حتى لو اعتُمد احتياج مستفيدها.
  {
    const { assoc, assocSession } = seedAssociation(S, admin, 283);
    const beneficiary = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة'], 'مستفيد قسم7');
    const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 1 }]);
    // إتمام التأكيد أثناء نشاط الجمعية (مسموح)، ثم تعطيلها قبل اعتماد أي احتياج جديد يُشغِّل محاولة تخصيص لاحقة.
    confirmFullReceipt_(S, assocSession, batchId);
    const fridgeNeed = needRow(S, beneficiary.id, 'ثلاجة');
    assert('اكتمل التخصيص أثناء نشاط الجمعية كالمتوقع', fridgeNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب');

    const beneficiary2 = S.saveBeneficiary(assocSession.token, {
      deviceTypes: ['فرن'], name: 'مستفيد قسم7ب', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي',
      phone: nextPhone_(), familyCount: 2, socialStatus: 'أرملة', needs: []
    });
    deactivate_(S, admin, assoc);
    // اعتماد احتياج مستفيد جديد لجمعية غير نشطة الآن — يُشغَّل runAutoAllocation_ داخليًا
    // لكن يجب أن يتخطى الجمعية غير النشطة صامتًا بلا أي حركة أجهزة.
    approveBeneficiary_(S, admin, beneficiary2.id, ['فرن']);
    const ovenNeed2 = needRow(S, beneficiary2.id, 'فرن');
    assert('لا يُشغَّل تخصيص تلقائي لجمعية غير نشطة — الاحتياج الجديد يبقى بلا أي جهاز',
      ovenNeed2['حالة التنفيذ'] !== 'جهاز جاهز' && ovenNeed2['حالة التنفيذ'] !== 'بانتظار تعيين مندوب');
  }
}

/* ================================================================
   29) Phase 3.1.1 القسم 8: migrateReferenceData_ seeding إضافي idempotent
   ================================================================ */
section('29) migrateReferenceData_ يضيف الناقص فقط ولا يتوقف لوجود صفوف قديمة ولا يكرر عند إعادة التشغيل');
{
  const S = buildSandbox();
  seedSheets(S);
  const maintenanceToken = grantMaintenance_(S);
  const first = S.migrateReferenceData_(maintenanceToken);
  assert('التشغيل الأول يُدرج بذورًا فعلية', first.ok === true && first.inserted > 0);

  const rowsAfterFirst = S.readTable_('البيانات المرجعية').rows.length;
  const second = S.migrateReferenceData_(maintenanceToken);
  assert('التشغيل الثاني (الجدول ممتلئ بالفعل) لا يضيف أي شيء جديدًا — لا تكرار', second.inserted === 0);
  assert('عدد الصفوف لم يتغيّر بعد التشغيل الثاني', S.readTable_('البيانات المرجعية').rows.length === rowsAfterFirst);

  // إضافة صف "قديم" يدويًا (يحاكي بيانات قديمة موجودة مسبقًا) ثم تشغيل الترحيل: يجب ألا يتوقف، ويضيف الباقي الناقص فقط.
  S.appendObject_('البيانات المرجعية', {'المعرف': S.nextId_('REF'), 'النوع': 'CUSTOM_LEGACY', 'القيمة': 'قيمة قديمة يدوية', 'يتبع': '', 'الترتيب': 999, 'نشط': 'نعم'});
  const third = S.migrateReferenceData_(maintenanceToken);
  assert('وجود صف قديم غريب لا يوقف الترحيل — لا يزال يضيف الناقص (لا شيء هنا لأن البذور مكتملة أصلًا) بلا خطأ', third.ok === true);
}

/* ================================================================
   30) Phase 3.1.1 القسم 8: addReferenceValue محمي بقفل مع تحقق يتبع
   ================================================================ */
section('30) addReferenceValue: فحص التكرار وتوليد المعرف داخل نفس القفل، وتحقق صحة "يتبع" حسب النوع');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const maintenanceToken = grantMaintenance_(S);
  S.migrateReferenceData_(maintenanceToken);

  const addedSpec = S.addReferenceValue(admin.token, {type: 'DEVICE_SPEC', value: '12 قدم', parent: 'ثلاجة'});
  assert('DEVICE_SPEC بنوع جهاز صحيح (من الأنواع الثلاثة) ينجح', addedSpec.ok === true);
  throws('DEVICE_SPEC بنوع جهاز غير صالح (ليس من الثلاثة) يُرفض',
    () => S.addReferenceValue(admin.token, {type: 'DEVICE_SPEC', value: 'حجم غريب', parent: 'مكيف'}), 'نوع الجهاز');
  throws('DEVICE_SPEC بلا يتبع إطلاقًا يُرفض',
    () => S.addReferenceValue(admin.token, {type: 'DEVICE_SPEC', value: 'حجم آخر', parent: ''}), 'يتبع');

  const addedCity = S.addReferenceValue(admin.token, {type: 'CITY', value: 'مدينة اختبار جديدة', parent: 'الرياض'});
  assert('CITY بمنطقة موجودة فعلًا (يتبع صالح) ينجح', addedCity.ok === true);
  throws('CITY بمنطقة غير موجودة في القائمة المرجعية يُرفض',
    () => S.addReferenceValue(admin.token, {type: 'CITY', value: 'مدينة يتيمة', parent: 'منطقة غير موجودة أصلًا'}), 'غير موجودة');

  throws('نوع غير تابع (SUPPLIER) مع "يتبع" غير فارغة يُرفض',
    () => S.addReferenceValue(admin.token, {type: 'SUPPLIER', value: 'مورد جديد', parent: 'شيء ما'}), 'لا يقبل');
  const addedSupplier = S.addReferenceValue(admin.token, {type: 'SUPPLIER', value: 'مورد جديد بلا يتبع'});
  assert('SUPPLIER بلا "يتبع" ينجح', addedSupplier.ok === true);

  throws('قيمة مكرَّرة ضمن نفس النوع والتبعية تُرفض',
    () => S.addReferenceValue(admin.token, {type: 'DEVICE_SPEC', value: '12 قدم', parent: 'ثلاجة'}), 'موجودة بالفعل');

  const payload = {type: 'RECEIVER_TITLE', value: 'صفة اختبار opId', opId: 'op-ref-add-1'};
  const first = S.addReferenceValue(admin.token, payload);
  const second = S.addReferenceValue(admin.token, payload);
  assert('نفس opId يُعيد نفس المعرّف دون إنشاء صف جديد', first.id === second.id);
  const titleCount = S.readTable_('البيانات المرجعية').rows.filter(r => String(r['النوع']) === 'RECEIVER_TITLE' && String(r['القيمة']) === 'صفة اختبار opId').length;
  assert('صف واحد فقط أُنشئ فعليًا رغم تكرار opId', titleCount === 1);
}

/* ================================================================
   31) Phase 3.1.2 القسم 1-2: تعظيم عالمي واحد (مخزون حر + أجهزة جزئية معًا)
   ================================================================ */
section('31) الاختبار الإلزامي: أ(ثلاجة فقط) وب(فرن فقط) يكتملان، لا يُختار ج (المخصَّص له جزئيًا ثلاجة+فرن) كطلبية واحدة');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 31);

  const beneficiaryA = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة'], 'أ تعظيم عالمي');
  const beneficiaryB = newApprovedBeneficiary_(S, admin, assocSession, ['فرن'], 'ب تعظيم عالمي');
  const beneficiaryC = newApprovedBeneficiary_(S, admin, assocSession, ['ثلاجة', 'فرن', 'غسالة'], 'ج تعظيم عالمي');
  // ج مخصَّص له جزئيًا ثلاجة وفرن (جاهزان فعليًا)، ناقصه فقط الغسالة.
  seedReadyDevice_(S, assoc, beneficiaryC.id, String(needRow(S, beneficiaryC.id, 'ثلاجة')['رقم الاحتياج']), 'ثلاجة', '16 قدم');
  seedReadyDevice_(S, assoc, beneficiaryC.id, String(needRow(S, beneficiaryC.id, 'فرن')['رقم الاحتياج']), 'فرن', '5 شعلات');

  // مخزون حر: غسالة واحدة فقط — يُحفَّز محرك التخصيص عبر تأكيد محضر استلامها.
  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'غسالة', spec: 'أوتوماتيك 7 كجم', sentQty: 1 }]);
  confirmFullReceipt_(S, assocSession, batchId);

  const aFridgeNeed = needRow(S, beneficiaryA.id, 'ثلاجة');
  const bOvenNeed = needRow(S, beneficiaryB.id, 'فرن');
  const cFridgeNeed = needRow(S, beneficiaryC.id, 'ثلاجة');
  const cOvenNeed = needRow(S, beneficiaryC.id, 'فرن');
  const cWasherNeed = needRow(S, beneficiaryC.id, 'غسالة');

  assert('أ اكتمل (ثلاجته وصلت "بانتظار تعيين مندوب")', aFridgeNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب');
  assert('ب اكتمل (فرنه وصل "بانتظار تعيين مندوب")', bOvenNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب');
  assert('ج لم يُختَر كطلبية واحدة مكتملة — لا ثلاجة ولا فرن له وصلا "بانتظار تعيين مندوب" معًا',
    !(cFridgeNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب' && cOvenNeed['حالة التنفيذ'] === 'بانتظار تعيين مندوب'));
  assert('لا أحد من احتياجات ج الثلاثة وصل "بانتظار تعيين مندوب" (لم يكتمل إطلاقًا كمستفيد)',
    cFridgeNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب'
    && cOvenNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب'
    && cWasherNeed['حالة التنفيذ'] !== 'بانتظار تعيين مندوب');
  assert('الغسالة خُصِّصت جزئيًا لج بعد مرحلة الإكمال (جهاز جاهز، لا اكتمال)', cWasherNeed['حالة التنفيذ'] === 'جهاز جاهز');

  const devices = S.readTable_('الأجهزة').rows.filter(d => String(d['رقم الجمعية']) === assoc.id);
  const deviceIds = devices.map(d => String(d['رقم الجهاز']));
  assert('لا تكرار لأي رقم جهاز بين السجلات (لا خطط مكررة لنفس deviceId)', new Set(deviceIds).size === deviceIds.length);
  devices.forEach(d => {
    if (String(d['حالة الجهاز']) === 'مخصص') {
      assert('كل جهاز "مخصص" مرتبط فعليًا بمستفيد واحد بلا غموض (device ' + d['رقم الجهاز'] + ')', !!String(d['رقم المستفيد'] || ''));
    }
  });
  const needsAll = S.readTable_('احتياجات المستفيدين').rows.filter(n => String(n['رقم الجمعية']) === assoc.id);
  needsAll.forEach(n => {
    if (String(n['حالة التنفيذ']) === 'جهاز جاهز' || String(n['حالة التنفيذ']) === 'بانتظار تعيين مندوب') {
      const linked = devices.filter(d => String(d['رقم الاحتياج']) === String(n['رقم الاحتياج']));
      assert('لا حالة "جاهزة" بلا جهاز فعلي مرتبط (احتياج ' + n['رقم الاحتياج'] + ')', linked.length === 1);
    }
  });
}

/* ================================================================
   32) Phase 3.1.2 القسم 3: معرّفات ربط صور التلف الآمنة (linkId)
   ================================================================ */
section('32) تفاصيل المحضر تعيد linkId آمنًا لكل صورة تلف، وgetReceiptEvidenceImage يعمل بها مع عزل صارم');
{
  const S = buildSandbox();
  seedSheets(S);
  const admin = adminSession(S);
  const { assoc, assocSession } = seedAssociation(S, admin, 32);
  const { assocSession: otherAssocSession } = seedAssociation(S, admin, 320);

  const batchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'ثلاجة', spec: '16 قدم', sentQty: 2 }]);
  const items = itemIdsOf_(S, batchId);
  S.confirmReceiptBatch(assocSession.token, {
    batchId: batchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
    items: [{ itemId: items['ثلاجة'], receivedQty: 1, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }],
    damagePhotos: [{ itemIds: [items['ثلاجة']], photo: pngDataUrl_() }]
  });

  const detail = S.receiptBatchDetail_(batchId);
  const fridgeItem = detail.items.find(it => it.deviceType === 'ثلاجة');
  assert('تفاصيل المحضر تعيد linkId واحدًا على الأقل لبند الثلاجة التالف', fridgeItem.damagePhotos.length === 1 && !!fridgeItem.damagePhotos[0].linkId);
  assert('لا fileId ولا رابط Drive في استجابة التفاصيل إطلاقًا', JSON.stringify(detail).indexOf('FILE-') === -1 && JSON.stringify(detail).indexOf('drive.example') === -1);
  const linkId = fridgeItem.damagePhotos[0].linkId;

  const evidence = S.getReceiptEvidenceImage(assocSession.token, batchId, 'damage', linkId);
  assert('getReceiptEvidenceImage يعمل باستخدام linkId المعاد من التفاصيل', evidence.ok === true && /^data:image\//.test(evidence.dataUrl));

  // محضر آخر لجمعية أخرى — نتحقق أن linkId المحضر الأول مرفوض على المحضر الثاني.
  const otherBatchId = createSentBatch_(S, admin, assoc.id, [{ deviceType: 'فرن', spec: '5 شعلات', sentQty: 1 }]);
  const otherItems = itemIdsOf_(S, otherBatchId);
  S.confirmReceiptBatch(assocSession.token, {
    batchId: otherBatchId, receiverTitle: 'مسؤول المستودع', signatureImage: pngDataUrl_(), quantityPhoto: pngDataUrl_(),
    items: [{ itemId: otherItems['فرن'], receivedQty: 0, damagedQty: 1, missingQty: 0, differenceReason: 'تلف أثناء الشحن' }],
    damagePhotos: [{ itemIds: [otherItems['فرن']], photo: pngDataUrl_() }]
  });
  throws('linkId تابع لمحضر آخر يُرفض عند طلبه ضمن محضر مختلف',
    () => S.getReceiptEvidenceImage(assocSession.token, otherBatchId, 'damage', linkId), 'غير تابعة');

  throws('جمعية أخرى لا تستطيع عرض صورة تلف تخص محضر جمعية أخرى (حتى بمعرّف ربط صحيح)',
    () => S.getReceiptEvidenceImage(otherAssocSession.token, batchId, 'damage', linkId), 'صلاحية');
}

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
