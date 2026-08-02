#!/usr/bin/env node
/**
 * اختبارات سلامة الحالات والترابط: المستفيد ↔ الأجهزة ↔ التسليم ↔ المندوب.
 * يغطي كل انتقال مسموح ومرفوض حسب القواعد المركزية في StateRules.gs،
 * ويتحقق أن العمليات لا تترك حالة جزئية غير متّسقة عند رفضها، وأن أداة
 * التشخيص diagnoseStateIntegrity()/الإصلاح repairStateIntegrityIssues()
 * تعملان بشكل صحيح (تُستدعيان هنا داخل بيئة محاكاة في الذاكرة فقط —
 * هذا لا يُشغِّل أي شيء على أي بيانات حية، ولا علاقة له بتشغيلهما من
 * محرر Apps Script على مشروع حقيقي).
 *
 *   تشغيل:  node tools/state-test.js
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

/* -------- بيئة محاكاة (مطابقة لتلك المستخدَمة في server-test.js/security-test.js) -------- */

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
    ScriptApp: { getScriptId: () => 'state-test', getOAuthToken: () => 'token' },
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
  vm.runInContext(source, sandbox, { filename: 'gs-merged(state)' });
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
  return S.createSession_({ id: 'USR-ADMIN-ST', name: 'مدير الاختبار', role: 'ADMIN', associationId: '' });
}

/** يبني بيئة كاملة: جمعية + مندوب نشط + مستفيد + جهاز واحد "بالمستودع". */
function seedScenario(S) {
  seedSheets(S);
  const admin = adminSession(S);
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية الحالات', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000010', email: 'state-assoc@example.org', password: 'StatePass123'
  });
  const assocSession = S.createSession_({ id: 'USR-ASSOC-ST', name: 'جمعية الحالات', role: 'ASSOCIATION', associationId: assoc.id });
  const delegateResult = S.saveDelegate(assocSession.token, { name: 'مندوب الحالات', phone: '0500000011' });
  S.updateById_('المناديب', 'رقم المندوب', delegateResult.id, {}); // no-op touch, keeps pattern consistent
  const beneficiary = S.saveBeneficiary(assocSession.token, {
    name: 'مستفيد الحالات', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0500000012', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة'],
    lat: '24.7', lng: '46.6'
  });
  const device = S.saveDevice(admin.token, {
    name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id
  });
  return { S, admin, assoc, assocSession, delegateId: delegateResult.id, beneficiaryId: beneficiary.id, deviceId: device.id };
}

function deviceRow(S, deviceId) { return S.findById_('الأجهزة', 'رقم الجهاز', deviceId); }
function beneficiaryRow(S, beneficiaryId) { return S.findById_('المستفيدون', 'رقم المستفيد', beneficiaryId); }

/* ================================================================
   1) وحدة قواعد الانتقال (assertDeviceTransition_/assertDeliveryTransition_)
   ================================================================ */

