#!/usr/bin/env node
/**
 * اختبار منطق الخادم: يحمّل ملفات .gs المدموجة داخل بيئة تُحاكي خدمات Apps Script،
 * ثم يفحص دوال التحقق والتنقية والأمان.
 *   تشغيل:  node tools/server-test.js
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
    newBlob: (content, mimeType, name) => ({
      getBytes: () => Array.from(Buffer.from(content == null ? '' : String(content), 'utf8')),
      getName: () => name || '',
      getContentType: () => mimeType || ''
    }),
    base64Encode: bytes => Buffer.from(bytes).toString('base64'),
    // تنفيذ ZIP حقيقي بأسلوب STORE (بلا ضغط) لأغراض الاختبار المحلي فقط —
    // Apps Script الحقيقي يستخدم تطبيقه الخاص لـ Utilities.zip، لكن الناتج
    // هنا حزمة ZIP سليمة بنيويًا فعلًا يمكن فتحها بأي أداة ZIP قياسية
    // (يُتحقّق من ذلك في tools/xlsx-test.js عبر python3 zipfile).
    zip: (blobs, archiveName) => {
      const zlib = require('zlib');
      const entries = blobs.map(blob => {
        const bytes = Buffer.from(blob.getBytes());
        const crc = zlib.crc32 ? zlib.crc32(bytes) : 0;
        return { name: blob.getName(), bytes, crc };
      });
      const localParts = [];
      const centralParts = [];
      let offset = 0;
      entries.forEach(entry => {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // بادئة اسم UTF-8
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(entry.crc >>> 0, 14);
        local.writeUInt32LE(entry.bytes.length, 18);
        local.writeUInt32LE(entry.bytes.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, nameBuf, entry.bytes);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(entry.crc >>> 0, 16);
        central.writeUInt32LE(entry.bytes.length, 20);
        central.writeUInt32LE(entry.bytes.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBuf);
        offset += local.length + nameBuf.length + entry.bytes.length;
      });
      const centralStart = offset;
      const centralBuf = Buffer.concat(centralParts);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(0, 4);
      end.writeUInt16LE(0, 6);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(centralBuf.length, 12);
      end.writeUInt32LE(centralStart, 16);
      end.writeUInt16LE(0, 20);
      const zipBytes = Buffer.concat(localParts.concat([centralBuf, end]));
      return {
        getBytes: () => Array.from(zipBytes),
        getName: () => archiveName || 'archive.zip'
      };
    },
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

section('0) تحميل ملفات .gs');
try {
  vm.runInContext(source, sandbox, { filename: 'gs-merged' });
  assert('تم تحميل كل ملفات .gs دون خطأ', true);
} catch (error) {
  assert('تحميل ملفات .gs', false, error.message);
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
assert('يحمي رقم الجوال الذي يبدأ بصفر من فقدان الصفر عند الكتابة (تحويل Sheets الرقمي التلقائي)',
  S.safeCell_('0501234567') === "'0501234567");
assert('لا يمس رقمًا نصيًا لا يبدأ بصفر', S.safeCell_('501234567') === '501234567');
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
assert('يطبّع 9 أرقام بلا صفر بادئ (العطل المرصود حيًّا: 550791650)',
  S.normalizePhone_('550791650') === '0550791650');
assert('التخزين الموحّد: كل الصيغ الأربع تنتج نفس القيمة',
  new Set(['0550791650', '550791650', '966550791650', '+966550791650'].map(S.normalizePhone_)).size === 1);
throws('يرفض رقمًا قصيرًا', () => S.normalizePhone_('05012'), 'غير صحيح');
throws('يرفض رقمًا لا يبدأ بـ 5', () => S.normalizePhone_('0401234567'), 'غير صحيح');
throws('يرفض نصًا', () => S.normalizePhone_('ليس رقمًا'), 'غير صحيح');

/* -------- 4ب) إحداثيات المستفيد الاختيارية -------- */

section('4ب) موقع المستفيد الجغرافي (اختياري)');
assert('فارغة تبقى فارغة (توافق خلفي كامل، لا كسر لبيانات قديمة بلا إحداثيات)',
  S.optionalCoordinate_('', '').lat === '' && S.optionalCoordinate_('', '').lng === '');
assert('فارغة كذلك عند undefined', S.optionalCoordinate_(undefined, undefined).lat === '');
assert('تقبل إحداثيات صحيحة داخل حدود المملكة (الرياض تقريبًا)', (() => {
  const c = S.optionalCoordinate_('24.7136', '46.6753');
  return c.lat === 24.7136 && c.lng === 46.6753;
})());
assert('تقبل قيم الحد الأقصى العالمي بالضبط (لات=90، لنغ=180)', (() => {
  const c = S.optionalCoordinate_('90', '180');
  return c.lat === 90 && c.lng === 180;
})());
assert('تقبل قيم الحد الأدنى العالمي بالضبط (لات=-90، لنغ=-180)', (() => {
  const c = S.optionalCoordinate_('-90', '-180');
  return c.lat === -90 && c.lng === -180;
})());
throws('ترفض خط عرض خارج النطاق العالمي (>90)', () => S.optionalCoordinate_('95', '46.6'), 'بين -90 و90');
throws('ترفض خط عرض خارج النطاق العالمي (<-90)', () => S.optionalCoordinate_('-95', '46.6'), 'بين -90 و90');
throws('ترفض خط طول خارج النطاق العالمي (>180)', () => S.optionalCoordinate_('24.7', '200'), 'بين -180 و180');
throws('ترفض خط طول خارج النطاق العالمي (<-180)', () => S.optionalCoordinate_('24.7', '-200'), 'بين -180 و180');
throws('ترفض قيمة غير رقمية (NaN)', () => S.optionalCoordinate_('ليس رقمًا', '46.6'), 'أرقامًا صحيحة');
throws('ترفض Infinity صراحة', () => S.optionalCoordinate_('Infinity', '46.6'), 'أرقامًا صحيحة');
throws('ترفض خط العرض وحده دون خط الطول (قيمة جزئية)', () => S.optionalCoordinate_('24.7', ''), 'معًا');
throws('ترفض خط الطول وحده دون خط العرض (قيمة جزئية)', () => S.optionalCoordinate_('', '46.6'), 'معًا');
assert('validateLocationSource_ تعيد فارغًا دائمًا بلا إحداثيات', S.validateLocationSource_('خريطة', false) === '');
assert('validateLocationSource_ تقبل قيمة معتمدة مع إحداثيات', S.validateLocationSource_('خريطة', true) === 'خريطة');
assert('validateLocationSource_ تصحّح قيمة غير معروفة إلى "يدوي" بدل الرفض', S.validateLocationSource_('مصدر غريب', true) === 'يدوي');

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
assert('أعمدة المستفيدين الأصلية العشرون لم تتغير ترتيبها أو أسماؤها (الموقع الجغرافي أُضيف لاحقًا كعمودين إضافيين فقط)',
  HEADERS['المستفيدون'].length >= 20
  && HEADERS['المستفيدون'][0] === 'رقم المستفيد'
  && HEADERS['المستفيدون'][19] === 'آخر تحديث');
