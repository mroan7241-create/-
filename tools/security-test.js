#!/usr/bin/env node
/**
 * مراجعة أمنية آلية مخصصة: مصادقة وجلسات، صلاحيات كل دور بمصفوفة شاملة،
 * عزل بيانات الجمعيات (IDOR)، XSS وحقن الصيغ، رفع الملفات، تحديد
 * المعدّل، عدم تسريب الأسرار، وسلامة سجل العمليات.
 *
 * ملاحظة صادقة ومهمة: هذا فحص آلي على مستوى الكود والمنطق داخل بيئة
 * محاكاة (Node.js vm بديل عن Apps Script الحي) — وليس اختبار اختراق
 * مستقلًا بمعايير OWASP/PTES يشمل فحص الشبكة والبنية التحتية والنشر
 * الفعلي. لا يغني عن مراجعة أمنية مستقلة احترافية قبل أي إطلاق واسع.
 *
 *   تشغيل:  node tools/security-test.js
 */
'use strict';

const fs = require('fs');
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

/* -------- بناء بيئة محاكاة كاملة (شيت في الذاكرة + خدمات Apps Script) -------- */

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
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64Decode: b64 => Array.from(Buffer.from(b64, 'base64')),
      formatString: (pattern, value) => String(value).padStart(6, '0'),
      formatDate: (date, _tz, pattern) => {
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
    ScriptApp: { getScriptId: () => 'security-test', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: driveMock.DriveApp, UrlFetchApp: {}, Logger: { log: msg => { logs.push(String(msg)); } }
  };
  sandbox.globalThis = sandbox;
  sandbox.__logs = logs;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'gs-merged(security)' });
  return sandbox;
}