section('1) قواعد الانتقال المركزية — كل زوج مسموح ومرفوض');
{
  const S = buildSandbox();
  // مسموح
  assert('بالمستودع ← مخصص', S.assertDeviceTransition_('بالمستودع', 'مخصص') === true);
  assert('مخصص ← مع المندوب', S.assertDeviceTransition_('مخصص', 'مع المندوب') === true);
  assert('مع المندوب ← تم التسليم', S.assertDeviceTransition_('مع المندوب', 'تم التسليم') === true);
  assert('مخصص ← بالمستودع (إرجاع للمستودع)', S.assertDeviceTransition_('مخصص', 'بالمستودع') === true);
  assert('أي حالة ← تالف', S.assertDeviceTransition_('مخصص', 'تالف') === true);
  assert('جهاز جديد بلا حالة سابقة ← أي حالة صالحة', S.assertDeviceTransition_('', 'مخصص') === true);
  // مرفوض
  throws('بالمستودع ← تم التسليم مباشرة (تجاوز مراحل)', () => S.assertDeviceTransition_('بالمستودع', 'تم التسليم'), 'غير مسموح');
  throws('بالمستودع ← مع المندوب مباشرة (تجاوز التخصيص)', () => S.assertDeviceTransition_('بالمستودع', 'مع المندوب'), 'غير مسموح');
  throws('تم التسليم ← أي حالة أخرى (نهائية)', () => S.assertDeviceTransition_('تم التسليم', 'مخصص'), 'غير مسموح');
  throws('تم التسليم ← تم التسليم (رفض إعادة تأكيد حالة مكتملة)', () => S.assertDeviceTransition_('تم التسليم', 'تم التسليم'), 'غير مسموح');
  throws('حالة جهاز فاسدة غير معروفة كأصل', () => S.assertDeviceTransition_('حالة وهمية', 'مخصص'), 'غير معروفة');
  throws('حالة جهاز فاسدة كهدف', () => S.assertDeviceTransition_('بالمستودع', 'حالة وهمية'), 'غير معروفة');

  // حالة التسليم
  assert('لم يبدأ ← جاري التجهيز', S.assertDeliveryTransition_('لم يبدأ', 'جاري التجهيز') === true);
  assert('جاري التجهيز ← خرج مع المندوب', S.assertDeliveryTransition_('جاري التجهيز', 'خرج مع المندوب') === true);
  assert('خرج مع المندوب ← تم التسليم', S.assertDeliveryTransition_('خرج مع المندوب', 'تم التسليم') === true);
  assert('خرج مع المندوب ← تعذر التسليم', S.assertDeliveryTransition_('خرج مع المندوب', 'تعذر التسليم') === true);
  assert('تعذر التسليم ← خرج مع المندوب (إعادة محاولة)', S.assertDeliveryTransition_('تعذر التسليم', 'خرج مع المندوب') === true);
  throws('لم يبدأ ← تم التسليم مباشرة', () => S.assertDeliveryTransition_('لم يبدأ', 'تم التسليم'), 'غير مسموح');
  throws('لم يبدأ ← تعذر التسليم مباشرة (لم يخرج أصلًا)', () => S.assertDeliveryTransition_('لم يبدأ', 'تعذر التسليم'), 'غير مسموح');
  throws('تم التسليم ← تم التسليم (رفض إعادة تأكيد)', () => S.assertDeliveryTransition_('تم التسليم', 'تم التسليم'), 'غير مسموح');
  throws('تم التسليم ← تعذر التسليم', () => S.assertDeliveryTransition_('تم التسليم', 'تعذر التسليم'), 'غير مسموح');
}

/* ================================================================
   2) الدورة الكاملة عبر الدوال الفعلية: تخصيص → خروج مع مندوب → تسليم
   ================================================================ */

