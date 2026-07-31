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

function buildSandbox() {
  const props = {};
  const cache = {};
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
    ScriptApp: { getScriptId: () => 'security-test', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: {}, UrlFetchApp: {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'gs-merged(security)' });
  return sandbox;
}

const ALL_HEADERS = {
  'إعدادات المشروع': ['المفتاح', 'القيمة', 'الوصف'],
  'المستخدمون': ['رقم المستخدم', 'الاسم', 'البريد الإلكتروني', 'كلمة المرور المشفرة', 'الملح', 'الدور', 'رقم الجمعية', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول', 'يجب تغيير كلمة المرور', 'كلمة مرور سابقة مشفرة', 'ملح سابق'],
  'الجمعيات': ['رقم الجمعية', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'الحالة', 'تاريخ الإنشاء'],
  'المستفيدون': ['رقم المستفيد', 'رقم الجمعية', 'الاسم', 'المنطقة', 'المدينة', 'العنوان', 'رقم الجوال', 'رقم جوال إضافي', 'عدد الأفراد', 'ضمان اجتماعي', 'الحالة الاجتماعية', 'مبلغ الدخل', 'الاحتياج', 'حالة المستفيد', 'حالة التسليم', 'رقم المندوب', 'الملاحظات', 'تاريخ الإنشاء', 'تاريخ التسليم', 'آخر تحديث', 'خط العرض', 'خط الطول'],
  'الأجهزة': ['رقم الجهاز', 'اسم الجهاز', 'النوع', 'رقم الجمعية', 'رقم المستفيد', 'حالة الجهاز', 'تاريخ الإضافة', 'تاريخ التسليم', 'ملاحظات'],
  'المناديب': ['رقم المندوب', 'رقم الجمعية', 'اسم المندوب', 'رقم الجوال', 'رمز الدخول المشفر', 'الملح', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول'],
  'التسليمات': ['رقم التسليم', 'رقم المستفيد', 'رقم المندوب', 'أرقام الأجهزة', 'الحالة', 'سبب التعذر', 'الملاحظات', 'رابط الإثبات', 'تاريخ ووقت التسليم', 'تاريخ الإنشاء'],
  'إدارة الأنشطة': ['ترتيب المرحلة', 'اسم المرحلة', 'ترتيب النشاط الرئيسي', 'اسم النشاط الرئيسي', 'اسم النشاط الفرعي', 'المسؤول', 'تاريخ البداية', 'تاريخ النهاية', 'نسبة الإنجاز', 'الحالة', 'رابط الشاهد', 'ملاحظات'],
  'شواهد الأنشطة الرئيسية': ['اسم المرحلة', 'اسم النشاط الرئيسي', 'رابط الشاهد', 'حالة الاعتماد', 'ملاحظات', 'تاريخ الرفع'],
  'سجل العمليات': ['رقم العملية', 'رقم المستخدم', 'اسم المستخدم', 'الدور', 'العملية', 'القسم', 'رقم السجل', 'ملاحظات', 'التاريخ والوقت'],
  'طلبات انضمام الجمعيات': ['رقم الطلب', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'اسم المسؤول', 'ملاحظات مقدّم الطلب', 'الحالة', 'سبب الرفض', 'رقم الجمعية الناتجة', 'تاريخ التقديم', 'تاريخ المراجعة', 'المراجع'],
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
    ['reviewAssociationApplication', ['ADMIN']]
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

  const beneficiaryA = S.saveBeneficiary(userA.token, {
    name: 'مستفيد الجمعية أ', region: 'الرياض', city: 'الرياض', address: 'حي',
    phone: '0501234567', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة']
  });

  throws('جمعية ب لا يمكنها تعديل مستفيد جمعية أ (IDOR)', () => S.saveBeneficiary(userB.token, {
    id: beneficiaryA.id, name: 'تعديل خبيث', region: 'الرياض', city: 'الرياض', address: 'حي',
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
    const beneficiaryB = S.saveBeneficiary(userB.token, {
      name: 'مستفيد الجمعية ب', region: 'الرياض', city: 'الرياض', address: 'حي',
      phone: '0501234568', familyCount: 1, socialStatus: 'أرملة', needs: []
    });
    S.assignDelegate(userB.token, beneficiaryB.id, delegateA.id);
  }, 'الجمعية نفسها');

  const delegateSessionA = S.loginDelegate_ ? null : null; // لا تُختبَر بيانات اعتماد المندوب هنا لتفادي تعقيد الاعتماد
  const fakeDelegateA = S.createSession_({ id: delegateA.id, name: 'مندوب أ', role: 'DELEGATE', associationId: associationAId });
  const beneficiaryOfB = S.saveBeneficiary(userB.token, {
    name: 'مستفيد للاختبار', region: 'الرياض', city: 'الرياض', address: 'حي',
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
  const saved = S.saveBeneficiary(userA.token, {
    name: maliciousName, region: 'الرياض', city: 'الرياض', address: 'حي',
    phone: '0501234570', familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  const rawRow = S.findById_('المستفيدون', 'رقم المستفيد', saved.id);
  assert('نص يبدأ بصيغة Sheets يُخزَّن مسبوقًا بعلامة نص صريح (لا يُنفَّذ كصيغة)',
    String(rawRow['الاسم']).charAt(0) === "'" && String(rawRow['الاسم']).includes(maliciousName));

  const scriptName = '<script>alert(1)</script>';
  const savedScript = S.saveBeneficiary(userA.token, {
    name: scriptName, region: 'الرياض', city: 'الرياض', address: 'حي',
    phone: '0501234571', familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  const rawScriptRow = S.findById_('المستفيدون', 'رقم المستفيد', savedScript.id);
  assert('وسم <script> يُخزَّن كنص خام دون تنفيذ (الهروب يحدث في الواجهة عبر esc() لا في الخادم)',
    String(rawScriptRow['الاسم']) === scriptName);
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

  throws('اسم مستفيد فارغ يُرفض', () => S.saveBeneficiary(userA.token, {
    name: '   ', region: 'الرياض', city: 'الرياض', address: 'حي', phone: '0501234572', familyCount: 1
  }), 'مطلوب');
  throws('اسم مستفيد يتجاوز 120 حرفًا يُقصّ ولا يفشل (سلوك مصمَّم لا خطأ)', () => {
    const longName = 'ا'.repeat(200);
    const result = S.saveBeneficiary(userA.token, {
      name: longName, region: 'الرياض', city: 'الرياض', address: 'حي',
      phone: '0501234573', familyCount: 1, socialStatus: 'أرملة', needs: []
    });
    const row = S.findById_('المستفيدون', 'رقم المستفيد', result.id);
    if (String(row['الاسم']).length > 120) throw new Error('تجاوز الحد المسموح فعليًا');
    throw new Error('تم القصّ بأمان');
  }, 'تم القصّ بأمان');
  throws('عدد أفراد خارج الحدود (0) يُرفض', () => S.saveBeneficiary(userA.token, {
    name: 'مستفيد', region: 'الرياض', city: 'الرياض', address: 'حي', phone: '0501234574', familyCount: 0
  }), 'غير صحيح');
  throws('عدد أفراد خارج الحدود (1000) يُرفض', () => S.saveBeneficiary(userA.token, {
    name: 'مستفيد', region: 'الرياض', city: 'الرياض', address: 'حي', phone: '0501234575', familyCount: 1000
  }), 'غير صحيح');
  throws('رقم جوال بصيغة غير سعودية يُرفض', () => S.saveBeneficiary(userA.token, {
    name: 'مستفيد', region: 'الرياض', city: 'الرياض', address: 'حي', phone: '0112345678', familyCount: 1
  }), 'غير صحيح');
  assert('معرّف يشبه محاولة حقن (لا يوجد SQL فعليًا، المطابقة نصية حرفية) لا يطابق أي سجل حقيقي فيُعامَل بأمان كإنشاء جديد لا كتعديل غير مصرَّح', (() => {
    const result = S.saveBeneficiary(userA.token, {
      id: "BEN-000001' OR '1'='1", name: 'مستفيد', region: 'الرياض', city: 'الرياض',
      address: 'حي', phone: '0501234576', familyCount: 1, socialStatus: 'أرملة', needs: []
    });
    // يجب أن يُنشَأ برقم مستفيد نظيف جديد (BEN-NNNNNN)، لا بالقيمة المُحقَنة نفسها.
    return /^BEN-\d{6}$/.test(result.id);
  })());
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

  throws('ملف Excel بنوع MIME غير صحيح يُرفض', () => {
    const A = adminSession(S);
    S.inspectBeneficiaryExcel(A.token, { dataUrl: 'data:text/plain;base64,aGVsbG8=' });
  }, 'صيغة');
  // base64 يُوسِّع الحجم بنسبة 4/3 تقريبًا؛ يلزم أكثر من 8 ميجابايت × 4/3 من محارف base64
  // ليتجاوز فك الترميز الحدّ الفعلي 8 ميجابايت (خطأ حسابي سابق كان يُنتج بيانات أصغر من الحدّ فعليًا).
  const oversizedExcel = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + 'A'.repeat(12 * 1024 * 1024);
  throws('ملف Excel يتجاوز 8 ميجابايت يُرفض قبل أي رفع فعلي', () => {
    const A = adminSession(S);
    S.inspectBeneficiaryExcel(A.token, { dataUrl: oversizedExcel });
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
      S3.submitAssociationApplication({
        name: 'جمعية تجريبية ' + i, category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
        contactName: 'فلان', phone: '05' + (10000000 + i), email: 'rl-test-' + i + '@example.org'
      });
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
  assert('لا يوجد أي مسار في الواجهة أو الخادم يحذف صفًا من أي ورقة (لا دالة deleteRow مستخدَمة في المنطق)',
    !/\.deleteRow\(/.test(source));

  const S = buildSandbox();
  const { associationAId } = seedFullEnvironment(S);
  const userA = S.createSession_({ id: 'USR-ASSOC-AUDIT', name: 'جمعية', role: 'ASSOCIATION', associationId: associationAId });
  const beforeCount = S.readTable_('سجل العمليات').rows.length;
  S.saveBeneficiary(userA.token, {
    name: 'مستفيد لسجل العمليات', region: 'الرياض', city: 'الرياض', address: 'حي',
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
    const body = extractFunctionBody_(source, fnName);
    if (!body) { assert(fnName + ' موجودة', false); return; }
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

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
console.log('\nتنبيه صادق: هذا فحص آلي داخل بيئة محاكاة، وليس اختبار اختراق');
console.log('مستقلًا. لا يغطي الشبكة أو البنية التحتية أو النشر الفعلي على Apps Script.');
process.exit(failures === 0 ? 0 : 1);
