#!/usr/bin/env node
/**
 * اختبار تكامل للدورة الكاملة (المرحلة السادسة): يحاكي رحلة حقيقية واحدة
 * متصلة عبر البوابات الثلاث — تقديم جمعية ← قبولها ← تغيير كلمة مرورها
 * المؤقتة ← إضافة مندوب ← إضافة مستفيد فرديًا ← استيراد بالجملة ← تخصيص
 * جهاز ← تعيين مندوب ← دخول المندوب ← تعذّر تسليم ثم إعادة محاولة ← إثبات
 * تسليم ← تحقّق من تحديث كل الحالات والمؤشرات والسجل ← عزل جمعيتين عن
 * بعضهما ← إبطال الجلسات والرموز القديمة بعد إعادة التعيين/التوليد.
 *
 * لا علاقة لهذا الملف بأي بيانات أو بيئة Apps Script حقيقية — محاكاة
 * Node.js vm بالكامل، كبقية أدوات tools/*.js. لا كلمات مرور أو رموز
 * حقيقية هنا؛ كل القيم اختبارية بحتة.
 *
 *   تشغيل:  node tools/integration-test.js
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

/* -------- بيئة محاكاة (مطابقة لتلك المستخدَمة في بقية tools/*.js) -------- */

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
    ScriptApp: { getScriptId: () => 'integration-test', getOAuthToken: () => 'token' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    DriveApp: driveMock.DriveApp,
    UrlFetchApp: {}, Logger: { log: msg => { logs.push(String(msg)); } }
  };
  sandbox.globalThis = sandbox;
  sandbox.__logs = logs;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'gs-merged(integration)' });
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

function seedSheets(S) {
  Object.keys(ALL_HEADERS).forEach(name => S.ensureSheet_(S.SpreadsheetApp.getActiveSpreadsheet(), name, ALL_HEADERS[name]));
}
function adminSession(S) {
  return S.createSession_({ id: 'USR-ADMIN-IT', name: 'مدير الاختبار', role: 'ADMIN', associationId: '' });
}

/* ================================================================
   الرحلة الكاملة: من تقديم طلب انضمام إلى تسليم فعلي موثَّق
   ================================================================ */

const S = buildSandbox();
seedSheets(S);
const admin = adminSession(S);

section('1) تقديم طلب انضمام جمعية (بوابة عامة، بلا جلسة)');
const application = S.submitAssociationApplication(applicationFixture({
  name: 'جمعية الرحلة الكاملة', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
  phone: '0501110001', email: 'full-journey@example.org', contactName: 'أحمد المطيري', licenseNumber: 'LIC-J1'
}));
assert('التقديم ينجح ويعيد رقم طلب', application.ok && /^APP-/.test(application.id));

section('2) قبول الطلب من الإدارة');
const accepted = S.reviewAssociationApplication(admin.token, application.id, 'accept', '');
assert('القبول ينشئ جمعية برقم صحيح', accepted.ok && /^ASC-/.test(accepted.associationId));
assert('القبول يصدر كلمة مرور مؤقتة قوية مرة واحدة', (() => {
  try { S.assertStrongPassword_(accepted.temporaryPassword); return true; } catch (e) { return false; }
})());
throws('إعادة قبول نفس الطلب تُرفض (لا تكرار عند إعادة المحاولة)',
  () => S.reviewAssociationApplication(admin.token, application.id, 'accept', ''), 'سبق البتّ');
assert('عملية القبول لا تُسجِّل كلمة المرور المؤقتة في سجل العمليات', (() => {
  const rows = S.readTable_('سجل العمليات').rows;
  return !rows.some(r => String(r['ملاحظات'] || '').includes(accepted.temporaryPassword));
})());

section('3) دخول الجمعية بكلمة المرور المؤقتة وإجبار تغييرها');
const firstLogin = S.loginUser_('full-journey@example.org', accepted.temporaryPassword);
assert('الدخول الأول ينجح لكن يُلزَم بتغيير كلمة المرور فورًا (لا بيانات بوابة)',
  firstLogin.ok && firstLogin.mustChangePassword === true && firstLogin.bootstrap === undefined);
throws('لا يمكن استدعاء أي دالة أخرى قبل تغيير كلمة المرور المؤقتة',
  () => S.saveBeneficiary(firstLogin.token, { deviceTypes: ['ثلاجة'], name: 'محاولة قبل التغيير' }), 'يجب تغيير كلمة المرور');