section('2) الدورة الكاملة الناجحة: تخصيص → خروج مع مندوب → تسليم');
{
  const ctx = seedScenario(buildSandbox());
  const { S, assocSession, beneficiaryId, deviceId, delegateId } = ctx;

  assert('الجهاز عند إضافته لمستفيد بلا تحديد حالة صريحة يصبح "مخصص" تلقائيًا', (() => {
    const d = S.saveDevice(ctx.admin.token, { id: deviceId, name: 'ثلاجة', type: 'ثلاجة', associationId: ctx.assoc.id, beneficiaryId: beneficiaryId });
    return d.ok && String(deviceRow(S, deviceId)['حالة الجهاز']) === 'مخصص';
  })());

  const delegateSession = S.createSession_({ id: delegateId, name: 'مندوب الحالات', role: 'DELEGATE', associationId: ctx.assoc.id });

  assert('تعيين المندوب ينجح ويحوّل الجهاز إلى "مع المندوب" وحالة التسليم إلى "خرج مع المندوب"', (() => {
    const result = S.assignDelegate(assocSession.token, beneficiaryId, delegateId);
    const b = beneficiaryRow(S, beneficiaryId);
    const d = deviceRow(S, deviceId);
    return result.ok
      && String(b['حالة التسليم']) === 'خرج مع المندوب'
      && String(b['حالة المستفيد']) === 'جاري التسليم'
      && String(d['حالة الجهاز']) === 'مع المندوب';
  })());

  assert('تأكيد التسليم ينجح ويحوّل المستفيد وجميع أجهزته إلى "تم التسليم" كوحدة واحدة', (() => {
    const result = S.confirmDelivery(delegateSession.token, {
      beneficiaryId: beneficiaryId, confirmed: true, proofDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    });
    const b = beneficiaryRow(S, beneficiaryId);
    const d = deviceRow(S, deviceId);
    return result.ok
      && String(b['حالة التسليم']) === 'تم التسليم'
      && String(b['حالة المستفيد']) === 'تم التسليم'
      && String(d['حالة الجهاز']) === 'تم التسليم'
      && !!d['تاريخ التسليم'];
  })());

  throws('إعادة تأكيد تسليم مكتمل بالفعل تُرفض (لا تُقبل كعملية بلا أثر)', () =>
    S.confirmDelivery(delegateSession.token, { beneficiaryId: beneficiaryId, confirmed: true, proofDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }),
    'لا توجد أجهزة');

  const deliveries = S.readTable_('التسليمات').rows.filter(r => String(r['رقم المستفيد']) === beneficiaryId);
  assert('سجل تسليم واحد فقط أُضيف رغم محاولة إعادة التأكيد المرفوضة', deliveries.length === 1 && deliveries[0]['الحالة'] === 'تم التسليم');
}

/* ================================================================
   3) مسار التعذر ثم إعادة المحاولة
   ================================================================ */

section('3) تعذر التسليم ثم إعادة المحاولة بنجاح');
{
  const ctx = seedScenario(buildSandbox());
  const { S, assocSession, beneficiaryId, deviceId, delegateId, assoc } = ctx;
  S.saveDevice(ctx.admin.token, { id: deviceId, name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiaryId });
  S.assignDelegate(assocSession.token, beneficiaryId, delegateId);
  const delegateSession = S.createSession_({ id: delegateId, name: 'مندوب الحالات', role: 'DELEGATE', associationId: assoc.id });

  assert('تعذر التسليم ينجح ويُبقي الجهاز "مع المندوب" (لا يتحول لتم التسليم)', (() => {
    const result = S.updateDeliveryStatus(delegateSession.token, beneficiaryId, 'لا يرد', 'حاولت مرتين');
    const b = beneficiaryRow(S, beneficiaryId);
    const d = deviceRow(S, deviceId);
    return result.ok && String(b['حالة التسليم']) === 'تعذر التسليم' && String(d['حالة الجهاز']) === 'مع المندوب';
  })());

  assert('إعادة تعيين مندوب بعد التعذر تنجح (لا تكسر الأجهزة الموجودة أصلًا مع المندوب)', (() => {
    const result = S.assignDelegate(assocSession.token, beneficiaryId, delegateId);
    const b = beneficiaryRow(S, beneficiaryId);
    return result.ok && String(b['حالة التسليم']) === 'خرج مع المندوب';
  })());

  assert('تأكيد التسليم بعد إعادة المحاولة ينجح', (() => {
    const result = S.confirmDelivery(delegateSession.token, {
      beneficiaryId: beneficiaryId, confirmed: true, proofDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    });
    return result.ok && String(beneficiaryRow(S, beneficiaryId)['حالة التسليم']) === 'تم التسليم';
  })());
}

/* ================================================================
   4) انتقالات مرفوضة عبر الدوال الفعلية (لا الوحدة المجرَّدة فقط)
   ================================================================ */