assert('عمود "رقم جوال إضافي" ما زال موجودًا', HEADERS['المستفيدون'].includes('رقم جوال إضافي'));
assert('عمودا الموقع الجغرافي إضافيان في نهاية الجدول فقط',
  HEADERS['المستفيدون'][20] === 'خط العرض' && HEADERS['المستفيدون'][21] === 'خط الطول');
assert('حالات الجهاز الخمس كما هي', read('DEVICE_STATUSES').length === 5);
assert('أسباب التعذر الستة كما هي', read('FAILED_REASONS').length === 6);
assert('doGet ما زال يقرأ الملف Index', /createHtmlOutputFromFile\('Index'\)/.test(source));
assert('setupSheets موجودة ولم تُستدعَ تلقائيًا',
  /function setupSheets\(/.test(source) && !/^\s*setupSheets\(\);/m.test(source));

/* -------- 12) المصادر المرجعية (مناطق/مدن) -------- */

section('12) المصادر المرجعية والتحقق اللين');

assert('جدول البيانات المرجعية إضافي فقط ولم يمس أوراقًا قائمة',
  expectedSheets.every(name => name in HEADERS) && 'البيانات المرجعية' in HEADERS);
assert('أعمدة البيانات المرجعية كما صُممت', HEADERS['البيانات المرجعية'].join('|')
  === ['المعرف', 'النوع', 'القيمة', 'يتبع', 'الترتيب', 'نشط'].join('|'));

assert('migrateReferenceData لم تُستدعَ تلقائيًا من أي مكان',
  /function migrateReferenceData\(/.test(source) && !/^\s*migrateReferenceData\(\);/m.test(source));

assert('getReferenceData تتعامل بأمان مع غياب الجدول (بلا استثناء)', (() => {
  try {
    const result = S.getReferenceData();
    return result && result.ready === false && Array.isArray(result.regions) && result.regions.length === 0;
  } catch (error) { return false; }
})());

assert('validateRegionCity_ يتصرف كنص حر قبل تشغيل الترحيل (توافق خلفي)', (() => {
  const result = S.validateRegionCity_('منطقة اختبارية', 'مدينة اختبارية');
  return result.region === 'منطقة اختبارية' && result.city === 'مدينة اختبارية';
})());

throws('validateRegionCity_ يرفض منطقة فارغة قبل الترحيل أيضًا',
  () => S.validateRegionCity_('', 'أي مدينة'), 'مطلوب');

assert('بذرة المناطق تغطي المناطق الإدارية الثلاث عشرة', Object.keys(read('REFERENCE_SEED_REGIONS_CITIES')).length === 13);
assert('كل منطقة في البذرة لها مدينة واحدة على الأقل', Object.values(read('REFERENCE_SEED_REGIONS_CITIES'))
  .every(cities => Array.isArray(cities) && cities.length >= 3));
assert('لا تكرار داخل قائمة مدن أي منطقة', Object.values(read('REFERENCE_SEED_REGIONS_CITIES'))
  .every(cities => new Set(cities).size === cities.length));

assert('saveBeneficiary يستخدم التحقق الموحّد من المنطقة/المدينة',
  /validateRegionCity_\(payload\.region, payload\.city\)/.test(source));
assert('importBeneficiaries يستخدم التحقق الموحّد من المنطقة/المدينة',
  /validateRegionCity_\(row\.region, row\.city\)/.test(source));
assert('saveAssociation يستخدم التحقق الموحّد من المنطقة/المدينة',
  (source.match(/validateRegionCity_\(payload\.region, payload\.city\)/g) || []).length >= 2);
assert('inspectBeneficiaryExcel يستخدم التحقق الموحّد من المنطقة/المدينة',
  /validateRegionCity_\(row\.region, row\.city\)/.test(source));

/* -------- 13) تصحيح صيغة الجوال (معاينة آمنة، بلا كتابة عمياء) -------- */

section('13) معاينة وترحيل أرقام الجوال');
assert('previewPhoneNormalization معرّفة', /function previewPhoneNormalization\(/.test(source));
assert('migratePhoneNumbers معرّفة ولم تُستدعَ تلقائيًا',
  /function migratePhoneNumbers\(/.test(source) && !/^\s*migratePhoneNumbers\(\);/m.test(source));
assert('الترحيل يعتمد على المعاينة نفسها (مصدر حقيقة واحد)', (() => {
  const start = source.indexOf('function migratePhoneNumbers(');
  const body = source.slice(start, start + 400);
  return body.includes('previewPhoneNormalization()');
})());
throws('previewPhoneNormalization يفشل بأمان بلا شيت مرتبط (بيئة الاختبار) بدل قراءة بيانات فاسدة',
  () => S.previewPhoneNormalization());

/* -------- 14) بوابة تقديم الجمعيات ودورة الاعتماد (بمحاكاة شيت كاملة) -------- */

section('14) بوابة تقديم الجمعيات: تقديم، قبول، رفض');

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
      getRange: (r1, c1, numRows, numCols) => ({
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

const props2 = {}; const cache2 = {};
const sandbox2 = Object.assign({}, sandbox, {
  Utilities: sandbox.Utilities,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props2 ? props2[k] : null), setProperty: (k, v) => { props2[k] = String(v); }, deleteProperty: k => { delete props2[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in cache2 ? cache2[k] : null), put: (k, v) => { cache2[k] = v; }, remove: k => { delete cache2[k]; } }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => mockSs }
});
const mockSs = buildMockSpreadsheet();
sandbox2.globalThis = sandbox2;
vm.createContext(sandbox2);
vm.runInContext(source, sandbox2, { filename: 'Code.gs(applications)' });
const S2 = sandbox2;
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
  'طلبات انضمام الجمعيات': ['رقم الطلب', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'اسم المسؤول', 'ملاحظات مقدّم الطلب', 'الحالة', 'سبب الرفض', 'رقم الجمعية الناتجة', 'تاريخ التقديم', 'تاريخ المراجعة', 'المراجع']
};
Object.keys(ALL_HEADERS).forEach(name => S2.ensureSheet_(mockSs, name, ALL_HEADERS[name]));

assert('استقبال الطلبات غير مفعّل بلا شيت (يفشل بأمان لا يكسر التطبيق)', (() => {
  const emptySandbox = { console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error, isNaN, isFinite, parseInt, parseFloat, Set, Utilities: sandbox.Utilities, PropertiesService: sandbox.PropertiesService, CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) }, LockService: sandbox.LockService, ScriptApp: sandbox.ScriptApp, SpreadsheetApp: { getActiveSpreadsheet: () => null }, HtmlService: sandbox.HtmlService, DriveApp: {}, UrlFetchApp: {} };
  emptySandbox.globalThis = emptySandbox;
  vm.createContext(emptySandbox);
  vm.runInContext(source, emptySandbox, { filename: 'Code.gs(noSheet)' });
  try { emptySandbox.submitAssociationApplication({name: 'جمعية', category: 'جمعية أهلية', region: 'الرياض', city: 'الرياض', contactName: 'أحمد', phone: '0501234567', email: 'a@example.org'}); return false; }
  catch (error) { return error.message.indexOf('غير مفعّل') >= 0; }
})());

const submitted = S2.submitAssociationApplication({
  name: 'جمعية الأمل الخيرية', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
  contactName: 'سالم العتيبي', phone: '0501234567', email: 'amal@example.org', notes: 'طلب أول'
});
assert('submitAssociationApplication ينجح ويعيد رقم طلب', submitted.ok && /^APP-/.test(submitted.id));

throws('يرفض طلبًا مكررًا بنفس البريد وهو قيد المراجعة', () => S2.submitAssociationApplication({
  name: 'جمعية أخرى', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
  contactName: 'سالم', phone: '0559876543', email: 'amal@example.org'
}), 'قيد المراجعة');

throws('يرفض طلبًا مكررًا بنفس رقم الجوال وهو قيد المراجعة', () => S2.submitAssociationApplication({
  name: 'جمعية ثالثة', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
  contactName: 'سالم', phone: '0501234567', email: 'other@example.org'
}), 'قيد المراجعة');

const adminSession = S2.createSession_({id: 'USR-ADMIN-TEST', name: 'مدير الاختبار', role: 'ADMIN', associationId: ''});
const beforeAccept = S2.listAssociationApplications(adminSession.token);
assert('listAssociationApplications يُعيد الطلب قيد المراجعة', beforeAccept.applications.length === 1 && beforeAccept.applications[0].status === 'قيد المراجعة');

const accepted = S2.reviewAssociationApplication(adminSession.token, submitted.id, 'accept', '');
assert('قبول الطلب ينشئ جمعية ورقم جمعية', accepted.ok && /^ASC-/.test(accepted.associationId));
assert('قبول الطلب يعيد كلمة مرور مؤقتة قوية', (() => {
  try { S2.assertStrongPassword_(accepted.temporaryPassword); return true; } catch (e) { return false; }
})());

const loginResult = S2.loginUser_('amal@example.org', accepted.temporaryPassword);
assert('الحساب المُنشأ تلقائيًا يعمل فورًا بكلمة المرور المؤقتة', loginResult.ok && loginResult.user.role === 'ASSOCIATION');
assert('حساب الجمعية المُنشأ من قبول طلب انضمام يُفرَض عليه تغيير كلمة المرور المؤقتة عند أول دخول (لا bootstrap فورًا)',
  loginResult.mustChangePassword === true && loginResult.bootstrap === undefined);
throws('الحساب المُلزَم بتغيير كلمة المرور لا يستطيع استدعاء دالة أخرى (كـgetBootstrapData) قبل تغييرها',
  () => S2.getBootstrapData(loginResult.token), 'يجب تغيير كلمة المرور');

throws('لا يمكن البتّ في طلب سبق قبوله', () => S2.reviewAssociationApplication(adminSession.token, submitted.id, 'accept', ''), 'سبق البتّ');

const submitted2 = S2.submitAssociationApplication({
  name: 'جمعية النور', category: 'جمعية أهلية', region: 'مكة المكرمة', city: 'جدة',
  contactName: 'منى القحطاني', phone: '0559998877', email: 'noor@example.org'
});
throws('الرفض يتطلب سببًا نصيًا', () => S2.reviewAssociationApplication(adminSession.token, submitted2.id, 'reject', '  '), 'مطلوب');
const rejected = S2.reviewAssociationApplication(adminSession.token, submitted2.id, 'reject', 'بيانات غير مكتملة');
assert('الرفض ينجح دون إنشاء حساب', rejected.ok && !S2.findUserByEmail_('noor@example.org'));
const afterReject = S2.listAssociationApplications(adminSession.token);
const rejectedRow = afterReject.applications.find(x => x.id === submitted2.id);
assert('حالة الطلب المرفوض وسببه محفوظان', rejectedRow.status === 'مرفوض' && rejectedRow.rejectionReason === 'بيانات غير مكتملة');

throws('غير الإدارة لا يمكنه مراجعة الطلبات', () => {
  const assocSession = S2.createSession_({id: 'USR-ASSOC-TEST', name: 'جمعية', role: 'ASSOCIATION', associationId: accepted.associationId});
  S2.reviewAssociationApplication(assocSession.token, submitted2.id, 'accept', '');
});

/* -------- 15) إدارة الأنشطة والفرعية -------- */

section('15) إدارة الأنشطة الرئيسية والفرعية');

const toIsoDate = date => date.toISOString().slice(0, 10);
const pastStart = toIsoDate(new Date(Date.now() - 30 * 86400000));
const farFutureEnd = toIsoDate(new Date(Date.now() + 5 * 365 * 86400000));
const addedActivity = S2.saveActivity(adminSession.token, {
  stage: 'التجهيز', stageOrder: 1, mainActivity: 'التعاقد', mainOrder: 1,
  subActivity: 'توقيع العقود', owner: 'إدارة المشروع',
  startDate: pastStart, endDate: farFutureEnd,
  progress: 40, status: '', evidenceUrl: '', notes: 'ملاحظة أولية'
});
assert('saveActivity ينجح لنشاط جديد', addedActivity.ok);
const activitiesAfterAdd = S2.getActivitiesData_();
const newRow = activitiesAfterAdd.find(x => x.subActivity === 'توقيع العقود');
assert('النشاط الجديد يظهر بحالة محسوبة تلقائيًا («جارٍ» بلا حالة صريحة)', newRow && newRow.status === 'جارٍ');
assert('نسبة الإنجاز محفوظة كما أُدخلت', newRow && newRow.progress === 40);

const editedActivity = S2.saveActivity(adminSession.token, {
  originalStage: 'التجهيز', originalMainActivity: 'التعاقد', originalSubActivity: 'توقيع العقود',
  stage: 'التجهيز', stageOrder: 1, mainActivity: 'التعاقد', mainOrder: 1,
  subActivity: 'توقيع العقود', owner: 'إدارة المشروع',
  startDate: pastStart, endDate: farFutureEnd,
  progress: 100, status: '', evidenceUrl: 'https://example.org/evidence.pdf', notes: 'اكتمل التوقيع'
});
assert('saveActivity ينجح لتعديل نشاط قائم', editedActivity.ok);
const activitiesAfterEdit = S2.getActivitiesData_();
const editedRow = activitiesAfterEdit.find(x => x.subActivity === 'توقيع العقود');
assert('التعديل لا يكرّر الصف (لا يزال صفًا واحدًا فقط)',
  activitiesAfterEdit.filter(x => x.subActivity === 'توقيع العقود').length === 1);
assert('التعديل يحدّث نسبة الإنجاز والحالة المحسوبة («مكتمل» عند 100٪)',
  editedRow.progress === 100 && editedRow.status === 'مكتمل');
assert('التعديل يحفظ رابط الشاهد', editedRow.evidenceUrl === 'https://example.org/evidence.pdf');

throws('تعديل نشاط أصلي غير موجود يفشل بوضوح', () => S2.saveActivity(adminSession.token, {
  originalStage: 'مرحلة غير موجودة', originalMainActivity: 'نشاط غير موجود', originalSubActivity: 'فرعي غير موجود',
  stage: 'مرحلة غير موجودة', stageOrder: 1, mainActivity: 'نشاط غير موجود', mainOrder: 1,
  subActivity: 'فرعي غير موجود', progress: 0
}), 'غير موجود');

throws('حالة نشاط غير معروفة تُرفض', () => S2.saveActivity(adminSession.token, {
  stage: 'التجهيز', mainActivity: 'التعاقد', subActivity: 'نشاط آخر', status: 'حالة وهمية'
}), 'غير معروفة');

throws('غير الإدارة لا يمكنه إدارة الأنشطة', () => {
  const assocSession = S2.createSession_({id: 'USR-ASSOC-TEST-2', name: 'جمعية', role: 'ASSOCIATION', associationId: accepted.associationId});
  S2.saveActivity(assocSession.token, {stage: 'التجهيز', mainActivity: 'التعاقد', subActivity: 'نشاط آخر'});
});

/* -------- 15ب) ذاكرة Bootstrap المؤقتة تُبطَل فعليًا لكل الأدوار، لا للإدارة فقط -------- */

section('15ب) إبطال ذاكرة Bootstrap المؤقتة (جيل مشترك) بعد أي حفظ');
{
  const assocSession = S2.createSession_({id: 'USR-ASSOC-CACHE', name: 'جمعية اختبار الذاكرة المؤقتة', role: 'ASSOCIATION', associationId: accepted.associationId});
  const before = S2.getBootstrapData(assocSession.token);
  const beforeCount = before.summary.beneficiaries;
  S2.saveBeneficiary(assocSession.token, {
    name: 'مستفيد لاختبار إبطال الذاكرة المؤقتة', region: 'الرياض', city: 'الرياض', address: 'حي',
    phone: '0501119999', familyCount: 1, socialStatus: 'أرملة', needs: []
  });
  const after = S2.getBootstrapData(assocSession.token);
  assert('ملخّص Bootstrap لحساب الجمعية يعكس فورًا مستفيدًا أُضيف للتو (بلا forceFresh) — لم يعد محصورًا بإبطال ذاكرة الإدارة فقط',
    after.summary.beneficiaries === beforeCount + 1);
}

/* -------- 16) حفظ إحداثيات المستفيد فعليًا عبر saveBeneficiary -------- */

section('16) موقع المستفيد الجغرافي: حفظ وقراءة فعليان');

const savedBeneficiary = S2.saveBeneficiary(adminSession.token, {
  associationId: accepted.associationId, name: 'مستفيد باختبار الموقع',
  region: 'الرياض', city: 'الرياض', address: 'حي النخيل', phone: '0501112233',
  familyCount: 3, socialStatus: 'أرملة', needs: ['ثلاجة'],
  lat: '24.7136', lng: '46.6753'
});
assert('saveBeneficiary ينجح مع إحداثيات صحيحة', savedBeneficiary.ok);
const savedRow = S2.findById_('المستفيدون', 'رقم المستفيد', savedBeneficiary.id);
const normalized = S2.normalizeBeneficiary_(savedRow);
assert('الإحداثيات تُقرأ بعد الحفظ كأرقام صحيحة', normalized.lat === 24.7136 && normalized.lng === 46.6753);

const savedWithoutCoords = S2.saveBeneficiary(adminSession.token, {
  associationId: accepted.associationId, name: 'مستفيد بلا إحداثيات',
  region: 'الرياض', city: 'الرياض', address: 'حي آخر', phone: '0501112244',
  familyCount: 2, socialStatus: 'أرملة', needs: ['غسالة']
});
const savedRowNoCoords = S2.findById_('المستفيدون', 'رقم المستفيد', savedWithoutCoords.id);
const normalizedNoCoords = S2.normalizeBeneficiary_(savedRowNoCoords);
assert('مستفيد قديم/بلا إحداثيات يبقى بحقلين فارغين (null) دون كسر', normalizedNoCoords.lat === null && normalizedNoCoords.lng === null);
assert('مصدر الموقع وتاريخ تحديثه فارغان أيضًا لمستفيد بلا إحداثيات',
  normalizedNoCoords.locationSource === '' && normalizedNoCoords.locationUpdatedAt === '');
assert('saveBeneficiary يضبط مصدر الموقع الافتراضي "يدوي" وتاريخ التحديث عند وجود إحداثيات',
  normalized.locationSource === 'يدوي' && !!normalized.locationUpdatedAt);

throws('saveBeneficiary يرفض إحداثيات خارج النطاق العالمي المسموح', () => S2.saveBeneficiary(adminSession.token, {
  associationId: accepted.associationId, name: 'مستفيد بإحداثيات فاسدة',
  region: 'الرياض', city: 'الرياض', address: 'حي', phone: '0501112255',
  familyCount: 1, socialStatus: 'أرملة', needs: [], lat: '95', lng: '46.6'
}), 'بين -90 و90');

const savedWithSource = S2.saveBeneficiary(adminSession.token, {
  associationId: accepted.associationId, name: 'مستفيد بمصدر موقع محدد',
  region: 'الرياض', city: 'الرياض', address: 'حي', phone: '0501112266',
  familyCount: 1, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6', locationSource: 'خريطة'
});
assert('saveBeneficiary يحفظ مصدر الموقع المُرسَل صراحة إن كان معتمدًا', savedWithSource.record.locationSource === 'خريطة');

const reSavedSameCoords = S2.saveBeneficiary(adminSession.token, {
  id: savedWithSource.id, associationId: accepted.associationId, name: 'مستفيد بمصدر موقع محدد',
  region: 'الرياض', city: 'الرياض', address: 'حي مختلف', phone: '0501112266',
  familyCount: 1, socialStatus: 'أرملة', needs: [], lat: '24.7', lng: '46.6', locationSource: 'يدوي'
});
assert('إعادة حفظ بنفس الإحداثيات (تعديل حقل آخر فقط) لا يُعيد ضبط مصدر/تاريخ الموقع',
  reSavedSameCoords.record.locationSource === 'خريطة' && reSavedSameCoords.record.locationUpdatedAt === savedWithSource.record.locationUpdatedAt);

/* -------- 17) دعم الإحداثيات في الاستيراد الجماعي (importBeneficiaries) -------- */

section('17) دعم الإحداثيات في الاستيراد الجماعي');

const importWithCoords = S2.importBeneficiaries(adminSession.token, [
  {
    associationId: accepted.associationId, name: 'مستفيد استيراد بإحداثيات', region: 'الرياض', city: 'الرياض',
    address: 'حي الملقا', phone: '0501113001', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة'],
    lat: '24.75', lng: '46.65'
  },
  {
    associationId: accepted.associationId, name: 'مستفيد استيراد بلا إحداثيات (ملف قديم)', region: 'الرياض', city: 'الرياض',
    address: 'حي الروضة', phone: '0501113002', familyCount: 1, socialStatus: 'أرملة', needs: ['غسالة']
  }
], true);
assert('importBeneficiaries ينجح لصفّين، أحدهما بإحداثيات والآخر بلا إحداثيات', importWithCoords.ok && importWithCoords.imported === 2);

const importedRows = S2.readTable_('المستفيدون').rows.filter(row => String(row['رقم الجمعية']) === accepted.associationId);
const withCoordsRow = importedRows.find(row => row['الاسم'] === 'مستفيد استيراد بإحداثيات');
const withoutCoordsRow = importedRows.find(row => row['الاسم'] === 'مستفيد استيراد بلا إحداثيات (ملف قديم)');
assert('الصف المستورَد بإحداثيات يحفظها كأرقام صحيحة', withCoordsRow && Number(withCoordsRow['خط العرض']) === 24.75 && Number(withCoordsRow['خط الطول']) === 46.65);
assert('الصف المستورَد بلا إحداثيات (توافق مع ملفات قديمة) يبقى بحقلين فارغين دون فشل الاستيراد',
  withoutCoordsRow && withoutCoordsRow['خط العرض'] === '' && withoutCoordsRow['خط الطول'] === '');

assert('الصف المستورَد بإحداثيات: مصدر الموقع "استيراد" وتاريخ التحديث مضبوط',
  withCoordsRow && withCoordsRow['مصدر الموقع'] === 'استيراد' && !!withCoordsRow['تاريخ تحديث الموقع']);
assert('الصف المستورَد بلا إحداثيات: مصدر الموقع وتاريخ تحديثه فارغان',
  withoutCoordsRow && withoutCoordsRow['مصدر الموقع'] === '' && withoutCoordsRow['تاريخ تحديث الموقع'] === '');

const importRejected = S2.importBeneficiaries(adminSession.token, [
  {
    associationId: accepted.associationId, name: 'مستفيد بإحداثيات فاسدة في الاستيراد', region: 'الرياض', city: 'الرياض',
    address: 'حي', phone: '0501113003', familyCount: 1, socialStatus: 'أرملة', needs: [],
    lat: '999', lng: '46.6'
  }
], true);
assert('صف بإحداثيات خارج النطاق يُرفض برسالة واضحة بدل قبوله صامتًا (لا يُستورَد الاستيراد كله بلا توضيح)',
  importRejected.ok === false && importRejected.errorCount === 1 && /بين -90 و90/.test(importRejected.errors[0].message));

const importPartialCoords = S2.importBeneficiaries(adminSession.token, [
  {
    associationId: accepted.associationId, name: 'مستفيد بإحداثية واحدة فقط', region: 'الرياض', city: 'الرياض',
    address: 'حي', phone: '0501113004', familyCount: 1, socialStatus: 'أرملة', needs: [], lat: '24.7'
  }
], true);
assert('صف بإحداثية واحدة فقط (دون الأخرى) يُرفض صراحة بدل إسقاطها بصمت',
  importPartialCoords.ok === false && importPartialCoords.errorCount === 1 && /معًا/.test(importPartialCoords.errors[0].message));

// inspectBeneficiaryExcel: تحقّق ثابت من الكود لأن محاكاة رفع Excel الفعلي
// (عبر UrlFetchApp/Drive الحقيقيين) تتجاوز نطاق بيئة الاختبار المحلية —
// موثَّق صراحةً هنا بدل الادّعاء باختبار حي لم يحدث.
assert('inspectBeneficiaryExcel يتعرّف على عمودي "خط العرض"/"خط الطول" كأعمدة اختيارية (keyMap)',
  /'خط العرض':\s*'lat'/.test(source) && /'خط الطول':\s*'lng'/.test(source));
assert('"خط العرض"/"خط الطول" ليسا ضمن الأعمدة الإلزامية "expected" (ملفات قديمة بلا إحداثيات تبقى مقبولة)', (() => {
  const start = source.indexOf('function inspectBeneficiaryExcel(');
  const expectedLine = source.slice(start, start + 3000).match(/const expected = \[[^\]]*\];/);
  return expectedLine && !expectedLine[0].includes('خط العرض') && !expectedLine[0].includes('خط الطول');
})());
assert('inspectBeneficiaryExcel يتحقق من صحة الإحداثيات لكل صف عبر optionalCoordinate_', (() => {
  const start = source.indexOf('function inspectBeneficiaryExcel(');
  const end = source.indexOf('\nfunction ', start + 10);
  const body = source.slice(start, end === -1 ? start + 4000 : end);
  return /optionalCoordinate_\(row\.lat, row\.lng\)/.test(body);
})());