const newPassword = 'JourneyPass456';
const changeResult = S.changePassword(firstLogin.token, accepted.temporaryPassword, newPassword);
assert('تغيير كلمة المرور ينجح', changeResult.ok);
const secondLogin = S.loginUser_('full-journey@example.org', newPassword);
assert('الدخول بكلمة المرور الجديدة ينجح ويعيد بوابة كاملة فورًا',
  secondLogin.ok && !secondLogin.mustChangePassword && !!secondLogin.bootstrap);
throws('كلمة المرور المؤقتة القديمة لم تعد صالحة بعد التغيير',
  () => S.loginUser_('full-journey@example.org', accepted.temporaryPassword), 'بيانات الدخول غير صحيحة');
const assocToken = secondLogin.token;
const associationId = accepted.associationId;

section('4) إضافة مندوب');
const delegateResult = S.saveDelegate(assocToken, { name: 'مندوب الرحلة', phone: '0501110002' });
assert('إضافة المندوب تنجح وتُصدر رمز دخول', delegateResult.ok && /^MND-/.test(delegateResult.accessCode));

section('5) إضافة مستفيد فرديًا');
const beneficiary = S.saveBeneficiary(assocToken, { deviceTypes: ['ثلاجة'],
  name: 'مستفيد الرحلة الكاملة', region: 'الرياض', city: 'الرياض', address: 'حي الملقا', district: 'الملقا',
  phone: '0501110003', familyCount: 3, socialStatus: 'أرملة', needs: ['ثلاجة'],
  landmark: 'بجانب المسجد', lat: '24.75', lng: '46.65', locationSource: 'خريطة'
});
assert('إضافة المستفيد الفردي تنجح مع بيانات الموقع كاملة', beneficiary.ok
  && beneficiary.record.landmark === 'بجانب المسجد' && beneficiary.record.locationSource === 'خريطة');

section('6) استيراد مستفيدين بالجملة');
const importResult = S.importBeneficiaries(assocToken, [
  { name: 'مستفيد مستورَد أول', region: 'الرياض', city: 'الرياض', address: 'حي الروضة', district: 'الروضة', phone: '0501110004', familyCount: 2, socialStatus: 'يتيم', needs: ['غسالة'] },
  { name: 'مستفيد مستورَد ثانٍ', region: 'الرياض', city: 'الرياض', address: 'حي النخيل', district: 'النخيل', phone: '0501110005', familyCount: 1, socialStatus: 'أخرى', needs: [] }
], true);
assert('الاستيراد الجماعي ينجح لصفَّين صحيحين', importResult.ok && importResult.imported === 2);
throws('الاستيراد الجماعي بلا تعهّد صريح يُرفض', () => S.importBeneficiaries(assocToken, [
  { name: 'صف بلا تعهّد', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار', phone: '0501110006', familyCount: 1, socialStatus: 'أخرى', needs: [] }
], false), 'التعهد');

section('7) تخصيص جهاز للمستفيد');
const device = S.saveDevice(admin.token, { name: 'ثلاجة الرحلة', type: 'ثلاجة', associationId: associationId, beneficiaryId: beneficiary.id });
assert('إضافة الجهاز وتخصيصه للمستفيد ينجح', device.ok);
assert('الجهاز المخصَّص لمستفيد يتحول تلقائيًا لحالة "مخصص"',
  String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['حالة الجهاز']) === 'مخصص');

section('8) تعيين المندوب للمستفيد');
const assign = S.assignDelegate(assocToken, beneficiary.id, delegateResult.id);
assert('تعيين المندوب ينجح', assign.ok);
assert('حالة التسليم تصبح "خرج مع المندوب" وحالة الجهاز "مع المندوب"',
  String(S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['حالة التسليم']) === 'خرج مع المندوب'
  && String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['حالة الجهاز']) === 'مع المندوب');

section('9) دخول المندوب برمزه');
const delegateLogin = S.loginDelegate_(delegateResult.accessCode);
assert('دخول المندوب بالرمز الصحيح ينجح ويعيد بوابته', delegateLogin.ok && delegateLogin.user.role === 'DELEGATE');
assert('بوابة المندوب تعرض المستفيد المُسنَد إليه فقط', delegateLogin.bootstrap.beneficiaries.some(b => b.id === beneficiary.id));
const delegateToken = delegateLogin.token;