section('4) رفض الانتقالات غير الصحيحة عبر الدوال الفعلية');
{
  const ctx = seedScenario(buildSandbox());
  const { S, assocSession, beneficiaryId, delegateId, assoc } = ctx;

  throws('تعيين مندوب لمستفيد بلا أي جهاز مخصَّص يُرفض', () =>
    S.assignDelegate(assocSession.token, beneficiaryId, delegateId), 'لا توجد أجهزة مخصَّصة');

  const beforeAssign = beneficiaryRow(S, beneficiaryId);
  assert('رفض تعيين المندوب لا يترك أي أثر جزئي على سجل المستفيد', String(beforeAssign['حالة التسليم']) === 'لم يبدأ' && !beforeAssign['رقم المندوب']);

  // بما أن تعيين المندوب فشل أعلاه، لم يُربط المندوب فعليًا بالمستفيد بعد؛
  // فحص الصلاحية (المستفيد يخص هذا المندوب؟) يرفض أولًا، وهذا صحيح ومتوقع:
  // لا يمكن أصلًا الوصول لفحص انتقال الحالة قبل أن يملك المندوب صلاحية العرض.
  const delegateSession = S.createSession_({ id: delegateId, name: 'مندوب الحالات', role: 'DELEGATE', associationId: assoc.id });
  throws('تأكيد تسليم لمستفيد لم يُعيَّن له هذا المندوب أصلًا يُرفض', () =>
    S.confirmDelivery(delegateSession.token, { beneficiaryId: beneficiaryId, confirmed: true, proofDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }),
    'غير متاح لك');

  throws('تسجيل تعذّر تسليم لمستفيد لم يُعيَّن له هذا المندوب أصلًا يُرفض', () =>
    S.updateDeliveryStatus(delegateSession.token, beneficiaryId, 'لا يرد', ''), 'غير متاح لك');
}

section('5) منع تخصيص جهاز نشط لمستفيد آخر دون تحريره أولًا');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId, deviceId, assoc } = ctx;
  S.saveDevice(admin.token, { id: deviceId, name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: beneficiaryId });

  const otherBeneficiary = S.saveBeneficiary(assocSession.token, {
    name: 'مستفيد آخر', region: 'الرياض', city: 'الرياض', address: 'حي آخر', district: 'حي آخر',
    phone: '0500000099', familyCount: 1, socialStatus: 'أرملة', needs: []
  });

  throws('محاولة تخصيص جهاز "مخصص" أصلًا لمستفيد مختلف تُرفض دون تحريره', () =>
    S.saveDevice(admin.token, { id: deviceId, name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: otherBeneficiary.id }),
    'أعده إلى المستودع أولًا');

  assert('الجهاز يبقى مرتبطًا بالمستفيد الأصلي دون تغيير بعد الرفض', String(deviceRow(S, deviceId)['رقم المستفيد']) === beneficiaryId);

  assert('تحرير الجهاز للمستودع أولًا ثم تخصيصه لمستفيد آخر يُقبل', (() => {
    S.saveDevice(admin.token, { id: deviceId, name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: '', status: 'بالمستودع' });
    const freed = deviceRow(S, deviceId);
    if (String(freed['حالة الجهاز']) !== 'بالمستودع' || freed['رقم المستفيد']) return false;
    S.saveDevice(admin.token, { id: deviceId, name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: otherBeneficiary.id });
    const reassigned = deviceRow(S, deviceId);
    return String(reassigned['حالة الجهاز']) === 'مخصص' && String(reassigned['رقم المستفيد']) === otherBeneficiary.id;
  })());
}

