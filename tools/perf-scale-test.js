#!/usr/bin/env node
/**
 * قياس أداء بأحجام بيانات محاكاة (100 / 1000 / 5000 مستفيد) — بيئة
 * Node.js في الذاكرة فقط، بلا أي اتصال بـ Google Sheets حية أو كتابة
 * عليها. يقيس: زمن الدخول، Bootstrap، البحث المُرقَّم، الحفظ، التعيين،
 * والتسليم — بالإضافة لعدد قراءات/كتابات الجداول الفعلية لكل عملية
 * (عبر نفس عدّادات _PERF_ المستخدَمة في perfTime_ داخل DataUtils.gs).
 *
 * تنبيه صادق: هذا "أداء الخادم نفسه" (زمن تنفيذ الشيفرة داخل vm.Script
 * محليًا) — لا يقيس زمن شبكة Apps Script/Sheets API الحقيقي (غير متاح
 * من بيئة هذه الجلسة، لا يوجد وصول حي لـ script.google.com). العدد
 * الأهم هنا هو "قراءات/كتابات الجداول لكل عملية" لأنه المتغيّر الذي
 * يتحكم مباشرة في زمن الشبكة الحقيقي على Apps Script — لا الزمن
 * بالمللي ثانية المطبوع هنا، وهو دائمًا أقل بكثير من الزمن الحي المتوقع.
 *
 *   تشغيل:  node tools/perf-scale-test.js
 */
'use strict';

const path = require('path');
const vm = require('vm');
const { readMergedServerSource } = require('./gs-manifest');

const source = readMergedServerSource(path.join(__dirname, '..'));

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
  const perfLog = [];
  const sandbox = {
    console: { log: line => { try { perfLog.push(JSON.parse(line)); } catch (ignore) {} }, error: () => {} },
    JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error,
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
    ScriptApp: { getScriptId: () => 'perf-scale', getOAuthToken: () => 'token' },
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
  vm.runInContext(source, sandbox, { filename: 'gs-merged(perf-scale)' });
  sandbox.__perfLog = perfLog;
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

function seedSheets(S) {
  Object.keys(ALL_HEADERS).forEach(name => S.ensureSheet_(S.SpreadsheetApp.getActiveSpreadsheet(), name, ALL_HEADERS[name]));
}

function timeIt(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, ms };
}

function runScenario(count) {
  const S = buildSandbox();
  seedSheets(S);
  const admin = S.createSession_({ id: 'USR-ADMIN-SCALE', name: 'مدير القياس', role: 'ADMIN', associationId: '' });
  const assoc = S.saveAssociation(admin.token, {
    name: 'جمعية القياس ' + count, category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض',
    phone: '0500000040', email: 'scale-' + count + '@example.org', password: 'ScalePass123'
  });
  const assocSession = S.createSession_({ id: 'USR-SCALE-' + count, name: 'جمعية القياس', role: 'ASSOCIATION', associationId: assoc.id });
  const delegate = S.saveDelegate(assocSession.token, { name: 'مندوب القياس', phone: '0500000041' });

  // بذر البيانات مباشرة عبر appendObjects_ (لا عبر saveBeneficiary) لتفادي
  // قياس زمن البذر نفسه ضمن نتائج الاختبار — البذر تحضير، ليس عملية مقاسة.
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      'رقم المستفيد': '', 'رقم الجمعية': assoc.id, 'الاسم': 'مستفيد رقم ' + i,
      'المنطقة': 'الرياض', 'المدينة': 'الرياض', 'العنوان': 'حي رقم ' + (i % 50),
      'رقم الجوال': '05' + String(30000000 + i).padStart(8, '0').slice(-8), 'رقم جوال إضافي': '',
      'عدد الأفراد': 3, 'ضمان اجتماعي': 'لا', 'الحالة الاجتماعية': 'متزوج/متزوجة', 'مبلغ الدخل': 2000,
      'الاحتياج': 'ثلاجة', 'حالة المستفيد': 'جديد', 'حالة التسليم': 'لم يبدأ', 'رقم المندوب': '',
      'الملاحظات': '', 'تاريخ الإنشاء': '2026/01/01', 'تاريخ التسليم': '', 'آخر تحديث': '2026/01/01',
      'خط العرض': '', 'خط الطول': ''
    });
  }
  const ids = S.nextIds_('BEN', rows.length);
  rows.forEach((row, i) => { row['رقم المستفيد'] = ids[i]; });
  S.appendObjects_('المستفيدون', rows);
  const searchTargetId = ids[Math.floor(count / 2)] || null;
  if (searchTargetId) S.updateById_('المستفيدون', 'رقم المستفيد', searchTargetId, {'الاسم': 'الهدف الفريد للبحث'});

  const metrics = {};
  S.__perfLog.length = 0;

  // كل استدعاء خادم حقيقي في Apps Script ينفَّذ في سياق تنفيذ منفصل تمامًا
  // (لا حالة JS مشتركة بين استدعاءين من العميل) — الذاكرة المؤقتة داخل
  // الطلب (_TABLE_CACHE_) تُبنى من الصفر في كل مرة. بيئة القياس هذه تُبقي
  // نفس vm context بين كل الاستدعاءات لأغراض السرعة، فنُبطل الذاكرة
  // المؤقتة يدويًا قبل كل عملية "مُقاسة" لمحاكاة هذا الفصل بأمانة.
  const resetPerCallCache = () => {
    ['المستفيدون', 'الجمعيات', 'الأجهزة', 'المناديب', 'المستخدمون', 'إدارة الأنشطة', 'شواهد الأنشطة الرئيسية', 'طلبات انضمام الجمعيات']
      .forEach(name => S.invalidateTableCache_(name));
  };

  resetPerCallCache();
  const login = timeIt(() => S.login({ type: 'user', email: 'scale-' + count + '@example.org', password: 'ScalePass123' }));
  metrics.login = login.ms;
  const token = login.result.token;

  resetPerCallCache();
  const bootstrap = timeIt(() => S.getBootstrapData(token, true));
  metrics.bootstrap = bootstrap.ms;

  resetPerCallCache();
  const listPage = timeIt(() => S.listBeneficiaries(token, { page: 1, pageSize: 25 }));
  metrics.listFirstPage = listPage.ms;

  resetPerCallCache();
  const search = timeIt(() => S.listBeneficiaries(token, { page: 1, pageSize: 25, search: 'الهدف الفريد' }));
  metrics.search = search.ms;
  metrics.searchFound = search.result.total === 1;

  resetPerCallCache();
  const save = timeIt(() => S.saveBeneficiary(token, {
    name: 'مستفيد جديد للقياس', region: 'الرياض', city: 'الرياض', address: 'حي',
    phone: '0500055555', familyCount: 2, socialStatus: 'أرملة', needs: ['ثلاجة']
  }));
  metrics.save = save.ms;
  const newBeneficiaryId = save.result.id;

  S.saveDevice(admin.token, { name: 'ثلاجة قياس', type: 'أجهزة منزلية', associationId: assoc.id, beneficiaryId: newBeneficiaryId });

  resetPerCallCache();
  const assign = timeIt(() => S.assignDelegate(token, newBeneficiaryId, delegate.id));
  metrics.assign = assign.ms;

  const delegateSession = S.createSession_({ id: delegate.id, name: 'مندوب القياس', role: 'DELEGATE', associationId: assoc.id });
  resetPerCallCache();
  const confirm = timeIt(() => S.confirmDelivery(delegateSession.token, {
    beneficiaryId: newBeneficiaryId, confirmed: true, proofDataUrl: 'data:image/png;base64,aGVsbG8='
  }));
  metrics.confirm = confirm.ms;

  const readsByOp = {};
  S.__perfLog.forEach(entry => {
    const key = entry.perf;
    if (!readsByOp[key]) readsByOp[key] = { reads: 0, writes: 0, count: 0 };
    readsByOp[key].reads += entry.reads;
    readsByOp[key].writes += entry.writes;
    readsByOp[key].count += 1;
  });

  return { count, metrics, readsByOp };
}