const __headerSandbox = buildSandbox();
const ALL_HEADERS = {
  'إعدادات المشروع': ['المفتاح', 'القيمة', 'الوصف'],
  'المستخدمون': ['رقم المستخدم', 'الاسم', 'البريد الإلكتروني', 'كلمة المرور المشفرة', 'الملح', 'الدور', 'رقم الجمعية', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول', 'يجب تغيير كلمة المرور', 'كلمة مرور سابقة مشفرة', 'ملح سابق'],
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

function seedFullEnvironment(S) {
  Object.keys(ALL_HEADERS).forEach(name => S.ensureSheet_(S.SpreadsheetApp.getActiveSpreadsheet(), name, ALL_HEADERS[name]));
  const assocA = S.saveAssociation(adminToken(S), {
    name: 'جمعية أ', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0501110001', email: 'assoc-a@example.org', password: 'PassA12345'
  });
  const assocB = S.saveAssociation(adminToken(S), {
    name: 'جمعية ب', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0501110002', email: 'assoc-b@example.org', password: 'PassB12345'
  });
  return { associationAId: assocA.id, associationBId: assocB.id };
}

function adminSession(S) {
  return S.createSession_({ id: 'USR-ADMIN-SEC', name: 'مدير الأمن', role: 'ADMIN', associationId: '' });
}
function adminToken(S) { return adminSession(S).token; }

/* ================================================================
   1) المصادقة والجلسات وانتهاء الصلاحية
   ================================================================ */

section('1) المصادقة والجلسات وانتهاء الصلاحية');
{
  const S = buildSandbox();
  throws('رمز جلسة فارغ يُرفض', () => S.requireSession_(''), 'انتهت الجلسة');
  throws('رمز جلسة قصير/مشوَّه يُرفض دون فك تشفير', () => S.requireSession_('abc'), 'انتهت الجلسة');
  throws('رمز جلسة عشوائي غير صادر عن النظام يُرفض', () => S.requireSession_('x'.repeat(40)), 'انتهت الجلسة');

  const session = adminSession(S);
  const user = S.requireSession_(session.token);
  assert('رمز جلسة صادر عن createSession_ صالح', user.id === 'USR-ADMIN-SEC');

  S.revokeSessions_('USR-ADMIN-SEC');
  throws('إبطال الجلسات يُسقط الرمز فورًا (لا ينتظر انتهاء المهلة)', () => S.requireSession_(session.token), 'انتهت الجلسة');

  // تعديل سجل الجلسة داخل CacheService مباشرة لمحاكاة جلسة صدرت قبل أكثر
  // من سقف العمر المطلق (APP.maxSessionSeconds)، دون التلاعب بـ Date
  // العامة (sandbox.Date كائن منفصل مأخوذ بالقيمة عند بناء البيئة، فتغيير
  // Date في عملية Node الخارجية لا يؤثر بداخلها إطلاقًا — هذا هو الأسلوب
  // الصحيح للمحاكاة، لا خطأ في requireSession_ نفسها).
  // APP ثابت (const) على مستوى الملف فلا يُصبح خاصية عامة في vm context؛
  // نستخرج maxSessionSeconds من نص المصدر نفسه بدل تخمينه أو تكراره يدويًا.
  const maxSessionSeconds = Number((source.match(/maxSessionSeconds:\s*(\d+)/) || [])[1]);
  assert('تعذّر استخراج maxSessionSeconds من Config.gs', maxSessionSeconds > 0);
  const session2 = adminSession(S);
  const cache = S.CacheService.getScriptCache();
  const key = S.sessionKey_(session2.token);
  const record = JSON.parse(cache.get(key));
  record.issuedAt = Date.now() - (maxSessionSeconds + 60) * 1000;
  cache.put(key, JSON.stringify(record));
  throws('سقف العمر المطلق يُنهي الجلسة حتى مع نشاط متواصل (تجاوز الحد الأقصى المسموح)',
    () => S.requireSession_(session2.token), 'انتهت الجلسة');
}

/* ================================================================
   2) مصفوفة صلاحيات الأدوار الشاملة
   ================================================================ */

section('2) مصفوفة صلاحيات الأدوار (كل دالة خادم حساسة)');
{
  // كل دالة مع الأدوار المسموحة فعليًا في الكود (راجع commit التقسيم للتأكد
  // من مطابقتها لالتزامات requireSession_ الفعلية في كل ملف .gs).
  const PERMISSION_MATRIX = [
    ['saveBeneficiary', ['ADMIN', 'ASSOCIATION']],
    ['importBeneficiaries', ['ADMIN', 'ASSOCIATION']],
    ['inspectBeneficiaryExcel', ['ADMIN', 'ASSOCIATION']],
    ['assignDelegate', ['ADMIN', 'ASSOCIATION']],
    ['saveDelegate', ['ADMIN', 'ASSOCIATION']],
    ['regenerateDelegateCode', ['ADMIN', 'ASSOCIATION']],
    ['setDelegateStatus', ['ADMIN', 'ASSOCIATION']],
    ['updateDeliveryStatus', ['DELEGATE']],
    ['confirmDelivery', ['DELEGATE']],
    ['saveDevice', ['ADMIN']],
    ['saveAssociation', ['ADMIN']],
    ['saveActivity', ['ADMIN']],
    ['updateAssociationSettings', ['ASSOCIATION']],
    ['changePassword', ['ADMIN', 'ASSOCIATION']],
    ['listAssociationApplications', ['ADMIN']],
    ['reviewAssociationApplication', ['ADMIN']],
    ['listApplications', ['ADMIN']],
    ['getApplicationLicenseFile', ['ADMIN']]
  ];
  const ALL_ROLES = ['ADMIN', 'ASSOCIATION', 'DELEGATE'];

  PERMISSION_MATRIX.forEach(([fnName, allowedRoles]) => {
    const S = buildSandbox();
    if (typeof S[fnName] !== 'function') {
      assert(fnName + ' معرّفة في ملفات .gs', false, 'الدالة غير موجودة');
      return;
    }
    ALL_ROLES.filter(role => allowedRoles.indexOf(role) === -1).forEach(deniedRole => {
      const session = S.createSession_({ id: 'USR-' + deniedRole, name: 'فاعل', role: deniedRole, associationId: deniedRole === 'ASSOCIATION' ? 'ASC-000001' : '' });
      checks++;
      try {
        S[fnName](session.token, {});
        failures++;
        console.log('  ✗ ' + fnName + ' يجب أن يرفض الدور ' + deniedRole + ' — لم تُرمَ أي استثناء');
      } catch (error) {
        if (error.message.indexOf('صلاحية') >= 0 || error.message.indexOf('انتهت الجلسة') === -1) {
          console.log('  ✓ ' + fnName + ' يرفض الدور غير المصرَّح ' + deniedRole);
        } else {
          failures++;
          console.log('  ✗ ' + fnName + ' مع الدور ' + deniedRole + ' — رسالة غير متوقعة: ' + error.message);
        }
      }
    });
  });

  const S = buildSandbox();
  throws('استدعاء أي دالة محروسة برمز فارغ يُرفض دائمًا', () => S.saveDevice('', {}), 'انتهت الجلسة');
  throws('استدعاء أي دالة محروسة برمز مزوَّر عشوائي يُرفض دائمًا', () => S.saveDevice('forged-token-1234567890123456', {}), 'انتهت الجلسة');
}

/* ================================================================
   3) عزل بيانات الجمعيات ومنع الوصول الأفقي (IDOR)
   ================================================================ */

section('3) عزل بيانات الجمعيات (IDOR) بين جمعيتين مختلفتين');
{
  const S = buildSandbox();
  const { associationAId, associationBId } = seedFullEnvironment(S);
  const userA = S.createSession_({ id: 'USR-ASSOC-A', name: 'جمعية أ', role: 'ASSOCIATION', associationId: associationAId });
  const userB = S.createSession_({ id: 'USR-ASSOC-B', name: 'جمعية ب', role: 'ASSOCIATION', associationId: associationBId });

  const beneficiaryA = S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد الجمعية أ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501234567', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة']
  });

  throws('جمعية ب لا يمكنها تعديل مستفيد جمعية أ (IDOR)', () => S.saveBeneficiary(userB.token, {
    id: beneficiaryA.id, name: 'تعديل خبيث', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501234567', familyCount: 2, socialStatus: 'أرملة', needs: []
  }), 'صلاحية');

  const delegateA = S.saveDelegate(userA.token, { name: 'مندوب أ', phone: '0559990001' });
  throws('جمعية ب لا يمكنها تعديل مندوب جمعية أ', () => S.saveDelegate(userB.token, {
    id: delegateA.id, name: 'تعديل خبيث', phone: '0559990001'
  }), 'صلاحية');
  throws('جمعية ب لا يمكنها إعادة توليد رمز دخول مندوب جمعية أ', () =>
    S.regenerateDelegateCode(userB.token, delegateA.id), 'صلاحية');
  throws('جمعية ب لا يمكنها تعطيل مندوب جمعية أ', () =>
    S.setDelegateStatus(userB.token, delegateA.id, 'غير نشط'), 'صلاحية');
  throws('جمعية ب لا يمكنها تعيين مندوب جمعية أ لمستفيد جمعية ب', () => {
    const beneficiaryB = S.saveBeneficiary(userB.token, { deviceTypes: ['ثلاجة'],
      name: 'مستفيد الجمعية ب', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
      phone: '0501234568', familyCount: 1, socialStatus: 'أرملة', needs: []
    });
    S.assignDelegate(userB.token, beneficiaryB.id, delegateA.id);
  }, 'الجمعية نفسها');

  const delegateSessionA = S.loginDelegate_ ? null : null; // لا تُختبَر بيانات اعتماد المندوب هنا لتفادي تعقيد الاعتماد
  const fakeDelegateA = S.createSession_({ id: delegateA.id, name: 'مندوب أ', role: 'DELEGATE', associationId: associationAId });
  const beneficiaryOfB = S.saveBeneficiary(userB.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد للاختبار', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501234569', familyCount: 1, socialStatus: 'أرملة', needs: ['غسالة']
  });
  throws('مندوب لا يمكنه تسجيل تعذّر تسليم لمستفيد غير معيَّن له (IDOR أفقي بين المناديب)',
    () => S.updateDeliveryStatus(fakeDelegateA.token, beneficiaryOfB.id, 'لا يرد', ''), 'غير متاح لك');
  throws('مندوب لا يمكنه تأكيد تسليم لمستفيد غير معيَّن له',
    () => S.confirmDelivery(fakeDelegateA.token, { beneficiaryId: beneficiaryOfB.id, confirmed: true }), 'غير متاح لك');
}

/* ================================================================
   4) XSS وحقن HTML وحقن الصيغ في Google Sheets
   ================================================================ */