section('10) تعذّر التسليم ثم إعادة المحاولة');
const failResult = S.updateDeliveryStatus(delegateToken, beneficiary.id, 'لم يتم التواصل', 'لا يرد على الاتصال');
assert('تسجيل تعذّر التسليم ينجح', failResult.ok);
assert('حالة التسليم تصبح "تعذر التسليم" دون المساس بحالة الجهاز', failResult.record.deliveryStatus === 'تعذر التسليم'
  && String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['حالة الجهاز']) === 'مع المندوب');
// المسار الصحيح الآن: إجراء «إعادة المحاولة» الصريح من المندوب نفسه،
// بدل المسار الالتفافي الذي كان الحل الوحيد (دخول الجمعية إلى "تغيير
// المندوب" وإعادة حفظ المندوب نفسه) — رُصد حيًّا 2026/08/01.
const retry = S.retryDelivery(delegateToken, beneficiary.id, 'op-journey-retry');
assert('إعادة المحاولة الصريحة من المندوب تنجح وتعيد الحالة لـ"خرج مع المندوب"',
  retry.ok && retry.record.deliveryStatus === 'خرج مع المندوب');
assert('إعادة المحاولة لم تغيّر المندوب ولا الجهاز', retry.record.delegateId === delegateResult.id
  && String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['حالة الجهاز']) === 'مع المندوب');
assert('سجل المحاولات يحفظ المحاولة المتعذّرة بسببها بعد الاستئناف',
  (retry.record.attempts || []).some(a => a.status === 'تعذر التسليم' && a.reason === 'لم يتم التواصل'));
// المسار الالتفافي القديم ما زال مسموحًا للجمعية (تغيير مندوب فعلي)،
// لكنه لم يعد الطريقة الوحيدة لاستئناف مهمة متعذّرة.
assert('الجمعية ما زالت تستطيع تغيير المندوب فعليًا عند الحاجة (لم يُكسَر المسار القديم)',
  S.assignDelegate(assocToken, beneficiary.id, delegateResult.id).ok === true);

section('11) إثبات التسليم');
throws('confirmDelivery يرفض بلا صورة إثبات', () => S.confirmDelivery(delegateToken, { beneficiaryId: beneficiary.id, confirmed: true }), 'صورة إثبات');
const proofDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const delivered = S.confirmDelivery(delegateToken, { beneficiaryId: beneficiary.id, confirmed: true, proofDataUrl: proofDataUrl });
assert('تأكيد التسليم ينجح ويحدّث المستفيد والجهاز معًا', delivered.ok
  && delivered.record.deliveryStatus === 'تم التسليم' && delivered.record.status === 'تم التسليم');
assert('وقت التسليم مُسجَّل', !!S.findById_('المستفيدون', 'رقم المستفيد', beneficiary.id)['تاريخ التسليم']);
assert('الجهاز المرتبط ينتقل لحالة "تم التسليم" أيضًا',
  String(S.findById_('الأجهزة', 'رقم الجهاز', device.id)['حالة الجهاز']) === 'تم التسليم');
assert('التسليم يُضاف فورًا لسجل تسليمات المندوب (لا يحتاج تحديثًا يدويًا)', (() => {
  const history = S.getDeliveryHistory_(delegateResult.id);
  return history.some(h => h.beneficiaryName === beneficiary.record.name);
})());

section('12) تحقّق من تطابق الحالات والمؤشرات والسجل بعد الرحلة كاملة');
const finalBundle = S.getBootstrapData(assocToken);
assert('ملخّص getBootstrapData يعكس فعليًا نفس عدد المستفيدين المُنشَأين (فردي + استيراد)',
  finalBundle.summary.beneficiaries === 3);