/* -------- 18) منع التكرار في المستفيدين والاستيراد -------- */

section('18) منع التكرار في المستفيدين والاستيراد');

const dupBase = {
  associationId: accepted.associationId, region: 'الرياض', city: 'الرياض', address: 'حي التعاون',
  familyCount: 3, socialStatus: 'أرملة', needs: []
};

const dupFirst = S2.saveBeneficiary(adminSession.token, Object.assign({}, dupBase, {
  name: 'فاطمة الدوسري', phone: '0509990001'
}));
assert('إضافة مستفيد أول تنجح كسجل جديد بلا تكرار', dupFirst.ok === true && !dupFirst.possibleDuplicateWarning);

let dupPhoneError = null;
try {
  S2.saveBeneficiary(adminSession.token, Object.assign({}, dupBase, {
    name: 'اسم مختلف تمامًا', phone: '0509990001'
  }));
} catch (error) { dupPhoneError = error; }
assert('إضافة مستفيد بنفس رقم الجوال (مطابق مؤكَّد) تُرفض ولا تُقبل رغم اختلاف الاسم',
  dupPhoneError && /نفس رقم الجوال/.test(dupPhoneError.message));

let dupPhoneFormatError = null;
try {
  S2.saveBeneficiary(adminSession.token, Object.assign({}, dupBase, {
    name: 'اسم آخر', phone: '966509990001'
  }));
} catch (error) { dupPhoneFormatError = error; }
assert('التكرار المؤكَّد يُكتشف حتى مع اختلاف صيغة كتابة رقم الجوال (966 بدل 0)',
  dupPhoneFormatError && /نفس رقم الجوال/.test(dupPhoneFormatError.message));

