#!/usr/bin/env node
/**
 * اختبارات إدارة حسابات الجمعيات والمناديب واستعادة الوصول الآمنة:
 * إعادة تعيين كلمة مرور الجمعية، إجبار تغييرها عند أول دخول، منع إعادة
 * استخدام كلمة المرور السابقة، إعادة إنشاء رمز دخول المندوب وإبطال
 * القديم، تفعيل/تعطيل المندوب، عزل الجمعيات عن مناديب بعضها، مقاومة
 * التكرار والتزامن، وعدم كشف أي سر (تجزئة/ملح/كلمة مرور قديمة) في أي
 * استجابة أو سجل عمليات.
 *
 *   تشغيل:  node tools/account-test.js
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

/* -------- بيئة محاكاة (مطابقة لتلك المستخدَمة في state-test.js) -------- */

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
    ScriptApp: { getScriptId: () => 'account-test', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: {
      createFolder: () => ({
        getId: () => 'folder-id', getUrl: () => 'https://drive.example/folder',
        createFile: () => ({ getUrl: () => 'https://drive.example/file' })
      }),
      getFolderById: () => ({ createFile: () => ({ getUrl: () => 'https://drive.example/file' }) })
    },
    UrlFetchApp: {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'gs-merged(account)' });
  return sandbox;
}