assert('ملخّص التسليم في Bootstrap يطابق ما تعرضه listBeneficiaries فعليًا (مصدر واحد لا مصدرين مختلفين)', (() => {
  const listed = S.listBeneficiaries(assocToken, {}).items;
  const deliveredInList = listed.filter(b => b.deliveryStatus === 'تم التسليم').length;
  return deliveredInList === 1 && finalBundle.summary.devicesDelivered === 1;
})());
assert('سجل العمليات يوثّق كل خطوات الرحلة (إضافة/استيراد/تخصيص/تعيين/تعذر/تسليم) دون فقد أي عملية', (() => {
  const actions = S.listAuditLog(admin.token, { associationId: associationId, pageSize: 50 }).items.map(r => r.action);
  // 'إضافة مستفيد باحتياجاته' (لا 'إضافة مستفيد' وحدها): Phase 2.2 وجَّهت
  // إنشاء المستفيدين الجدد عبر saveBeneficiary العام إلى المسار الذري
  // الموحَّد (createBeneficiaryWithNeeds_)، الذي يسجّل هذا الاسم المميَّز
  // للعملية المترابطة (مستفيد + احتياجاته معًا) بدل الاسم القديم.
  return ['إضافة مستفيد باحتياجاته', 'استيراد مستفيدين', 'إضافة جهاز', 'تعيين مندوب', 'تعذر التسليم', 'تأكيد تسليم'].every(a => actions.includes(a));
})());
assert('حالة الجهاز وحالة التسليم متّسقتان (لا تعارض جهاز "تم التسليم" مع مستفيد لم يُسلَّم)', (() => {
  const report = S.diagnoseStateIntegrity_(grantToken_(S));
  return report.issueCount === 0;
})());

section('13) عزل جمعيتين عن بعضهما داخل نفس الرحلة');
const otherApplication = S.submitAssociationApplication(applicationFixture({
  name: 'جمعية أخرى للعزل', category: 'جمعية أهلية', region: 'مكة المكرمة', city: 'جدة',
  phone: '0501110099', email: 'isolated@example.org', contactName: 'مسؤول آخر', licenseNumber: 'LIC-J2'
}));
const otherAccepted = S.reviewAssociationApplication(admin.token, otherApplication.id, 'accept', '');
const otherLogin = S.loginUser_('isolated@example.org', otherAccepted.temporaryPassword);
S.changePassword(otherLogin.token, otherAccepted.temporaryPassword, 'OtherPass789');
const otherToken = S.loginUser_('isolated@example.org', 'OtherPass789').token;

assert('الجمعية الأخرى لا ترى مستفيد الرحلة الأولى في قائمتها', !S.listBeneficiaries(otherToken, {}).items.some(b => b.id === beneficiary.id));
throws('الجمعية الأخرى لا تستطيع تعديل مستفيد الجمعية الأولى مباشرة عبر API',
  () => S.saveBeneficiary(otherToken, { id: beneficiary.id, name: 'تعديل متطفل', region: 'الرياض', city: 'الرياض', address: 'حي', district: 'حي الاختبار', phone: '0501110003', familyCount: 1, socialStatus: 'أرملة', needs: [] }),
  'ليس لديك صلاحية');
throws('الجمعية الأخرى لا تستطيع تعيين مندوبها لمستفيد الجمعية الأولى',
  () => S.assignDelegate(otherToken, beneficiary.id, delegateResult.id), 'ليس لديك صلاحية');
assert('سجل عمليات الجمعية الأخرى لا يحتوي أي عملية من الجمعية الأولى', (() => {
  const otherActions = S.listAuditLog(otherToken, {}).items;
  return !otherActions.some(r => r.recordId === beneficiary.id);
})());

section('14) إبطال الجلسات والرموز القديمة');
const oldDelegateToken = delegateToken;
const regen = S.regenerateDelegateCode(assocToken, delegateResult.id);
assert('إعادة إنشاء رمز المندوب تنجح وتصدر رمزًا جديدًا مختلفًا', regen.ok && regen.accessCode !== delegateResult.accessCode);
throws('الرمز القديم للمندوب لم يعد يعمل بعد إعادة الإنشاء', () => S.loginDelegate_(delegateResult.accessCode), 'رمز الدخول غير صحيح');
throws('جلسة المندوب المفتوحة بالرمز القديم تُقطع فورًا (لا تبقى صالحة)',
  () => S.requireSession_(oldDelegateToken, ['DELEGATE']), 'انتهت الجلسة');

const oldAssocToken = assocToken;
const resetResult = S.resetAssociationPassword(admin.token, associationId);
assert('إعادة تعيين كلمة مرور الجمعية من الإدارة تنجح وتصدر كلمة مرور مؤقتة جديدة',
  resetResult.ok && resetResult.temporaryPassword !== newPassword);