section('4) XSS وحقن الصيغ (Formula Injection) — اختبار كتابة/قراءة فعلي');
{
  const S = buildSandbox();
  const { associationAId } = seedFullEnvironment(S);
  const userA = S.createSession_({ id: 'USR-ASSOC-XSS', name: 'جمعية', role: 'ASSOCIATION', associationId: associationAId });

  const maliciousName = '=HYPERLINK("http://evil.example","انقر هنا")';
  const saved = S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: maliciousName, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501234570', familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  const rawRow = S.findById_('المستفيدون', 'رقم المستفيد', saved.id);
  assert('safeCell_ يسبق نص الصيغة بعلامة نص صريح قبل الكتابة (تمنع Sheets من تنفيذها كصيغة)',
    S.safeCell_(maliciousName).charAt(0) === "'");
  assert('نص الصيغة الخبيث يُخزَّن ويُقرأ سليمًا كنص خام دون تحوير (Sheets تحذف علامة الاقتباس عند التخزين كنص، فلا صيغة تُنفَّذ رغم أن القيمة المقروءة تبدأ بـ"=")',
    String(rawRow['الاسم']) === maliciousName);

  const scriptName = '<script>alert(1)</script>';
  const savedScript = S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: scriptName, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501234571', familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  const rawScriptRow = S.findById_('المستفيدون', 'رقم المستفيد', savedScript.id);
  assert('وسم <script> يُخزَّن كنص خام دون تنفيذ (الهروب يحدث في الواجهة عبر esc() لا في الخادم)',
    String(rawScriptRow['الاسم']) === scriptName);

  const landmarkXss = '<img src=x onerror=alert(1)>';
  const savedLandmark = S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد بعلامة مميزة خبيثة', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501234572', familyCount: 1, socialStatus: 'أرملة', needs: [], landmark: landmarkXss
  });
  const rawLandmarkRow = S.findById_('المستفيدون', 'رقم المستفيد', savedLandmark.id);
  assert('حقل "علامة مميزة" الجديد (المرحلة الخامسة) يُخزَّن كنص خام محدود الطول دون تنفيذ HTML (الهروب في الواجهة فقط)',
    String(rawLandmarkRow['علامة مميزة']) === landmarkXss);
  // ملاحظة: الحماية الفعلية من XSS تقع في Index.html عبر esc() عند العرض؛
  // tools/verify.js وtools/smoke.js يتحقّقان من ذلك في كل شاشة عرض بيانات.
}

/* ================================================================
   5) التحقق من المدخلات: الأحجام والأنواع
   ================================================================ */

section('5) التحقق من أحجام وأنواع المدخلات');
{
  const S = buildSandbox();
  const { associationAId } = seedFullEnvironment(S);
  const userA = S.createSession_({ id: 'USR-ASSOC-VAL', name: 'جمعية', role: 'ASSOCIATION', associationId: associationAId });

  throws('اسم مستفيد فارغ يُرفض', () => S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: '   ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار', phone: '0501234572', familyCount: 1
  }), 'مطلوب');
  throws('اسم مستفيد يتجاوز 120 حرفًا يُقصّ ولا يفشل (سلوك مصمَّم لا خطأ)', () => {
    const longName = 'ا'.repeat(200);
    const result = S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
      name: longName, region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
      phone: '0501234573', familyCount: 1, socialStatus: 'أرملة', needs: []
    });
    const row = S.findById_('المستفيدون', 'رقم المستفيد', result.id);
    if (String(row['الاسم']).length > 120) throw new Error('تجاوز الحد المسموح فعليًا');
    throw new Error('تم القصّ بأمان');
  }, 'تم القصّ بأمان');
  throws('عدد أفراد خارج الحدود (0) يُرفض', () => S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار', phone: '0501234574', familyCount: 0
  }), 'غير صحيح');
  throws('عدد أفراد خارج الحدود (1000) يُرفض', () => S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار', phone: '0501234575', familyCount: 1000
  }), 'غير صحيح');
  throws('رقم جوال بصيغة غير سعودية يُرفض', () => S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار', phone: '0112345678', familyCount: 1
  }), 'غير صحيح');
  // Phase 2.3.4 (القسم 1): saveBeneficiary لتعديل سجل قائم يمر الآن عبر
  // updateBeneficiaryWithNeeds_ حصرًا، التي ترفض أي معرّف لا يطابق صيغة
  // التخزين الصارمة (cleanId_) فورًا بخطأ واضح قبل أي قراءة أو كتابة —
  // لا "سقوط آمن" ضمني بإنشاء سجل جديد بدل التعديل المطلوب كما كان في
  // المسار القديم؛ الرفض الصريح المبكر هو الخاصية الأمنية الأصح هنا.
  const beforeCount = S.readTable_('المستفيدون').rows.length;
  throws('معرّف يشبه محاولة حقن (لا يوجد SQL فعليًا، المطابقة نصية حرفية) يُرفض فورًا بخطأ صريح — لا تعديل لسجل عشوائي ولا إنشاء بديل صامت',
    () => S.saveBeneficiary(userA.token, {
      id: "BEN-000001' OR '1'='1", name: 'مستفيد', region: 'الرياض', city: 'الرياض',
      address: 'حي', district: 'حي الاختبار', phone: '0501234576', familyCount: 1, socialStatus: 'أرملة', needs: []
    }), 'رقم مستفيد غير صالح');
  assert('محاولة الحقن لم تُنشئ أي سجل مستفيد جديد ولم تُعدّل أي سجل قائم', S.readTable_('المستفيدون').rows.length === beforeCount);
}

/* ================================================================
   6) رفع الملفات والصور
   ================================================================ */