section('6) منع ضبط "مع المندوب"/"تم التسليم" يدويًا من نموذج الأجهزة');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, deviceId, assoc } = ctx;
  throws('ضبط حالة "مع المندوب" مباشرة من saveDevice يُرفض', () =>
    S.saveDevice(admin.token, { id: deviceId, name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, status: 'مع المندوب' }),
    'لا يمكن ضبط حالة');
  throws('ضبط حالة "تم التسليم" مباشرة من saveDevice يُرفض', () =>
    S.saveDevice(admin.token, { id: deviceId, name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, status: 'تم التسليم' }),
    'لا يمكن ضبط حالة');
  assert('تعديل حقل آخر (الاسم) بلا تغيير الحالة الفعلية لا يُرفض حتى لو الحالة نهائية لاحقًا', (() => {
    // نتأكد أولًا أن تعديل جهاز "بالمستودع" بحالة غير مُرسلة (نفس القيمة) يمر بأمان
    const result = S.saveDevice(admin.token, { id: deviceId, name: 'ثلاجة مجدَّدة', type: 'ثلاجة', associationId: assoc.id, status: 'بالمستودع' });
    return result.ok && String(deviceRow(S, deviceId)['اسم الجهاز']) === 'ثلاجة مجدَّدة';
  })());
}

/* ================================================================
   7) التشخيص القرائي (diagnoseStateIntegrity) والإصلاح المُجهَّز
   ================================================================ */