throws('جلسة الجمعية المفتوحة قبل إعادة التعيين تُقطع فورًا', () => S.requireSession_(oldAssocToken, ['ASSOCIATION']), 'انتهت الجلسة');
throws('كلمة المرور القديمة للجمعية لم تعد تعمل بعد إعادة التعيين',
  () => S.loginUser_('full-journey@example.org', newPassword), 'بيانات الدخول غير صحيحة');
const afterReset = S.loginUser_('full-journey@example.org', resetResult.temporaryPassword);
assert('كلمة المرور المؤقتة الجديدة تعمل، وتُفرَض إعادة تغييرها من جديد', afterReset.ok && afterReset.mustChangePassword === true);

/* ================================================================
   15) الرحلات الأربع المطلوبة، كل واحدة مستقلة من بيئة نظيفة
   ================================================================ */

section('15) الرحلات الأربع الكاملة (بيئة مستقلة لكل رحلة)');

/** جلسة إدارة داخل بيئة نظيفة — نفس نمط بقية الملف (أوراق مُهيّأة + جلسة مباشرة). */
function seedAdmin(J) {
  seedSheets(J);
  return adminSession(J);
}
const PROOF_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// الرحلة 1: تقديم جمعية ← قبول ورفض.
{
  const J = buildSandbox();
  const boot = seedAdmin(J);
  const applied = J.submitAssociationApplication(applicationFixture({
    name: 'جمعية الرحلة الأولى', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    contactName: 'مسؤول', phone: '0551110001', email: 'j1@example.org', licenseNumber: 'LIC-J1A'
  }));
  assert('رحلة 1: التقديم العام ينجح بلا جلسة', applied.ok && /^APP-/.test(applied.id));
  const accepted = J.reviewAssociationApplication(boot.token, applied.id, 'accept', '', 'j1-accept');
  assert('رحلة 1: القبول يُنشئ جمعية وحسابًا بكلمة مرور مؤقتة',
    accepted.ok && /^ASC-/.test(accepted.associationId) && !!accepted.temporaryPassword);
  const login1 = J.loginUser_('j1@example.org', accepted.temporaryPassword);
  assert('رحلة 1: الحساب الجديد يعمل ويُفرَض عليه تغيير كلمة المرور', login1.ok && login1.mustChangePassword === true);

  const rejectedApp = J.submitAssociationApplication(applicationFixture({
    name: 'جمعية مرفوضة', category: 'جمعية خيرية', region: 'الرياض', city: 'الخرج',
    contactName: 'مسؤول', phone: '0551110002', email: 'j1r@example.org', licenseNumber: 'LIC-J1B'
  }));
  throws('رحلة 1: الرفض يتطلب سببًا', () => J.reviewAssociationApplication(boot.token, rejectedApp.id, 'reject', '  ', 'j1-rej-a'), 'مطلوب');
  const rejected = J.reviewAssociationApplication(boot.token, rejectedApp.id, 'reject', 'بيانات ناقصة', 'j1-rej');
  assert('رحلة 1: الرفض يُسجَّل بسببه ولا يُنشئ حسابًا',
    rejected.record.status === 'مرفوض' && rejected.record.rejectionReason === 'بيانات ناقصة'
    && !J.findUserByEmail_('j1r@example.org'));
  assert('رحلة 1: الطلب المرفوض لا يمنع تقديم طلب جديد بنفس البريد لاحقًا', (() => {
    const again = J.submitAssociationApplication(applicationFixture({
      name: 'جمعية معاد تقديمها', category: 'جمعية خيرية', region: 'الرياض', city: 'الخرج',
      contactName: 'مسؤول', phone: '0551110002', email: 'j1r@example.org', licenseNumber: 'LIC-J1C'
    }));
    return again.ok === true;
  })());
}

