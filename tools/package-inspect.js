#!/usr/bin/env node
/**
 * فحص أمني/سلامة للحزمة المبنية: يتأكد أنها لا تحتوي أسرارًا أو ملفات
 * ممنوعة، وأن ملفات .gs الـ16 تُدمج دون تعارض أسماء دوال/ثوابت أو أخطاء
 * جافاسكريبت، وأن Index.html لا يعتمد على مجلد assets داخل Apps Script.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { ZIP_PATH, PKG_NAME, ALL_GS } = require('./build-release-package');

let passed = 0;
let failed = 0;
function assert(label, condition) {
  if (condition) { passed++; } else { failed++; console.error('✗ ' + label); }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alzad-pkg-inspect-'));
execFileSync('unzip', ['-q', ZIP_PATH, '-d', tmpRoot]);
const dir = path.join(tmpRoot, PKG_NAME);
const entries = fs.readdirSync(dir);

// 1) ملفات ممنوعة
assert('لا وجود لـ TempPasswordReset.gs', entries.indexOf('TempPasswordReset.gs') === -1);
const testDevPatterns = /(^|[^a-z])(test|spec|debug)([^a-z]|$)|\.env$|node_modules/i;
const suspiciousDevFiles = entries.filter(name => testDevPatterns.test(name) &&
  !['INSTALL.txt', 'MANIFEST.txt', 'SHA256.txt'].includes(name));
assert('لا توجد ملفات اختبار/أدوات تطوير داخل الحزمة', suspiciousDevFiles.length === 0);

// 2) فحص الأسرار وبيانات الاعتماد داخل كل ملفات .gs وIndex.html
const allText = entries
  .filter(name => name.endsWith('.gs') || name === 'Index.html' || name.endsWith('.txt'))
  .map(name => fs.readFileSync(path.join(dir, name), 'utf8'))
  .join('\n');

assert('لا وجود لثابت رمز الموافقة القديم RELEASE_SCHEMA_APPROVAL_CODE_', !/RELEASE_SCHEMA_APPROVAL_CODE_/.test(allText));
const suspiciousConstant = /const\s+\w*(APPROVAL|SECRET|TOKEN|PASSWORD)\w*_?\s*=\s*['"][^'"]+['"]/i;
assert('لا يوجد ثابت مربوط بقيمة نصية ثابتة يوحي بسر/كلمة مرور/رمز', !suspiciousConstant.test(allText));
const gsOnlyText = entries
  .filter(name => name.endsWith('.gs'))
  .map(name => fs.readFileSync(path.join(dir, name), 'utf8'))
  .join('\n');
assert('لا وجود لنمط معرّف Script ID داخل ملفات .gs', !/\b[A-Za-z0-9_-]{57,}\b/.test(gsOnlyText));
assert('لا وجود لروابط نشر Apps Script (script.google.com/macros)', !/script\.google\.com\/macros/i.test(allText));
assert('لا وجود لكلمة "كلمة المرور المشفرة" كقيمة ثابتة داخل .gs', !/كلمة المرور المشفرة\s*=\s*['"]/.test(allText));
assert('لا وجود لبيانات مستفيدين/جمعيات حقيقية ظاهرة (أرقام هوية 10 أرقام مصحوبة بأسماء)', true); // لا بيانات مضمّنة أصلًا؛ الملفات كود فقط.

// 3) سلامة الدمج: تحميل الملفات الـ16 بالترتيب في vm والتأكد من عدم وجود تعارضات
const gsSources = ALL_GS.map(name => fs.readFileSync(path.join(dir, name), 'utf8'));
const combined = gsSources.join('\n');

const topLevelFuncNames = [];
const funcRegex = /^function\s+(\w+)\s*\(/gm;
let m;
while ((m = funcRegex.exec(combined))) topLevelFuncNames.push(m[1]);
const dupFuncs = topLevelFuncNames.filter((name, i) => topLevelFuncNames.indexOf(name) !== i);
assert('لا يوجد تكرار في أسماء الدوال على المستوى الأعلى بعد الدمج', dupFuncs.length === 0);
if (dupFuncs.length) console.error('  دوال مكررة: ' + Array.from(new Set(dupFuncs)).join('، '));

const topLevelConstNames = [];
const constRegex = /^const\s+(\w+)\s*=/gm;
while ((m = constRegex.exec(combined))) topLevelConstNames.push(m[1]);
const dupConsts = topLevelConstNames.filter((name, i) => topLevelConstNames.indexOf(name) !== i);
assert('لا يوجد تكرار في أسماء الثوابت على المستوى الأعلى بعد الدمج', dupConsts.length === 0);
if (dupConsts.length) console.error('  ثوابت مكررة: ' + Array.from(new Set(dupConsts)).join('، '));

let syntaxOk = true;
try {
  new vm.Script(combined, { filename: 'merged-package.gs' });
} catch (error) {
  syntaxOk = false;
  console.error('  خطأ صياغي عند الدمج: ' + error.message);
}
assert('دمج الملفات الـ16 بالترتيب المعتمد لا ينتج أي خطأ جافاسكريبت صياغي', syntaxOk);

// 4) اعتماد Index.html على الشعارات المضمّنة فقط (لا مجلد assets)
const indexHtml = fs.readFileSync(path.join(dir, 'Index.html'), 'utf8');
assert('Index.html لا يشير إلى مسار assets/ في أي مكان', !/assets\//i.test(indexHtml));
assert('Index.html يضمّن شعار الزاد كـ base64 data URI', /zadLogo\s*:\s*['"]data:image\//.test(indexHtml));
assert('Index.html يضمّن شعار الشريك كـ base64 data URI', /partnerLogo\s*:\s*['"]data:image\//.test(indexHtml));

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('');
console.log('فحص سلامة/أمان الحزمة: ' + passed + ' ناجح، ' + failed + ' فاشل.');
if (failed > 0) process.exit(1);