section('7) تشخيص سلامة الحالات (قراءة فقط) والإصلاح المُجهَّز');
{
  const ctx = seedScenario(buildSandbox());
  const { S, admin, assocSession, beneficiaryId, deviceId, delegateId, assoc } = ctx;

  throws('diagnoseStateIntegrity_ ترفض العمل بلا أي رمز ممنوح أصلًا', () => S.diagnoseStateIntegrity_(), 'مقفل');
  throws('repairStateIntegrityIssues_ ترفض العمل بلا أي رمز ممنوح أصلًا', () => S.repairStateIntegrityIssues_(), 'مقفل');

  const maintToken = grantToken_(S);
  throws('diagnoseStateIntegrity_ ترفض رمزًا خاطئًا حتى بعد منح رمز صحيح', () => S.diagnoseStateIntegrity_('رمز-خاطئ'), 'غير صحيح');

  const cleanReport = S.diagnoseStateIntegrity_(maintToken);
  assert('بيئة سليمة تمامًا تُنتج تقريرًا بلا أي تعارض', cleanReport.ok === true && cleanReport.issueCount === 0);
  assert('diagnoseStateIntegrity_ لا تكتب أي شيء (قراءة فقط) — التحقق بمقارنة نفس البيانات بعد الاستدعاء', (() => {
    const before = JSON.stringify(S.readTable_('الأجهزة').rows);
    S.diagnoseStateIntegrity_(maintToken);
    const after = JSON.stringify(S.readTable_('الأجهزة').rows);
    return before === after;
  })());

  // إفساد متعمَّد يحاكي تعديلًا يدويًا سابقًا من داخل الشيت مباشرة (تجاوز الدوال الآمنة)
  S.updateById_('الأجهزة', 'رقم الجهاز', deviceId, {'رقم المستفيد': beneficiaryId, 'حالة الجهاز': 'بالمستودع'});
  const afterCorruption1 = S.diagnoseStateIntegrity_(maintToken);
  assert('التشخيص يكتشف جهازًا مرتبطًا بمستفيد لكن حالته "بالمستودع"',
    afterCorruption1.issues.some(x => x.type === 'DEVICE_ASSIGNED_BUT_WAREHOUSE' && x.deviceId === deviceId));

  const otherDevice = S.saveDevice(admin.token, { name: 'غسالة', type: 'ثلاجة', associationId: assoc.id });
  S.updateById_('الأجهزة', 'رقم الجهاز', otherDevice.id, {'رقم المستفيد': 'BEN-999999', 'حالة الجهاز': 'مخصص'});
  const afterCorruption2 = S.diagnoseStateIntegrity_(maintToken);
  assert('التشخيص يكتشف جهازًا يشير إلى مستفيد غير موجود',
    afterCorruption2.issues.some(x => x.type === 'DEVICE_UNKNOWN_BENEFICIARY' && x.deviceId === otherDevice.id));

  const thirdDevice = S.saveDevice(admin.token, { name: 'مكيف', type: 'ثلاجة', associationId: assoc.id });
  S.updateById_('الأجهزة', 'رقم الجهاز', thirdDevice.id, {'حالة الجهاز': 'مخصص'}); // مخصص بلا رقم مستفيد إطلاقًا
  const afterCorruption3 = S.diagnoseStateIntegrity_(maintToken);
  assert('التشخيص يكتشف جهازًا بحالة "مخصص" بلا رقم مستفيد (حالة يتيمة)',
    afterCorruption3.issues.some(x => x.type === 'DEVICE_ORPHAN_STATUS' && x.deviceId === thirdDevice.id));

  const repairResult = S.repairStateIntegrityIssues_(maintToken);
  assert('الإصلاح المُجهَّز يُصلح الحالات الآمنة الثلاث المُكتشَفة', repairResult.fixedCount >= 3);
  const afterRepair = S.diagnoseStateIntegrity_(maintToken);
  assert('بعد الإصلاح: لا تبقى مشكلات DEVICE_ASSIGNED_BUT_WAREHOUSE/DEVICE_UNKNOWN_BENEFICIARY/DEVICE_ORPHAN_STATUS',
    !afterRepair.issues.some(x => ['DEVICE_ASSIGNED_BUT_WAREHOUSE', 'DEVICE_UNKNOWN_BENEFICIARY', 'DEVICE_ORPHAN_STATUS'].indexOf(x.type) >= 0));
  assert('repairStateIntegrityIssues_ غير مُستدعاة من أي دالة أخرى في المصدر (لن تعمل تلقائيًا أبدًا)', (() => {
    const callSites = (source.match(/repairStateIntegrityIssues_\(/g) || []).length;
    return callSites === 1; // التعريف نفسه فقط، لا أي استدعاء آخر
  })());
}

/* ================================================================
   8) التحقق من جميع مسارات التعديل تستخدم القواعد نفسها
   ================================================================ */

section('8) اتساق القواعد عبر كل المسارات (فحص ثابت من الكود)');
{
  ['assignDelegate', 'confirmDelivery', 'updateDeliveryStatus'].forEach(fnName => {
    const body = extractFunctionBody_(source, fnName);
    assert(fnName + ' يستخدم assertDeliveryTransition_ (لا يكتب حالة التسليم مباشرة بلا تحقق)',
      !!body && /assertDeliveryTransition_\(/.test(body));
  });
  assert('saveDevice يستخدم assertDeviceTransition_', /assertDeviceTransition_\(/.test(extractFunctionBody_(source, 'saveDevice') || ''));
  assert('assignDelegate يستخدم assertDeviceTransition_ (لأجهزة المستفيد أيضًا لا حالة التسليم فقط)',
    /assertDeviceTransition_\(/.test(extractFunctionBody_(source, 'assignDelegate') || ''));
  assert('importBeneficiaries لا يكتب أي حالة جهاز أو تسليم (لا يتجاوز قواعد الحالة، يُنشئ سجلات جديدة فقط)',
    !/importBeneficiaries[\s\S]{0,3000}?'حالة الجهاز'/.test(source));
}

/**
 * يستخرج جسم دالة بمطابقة الأقواس، ويتبع مستوى واحدًا من التفويض إلى
 * دالة مساعدة بنفس الاسم مع شرطة سفلية (نمط شائع الآن: الدالة المُصدَّرة
 * غلاف رقيق حول perfTime_/withIdempotency_ يستدعي fnName_ الفعلية).
 */
function extractFunctionBody_(source, fnName) {
  const start = source.indexOf('function ' + fnName + '(');
  if (start === -1) return null;
  let depth = 0, i = source.indexOf('{', start), end = -1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  let body = source.slice(start, end + 1);
  if (new RegExp(fnName + '_\\(').test(body)) {
    const helperBody = extractFunctionBody_(source, fnName + '_');
    if (helperBody) body += helperBody;
  }
  return body;
}

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