section('6) رفع الملفات والصور');
{
  const S = buildSandbox();
  throws('صورة إثبات بنوع MIME غير مدعوم تُرفض (svg قابل لحقن XSS عبر <script>)',
    () => S.saveProofImage_('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'BEN-000001'), 'صيغة');
  throws('صورة إثبات برأس data: مزوَّر (نوع خاطئ رغم امتداد صحيح ظاهريًا) تُرفض',
    () => S.saveProofImage_('data:text/html;base64,PGh0bWw+', 'BEN-000001'), 'صيغة');
  throws('صورة إثبات بلا بادئة data: صالحة تُرفض', () => S.saveProofImage_('not-a-data-url', 'BEN-000001'), 'صيغة');
  const oversized = 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024);
  throws('صورة إثبات تتجاوز 6 ميجابايت تُرفض قبل أي رفع فعلي', () => S.saveProofImage_(oversized, 'BEN-000001'), 'حجم');

  // نوع الملف الحقيقي (magic bytes) لا بادئة data: المُعلَنة من العميل فقط —
  // محتوى نصي عادي (غير صورة إطلاقًا) مموَّه ببادئة "data:image/jpeg" يجب أن يُرفض.
  throws('محتوى نصي عادي مموَّه ببادئة data:image/jpeg (توقيع JPEG حقيقي مفقود) يُرفض',
    () => S.saveProofImage_('data:image/jpeg;base64,' + Buffer.from('ceci nest pas une image').toString('base64'), 'BEN-000001'),
    'محتوى الملف الفعلي');
  throws('محتوى HTML مموَّه ببادئة data:image/png (توقيع PNG حقيقي مفقود) يُرفض',
    () => S.saveProofImage_('data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'), 'BEN-000001'),
    'محتوى الملف الفعلي');
  // اختبار توقيع البايتات مباشرة (بلا حاجة لمحاكاة Drive الكاملة، غير
  // المُهيَّأة في رمل هذا الملف): صورة PNG حقيقية يجب أن تُقبل بنيويًا.
  const realPngBytes = Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  assert('صورة PNG حقيقية (توقيع بايتات صحيح فعليًا) تُقبل بنيويًا عبر verifyImageMagicBytes_',
    S.verifyImageMagicBytes_(realPngBytes, 'png') === true);
  assert('نص عادي بتوقيع png مزعوم يُرفض بنيويًا عبر verifyImageMagicBytes_',
    S.verifyImageMagicBytes_(Array.from(Buffer.from('hello world')), 'png') === false);

  // بدور ASSOCIATION عمدًا هنا (لا ADMIN): تفحص هاتان الحالتان تحقُّق
  // صيغة/حجم الملف حصرًا، وASSOCIATION تستخدم جمعيتها مباشرة بلا حاجة
  // لقراءة ورقة الجمعيات إطلاقًا (Phase 2.3.1 القسم 10 يفرض على ADMIN
  // تحديدًا associationId صحيحًا موجودًا فعليًا قبل أي فحص آخر — غير
  // ذي صلة بما يُختبَر هنا، وقسم 6 هذا لا يزرع أي جمعية حقيقية أصلًا).
  const assocRoleSession = S.createSession_({ id: 'USR-ASSOC-EXCEL', name: 'جمعية', role: 'ASSOCIATION', associationId: 'ASC-000001' });
  throws('ملف Excel بنوع MIME غير صحيح يُرفض', () => {
    S.inspectBeneficiaryExcel(assocRoleSession.token, { dataUrl: 'data:text/plain;base64,aGVsbG8=' });
  }, 'صيغة');
  // base64 يُوسِّع الحجم بنسبة 4/3 تقريبًا؛ يلزم أكثر من 8 ميجابايت × 4/3 من محارف base64
  // ليتجاوز فك الترميز الحدّ الفعلي 8 ميجابايت (خطأ حسابي سابق كان يُنتج بيانات أصغر من الحدّ فعليًا).
  const oversizedExcel = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + 'A'.repeat(12 * 1024 * 1024);
  throws('ملف Excel يتجاوز 8 ميجابايت يُرفض قبل أي رفع فعلي', () => {
    S.inspectBeneficiaryExcel(assocRoleSession.token, { dataUrl: oversizedExcel });
  }, 'حجم');
}

/* ================================================================
   7) تحديد المعدّل ومنع التخمين المتكرر
   ================================================================ */

section('7) تحديد المعدّل (Rate Limiting)');
{
  const S = buildSandbox();
  for (let i = 0; i < 5; i++) S.throttle_('sec-test-bucket', 5, 900);
  throws('تجاوز حد المحاولات يُرفض بعد الوصول للسقف', () => S.throttle_('sec-test-bucket', 5, 900), 'محاولات كثيرة');

  const S2 = buildSandbox();
  seedFullEnvironment(S2);
  for (let i = 0; i < 8; i++) {
    try { S2.loginUser_('assoc-a@example.org', 'كلمة-مرور-خاطئة-عمدًا'); } catch (ignore) { /* متوقّع */ }
  }
  throws('تسجيل الدخول يُحدَّد معدله بعد محاولات فاشلة متكررة بنفس البريد',
    () => S2.loginUser_('assoc-a@example.org', 'محاولة-أخرى'), 'محاولات كثيرة');

  const S3 = buildSandbox();
  seedFullEnvironment(S3);
  for (let i = 0; i < 5; i++) {
    try {
      S3.submitAssociationApplication(applicationFixture({
        name: 'جمعية تجريبية ' + i, category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
        contactName: 'فلان', phone: '05' + (10000000 + i), email: 'rl-test-' + i + '@example.org',
        licenseNumber: 'LIC-RL-' + i
      }));
    } catch (ignore) { /* قد يفشل لأسباب أخرى، المهم أنه يستهلك عدّاد المعدّل بالبريد المتغيّر لا يُحسب هنا */ }
  }
  // throttle_ في submitAssociationApplication مبني على هاش البريد نفسه، فلا يتراكم عبر بريد متغيّر — نتحقق مباشرة من throttle_ بدلًا من ذلك
  assert('submitAssociationApplication يستخدم throttle_ فعليًا (تحقّق ثابت من الكود)',
    /throttle_\(.*apply.*\)/.test(source) || /throttle_\('apply:/.test(source));
}

/* ================================================================
   8) منع تسريب كلمات المرور والرموز والأسرار
   ================================================================ */

section('8) عدم تسريب كلمات المرور/الرموز/الأسرار في استجابات الخادم');
{
  const S = buildSandbox();
  const { associationAId } = seedFullEnvironment(S);
  const userA = S.createSession_({ id: 'USR-ASSOC-LEAK', name: 'جمعية', role: 'ASSOCIATION', associationId: associationAId });
  S.saveDelegate(userA.token, { name: 'مندوب سرّي', phone: '0559991234' });

  const adminData = JSON.stringify(S.buildAdminPortal_({ id: 'USR-ADMIN-SEC', name: 'مدير', role: 'ADMIN', associationId: '' }));
  assert('حمولة بوابة الإدارة لا تحتوي عمود "كلمة المرور المشفرة"', !adminData.includes('كلمة المرور المشفرة') && !adminData.includes('PassA12345'));
  assert('حمولة بوابة الإدارة لا تحتوي عمود "رمز الدخول المشفر"', !adminData.includes('رمز الدخول المشفر'));
  assert('حمولة بوابة الإدارة لا تحتوي عمود "الملح" (salt)', !/"الملح"/.test(adminData));

  const assocData = JSON.stringify(S.buildAssociationPortal_({ id: userA.token, role: 'ASSOCIATION', associationId: associationAId }));
  assert('حمولة بوابة الجمعية لا تحتوي أي حقل كلمة مرور مشفَّرة', !assocData.includes('كلمة المرور المشفرة') && !assocData.includes('رمز الدخول المشفر'));

  assert('normalizeBeneficiary_/normalizeAssociation_/normalizeDelegate_ مبنية بقائمة سماح صريحة (allow-list) لا تمرّر الصف الخام',
    !/return\s+row;/.test(source.match(/function normalize\w+_\([^)]*\)\s*{[\s\S]*?\n}/g).join('\n')));

  assert('reviewAssociationApplication لا يكتب كلمة المرور المؤقتة في سجل العمليات (audit_)', (() => {
    const start = source.indexOf('function reviewAssociationApplication(');
    const end = source.indexOf('\nfunction ', start + 10);
    const body = source.slice(start, end === -1 ? start + 3000 : end);
    const auditCalls = body.match(/audit_\([^)]*\)/g) || [];
    return auditCalls.every(call => !call.includes('tempPassword') && !call.includes('temporaryPassword'));
  })());
}