const dupEditSelf = S2.saveBeneficiary(adminSession.token, Object.assign({}, dupBase, {
  id: dupFirst.id, name: 'فاطمة الدوسري المحدَّثة', phone: '0509990001'
}));
assert('تعديل السجل نفسه بنفس رقم جواله لا يُرفض كتكرار (استثناء الذات)', dupEditSelf.ok === true);

const dupPossible = S2.saveBeneficiary(adminSession.token, Object.assign({}, dupBase, {
  name: 'فاطمة الدوسري المحدَّثة', phone: '0509990002'
}));
assert('مستفيد بنفس الاسم والمدينة لكن جوال مختلف: يُقبل مع تحذير "مطابق محتمل" غير مانع',
  dupPossible.ok === true && dupPossible.possibleDuplicateWarning && dupPossible.possibleDuplicateId === dupFirst.id);

const dupImportWithinFile = S2.importBeneficiaries(adminSession.token, [
  Object.assign({}, dupBase, {name: 'صف أول', phone: '0509990010'}),
  Object.assign({}, dupBase, {name: 'صف ثانٍ بنفس الجوال', phone: '0509990010'})
], true);
assert('الاستيراد يرفض تكرارًا بين صفوف الملف نفسه (لا يستورد أي سجل من الدفعة)',
  dupImportWithinFile.ok === false && dupImportWithinFile.errorCount === 1 && /داخل الملف نفسه/.test(dupImportWithinFile.errors[0].message));