console.log('قياس أداء بأحجام بيانات محاكاة — بيئة Node.js في الذاكرة فقط، بلا اتصال بأي Google Sheets حية.\n');

const sizes = [100, 1000, 5000];
const results = sizes.map(runScenario);

const fmtMs = ms => ms.toFixed(2) + 'ms';
console.log('الزمن بالمللي ثانية (تنفيذ الشيفرة محليًا — ليس زمن شبكة Apps Script الحقيقي):\n');
console.log(
  'الحجم'.padEnd(8) + 'دخول'.padEnd(10) + 'Bootstrap'.padEnd(12) + 'صفحة مستفيدين'.padEnd(16)
  + 'بحث'.padEnd(10) + 'حفظ'.padEnd(10) + 'تعيين'.padEnd(10) + 'تسليم'.padEnd(10)
);
results.forEach(r => {
  console.log(
    String(r.count).padEnd(8) + fmtMs(r.metrics.login).padEnd(10) + fmtMs(r.metrics.bootstrap).padEnd(12)
    + fmtMs(r.metrics.listFirstPage).padEnd(16) + fmtMs(r.metrics.search).padEnd(10) + fmtMs(r.metrics.save).padEnd(10)
    + fmtMs(r.metrics.assign).padEnd(10) + fmtMs(r.metrics.confirm).padEnd(10)
  );
});

console.log('\nعدد قراءات/كتابات الجداول الفعلية لكل عملية (لا يتغيّر عمليًا مع حجم البيانات — هذا هو المتغيّر الحقيقي المتحكم في زمن الشبكة على Apps Script):\n');
results.forEach(r => {
  console.log('حجم ' + r.count + ':');
  Object.keys(r.readsByOp).forEach(op => {
    const stat = r.readsByOp[op];
    console.log('  ' + op.padEnd(28) + 'قراءات=' + stat.reads + '  كتابات=' + stat.writes + '  (لكل استدعاء: قراءات=' + (stat.reads / stat.count).toFixed(1) + ')');
  });
});

console.log('\nملاحظة صادقة: البحث والصفحة الأولى وBootstrap كلها تقرأ الجدول كاملًا مرة');
console.log('واحدة (readTable_ + الذاكرة المؤقتة القصيرة داخل الطلب) بصرف النظر عن حجم');
console.log('الصفحة المطلوبة فعليًا — لذلك الزمن هنا ينمو تقريبًا خطيًا مع عدد السجلات (ملموس عند 5000)،');
console.log('و"القراءة الواحدة الكاملة لكل عملية" هي ما يُبقي تكلفة Sheets API نفسها ثابتة');
console.log('(لا تتضاعف)، لكنها لا تُلغي كلفة معالجة/تصفية/ترتيب المصفوفة كاملة في ذاكرة');
console.log('Apps Script نفسها. راجع RELEASE.md لتفصيل هذا القيد والحل المقترح (فهرس/قاعدة');
console.log('بيانات مستقلة) إن نما عدد المستفيدين لعشرات الآلاف مستقبلًا.');