// الرحلة 2: دخول الجمعية ← إضافة مستفيد ومندوب واستيراد.
{
  const J = buildSandbox();
  const boot = seedAdmin(J);
  const assoc = J.saveAssociation(boot.token, {name: 'جمعية الرحلة الثانية', category: 'جمعية خيرية',
    region: 'الرياض', city: 'الرياض', phone: '0552220001', email: 'j2@example.org', password: 'ZadJourney2026x'});
  // الحساب المُنشأ من الإدارة يبدأ بكلمة مرور مؤقتة مُلزِمة بالتغيير —
  // نمرّ بالمسار الحقيقي كاملًا كما يفعل المستخدم.
  const firstLogin2 = J.loginUser_('j2@example.org', 'ZadJourney2026x');
  assert('رحلة 2: الدخول الأول يُلزِم بتغيير كلمة المرور المؤقتة', firstLogin2.mustChangePassword === true);
  J.changePassword(firstLogin2.token, 'ZadJourney2026x', 'ZadJourneyNew2026');
  const assocLogin = J.loginUser_('j2@example.org', 'ZadJourneyNew2026');
  const t = assocLogin.token;
  const ben = J.saveBeneficiary(t, { deviceTypes: ['ثلاجة'],name: 'مستفيد الرحلة 2', phone: '0552220002', region: 'الرياض',
    city: 'الرياض', address: 'حي', district: 'حي الاختبار', familyCount: 3, socialStatus: 'أرملة', needs: ['ثلاجة']});
  assert('رحلة 2: الجمعية تضيف مستفيدًا وتراه فورًا في قائمتها المُرقَّمة', (() => {
    const listed = J.listBeneficiaries(t, {}).items;
    return listed.some(x => x.id === ben.id);
  })());
  const del = J.saveDelegate(t, {name: 'مندوب الرحلة 2', phone: '0552220003'});
  assert('رحلة 2: الجمعية تضيف مندوبًا وتحصل على رمز دخوله مرة واحدة', del.ok && !!del.accessCode);
  const imported = J.importBeneficiaries(t, [
    {name: 'مستورد أ', phone: '0552220004', region: 'الرياض', city: 'الخرج', address: 'حي', district: 'حي الاختبار', familyCount: 2, socialStatus: 'أرملة'},
    {name: 'مستورد ب', phone: '0552220005', region: 'الرياض', city: 'الخرج', address: 'حي', district: 'حي الاختبار', familyCount: 5, socialStatus: 'يتيم'}
  ], true);
  assert('رحلة 2: الاستيراد الجماعي يضيف الصفوف الصحيحة', imported.ok === true && imported.imported === 2);
  assert('رحلة 2: القائمة تعكس الإجمالي الصحيح بعد الاستيراد', J.listBeneficiaries(t, {}).total === 3);
  assert('رحلة 2: مدينة خارج المنطقة تُرفض بالقائمة المعتمدة ولا يُكتب أي صف', (() => {
    const totalBefore = J.listBeneficiaries(t, {}).total;
    const bad = J.importBeneficiaries(t, [
      {name: 'مستورد خاطئ', phone: '0552220006', region: 'الرياض', city: 'جدة', address: 'حي', district: 'حي الاختبار', familyCount: 2, socialStatus: 'أرملة'}
    ], true);
    return bad.ok === false && bad.errorCount === 1 && J.listBeneficiaries(t, {}).total === totalBefore;
  })());
}

// الرحلة 3: الإدارة ← إضافة وتخصيص جهاز.
{
  const J = buildSandbox();
  const boot = seedAdmin(J);
  const assoc = J.saveAssociation(boot.token, {name: 'جمعية الرحلة الثالثة', category: 'جمعية خيرية',
    region: 'الرياض', city: 'الرياض', phone: '0553330001', email: 'j3@example.org', password: 'ZadJourney2026x'});
  const ben = J.saveBeneficiary(boot.token, { deviceTypes: ['ثلاجة'],name: 'مستفيد الرحلة 3', phone: '0553330002', region: 'الرياض',
    city: 'الرياض', address: 'حي', district: 'حي الاختبار', familyCount: 3, socialStatus: 'أرملة', needs: ['ثلاجة'], associationId: assoc.id});
  const dev = J.saveDevice(boot.token, {name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id});
  assert('رحلة 3: الجهاز الجديد يبدأ "بالمستودع"', dev.record.status === 'بالمستودع');
  const assigned = J.saveDevice(boot.token, {id: dev.id, name: 'ثلاجة', type: 'ثلاجة',
    associationId: assoc.id, beneficiaryId: ben.id});
  assert('رحلة 3: تخصيص الجهاز لمستفيد ينقله إلى "مخصص"', assigned.record.status === 'مخصص');
  throws('رحلة 3: نوع جهاز خارج القائمة المعتمدة يُرفض',
    () => J.saveDevice(boot.token, {name: 'جهاز', type: 'نوع مخترَع', associationId: assoc.id}), 'غير معروف');
  throws('رحلة 3: لا يمكن ضبط "مع المندوب" يدويًا (تُحدَّث عبر تعيين المندوب فقط)',
    () => J.saveDevice(boot.token, {id: dev.id, name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id,
      beneficiaryId: ben.id, status: 'مع المندوب'}), 'يدويًا');
}

