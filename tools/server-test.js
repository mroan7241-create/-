#!/usr/bin/env node
/**
 * اختبار منطق الخادم: يحمّل Code.gs داخل بيئة تُحاكي خدمات Apps Script،
 * ثم يفحص دوال التحقق والتنقية والأمان.
 *   تشغيل:  node tools/server-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

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

/* -------- محاكاة خدمات Apps Script -------- */

const props = {};
const cache = {};
const sandbox = {
  console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error,
  isNaN, isFinite, parseInt, parseFloat, Set,
  Utilities: {
    getUuid: () => 'uuid-' + Math.random().toString(36).slice(2),
    computeDigest: (_alg, text) => {
      const bytes = [];
      const s = String(text);
      for (let i = 0; i < 32; i++) bytes.push((s.charCodeAt(i % s.length) + i * 7) % 256);
      return bytes;
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
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); }
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
  ScriptApp: { getScriptId: () => 'script-id-test', getOAuthToken: () => 'token' },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
  DriveApp: {}, UrlFetchApp: {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

section('0) تحميل Code.gs');
try {
  vm.runInContext(source, sandbox, { filename: 'Code.gs' });
  assert('تم تحميل Code.gs دون خطأ', true);
} catch (error) {
  assert('تحميل Code.gs', false, error.message);
  process.exit(1);
}
const S = sandbox;

/* -------- 1) منع Formula Injection -------- */

section('1) منع Formula Injection عند الكتابة إلى Sheets');
assert('يحيّد الصيغة =', S.safeCell_('=HYPERLINK("http://x","x")').charAt(0) === "'");
assert('يحيّد الصيغة +', S.safeCell_('+1+1').charAt(0) === "'");
assert('يحيّد الصيغة -', S.safeCell_('-1+1').charAt(0) === "'");
assert('يحيّد الأمر @', S.safeCell_('@SUM(A1)').charAt(0) === "'");
assert('لا يمس الاسم العربي', S.safeCell_('محمد العتيبي') === 'محمد العتيبي');
assert('لا يمس رقم الجوال النصي', S.safeCell_('0501234567') === '0501234567');
assert('لا يمس الأرقام (نوع Number)', S.safeCell_(1500) === 1500);
assert('لا يمس القيمة الفارغة', S.safeCell_('') === '');

/* -------- 2) تنقية النصوص -------- */

section('2) تنقية مدخلات النص');
assert('يزيل محارف التحكم', S.cleanText_('a' + String.fromCharCode(1) + 'b', 50) === 'ab');
assert('يحافظ على العربية كاملة', S.cleanText_('  فاطمة العتيبي  ', 50) === 'فاطمة العتيبي');
assert('يقصّ عند الحد الأقصى', S.cleanText_('abcdefghij', 4) === 'abcd');
assert('يتعامل مع null', S.cleanText_(null, 50) === '');
throws('يرفض النص المطلوب الفارغ', () => S.requiredText_('   ', 'الاسم', 50), 'مطلوب');

/* -------- 3) المعرّفات (منع IDOR بالتخمين) -------- */

section('3) التحقق من المعرّفات');
assert('يقبل معرّفًا صحيحًا', S.cleanId_('BEN-000123') === 'BEN-000123');
assert('يرفض معرّفًا مشوّهًا', S.cleanId_('BEN-12') === '');
assert('يرفض محاولة حقن', S.cleanId_("BEN-000001' OR 1=1") === '');
assert('يرفض الفراغ', S.cleanId_('') === '');
assert('يرفض المسار النسبي', S.cleanId_('../../secret') === '');

/* -------- 4) أرقام الجوال -------- */

section('4) تطبيع أرقام الجوال السعودية');
assert('يقبل 05XXXXXXXX', S.normalizePhone_('0501234567') === '0501234567');
assert('يحوّل +9665 إلى 05', S.normalizePhone_('+966501234567') === '0501234567');
assert('يحوّل 9665 إلى 05', S.normalizePhone_('966501234567') === '0501234567');
assert('يتجاهل الفواصل والمسافات', S.normalizePhone_('050 123 45 67') === '0501234567');
throws('يرفض رقمًا قصيرًا', () => S.normalizePhone_('05012'), 'غير صحيح');
throws('يرفض رقمًا لا يبدأ بـ 5', () => S.normalizePhone_('0401234567'), 'غير صحيح');
throws('يرفض نصًا', () => S.normalizePhone_('ليس رقمًا'), 'غير صحيح');

/* -------- 5) الأرقام والحدود -------- */

section('5) الحدود العددية');
assert('يقبل عدد أفراد صحيحًا', S.boundedNumber_(5, 1, 99, 'عدد الأفراد') === 5);
throws('يرفض صفرًا', () => S.boundedNumber_(0, 1, 99, 'عدد الأفراد'), 'غير صحيح');
throws('يرفض تجاوز الحد', () => S.boundedNumber_(500, 1, 99, 'عدد الأفراد'), 'غير صحيح');
throws('يرفض قيمة غير رقمية', () => S.boundedNumber_('كثير', 1, 99, 'عدد الأفراد'), 'غير صحيح');
assert('safeNumber_ يعالج النسبة المئوية', S.safeNumber_('60%') === 60);
assert('safeNumber_ يعيد صفرًا للقيم الفاسدة', S.safeNumber_('abc') === 0);

/* -------- 6) البريد والروابط -------- */

section('6) البريد والروابط');
assert('يقبل بريدًا صحيحًا', S.requiredEmail_('Info@Alzad.ORG') === 'info@alzad.org');
throws('يرفض بريدًا فاسدًا', () => S.requiredEmail_('not-an-email'), 'غير صحيح');
assert('safeUrl_ يقبل https', S.safeUrl_('https://drive.google.com/x') !== '');
assert('safeUrl_ يرفض javascript:', S.safeUrl_('javascript:alert(1)') === '');
assert('safeUrl_ يرفض data:', S.safeUrl_('data:text/html,<script>') === '');

/* -------- 7) كلمات المرور والأسرار -------- */

section('7) كلمات المرور ومقارنة الأسرار');
assert('يقبل كلمة مرور قوية', S.assertStrongPassword_('Zad2026Pass') === 'Zad2026Pass');
throws('يرفض كلمة قصيرة', () => S.assertStrongPassword_('Zad1'), '10 خانات');
throws('يرفض كلمة بلا أرقام', () => S.assertStrongPassword_('ZadPassword'), '10 خانات');
throws('يرفض كلمة بلا حروف', () => S.assertStrongPassword_('1234567890'), '10 خانات');

const salt = 'salt-1';
const hashed = S.hashSecret_('secret', salt);
assert('التجزئة تُنتج قيمة غير النص الأصلي', hashed !== 'secret' && hashed.length > 10);
assert('نفس المدخلات تعطي نفس التجزئة', S.hashSecret_('secret', salt) === hashed);
assert('ملح مختلف يعطي تجزئة مختلفة', S.hashSecret_('secret', 'salt-2') !== hashed);
assert('المقارنة تنجح للمتطابق', S.constantTimeEquals_(hashed, hashed) === true);
assert('المقارنة تفشل للمختلف', S.constantTimeEquals_(hashed, hashed + 'x') === false);
assert('المقارنة تتعامل مع null', S.constantTimeEquals_(null, null) === true);

/* -------- 8) تقييد المحاولات -------- */

section('8) تقييد محاولات الدخول');
for (const key in cache) delete cache[key];
let allowed = 0;
let blocked = false;
for (let i = 0; i < 12; i++) {
  try { S.throttle_('test-bucket', 8, 900); allowed++; }
  catch (error) { blocked = true; break; }
}
assert('يسمح بالمحاولات ضمن الحد', allowed === 8, 'سُمح بـ ' + allowed);
assert('يمنع بعد تجاوز الحد', blocked);

/* -------- 9) ترقيم المعرّفات -------- */

section('9) توليد المعرّفات');
for (const key in props) delete props[key];
const batch = S.nextIds_('BEN', 3);
assert('يولّد دفعة بترقيم متسلسل', batch.join(',') === 'BEN-000001,BEN-000002,BEN-000003');
assert('الاستدعاء التالي يكمل التسلسل', S.nextId_('BEN') === 'BEN-000004');
assert('لا يستهلك أرقامًا عند العدد صفر', S.nextIds_('BEN', 0).length === 0 && S.nextId_('BEN') === 'BEN-000005');
assert('بادئة مختلفة لها عدّاد مستقل', S.nextId_('DEV') === 'DEV-000001');

/* -------- 10) القوائم والتواريخ -------- */

section('10) القوائم والتواريخ');
assert('splitList_ يفصل بالفاصلة العربية', S.splitList_('ثلاجة، غسالة').join('|') === 'ثلاجة|غسالة');
assert('splitList_ يفصل بالفاصلة اللاتينية', S.splitList_('a, b').join('|') === 'a|b');
assert('normalizeNeeds_ يوحّد المصفوفة', S.normalizeNeeds_(['ثلاجة', 'غسالة']) === 'ثلاجة، غسالة');
assert('normalizeNeeds_ يتجاهل الفراغات', S.normalizeNeeds_(['ثلاجة', '', '  ']) === 'ثلاجة');
assert('normalizeNeeds_ يحدّ العدد بـ 20', S.normalizeNeeds_(new Array(40).fill('جهاز')).split('، ').length === 20);
assert('parseDate_ يقرأ التاريخ', S.parseDate_('2026/07/29') instanceof Date);
assert('parseDate_ يعيد null للفاسد', S.parseDate_('ليس تاريخًا') === null);
assert('formatDate_ يتعامل مع null', S.formatDate_(null) === '');

/* -------- 11) الثوابت وسلامة الأعمدة -------- */

section('11) توافق بنية الجداول');
// ثوابت const لا تُعلَّق على كائن الـ sandbox، لذا تُقرأ بتقييم داخل السياق.
const read = expr => vm.runInContext(expr, sandbox);
const HEADERS = read('HEADERS');
const expectedSheets = ['إعدادات المشروع', 'المستخدمون', 'الجمعيات', 'المستفيدون', 'الأجهزة',
  'المناديب', 'التسليمات', 'إدارة الأنشطة', 'شواهد الأنشطة الرئيسية', 'سجل العمليات'];
assert('أسماء الأوراق العشرة كما هي', expectedSheets.every(name => name in HEADERS));
assert('أعمدة المستفيدين لم تتغير', HEADERS['المستفيدون'].length === 20
  && HEADERS['المستفيدون'][0] === 'رقم المستفيد'
  && HEADERS['المستفيدون'][19] === 'آخر تحديث');
assert('عمود "رقم جوال إضافي" ما زال موجودًا', HEADERS['المستفيدون'].includes('رقم جوال إضافي'));
assert('حالات الجهاز الخمس كما هي', read('DEVICE_STATUSES').length === 5);
assert('أسباب التعذر الستة كما هي', read('FAILED_REASONS').length === 6);
assert('doGet ما زال يقرأ الملف Index', /createHtmlOutputFromFile\('Index'\)/.test(source));
assert('setupSheets موجودة ولم تُستدعَ تلقائيًا',
  /function setupSheets\(/.test(source) && !/^\s*setupSheets\(\);/m.test(source));

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