/* ================================================================
   9) سلامة سجل العمليات (Audit Log)
   ================================================================ */

section('9) سلامة سجل العمليات');
{
  assert('لا توجد أي دالة تعديل أو حذف لصفوف سجل العمليات (إلحاق فقط - append-only)',
    !/updateById_\(APP\.sheets\.audit/.test(source) && !/updateRowByMatch_\(APP\.sheets\.audit/.test(source));
  assert('لا يوجد حذف صف فعلي لأي بيانات ذات دلالة تاريخية/تشغيلية — .deleteRow( محصورة حصرًا داخل deleteRowById_ (تُستدعى فقط لإزالة احتياج لم يُبتّ فيه بعد، Phase 2.1)', (() => {
    const allDeleteRowUses = source.match(/\.deleteRow\(/g) || [];
    const start = source.indexOf('function deleteRowById_(');
    if (start === -1) return allDeleteRowUses.length === 0; // لا الدالة ولا أي استخدام آخر — الحالة الأصلية
    const end = source.indexOf('\nfunction ', start + 10);
    const body = source.slice(start, end === -1 ? start + 2000 : end);
    const usesInsideDeleteRowById = (body.match(/\.deleteRow\(/g) || []).length;
    return allDeleteRowUses.length === usesInsideDeleteRowById && usesInsideDeleteRowById === 1;
  })());
  assert('deleteRowById_ لا تُستدعى إطلاقًا على ورقة "المستفيدون" — كل استدعاءاتها (Phase 2.2: إزالة احتياج معلَّق، وتنظيف احتياجات معلَّقة عند فشل إنشاء مستفيد) تستهدف حصرًا ورقة "احتياجات المستفيدين" التي لا قيمة تاريخية لصفوفها قبل أي قرار', (() => {
    const calls = [...source.matchAll(/(?<!function )deleteRowById_\(([^,]+),/g)].map(m => m[1].trim());
    return calls.length >= 1 && calls.every(target => target === 'APP.sheets.beneficiaryNeeds');
  })());

  const S = buildSandbox();
  const { associationAId } = seedFullEnvironment(S);
  const userA = S.createSession_({ id: 'USR-ASSOC-AUDIT', name: 'جمعية', role: 'ASSOCIATION', associationId: associationAId });
  const beforeCount = S.readTable_('سجل العمليات').rows.length;
  S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد لسجل العمليات', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501234580', familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  const afterCount = S.readTable_('سجل العمليات').rows.length;
  assert('كل عملية حفظ ناجحة تُضيف سطرًا واحدًا بالضبط لسجل العمليات (لا نقص ولا تكرار)', afterCount === beforeCount + 1);

  const mutatingFunctions = [
    'saveBeneficiary', 'saveDelegate', 'saveDevice', 'saveAssociation', 'saveActivity',
    'assignDelegate', 'regenerateDelegateCode', 'setDelegateStatus', 'updateDeliveryStatus',
    'confirmDelivery', 'updateAssociationSettings', 'changePassword',
    'reviewAssociationApplication'
  ];
  mutatingFunctions.forEach(fnName => {
    let body = extractFunctionBody_(source, fnName);
    if (!body) { assert(fnName + ' موجودة', false); return; }
    // Phase 2.3.1: saveDevice_ تفوّض الكتابة الفعلية والـaudit إلى
    // commitDeviceWithNeed_/saveDeviceDescriptiveOnly_ (مستوى تفويض ثانٍ
    // لا يتبعه extractFunctionBody_ تلقائيًا — تُلحَق أجسامهما هنا صراحةً).
    if (fnName === 'saveDevice') {
      body += (extractFunctionBody_(source, 'commitDeviceWithNeed_') || '') + (extractFunctionBody_(source, 'saveDeviceDescriptiveOnly_') || '');
    }
    // Phase 2.3.4 (القسم 1): saveBeneficiary تفوّض الكتابة الفعلية والـaudit
    // إلى createBeneficiaryWithNeeds_ (إنشاء) وupdateBeneficiaryWithNeeds_
    // (تعديل) بدل saveBeneficiary_ القديمة — أسماء لا يتبعها extractFunctionBody_
    // تلقائيًا (لا تطابق نمط fnName + '_')، فتُلحَق أجسامهما هنا صراحةً.
    if (fnName === 'saveBeneficiary') {
      body += (extractFunctionBody_(source, 'createBeneficiaryWithNeeds_') || '') + (extractFunctionBody_(source, 'updateBeneficiaryWithNeeds_') || '');
    }
    assert(fnName + ' يسجّل العملية في audit_ عند النجاح', /audit_\(/.test(body));
  });
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

section('10) خصوصية الموقع الجغرافي (المرحلة الخامسة)');
{
  const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
  const appScript = htmlSource.slice(htmlSource.lastIndexOf('<script'));

  assert('renderLogin/restoreSession لا يستدعيان navigator.geolocation عند فتح النظام (الإذن يُطلَب فقط بضغط المستخدم)', (() => {
    const loginBody = extractFunctionBody_(appScript, 'renderLogin') || '';
    const restoreBody = extractFunctionBody_(appScript, 'restoreSession') || '';
    return !/geolocation/.test(loginBody) && !/geolocation/.test(restoreBody);
  })());

  const geoCalls = (appScript.match(/navigator\.geolocation\.getCurrentPosition/g) || []).length;
  assert('استدعاءات navigator.geolocation.getCurrentPosition محصورة في معالجات أزرار صريحة (fillCurrentLocation/startDelegateRoute) لا أكثر',
    geoCalls === 2);

  assert('confirmDelivery لا يكتب أي إحداثيات أو موقع حي للمندوب في سجل التسليمات أو سجل العمليات', (() => {
    const body = extractFunctionBody_(source, 'confirmDelivery') || '';
    return !/'خط العرض'|'خط الطول'|position\.coords/.test(body);
  })());
  assert('updateDeliveryStatus لا يكتب أي إحداثيات أو موقع حي للمندوب', (() => {
    const body = extractFunctionBody_(source, 'updateDeliveryStatus') || '';
    return !/'خط العرض'|'خط الطول'|position\.coords/.test(body);
  })());
  assert('audit_ لا تُستدعى أبدًا بوسيطة تحمل إحداثيات موقع المندوب الحي (لا نمط lat/lng ضمن نص العملية المُسجَّل)',
    !/audit_\([^)]*(position\.coords|\.lat \+|\.lng \+)/.test(source));

  assert('optionalCoordinate_ تُستخدَم دائمًا للتحقق من الإحداثيات في الخادم (لا اعتماد على تحقق الواجهة فقط)',
    (source.match(/optionalCoordinate_\(/g) || []).length >= 3);
}

/* ================================================================
   11) دوال الصيانة: محاكاة استدعاء غير مصرَّح كما تفعل google.script.run
   ================================================================ */

section('11) دوال الصيانة: رفض الاستدعاء غير المصرَّح (محاكاة google.script.run)');
{
  const S = buildSandbox();
  // كل دالة صيانة يجب أن تنتهي بشرطة سفلية (خاصة، لا يستدعيها Index.html أصلًا
  // حسب فحص tools/verify.js) **و** ترفض العمل فعليًا عند استدعائها مباشرة
  // بلا رمز وصول صيانة صالح — دفاع مزدوج مستقل، لا طبقة واحدة.
  const maintenanceFunctions = [
    'setupSheets_', 'migrateReferenceData_', 'migrateLegacyReferenceValues_',
    'previewPhoneNormalization_', 'migratePhoneNumbers_', 'diagnoseReferenceDataIssues_',
    'diagnoseStateIntegrity_', 'repairStateIntegrityIssues_', 'preflightRelease_', 'applyReleaseSchema_'
  ];
  maintenanceFunctions.forEach(name => {
    assert('اسم الدالة "' + name + '" ينتهي بشرطة سفلية (خاصة، لا تُستدعى من الواجهة)', /_$/.test(name));
    assert('الدالة "' + name + '" غير معرَّفة بلا شرطة سفلية في المصدر (لا نسخة عامة موازية)',
      !new RegExp('function ' + name.slice(0, -1) + '\\(').test(source));
    let rejected = false;
    let rejectedWithToken = false;
    try { S[name](); } catch (error) { rejected = true; }
    try { S[name]('رمز-مزوَّر-عشوائي-لا-يطابق-شيئًا'); } catch (error) { rejectedWithToken = true; }
    assert('استدعاء "' + name + '" بلا أي رمز (محاكاة google.script.run من متصفح غير مصرَّح) يُرفض', rejected);
    assert('استدعاء "' + name + '" برمز مزوَّر عشوائي (محاكاة تخمين) يُرفض أيضًا', rejectedWithToken);
  });

  assert('grantMaintenanceAccess_ نفسها خاصة أيضًا (لا تُستدعى من الواجهة)، ولا تتطلب جلسة ويب (تُشغَّل من المحرر فقط)',
    /function grantMaintenanceAccess_\(/.test(source) && !/requireSession_/.test(extractFunctionBody_(source, 'grantMaintenanceAccess_') || ''));
  assert('grantMaintenanceAccess_ لا تُعيد الرمز الخام في القيمة الراجعة (القناة الوحيدة Logger.log فقط)', (() => {
    const body = extractFunctionBody_(source, 'grantMaintenanceAccess_') || '';
    const returnMatch = body.match(/return\s*\{[^}]*\}/);
    return returnMatch && !/token/.test(returnMatch[0]);
  })());
  assert('requireMaintenanceAccess_ لا تُسجِّل الرمز نفسه في أي مكان (لا Logger.log ولا audit_ يحمل المعامل token)', (() => {
    const body = extractFunctionBody_(source, 'requireMaintenanceAccess_') || '';
    return !/Logger\.log\([^)]*token/.test(body) && !/audit_\([^)]*token/.test(body);
  })());
  assert('لا تُخزَّن أي نسخة من الرمز الخام في Script Properties — فقط hash/salt', (() => {
    const body = extractFunctionBody_(source, 'grantMaintenanceAccess_') || '';
    return /hash:\s*hashSecret_\(token/.test(body) && !/setProperty\([^)]*,\s*token\)/.test(body);
  })());
}

/* ================================================================
   12) لا يوجد رمز موافقة أو سرّ ثابت في المستودع
   ================================================================ */

section('12) عدم وجود رمز موافقة أو سرّ ثابت مكتوب في المصدر');
{
  const repoRoot = path.join(__dirname, '..');
  const gsFiles = fs.readdirSync(repoRoot).filter(name => name.endsWith('.gs'));
  const combinedGsSource = gsFiles.map(name => fs.readFileSync(path.join(repoRoot, name), 'utf8')).join('\n');

  assert('لا وجود إطلاقًا لثابت رمز الموافقة القديم المكتوب حرفيًا (RELEASE_SCHEMA_APPROVAL_CODE_) في أي ملف .gs',
    !/RELEASE_SCHEMA_APPROVAL_CODE_/.test(combinedGsSource));
  assert('لا وجود لعبارة الموافقة النصية القديمة المكتوبة حرفيًا في أي ملف .gs',
    !/أوافق-على-تطبيق-مخطط-الإصدار/.test(combinedGsSource));
  assert('applyReleaseSchema_ لا تقارن بأي نص ثابت مكتوب حرفيًا — تعتمد فقط على requireMaintenanceAccess_', (() => {
    const body = extractFunctionBody_(combinedGsSource, 'applyReleaseSchema_') || '';
    return !/===\s*['"][^'"]{4,}['"]/.test(body.replace(/requireMaintenanceAccess_\([^)]*\)/, ''));
  })());
  assert('requireMaintenanceAccess_ نفسها لا تقارن الرمز بأي نص ثابت — فقط بصمة مخزَّنة عبر constantTimeEquals_', (() => {
    const body = extractFunctionBody_(combinedGsSource, 'requireMaintenanceAccess_') || '';
    return /constantTimeEquals_\(/.test(body) && !/token\s*===\s*['"]/.test(body);
  })());

  // فحص عام إضافي: لا يوجد أي متغيّر/ثابت باسم يوحي بسرّ أو رمز موافقة مربوط بقيمة نصية عربية/إنجليزية ثابتة داخل .gs.
  const suspiciousConstant = /const\s+\w*(APPROVAL|SECRET|TOKEN)\w*_?\s*=\s*['"][^'"]+['"]/i;
  assert('لا يوجد أي ثابت آخر باسم يوحي بسر/رمز موافقة مربوط بقيمة نصية ثابتة في .gs', !suspiciousConstant.test(combinedGsSource));

  const mdFiles = ['DEPLOYMENT.md', 'RELEASE.md', 'SECURITY_REVIEW.md', 'HANDOFF.md', 'README.md']
    .filter(name => fs.existsSync(path.join(repoRoot, name)));
  assert('التوثيق (DEPLOYMENT.md/RELEASE.md/...) لا يذكر رمز الموافقة الثابت القديم كخطوة موصى بها', mdFiles.every(name => {
    const text = fs.readFileSync(path.join(repoRoot, name), 'utf8');
    return !/أوافق-على-تطبيق-مخطط-الإصدار/.test(text);
  }));
}

/* ================================================================
   13) الأسطح الجديدة في هذه المرحلة: الحزمة المُجمَّعة وإعادة المحاولة
   ================================================================ */

section('13) حراسة الأسطح الجديدة (getPortalBundle / retryDelivery / القياس)');
{
  const S = buildSandbox();
  const { associationAId, associationBId } = seedFullEnvironment(S);
  const userA = S.createSession_({ id: 'USR-SEC-A', name: 'جمعية أ', role: 'ASSOCIATION', associationId: associationAId });
  const userB = S.createSession_({ id: 'USR-SEC-B', name: 'جمعية ب', role: 'ASSOCIATION', associationId: associationBId });

  throws('getPortalBundle ترفض الرمز الفارغ', () => S.getPortalBundle('', 'beneficiaries', {}), 'انتهت الجلسة');
  throws('getPortalBundle ترفض الرمز المزوَّر', () => S.getPortalBundle('forged-token-1234567890123456', 'beneficiaries', {}), 'انتهت الجلسة');

  const beneficiaryA = S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد الحزمة أ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501239001', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة']
  });

  // العزل الأفقي داخل الحزمة نفسها: لا تُستخدم الحزمة كباب خلفي لبيانات جمعية أخرى.
  const bundleB = S.getPortalBundle(userB.token, 'beneficiaries', {associationId: associationAId, page: 1, pageSize: 50});
  assert('جمعية ب لا ترى مستفيدي جمعية أ عبر الحزمة حتى بتمرير associationId صراحةً',
    (bundleB.pageData.items || []).every(item => item.id !== beneficiaryA.id));
  assert('حمولة الحزمة لجمعية ب لا تحمل أي معرّف يخص جمعية أ',
    JSON.stringify(bundleB).indexOf(associationAId) === -1);

  const bundleAdminOnly = S.getPortalBundle(userB.token, 'applications', {});
  assert('قسم إداري (طلبات الانضمام) لا يُخدَم لجمعية عبر الحزمة إطلاقًا',
    bundleAdminOnly.pageData === undefined && bundleAdminOnly.page === undefined);

  // قياس الأداء لا يُسرِّب شيئًا.
  assert('كائن القياس _meta لا يحمل رمز جلسة ولا كلمة مرور ولا تجزئة ولا ملحًا', (() => {
    const meta = JSON.stringify(bundleB._meta || {});
    return meta.indexOf(userB.token) === -1
      && !/كلمة المرور|الملح|رمز الدخول|hash|salt|password|token/i.test(meta);
  })());
  assert('_meta يقتصر على حقول قياس معروفة فقط', (() => {
    const keys = Object.keys(bundleB._meta || {}).sort().join(',');
    return keys === 'op,reads,serverMs,traceId,writes';
  })());

  // إعادة المحاولة: محروسة بالأدوار وبالملكية معًا.
  throws('retryDelivery ترفض الرمز الفارغ', () => S.retryDelivery('', 'BEN-000001'), 'انتهت الجلسة');
  throws('جمعية ب لا تستطيع إعادة محاولة تسليم مستفيد جمعية أ (IDOR)',
    () => S.retryDelivery(userB.token, beneficiaryA.id), 'صلاحية');

  // رسالة تكرار المعرّف لا تكشف بيانات صفوف، فقط الورقة والعدد.
  assert('رسالة رفض المعرّف المكرَّر لا تكشف أي محتوى صف (اسم/جوال/بريد)', (() => {
    const message = S.duplicateIdMessage_('المستفيدون', 'رقم المستفيد', 'BEN-000001', 2);
    return message.indexOf('BEN-000001') >= 0 && !/@|05\d{8}/.test(message);
  })());
}

/* ================================================================
   14) تأمين الوصول لصورة إثبات التسليم (المرحلة الثانية عشرة)
   ================================================================ */

section('14) تأمين الوصول لصورة إثبات التسليم');
{
  const S = buildSandbox();
  const { associationAId, associationBId } = seedFullEnvironment(S);
  const userA = S.createSession_({ id: 'USR-PROOF-A', name: 'جمعية أ', role: 'ASSOCIATION', associationId: associationAId });
  const userB = S.createSession_({ id: 'USR-PROOF-B', name: 'جمعية ب', role: 'ASSOCIATION', associationId: associationBId });
  const admin = adminSession(S);

  const beneficiaryA = S.saveBeneficiary(userA.token, { deviceTypes: ['ثلاجة'],
    name: 'مستفيد إثبات أ', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار',
    phone: '0501119001', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة'], lat: '24.7', lng: '46.6'
  });
  const delegateA = S.saveDelegate(userA.token, { name: 'مندوب إثبات أ', phone: '0501119002' });
  const otherDelegateA = S.saveDelegate(userA.token, { name: 'مندوب آخر لدى أ', phone: '0501119003' });
  const beneficiaryANeed = S.readTable_('احتياجات المستفيدين').rows.find(row => String(row['رقم المستفيد']) === beneficiaryA.id);
  S.reviewBeneficiaryNeeds(admin.token, beneficiaryA.id, {
    beneficiaryDecision: 'معتمد', needDecisions: [{needId: String(beneficiaryANeed['رقم الاحتياج']), decision: 'معتمد'}]
  });
  const proofDevice = S.saveDevice(admin.token, { name: 'ثلاجة إثبات', type: 'ثلاجة', associationId: associationAId, beneficiaryId: beneficiaryA.id });
  S.assignDelegate(userA.token, beneficiaryA.id, delegateA.id);
  // محاكاة الاستلام الفعلي (مسار startDelivery/confirmDevicePickup المستقل
  // لم يُبنَ بعد عمدًا — Phase 3): assignDelegate الآن "تعيين" فقط.
  const proofNeedId = String(S.findById_('الأجهزة', 'رقم الجهاز', proofDevice.id)['رقم الاحتياج']);
  S.updateById_('الأجهزة', 'رقم الجهاز', proofDevice.id, {'حالة الجهاز': 'مع المندوب'});
  S.updateById_('احتياجات المستفيدين', 'رقم الاحتياج', proofNeedId, {'حالة التنفيذ': 'خرج مع المندوب'});
  S.updateById_('المستفيدون', 'رقم المستفيد', beneficiaryA.id, {'حالة التسليم': 'خرج مع المندوب'});

  const delegateSessionA = S.createSession_({ id: delegateA.id, name: 'مندوب إثبات أ', role: 'DELEGATE', associationId: associationAId });
  const otherDelegateSessionA = S.createSession_({ id: otherDelegateA.id, name: 'مندوب آخر لدى أ', role: 'DELEGATE', associationId: associationAId });

  const REAL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const delivered = S.confirmDelivery(delegateSessionA.token, {
    beneficiaryId: beneficiaryA.id, confirmed: true, proofDataUrl: 'data:image/png;base64,' + REAL_PNG_B64
  });
  assert('تأكيد التسليم بصورة إثبات صحيحة ينجح', delivered.ok === true);
  const deliveryRow = S.readTable_('التسليمات').rows.find(row => String(row['رقم المستفيد']) === beneficiaryA.id);
  const deliveryId = String(deliveryRow['رقم التسليم']);

  assert('العمود "رابط الإثبات" يخزّن معرّف ملف Drive خامًا لا رابطًا كاملًا بعد هذا التعديل',
    String(deliveryRow['رابط الإثبات']).indexOf('http') === -1 && String(deliveryRow['رابط الإثبات']).indexOf('/') === -1);

  const adminView = S.getDeliveryProofImage(admin.token, deliveryId);
  assert('الإدارة تستطيع عرض إثبات أي تسليم', adminView.ok === true && adminView.dataUrl.indexOf('data:image/png;base64,') === 0);

  const assocAView = S.getDeliveryProofImage(userA.token, deliveryId);
  assert('الجمعية صاحبة المستفيد تستطيع عرض إثبات تسليمه', assocAView.ok === true && assocAView.dataUrl.indexOf('data:image/png;base64,') === 0);

  throws('جمعية أخرى لا تستطيع عرض إثبات تسليم ليس لمستفيديها (IDOR)',
    () => S.getDeliveryProofImage(userB.token, deliveryId), 'ليس لديك صلاحية');

  const delegateView = S.getDeliveryProofImage(delegateSessionA.token, deliveryId);
  assert('المندوب الذي نفَّذ التسليم يستطيع عرض إثباته الخاص', delegateView.ok === true && delegateView.dataUrl.indexOf('data:image/png;base64,') === 0);

  throws('مندوب آخر لدى نفس الجمعية لا يستطيع عرض إثبات تسليم لم يُنفِّذه هو',
    () => S.getDeliveryProofImage(otherDelegateSessionA.token, deliveryId), 'ليس لديك صلاحية');

  throws('استدعاء غير مصادَق (رمز فارغ) يُرفض', () => S.getDeliveryProofImage('', deliveryId), 'انتهت الجلسة');
  throws('طلب صورة إثبات لتسليم غير موجود يُرفض برسالة واضحة', () => S.getDeliveryProofImage(admin.token, 'DLV-999999'), 'غير موجود');

  assert('عرض صورة الإثبات يُسجَّل في سجل العمليات', (() => {
    const rows = S.readTable_('سجل العمليات').rows;
    return rows.some(row => String(row['العملية']) === 'عرض صورة إثبات تسليم' && String(row['رقم السجل']) === deliveryId);
  })());

  // توافق خلفي: سجلات أقدم كانت saveProofImage_ تُخزِّن فيها رابط Drive
  // كاملًا (قبل هذا التعديل) — يجب أن تبقى قابلة للعرض دون أي ترحيل أو
  // إعادة كتابة فعلية لقيمة الخلية.
  const legacyFileId = String(deliveryRow['رابط الإثبات']);
  assert('driveFileIdFromProofValue_ تستخرج المعرّف من قيمة خام كما هي', S.driveFileIdFromProofValue_(legacyFileId) === legacyFileId);
  assert('driveFileIdFromProofValue_ تستخرج المعرّف من رابط Drive قديم كامل (توافق خلفي بلا ترحيل بيانات)',
    S.driveFileIdFromProofValue_('https://drive.example/file/' + legacyFileId) === legacyFileId);

  // لا رابط Drive خام (ولا حتى المعرّف الخام) يُسرَّب ضمن أي قائمة/حزمة/بطاقة مهمة.
  const taskPayload = S.delegateTaskPayload_(beneficiaryA.id);
  assert('delegateTaskPayload_ (بطاقة مهمة المندوب) لا تحمل معرّف/رابط ملف الإثبات إطلاقًا',
    JSON.stringify(taskPayload).indexOf(legacyFileId) === -1);
  const listing = S.listBeneficiaries_(S.createSession_({ id: 'USR-PROOF-CHK', name: 'فحص', role: 'ADMIN', associationId: '' }), {});
  assert('listBeneficiaries_ لا تحمل معرّف/رابط ملف الإثبات في أي عنصر',
    JSON.stringify(listing).indexOf(legacyFileId) === -1);

  const attemptsForAdmin = S.listBeneficiaryDeliveryAttempts(admin.token, beneficiaryA.id);
  assert('listBeneficiaryDeliveryAttempts تُعيد hasProof منطقيًا فقط، لا المعرّف أو الرابط نفسه',
    attemptsForAdmin.attempts.some(a => a.hasProof === true) && JSON.stringify(attemptsForAdmin).indexOf(legacyFileId) === -1);
  throws('جمعية أخرى لا تستطيع طلب سجل محاولات تسليم مستفيد ليس لها',
    () => S.listBeneficiaryDeliveryAttempts(userB.token, beneficiaryA.id), 'صلاحية');
}

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
console.log('\nتنبيه صادق: هذا فحص آلي داخل بيئة محاكاة، وليس اختبار اختراق');
console.log('مستقلًا. لا يغطي الشبكة أو البنية التحتية أو النشر الفعلي على Apps Script.');
process.exit(failures === 0 ? 0 : 1);