const __headerSandbox = buildSandbox();
const ALL_HEADERS = {
  'إعدادات المشروع': ['المفتاح', 'القيمة', 'الوصف'],
  'المستخدمون': ['رقم المستخدم', 'الاسم', 'البريد الإلكتروني', 'كلمة المرور المشفرة', 'الملح', 'الدور', 'رقم الجمعية', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول', 'يجب تغيير كلمة المرور', 'كلمة مرور سابقة مشفرة', 'ملح سابق'],
  'الجمعيات': ['رقم الجمعية', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'الحالة', 'تاريخ الإنشاء'],
  'المستفيدون': ['رقم المستفيد', 'رقم الجمعية', 'الاسم', 'المنطقة', 'المدينة', 'العنوان', 'رقم الجوال', 'رقم جوال إضافي', 'عدد الأفراد', 'ضمان اجتماعي', 'الحالة الاجتماعية', 'مبلغ الدخل', 'الاحتياج', 'حالة المستفيد', 'حالة التسليم', 'رقم المندوب', 'الملاحظات', 'تاريخ الإنشاء', 'تاريخ التسليم', 'آخر تحديث', 'خط العرض', 'خط الطول', 'علامة مميزة', 'مصدر الموقع', 'تاريخ تحديث الموقع'],
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
  return S.createSession_({ id: 'USR-ADMIN-AC', name: 'مدير الاختبار', role: 'ADMIN', associationId: '' });
}

/** يبني بيئة كاملة: جمعيتان + مندوب لكل واحدة، لاختبار العزل بينهما أيضًا. */
function seedScenario(S) {
  seedSheets(S);
  const admin = adminSession(S);
  const assocA = S.saveAssociation(admin.token, {
    name: 'جمعية الحسابات أ', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000020', email: 'assoc-a@example.org', password: 'AssocPassA123'
  });
  const assocB = S.saveAssociation(admin.token, {
    name: 'جمعية الحسابات ب', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000021', email: 'assoc-b@example.org', password: 'AssocPassB123'
  });
  const userA = findUserByAssociation(S, assocA.id);
  const userB = findUserByAssociation(S, assocB.id);
  const assocASession = S.createSession_({ id: String(userA['رقم المستخدم']), name: 'جمعية الحسابات أ', role: 'ASSOCIATION', associationId: assocA.id });
  const assocBSession = S.createSession_({ id: String(userB['رقم المستخدم']), name: 'جمعية الحسابات ب', role: 'ASSOCIATION', associationId: assocB.id });
  const delegateA = S.saveDelegate(assocASession.token, { name: 'مندوب أ', phone: '0500000022' });
  const delegateB = S.saveDelegate(assocBSession.token, { name: 'مندوب ب', phone: '0500000023' });
  return { S, admin, assocA, assocB, assocASession, assocBSession, delegateA, delegateB };
}

function findUserByAssociation(S, associationId) {
  return S.readTable_('المستخدمون').rows.find(row =>
    String(row['رقم الجمعية']) === String(associationId) && String(row['الدور']) === 'ASSOCIATION'
  );
}

/* ================================================================
   1) إعادة تعيين كلمة مرور الجمعية
   ================================================================ */

section('1) إعادة تعيين كلمة مرور الجمعية');
{
  const { S, admin, assocA } = seedScenario(buildSandbox());

  throws('غير الإدارة (جمعية) لا تستطيع إعادة تعيين كلمة مرور أي جمعية', () => {
    const { assocASession } = { assocASession: S.createSession_({ id: 'X', name: 'x', role: 'ASSOCIATION', associationId: assocA.id }) };
    S.resetAssociationPassword(assocASession.token, assocA.id);
  }, 'صلاحية');

  const result = S.resetAssociationPassword(admin.token, assocA.id);
  assert('إعادة التعيين تنجح وتعيد كلمة مرور مؤقتة قوية جديدة', result.ok === true
    && typeof result.temporaryPassword === 'string' && result.temporaryPassword.length >= 10
    && /[A-Za-z]/.test(result.temporaryPassword) && /\d/.test(result.temporaryPassword));

  const record = findUserByAssociation(S, assocA.id);
  assert('الحساب يُعلَّم "يجب تغيير كلمة المرور" بعد إعادة التعيين', String(record['يجب تغيير كلمة المرور']) === 'نعم');

  const loginResult = S.login({ type: 'user', email: 'assoc-a@example.org', password: result.temporaryPassword });
  assert('تسجيل الدخول بكلمة المرور المؤقتة الجديدة ينجح', loginResult.ok === true);
  assert('استجابة الدخول لا تحتوي بيانات بوابة كاملة قبل تغيير كلمة المرور', loginResult.bootstrap === undefined && loginResult.mustChangePassword === true);

  throws('كلمة المرور القديمة (قبل إعادة التعيين) لم تعد صالحة للدخول', () =>
    S.login({ type: 'user', email: 'assoc-a@example.org', password: 'AssocPassA123' }), 'بيانات الدخول غير صحيحة');
}

/* ================================================================
   2) إبطال الجلسات القديمة عند إعادة التعيين
   ================================================================ */

section('2) إبطال الجلسات القديمة عند إعادة تعيين كلمة مرور الجمعية');
{
  const { S, admin, assocA, assocASession, delegateA } = seedScenario(buildSandbox());
  const beforeUser = findUserByAssociation(S, assocA.id);

  assert('جلسة الجمعية صالحة قبل إعادة التعيين', (() => {
    try { S.requireSession_(assocASession.token, ['ASSOCIATION']); return true; } catch (e) { return false; }
  })());

  S.resetAssociationPassword(admin.token, assocA.id);

  throws('جلسة الجمعية القديمة تُرفض فورًا بعد إعادة تعيين كلمة المرور', () =>
    S.requireSession_(assocASession.token, ['ASSOCIATION']), 'انتهت الجلسة');

  const delegateSession = S.createSession_({ id: delegateA.id, name: 'مندوب أ', role: 'DELEGATE', associationId: assocA.id });
  assert('جلسة مندوب الجمعية نفسها لا تتأثر بإعادة تعيين كلمة مرور الجمعية (سرّان مستقلان)', (() => {
    try { S.requireSession_(delegateSession.token, ['DELEGATE']); return true; } catch (e) { return false; }
  })());
}

/* ================================================================
   3) فرض تغيير كلمة المرور عند أول دخول
   ================================================================ */

section('3) فرض تغيير كلمة المرور المؤقتة عند أول دخول');
{
  const { S, admin, assocA } = seedScenario(buildSandbox());
  const reset = S.resetAssociationPassword(admin.token, assocA.id);
  const loginResult = S.login({ type: 'user', email: 'assoc-a@example.org', password: reset.temporaryPassword });
  const token = loginResult.token;

  throws('الخادم يرفض getBootstrapData طالما لم تُغيَّر كلمة المرور المؤقتة', () =>
    S.getBootstrapData(token), 'يجب تغيير كلمة المرور');
  throws('الخادم يرفض saveBeneficiary طالما لم تُغيَّر كلمة المرور المؤقتة (لا تجاوز عبر API مباشر)', () =>
    S.saveBeneficiary(token, { name: 'تجاوز', region: 'الرياض', city: 'الرياض', address: 'حي', phone: '0500000099', familyCount: 1, socialStatus: 'أرملة', needs: [] }),
    'يجب تغيير كلمة المرور');

  throws('changePassword يرفض كلمة مرور جديدة ضعيفة حتى في وضع الإلزام', () =>
    S.changePassword(token, reset.temporaryPassword, 'weak'), 'كلمة المرور الجديدة');

  const changeResult = S.changePassword(token, reset.temporaryPassword, 'BrandNewPass456');
  assert('changePassword ينجح ويكسر القفل الإلزامي', changeResult.ok === true);

  const record = findUserByAssociation(S, assocA.id);
  assert('علامة "يجب تغيير كلمة المرور" تُمسَح بعد نجاح التغيير', String(record['يجب تغيير كلمة المرور']) === 'لا');

  throws('التوكن نفسه يُبطَل أيضًا بعد تغيير كلمة المرور — يجب تسجيل دخول جديد', () =>
    S.requireSession_(token, ['ASSOCIATION']), 'انتهت الجلسة');

  const reLogin = S.login({ type: 'user', email: 'assoc-a@example.org', password: 'BrandNewPass456' });
  assert('تسجيل الدخول بكلمة المرور الجديدة يعمل بشكل طبيعي كامل (بلا قفل إلزامي)', reLogin.ok === true && reLogin.mustChangePassword === undefined && !!reLogin.bootstrap);

  throws('لا يمكن إعادة استخدام كلمة المرور المؤقتة السابقة عند التغيير التالي', () => {
    const t2 = reLogin.token;
    S.changePassword(t2, 'BrandNewPass456', reset.temporaryPassword);
  }, 'السابقة');
}

/* ================================================================
   4) عدم تسجيل أي سرّ في سجل العمليات
   ================================================================ */

section('4) عدم تسجيل كلمة المرور أو الرمز في سجل العمليات');
{
  const { S, admin, assocA, assocASession, delegateA } = seedScenario(buildSandbox());
  // إعادة إنشاء رمز المندوب أولًا — إعادة تعيين كلمة مرور الجمعية أدناه
  // تُبطل جلسة حساب الجمعية نفسه (سلوك مقصود ومختبر في القسم 2)، فترتيب
  // الاستدعاءين هنا مقصود حتى لا تُستخدَم جلسة مُبطَلة سلفًا.
  const regen = S.regenerateDelegateCode(assocASession.token, delegateA.id);
  const reset = S.resetAssociationPassword(admin.token, assocA.id);

  const auditRows = S.readTable_('سجل العمليات').rows;
  const auditText = JSON.stringify(auditRows);
  assert('كلمة المرور المؤقتة الجديدة غير موجودة نصيًا في أي سطر من سجل العمليات', auditText.indexOf(reset.temporaryPassword) === -1);
  assert('رمز دخول المندوب الجديد غير موجود نصيًا في أي سطر من سجل العمليات', auditText.indexOf(regen.accessCode) === -1);

  const resetLog = auditRows.find(r => String(r['العملية']) === 'إعادة تعيين كلمة مرور جمعية');
  assert('سطر تسجيل إعادة التعيين موجود ويوثّق الجمعية دون كلمة المرور', !!resetLog && String(resetLog['رقم السجل']) === assocA.id);
  const regenLog = auditRows.find(r => String(r['العملية']) === 'إعادة إنشاء رمز الدخول');
  assert('سطر تسجيل إعادة إنشاء الرمز موجود ويوثّق المندوب دون الرمز نفسه', !!regenLog && String(regenLog['رقم السجل']) === delegateA.id);
}

/* ================================================================
   5) إنشاء رمز مندوب جديد وإبطال القديم
   ================================================================ */

section('5) إعادة إنشاء رمز دخول المندوب وإبطال القديم');
{
  const { S, assocASession, delegateA } = seedScenario(buildSandbox());
  const firstLogin = S.login({ type: 'delegate', code: delegateA.accessCode });
  assert('الدخول بالرمز الأول ينجح قبل إعادة الإنشاء', firstLogin.ok === true);

  const regen = S.regenerateDelegateCode(assocASession.token, delegateA.id);
  assert('إعادة إنشاء الرمز تعيد رمزًا جديدًا مختلفًا عن القديم', regen.accessCode !== delegateA.accessCode);

  throws('الرمز القديم لم يعد صالحًا للدخول بعد إعادة الإنشاء', () =>
    S.login({ type: 'delegate', code: delegateA.accessCode }), 'رمز الدخول غير صحيح');
  throws('جلسة المندوب المفتوحة بالرمز القديم تُقطع فورًا', () =>
    S.requireSession_(firstLogin.token, ['DELEGATE']), 'انتهت الجلسة');

  const newLogin = S.login({ type: 'delegate', code: regen.accessCode });
  assert('الدخول بالرمز الجديد ينجح', newLogin.ok === true);
}

/* ================================================================
   6) منع دخول المندوب المعطل
   ================================================================ */

section('6) منع دخول المندوب المعطل ومتابعة جلسة قديمة');
{
  const { S, assocASession, delegateA } = seedScenario(buildSandbox());
  const login1 = S.login({ type: 'delegate', code: delegateA.accessCode });
  assert('الدخول ينجح قبل التعطيل', login1.ok === true);

  const disableResult = S.setDelegateStatus(assocASession.token, delegateA.id, 'غير نشط');
  assert('تعطيل المندوب ينجح', disableResult.ok === true);

  throws('جلسة المندوب المفتوحة قبل التعطيل تُقطع فورًا (لا تُكمل باستخدام جلسة قديمة)', () =>
    S.requireSession_(login1.token, ['DELEGATE']), 'انتهت الجلسة');
  throws('محاولة دخول جديدة بنفس الرمز بعد التعطيل تُرفض', () =>
    S.login({ type: 'delegate', code: delegateA.accessCode }), 'غير نشط');

  const enableResult = S.setDelegateStatus(assocASession.token, delegateA.id, 'نشط');
  assert('إعادة التفعيل تنجح', enableResult.ok === true);
  const login2 = S.login({ type: 'delegate', code: delegateA.accessCode });
  assert('الدخول بنفس الرمز ينجح مجددًا بعد إعادة التفعيل', login2.ok === true);
}

/* ================================================================
   7) منع جمعية من إدارة مندوب جمعية أخرى
   ================================================================ */

section('7) عزل الجمعيات — منع إدارة مندوب جمعية أخرى');
{
  const { S, assocASession, assocBSession, delegateA, delegateB } = seedScenario(buildSandbox());

  throws('جمعية ب لا تستطيع إعادة إنشاء رمز مندوب جمعية أ', () =>
    S.regenerateDelegateCode(assocBSession.token, delegateA.id), 'ليس لديك صلاحية');
  throws('جمعية ب لا تستطيع تعطيل مندوب جمعية أ', () =>
    S.setDelegateStatus(assocBSession.token, delegateA.id, 'غير نشط'), 'ليس لديك صلاحية');
  throws('جمعية أ لا تستطيع إعادة إنشاء رمز مندوب جمعية ب', () =>
    S.regenerateDelegateCode(assocASession.token, delegateB.id), 'ليس لديك صلاحية');
  throws('جمعية أ لا تستطيع تعطيل مندوب جمعية ب', () =>
    S.setDelegateStatus(assocASession.token, delegateB.id, 'غير نشط'), 'ليس لديك صلاحية');

  const stillActiveA = S.findById_('المناديب', 'رقم المندوب', delegateA.id);
  const stillActiveB = S.findById_('المناديب', 'رقم المندوب', delegateB.id);
  assert('مندوب أ يبقى نشطًا رغم محاولات جمعية ب المرفوضة', String(stillActiveA['الحالة']) === 'نشط');
  assert('مندوب ب يبقى نشطًا رغم محاولات جمعية أ المرفوضة', String(stillActiveB['الحالة']) === 'نشط');
}

/* ================================================================
   8) مقاومة تكرار الطلب والتزامن
   ================================================================ */

section('8) مقاومة تكرار الطلب والتزامن — لا يبقى أكثر من رمز/كلمة مرور صالحة');
{
  const { S, admin, assocA, assocASession, delegateA } = seedScenario(buildSandbox());

  // إعادة تعيين متكررة سريعة لكلمة مرور الجمعية: كل نتيجة سابقة تصبح
  // فورًا غير صالحة بمجرد ظهور نتيجة تالية — لا يبقى أكثر من كلمة مرور
  // واحدة صالحة في أي لحظة، بصرف النظر عن عدد الاستدعاءات المتتالية.
  const r1 = S.resetAssociationPassword(admin.token, assocA.id);
  const r2 = S.resetAssociationPassword(admin.token, assocA.id);
  throws('كلمة المرور المؤقتة الأولى تصبح غير صالحة بعد إعادة تعيين ثانية فورية', () =>
    S.login({ type: 'user', email: 'assoc-a@example.org', password: r1.temporaryPassword }), 'بيانات الدخول غير صحيحة');
  const loginWithLatest = S.login({ type: 'user', email: 'assoc-a@example.org', password: r2.temporaryPassword });
  assert('كلمة المرور المؤقتة الأخيرة فقط هي الصالحة', loginWithLatest.ok === true);

  throws('تحديد المعدّل يمنع سلسلة طويلة من إعادات التعيين المتتالية على نفس الجمعية', () => {
    for (let i = 0; i < 10; i++) S.resetAssociationPassword(admin.token, assocA.id);
  }, 'محاولات كثيرة');

  // نفس المبدأ لرمز دخول المندوب — بجلسة جمعية جديدة لأن سابقتها أُبطلت
  // أعلاه بفعل إعادة تعيين كلمة مرور الجمعية نفسها (سلوك متوقَّع، القسم 2).
  const freshAssocASession = S.createSession_({
    id: String(findUserByAssociation(S, assocA.id)['رقم المستخدم']),
    name: 'جمعية الحسابات أ', role: 'ASSOCIATION', associationId: assocA.id
  });
  const c1 = S.regenerateDelegateCode(freshAssocASession.token, delegateA.id);
  const c2 = S.regenerateDelegateCode(freshAssocASession.token, delegateA.id);
  throws('الرمز الأول يصبح غير صالح بعد إعادة إنشاء ثانية فورية', () =>
    S.login({ type: 'delegate', code: c1.accessCode }), 'رمز الدخول غير صحيح');
  const loginWithLatestCode = S.login({ type: 'delegate', code: c2.accessCode });
  assert('رمز الدخول الأخير فقط هو الصالح', loginWithLatestCode.ok === true);
}

/* ================================================================
   9) عدم كشف hash أو salt أو أسرار قديمة في أي استجابة
   ================================================================ */

section('9) الاستجابات لا تحتوي على تجزئة أو ملح أو أسرار قديمة');
{
  const { S, admin, assocA, assocASession, delegateA } = seedScenario(buildSandbox());
  const record = findUserByAssociation(S, assocA.id);
  const secretMarkers = [String(record['كلمة المرور المشفرة']), String(record['الملح'])];

  // إعادة إنشاء رمز المندوب أولًا لأن إعادة تعيين كلمة المرور أدناه
  // تُبطل جلسة حساب الجمعية نفسه (سلوك مقصود، مختبر في القسم 2).
  const delegateRecord = S.findById_('المناديب', 'رقم المندوب', delegateA.id);
  const delegateSecretMarkers = [String(delegateRecord['رمز الدخول المشفر']), String(delegateRecord['الملح'])];
  const regen = S.regenerateDelegateCode(assocASession.token, delegateA.id);
  const regenJson = JSON.stringify(regen);

  const reset = S.resetAssociationPassword(admin.token, assocA.id);
  const resetJson = JSON.stringify(reset);
  assert('استجابة resetAssociationPassword لا تحتوي على أي مفتاح hash/salt', resetJson.indexOf('كلمة المرور المشفرة') === -1 && resetJson.indexOf('الملح') === -1);
  secretMarkers.forEach(marker => {
    assert('استجابة resetAssociationPassword لا تحتوي على قيمة التجزئة/الملح القديمة حرفيًا', resetJson.indexOf(marker) === -1);
  });

  assert('استجابة regenerateDelegateCode لا تحتوي على أي مفتاح تجزئة/ملح', regenJson.indexOf('رمز الدخول المشفر') === -1 && regenJson.indexOf('الملح') === -1);
  delegateSecretMarkers.forEach(marker => {
    assert('استجابة regenerateDelegateCode لا تحتوي على قيمة التجزئة/الملح القديمة حرفيًا', regenJson.indexOf(marker) === -1);
  });

  const loginResult = S.login({ type: 'user', email: 'assoc-a@example.org', password: reset.temporaryPassword });
  const bootstrapAfterChange = (() => {
    S.changePassword(loginResult.token, reset.temporaryPassword, 'FreshPass789');
    const relog = S.login({ type: 'user', email: 'assoc-a@example.org', password: 'FreshPass789' });
    return relog.bootstrap;
  })();
  const bootstrapJson = JSON.stringify(bootstrapAfterChange);
  assert('getBootstrapData (عبر تضمينها في login) لا تحتوي إطلاقًا على حقول التجزئة أو الملح', bootstrapJson.indexOf('كلمة المرور المشفرة') === -1 && bootstrapJson.indexOf('الملح') === -1);
}

/* ================================================================
   10) لا تراجع في قواعد الحالات المُنجزة سابقًا (c449d3d)
   ================================================================ */

section('10) عدم تراجع قواعد سلامة الحالات (StateRules.gs) بهذا التعديل');
{
  const S = buildSandbox();
  assert('assertDeviceTransition_ ما زالت مرفوضة لتجاوز مراحل الجهاز', (() => {
    try { S.assertDeviceTransition_('بالمستودع', 'تم التسليم'); return false; } catch (e) { return e.message.indexOf('غير مسموح') >= 0; }
  })());
  assert('assertDeliveryTransition_ ما زالت ترفض إعادة تأكيد تسليم مكتمل', (() => {
    try { S.assertDeliveryTransition_('تم التسليم', 'تم التسليم'); return false; } catch (e) { return e.message.indexOf('غير مسموح') >= 0; }
  })());
  assert('repairStateIntegrityIssues_ ما زالت غير مُستدعاة تلقائيًا من أي مكان', (() => {
    const callSites = (source.match(/repairStateIntegrityIssues_\(/g) || []).length;
    return callSites === 1;
  })());
}

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