const dupImportAgainstDb = S2.importBeneficiaries(adminSession.token, [
  Object.assign({}, dupBase, {name: 'صف يطابق سجلًا موجودًا', phone: '0509990001'})
], true);
assert('الاستيراد يرفض صفًا يطابق رقم جوال موجود مسبقًا في قاعدة البيانات',
  dupImportAgainstDb.ok === false && /لدى هذه الجمعية بالفعل/.test(dupImportAgainstDb.errors[0].message));

const dupImportClean = S2.importBeneficiaries(adminSession.token, [
  Object.assign({}, dupBase, {name: 'صف جديد سليم', phone: '0509990020'})
], true);
assert('الاستيراد ينجح لصف جديد لا يطابق أي تكرار مؤكَّد', dupImportClean.ok === true && dupImportClean.imported === 1);

let dupImportNoLeak = null;
try {
  const otherApp = S2.submitAssociationApplication({
    name: 'جمعية أخرى للاختبار', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    contactName: 'مسؤول آخر', phone: '0511112222', email: 'other-dup-test@example.org'
  });
  const otherAccepted = S2.reviewAssociationApplication(adminSession.token, otherApp.id, 'accept', '');
  const otherAssocSession = S2.createSession_({id: 'USR-OTHER-ASSOC', name: 'جمعية أخرى', role: 'ASSOCIATION', associationId: otherAccepted.associationId});
  // نفس رقم الجوال (0509990001) يخص جمعية "accepted" الأولى — يجب ألا تكتشف
  // جمعية أخرى هذا التكرار إطلاقًا (لا كشف بيانات جمعية أخرى)، فتنجح الإضافة.
  const otherSave = S2.saveBeneficiary(otherAssocSession.token, {
    name: 'مستفيد لدى جمعية أخرى', phone: '0509990001', region: 'الرياض', city: 'الرياض',
    address: 'حي', familyCount: 2, socialStatus: 'أرملة', needs: []
  });
  dupImportNoLeak = otherSave;
} catch (error) { dupImportNoLeak = {ok: false, error: error.message}; }
assert('فحص التكرار لا يكشف عن بيانات جمعية أخرى: نفس رقم الجوال مقبول لدى جمعية مختلفة',
  dupImportNoLeak && dupImportNoLeak.ok === true);

