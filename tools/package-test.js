#!/usr/bin/env node
/**
 * يتحقق آليًا من حزمة التركيب اليدوية المبنية عبر build-release-package.js:
 * يفكّ ضغط الـZIP في مجلد مؤقت ويتأكد من عدد الملفات، الأسماء، تطابق
 * المحتوى حرفيًا مع المصدر، عدم وجود ملفات خطرة إضافية، وسلامة UTF-8/العربية.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ROOT, ZIP_PATH, PKG_NAME, ALL_FILES, ALL_GS, REPLACED_FILES, NEW_FILES } = require('./build-release-package');

let passed = 0;
let failed = 0;
function assert(label, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('✗ ' + label);
  }
}

if (!fs.existsSync(ZIP_PATH)) {
  console.error('لم يتم العثور على ' + ZIP_PATH + ' — شغّل tools/build-release-package.js أولًا.');
  process.exit(1);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alzad-pkg-test-'));
execFileSync('unzip', ['-q', ZIP_PATH, '-d', tmpRoot]);
const extractedDir = path.join(tmpRoot, PKG_NAME);

assert('مجلد الحزمة بعد فك الضغط موجود', fs.existsSync(extractedDir) && fs.statSync(extractedDir).isDirectory());

const entries = fs.readdirSync(extractedDir);
const codeFiles = entries.filter(name => name.endsWith('.gs') || name === 'Index.html');
const sidecarFiles = entries.filter(name => ['INSTALL.txt', 'MANIFEST.txt', 'SHA256.txt'].indexOf(name) !== -1);

assert('عدد ملفات الكود بالضبط 17 (16 .gs + Index.html واحد)، لا أكثر', codeFiles.length === 17);
assert('عدد ملفات .gs بالضبط 16', codeFiles.filter(n => n.endsWith('.gs')).length === 16);
assert('يوجد Index.html واحد بالضبط', codeFiles.filter(n => n === 'Index.html').length === 1);

ALL_GS.forEach(name => {
  assert('اسم الملف مطابق تمامًا: ' + name, entries.indexOf(name) !== -1);
});
assert('اسم الملف مطابق تمامًا: Index.html', entries.indexOf('Index.html') !== -1);

assert('الملفات المرافقة الثلاثة موجودة (INSTALL.txt, MANIFEST.txt, SHA256.txt)', sidecarFiles.length === 3);

assert('لا يوجد TempPasswordReset.gs داخل الحزمة إطلاقًا', entries.indexOf('TempPasswordReset.gs') === -1);

const allowedNames = new Set(ALL_FILES.concat(['INSTALL.txt', 'MANIFEST.txt', 'SHA256.txt']));
const unexpected = entries.filter(name => !allowedNames.has(name));
assert('لا توجد أي ملفات إضافية خطرة أو غير متوقعة داخل الحزمة', unexpected.length === 0);
if (unexpected.length) console.error('  ملفات غير متوقعة: ' + unexpected.join('، '));

ALL_FILES.forEach(name => {
  const srcPath = path.join(ROOT, name);
  const extractedPath = path.join(extractedDir, name);
  const srcBuf = fs.readFileSync(srcPath);
  const extractedBuf = fs.readFileSync(extractedPath);
  assert('المحتوى مطابق حرفيًا للمصدر: ' + name, Buffer.compare(srcBuf, extractedBuf) === 0);

  const srcHash = crypto.createHash('sha256').update(srcBuf).digest('hex');
  const extractedHash = crypto.createHash('sha256').update(extractedBuf).digest('hex');
  assert('بصمة SHA-256 مطابقة للمصدر: ' + name, srcHash === extractedHash);
});

const utf8Samples = {
  'Config.gs': 'جمعية',
  'Index.html': 'جمعية الزاد',
  'INSTALL.txt': 'خطوات تركيب',
  'MANIFEST.txt': 'حزمة التركيب'
};
Object.keys(utf8Samples).forEach(name => {
  const text = fs.readFileSync(path.join(extractedDir, name), 'utf8');
  assert('ترميز UTF-8 وسلامة النص العربي في ' + name, text.indexOf(utf8Samples[name]) !== -1);
  assert('لا وجود لأحرف استبدال تالفة (mojibake) في ' + name, text.indexOf('�') === -1);
});

const manifestText = fs.readFileSync(path.join(extractedDir, 'MANIFEST.txt'), 'utf8');
REPLACED_FILES.forEach(name => {
  assert('MANIFEST.txt يذكر ملف الاستبدال: ' + name, manifestText.indexOf(name) !== -1);
});
NEW_FILES.forEach(name => {
  assert('MANIFEST.txt يذكر الملف الجديد: ' + name, manifestText.indexOf(name) !== -1);
});
assert('MANIFEST.txt يذكر حذف TempPasswordReset.gs', manifestText.indexOf('TempPasswordReset.gs') !== -1);

const installText = fs.readFileSync(path.join(extractedDir, 'INSTALL.txt'), 'utf8');
assert('INSTALL.txt يحذّر من setupSheets المباشر', installText.indexOf('setupSheets') !== -1);
assert('INSTALL.txt يحذّر من النشر قبل الإكمال', installText.indexOf('لا تنشر') !== -1);
assert('INSTALL.txt يذكر حذف TempPasswordReset.gs', installText.indexOf('TempPasswordReset.gs') !== -1);

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('');
console.log('اختبار الحزمة: ' + passed + ' ناجح، ' + failed + ' فاشل.');
if (failed > 0) process.exit(1);