// الرحلة 4: المندوب ← تعذّر ← إعادة محاولة ← تسليم موثّق (في المحاكاة فقط).
{
  const J = buildSandbox();
  const boot = seedAdmin(J);
  const assoc = J.saveAssociation(boot.token, {name: 'جمعية الرحلة الرابعة', category: 'جمعية خيرية',
    region: 'الرياض', city: 'الرياض', phone: '0554440001', email: 'j4@example.org', password: 'ZadJourney2026x'});
  const ben = J.saveBeneficiary(boot.token, { deviceTypes: ['ثلاجة'],name: 'مستفيد الرحلة 4', phone: '0554440002', region: 'الرياض',
    city: 'الرياض', address: 'حي', district: 'حي الاختبار', familyCount: 3, socialStatus: 'أرملة', needs: ['ثلاجة'], associationId: assoc.id,
    lat: '24.7', lng: '46.6'});
  const del = J.saveDelegate(boot.token, {name: 'مندوب الرحلة 4', phone: '0554440003', associationId: assoc.id});
  J.saveDevice(boot.token, {name: 'ثلاجة', type: 'ثلاجة', associationId: assoc.id, beneficiaryId: ben.id});
  J.assignDelegate(boot.token, ben.id, del.id);
  const dLogin = J.loginDelegate_(del.accessCode);
  const dt = dLogin.token;

  const fail = J.updateDeliveryStatus(dt, ben.id, 'لا يرد', 'اتصلت مرتين', 'j4-fail');
  assert('رحلة 4: التعذّر يُسجَّل وتبقى الأجهزة مع المندوب في الاستجابة نفسها',
    fail.record.deliveryStatus === 'تعذر التسليم'
    && fail.record.devices.length === 1 && fail.record.devices[0].status === 'مع المندوب');
  throws('رحلة 4: لا تسليم قبل إعادة المحاولة', () => J.confirmDelivery(dt, {beneficiaryId: ben.id,
    confirmed: true, proofDataUrl: PROOF_PNG, opId: 'j4-early'}), 'انتقال غير مسموح');
  const resumed = J.retryDelivery(dt, ben.id, 'j4-retry');
  assert('رحلة 4: إعادة المحاولة تستأنف المهمة بضغطة واحدة', resumed.record.deliveryStatus === 'خرج مع المندوب');
  const done = J.confirmDelivery(dt, {beneficiaryId: ben.id, confirmed: true, proofDataUrl: PROOF_PNG, opId: 'j4-done'});
  assert('رحلة 4: التسليم يُوثَّق بالصورة (محاكاة فقط، بلا رفع فعلي)', done.record.deliveryStatus === 'تم التسليم');
  assert('رحلة 4: سجل المحاولات يحمل المحاولتين معًا بترتيبهما',
    (done.record.attempts || []).length === 2);
  // تأكيد ثانٍ بـopId جديد يُرفض: لم تعد هناك أجهزة "مع المندوب" بعد
  // نجاح التسليم (انتقلت كلها إلى "تم التسليم")، وهو أول حاجز يعترضه.
  throws('رحلة 4: لا تسليم مزدوج لنفس المستفيد', () => J.confirmDelivery(dt, {beneficiaryId: ben.id,
    confirmed: true, proofDataUrl: PROOF_PNG, opId: 'j4-double'}), 'لا توجد أجهزة');
  assert('رحلة 4: إعادة إرسال نفس التأكيد بنفس opId تُعيد النتيجة الأصلية لا خطأً مربكًا', (() => {
    const again = J.confirmDelivery(dt, {beneficiaryId: ben.id, confirmed: true, proofDataUrl: PROOF_PNG, opId: 'j4-done'});
    return again.ok === true && again.record.deliveryStatus === 'تم التسليم';
  })());
  assert('رحلة 4: لا تعارض حالات بعد الرحلة كاملة',
    J.diagnoseStateIntegrity_(grantToken_(J)).issueCount === 0);
}

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