assert('saveBeneficiary يعيد فحص التكرار المؤكَّد داخل قفل قبل الإضافة الفعلية لمنع سباق التزامن', (() => {
  const start = source.indexOf('function saveBeneficiary(');
  const end = source.indexOf('\nfunction ', start + 10);
  const body = source.slice(start, end === -1 ? start + 4000 : end);
  return /LockService\.getScriptLock\(\)/.test(body) && /findConfirmedDuplicateBeneficiary_/.test(body);
})());

assert('importBeneficiaries يعيد فحص التكرار المؤكَّد داخل قفل قبل الكتابة الفعلية لمنع سباق التزامن بين استيرادين متزامنين', (() => {
  const start = source.indexOf('function importBeneficiaries(');
  const end = source.indexOf('\nfunction ', start + 10);
  const body = source.slice(start, end === -1 ? start + 4000 : end);
  return /LockService\.getScriptLock\(\)/.test(body) && /raceDuplicate/.test(body);
})());

/* -------- 19) قالب Excel حقيقي (.xlsx) -------- */

section('19) قالب استيراد المستفيدين بصيغة Excel حقيقية (.xlsx)');

const xlsxAssocSession = S2.createSession_({id: 'USR-ASSOC-XLSX', name: 'جمعية اختبار القالب', role: 'ASSOCIATION', associationId: accepted.associationId});
const xlsxResult = S2.downloadBeneficiaryImportTemplateXlsx(xlsxAssocSession.token);
assert('downloadBeneficiaryImportTemplateXlsx يعيد dataUrl بصيغة xlsx الرسمية', xlsxResult.ok === true
  && /^data:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet;base64,/.test(xlsxResult.dataUrl));

throws('غير المسجَّل دخوله لا يمكنه تنزيل القالب', () => S2.downloadBeneficiaryImportTemplateXlsx('token-غير-صحيح'), '');

(function structuralXlsxTest() {
  const fs = require('fs');
  const path = require('path');
  const cp = require('child_process');
  const base64 = xlsxResult.dataUrl.split(',')[1];
  const bytes = Buffer.from(base64, 'base64');
  const tmpFile = path.join(require('os').tmpdir(), 'beneficiary-import-template-test.xlsx');
  fs.writeFileSync(tmpFile, bytes);

  // اختبار بنيوي حقيقي عبر python3 (وحدة zipfile القياسية) — يفتح الملف
  // كأرشيف ZIP فعلي (وهذا هو الأساس البنيوي لصيغة xlsx نفسها)، يتحقق من
  // وجود كل الأجزاء المطلوبة، ويتحقق أن كل جزء XML سليم البنية (parseable)
  // فعلًا لا نصًا عشوائيًا بامتداد مغاير. هذا اختبار بنيوي محلي فقط،
  // وليس فتحًا فعليًا داخل تطبيق Excel حقيقي (يتطلب اختبارًا يدويًا حيًا).
  const pyScript = `
import zipfile, sys, xml.etree.ElementTree as ET
path = ${JSON.stringify(tmpFile)}
required = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]
try:
    zf = zipfile.ZipFile(path)
    bad = zf.testzip()
    if bad:
        print("BAD_ENTRY:" + bad); sys.exit(1)
    names = zf.namelist()
    missing = [n for n in required if n not in names]
    if missing:
        print("MISSING:" + ",".join(missing)); sys.exit(1)
    for n in required:
        content = zf.read(n)
        try:
            ET.fromstring(content)
        except Exception as e:
            print("XML_PARSE_ERROR:" + n + ":" + str(e)); sys.exit(1)
    sheet1 = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
    if "الاسم" not in sheet1 or "الجوال" not in sheet1:
        print("MISSING_HEADERS"); sys.exit(1)
    if "0501234567" not in sheet1:
        print("PHONE_LEADING_ZERO_LOST"); sys.exit(1)
    if "dataValidation" not in sheet1:
        print("NO_DATA_VALIDATION"); sys.exit(1)
    print("OK")
except zipfile.BadZipFile as e:
    print("NOT_A_ZIP:" + str(e)); sys.exit(1)
`;
  let output;
  try {
    output = cp.execFileSync('python3', ['-c', pyScript], {encoding: 'utf8'}).trim();
  } catch (error) {
    output = 'EXEC_ERROR:' + (error.stdout || error.message);
  }
  assert('الملف الناتج أرشيف ZIP سليم فعليًا (وليس CSV بامتداد مغاير)', output.indexOf('NOT_A_ZIP') !== 0 && output.indexOf('EXEC_ERROR') !== 0, output);
  assert('كل أجزاء OOXML المطلوبة موجودة (Content_Types، workbook، worksheets، styles، rels)', output.indexOf('MISSING:') !== 0, output);
  assert('كل جزء XML داخل الملف سليم البنية (parseable) فعلًا', output.indexOf('XML_PARSE_ERROR') !== 0, output);
  assert('صف العناوين الرسمية موجود في ورقة "مستفيدون" (الاسم، الجوال...)', output.indexOf('MISSING_HEADERS') !== 0, output);
  assert('رقم الجوال في صف المثال يحافظ على الصفر الأول (تنسيق نصي)', output.indexOf('PHONE_LEADING_ZERO_LOST') !== 0, output);
  assert('قوائم Excel المنسدلة المرجعية (dataValidation) موجودة فعليًا في الملف', output.indexOf('NO_DATA_VALIDATION') !== 0, output);
  assert('الاختبار البنيوي الكامل نجح (OK) عبر أداة ZIP/XML قياسية مستقلة', output.trim() === 'OK', output);

  try { fs.unlinkSync(tmpFile); } catch (ignore) {}
})();

/* -------- 20) تفاصيل الجهاز وسجل عمليات المندوب -------- */

section('20) تفاصيل الجهاز وسجل عمليات المندوب');

const detailBeneficiary = S2.saveBeneficiary(adminSession.token, {
  associationId: accepted.associationId, name: 'مستفيد تفاصيل الجهاز', region: 'الرياض', city: 'الرياض',
  address: 'حي', phone: '0509990030', familyCount: 2, socialStatus: 'أرملة', needs: []
});
const detailDevice = S2.saveDevice(adminSession.token, {
  name: 'ثلاجة اختبار التفاصيل', type: 'ثلاجة', associationId: accepted.associationId,
  beneficiaryId: detailBeneficiary.id, status: 'مخصص'
});
const detailDelegate = S2.saveDelegate(adminSession.token, {name: 'مندوب اختبار التفاصيل', phone: '0509990031', associationId: accepted.associationId});
const detailAssign = S2.assignDelegate(adminSession.token, detailBeneficiary.id, detailDelegate.id);
assert('assignDelegate ينجح ويحوّل الجهاز إلى "مع المندوب"', detailAssign.ok === true);

const deviceDetail = S2.getDeviceDetail(adminSession.token, detailDevice.id);
assert('getDeviceDetail يعيد بيانات الجهاز الأساسية', deviceDetail.ok === true && deviceDetail.device.id === detailDevice.id);
assert('getDeviceDetail يعيد اسم الجمعية والمستفيد والمندوب الحاليين', deviceDetail.associationName === accepted.associationName || deviceDetail.associationName.length > 0);
assert('getDeviceDetail يعيد اسم المستفيد الحالي المرتبط بالجهاز', deviceDetail.beneficiaryName === 'مستفيد تفاصيل الجهاز');
assert('getDeviceDetail يعيد اسم المندوب المرتبط بعد التعيين', deviceDetail.delegateName === 'مندوب اختبار التفاصيل');
assert('getDeviceDetail يشتق "تاريخ الخروج مع المندوب" من سجل العمليات الخاص بالجهاز (بلا عمود جديد)', deviceDetail.dispatchedAt !== '');
assert('سجل عمليات الجهاز (log) يتضمن حدث تحويله إلى "مع المندوب"', deviceDetail.log.some(function (row) { return /مع المندوب/.test(row.notes); }));

const otherAssocSession2 = S2.createSession_({id: 'USR-OTHER-ASSOC-DEV', name: 'جمعية أخرى', role: 'ASSOCIATION', associationId: 'ASC-NONEXISTENT-XYZ'});
throws('جمعية أخرى لا تستطيع الاطلاع على تفاصيل جهاز جمعية غير جمعيتها (IDOR)', () => S2.getDeviceDetail(otherAssocSession2.token, detailDevice.id), 'صلاحية');

throws('جهاز غير موجود يُرفَض برسالة واضحة', () => S2.getDeviceDetail(adminSession.token, 'DEV-NOT-EXIST'), 'غير موجود');

// سجل عمليات المندوب: الإدارة ترى الكل، الجمعية ترى مندوبيها، المندوب يرى نفسه فقط ضمن الأحداث المسموحة.
const ownDelegateLog = S2.listDelegateAuditLog(adminSession.token, detailDelegate.id, {});
assert('listDelegateAuditLog (إدارة): يتضمن حدث الإضافة وحدث التعيين لهذا المندوب', ownDelegateLog.ok === true
  && ownDelegateLog.items.some(function (r) { return r.action === 'إضافة مندوب'; })
  && ownDelegateLog.items.some(function (r) { return r.action === 'تعيين مندوب'; }));

const delegateSelfSession = S2.createSession_({id: detailDelegate.id, name: 'مندوب اختبار التفاصيل', role: 'DELEGATE', associationId: accepted.associationId});
const delegateSelfLog = S2.listDelegateAuditLog(delegateSelfSession.token, detailDelegate.id, {});
assert('listDelegateAuditLog (المندوب نفسه): يرى حدث تعيينه', delegateSelfLog.items.some(function (r) { return r.action === 'تعيين مندوب'; }));
assert('listDelegateAuditLog (المندوب نفسه): لا يرى حدث "إضافة مندوب" الإداري (بيانات إدارية حساسة مستبعدة)',
  !delegateSelfLog.items.some(function (r) { return r.action === 'إضافة مندوب'; }));

const otherDelegate = S2.saveDelegate(adminSession.token, {name: 'مندوب آخر لاختبار العزل', phone: '0509990032', associationId: accepted.associationId});
const otherDelegateSession = S2.createSession_({id: otherDelegate.id, name: 'مندوب آخر لاختبار العزل', role: 'DELEGATE', associationId: accepted.associationId});
throws('مندوب لا يستطيع الاطلاع على سجل عمليات مندوب آخر (IDOR بين مندوبين)',
  () => S2.listDelegateAuditLog(otherDelegateSession.token, detailDelegate.id, {}), 'صلاحية');

const otherAssocDelegateSession = S2.createSession_({id: 'USR-OTHER-ASSOC-DELEGATE', name: 'جمعية أخرى', role: 'ASSOCIATION', associationId: 'ASC-NONEXISTENT-XYZ'});
throws('جمعية أخرى لا تستطيع الاطلاع على سجل مندوب لا يتبعها', () => S2.listDelegateAuditLog(otherAssocDelegateSession.token, detailDelegate.id, {}), 'صلاحية');

/* -------- النتيجة -------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0 ? `نجحت جميع الاختبارات: ${checks}/${checks}` : `فشل ${failures} من ${checks} اختبارًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
