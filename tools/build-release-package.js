#!/usr/bin/env node
/**
 * يبني حزمة تركيب يدوية منفصلة (20 ملفًا: 19 .gs + Index.html) لأحدث Release
 * Candidate، مع INSTALL.txt وMANIFEST.txt وSHA256.txt داخل أرشيف ZIP واحد.
 * لا يُشغّل أي دالة صيانة، ولا يعدّل Google Sheets، ولا ينشر أي شيء —
 * يقرأ فقط ملفات المصدر الحالية في جذر المستودع وينسخها كما هي حرفيًا.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { GS_FILES_ORDER } = require('./gs-manifest');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PKG_NAME = 'alzad-rc-split-18-files';
const STAGE = path.join(DIST, PKG_NAME);
const ZIP_PATH = path.join(DIST, PKG_NAME + '.zip');

const ALL_GS = GS_FILES_ORDER.slice();
const ALL_FILES = ALL_GS.concat(['Index.html']);

/**
 * بعد المرحلة التاسعة: **كل الملفات تُستبدل بالكامل** (20 ملفًا حاليًا:
 * 19 `.gs` + `Index.html`؛ Phase 3.1 أضافت AutoAllocation.gs وReceiptBatches.gs
 * كملفين جديدين كاملين إلى القائمة)، ولا فرق عملي بين "إنشاء" و"استبدال" هنا
 * الأسماء تمامًا)، لكن التعديلات متشابكة عبر الملفات (نطاق الطلب، شكل
 * الاستجابات، عقد الواجهة/الخادم) — فخلط نسخة قديمة بأخرى جديدة يكسر
 * العقد بينهما. لذلك لا يوجد تقسيم "استبدال/إنشاء" بعد الآن.
 */
const REPLACED_FILES = ALL_FILES.slice();
const NEW_FILES = [];

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function getCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
}

function buildDate() {
  return new Date().toISOString().slice(0, 10);
}

function stage() {
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });

  const missing = ALL_FILES.filter(name => !fs.existsSync(path.join(ROOT, name)));
  if (missing.length) {
    throw new Error('ملفات مصدر مفقودة عن الجذر: ' + missing.join('، '));
  }

  ALL_FILES.forEach(name => {
    fs.copyFileSync(path.join(ROOT, name), path.join(STAGE, name));
  });

  return { commit: getCommit(), date: buildDate() };
}

function typeOf(name) {
  if (name === 'Index.html') return 'واجهة مستخدم (HTML)';
  return 'كود خادم Apps Script (.gs)';
}

function writeManifest(meta) {
  const lines = [];
  lines.push('MANIFEST.txt — حزمة التركيب اليدوية المنفصلة لأحدث Release Candidate');
  lines.push('نظام متابعة مشروع توزيع الأجهزة الكهربائية — جمعية الزاد');
  lines.push('');
  lines.push('الكوميت المصدر (Source commit): ' + meta.commit);
  lines.push('تاريخ بناء الحزمة (Package build date): ' + meta.date);
  lines.push('');
  lines.push('عدد الملفات في الحزمة: ' + ALL_FILES.length + ' ملفًا (' + ALL_GS.length + ' .gs + Index.html واحد)');
  lines.push('');
  lines.push('قائمة الملفات ونوع كل ملف:');
  ALL_FILES.forEach(name => {
    lines.push('  - ' + name + '  [' + typeOf(name) + ']');
  });
  lines.push('');
  lines.push('الملفات التي سيُستبدل محتواها بالكامل (' + REPLACED_FILES.length + ' ملفًا — أي كل ملفات الحزمة):');
  REPLACED_FILES.forEach(name => lines.push('  - ' + name));
  lines.push('');
  lines.push('ملفات جديدة يجب إنشاؤها: لا يوجد. البنية نفسها لم تتغيّر');
  lines.push('(' + ALL_GS.length + ' ملف .gs + Index.html، شاملة AutoAllocation.gs وReceiptBatches.gs الجديدين في Phase 3.1).');
  lines.push('');
  lines.push('⚠️ مهم: استبدل الملفات الـ' + ALL_FILES.length + ' كلها، لا بعضها. التعديلات متشابكة');
  lines.push('عبر الملفات (نطاق الطلب الواحد، شكل الاستجابات، عقد الواجهة/الخادم)،');
  lines.push('وخلط نسخة قديمة بأخرى جديدة يكسر العقد بينهما.');
  lines.push('');
  lines.push('Index.html: يُستبدل بالكامل (محتوى كامل جديد، وليس تعديلًا جزئيًا).');
  lines.push('');
  lines.push('TempPasswordReset.gs: ملف مؤقت قديم غير جزء من النسخة النهائية إطلاقًا،');
  lines.push('ولا يوجد داخل هذه الحزمة، ويجب حذفه يدويًا من المشروع التجريبي قبل النشر.');
  lines.push('');
  lines.push('ملاحظة: لا يوجد أي ترتيب "استيراد" حقيقي بين ملفات .gs داخل Apps Script —');
  lines.push('كل الملفات تُدمج تلقائيًا في نطاق عام واحد بصرف النظر عن ترتيب إنشائها.');
  lines.push('');
  return lines.join('\n') + '\n';
}

function writeInstall() {
  const lines = [];
  lines.push('INSTALL.txt — خطوات تركيب مبسّطة جدًا (بالعربية)');
  lines.push('نظام متابعة مشروع توزيع الأجهزة الكهربائية — جمعية الزاد');
  lines.push('');
  lines.push('تحذير قبل البدء:');
  lines.push('تأكّد أنك تعمل على مشروع Apps Script "التجريبي" فقط، وليس المشروع');
  lines.push('الأساسي/الفعلي (Live). لا تنفّذ أي خطوة من هذه الحزمة على النظام الحي.');
  lines.push('');
  lines.push('1) خذ نسخة احتياطية أولًا:');
  lines.push('   - نسخة احتياطية من ملف Google Sheets (تنزيل/نسخ الملف).');
  lines.push('   - نسخة احتياطية من مشروع Apps Script (تنزيل كل الملفات أو نسخ محتواها).');
  lines.push('');
  lines.push('2) احذف الملف المؤقت القديم:');
  lines.push('   - احذف الملف TempPasswordReset.gs من مشروع Apps Script التجريبي إن وُجد.');
  lines.push('   - هذا الملف ليس جزءًا من النسخة النهائية ولا يوجد داخل هذه الحزمة.');
  lines.push('');
  lines.push('3) استبدل محتوى كل ملف من الملفات الـ' + ALL_FILES.length + ' التالية واحدًا تلو الآخر');
  lines.push('   (افتح الملف، احذف محتواه بالكامل بـCtrl+A، ثم الصق المحتوى الجديد');
  lines.push('   من الملف الذي يحمل نفس الاسم داخل هذه الحزمة):');
  ALL_FILES.forEach((name, index) => lines.push('   ' + (index + 1) + '. ' + name));
  lines.push('');
  lines.push('   ⚠️ استبدلها كلها، لا بعضها — التعديلات متشابكة عبر الملفات،');
  lines.push('   وخلط نسخة قديمة بأخرى جديدة يكسر العقد بين الواجهة والخادم.');
  lines.push('');
  lines.push('4) لا يوجد أي ملف جديد يجب إنشاؤه في هذه النسخة — البنية نفسها');
  lines.push('   (' + ALL_GS.length + ' ملف .gs + Index.html، شاملة ملفَي Phase 3.1 الجديدين).');
  lines.push('');
  lines.push('5) احفظ المشروع (Ctrl+S أو من قائمة الملف).');
  lines.push('');
  lines.push('6) ممنوعات مهمة بعد الحفظ مباشرة:');
  lines.push('   - لا تُشغّل setupSheets أو أي دالة ترحيل/إصلاح مباشرة من المحرر.');
  lines.push('   - لا تنشر (Deploy) المشروع قبل إكمال preflightRelease_ وخطوات التحضير الآمنة.');
  lines.push('   - لا تُنشئ دالة مؤقتة تحمل رمز وصول صيانة (Maintenance Access Token)');
  lines.push('     إلا في الخطوة المخصّصة لذلك تحديدًا في دليل DEPLOYMENT.md.');
  lines.push('   - إن أنشأت دالة مؤقتة كهذه، احذفها فورًا من المحرر قبل أي نشر.');
  lines.push('');
  lines.push('7) بعد ذلك، اتّبع الخطوات التفصيلية الكاملة الموجودة في DEPLOYMENT.md');
  lines.push('   وRELEASE.md القسم 18 (فحص preflight قراءة-فقط، ثم diagnoseIdSequences_');
  lines.push('   لتقرير المعرّفات المكرَّرة، ثم النشر التجريبي).');
  lines.push('');
  lines.push('8) البيانات التاريخية المكرَّرة (APP-000001 مزدوج) لن تُصحَّح تلقائيًا.');
  lines.push('   بعد هذه النسخة، أي عملية تلمس معرّفًا مكرَّرًا تتوقف برسالة واضحة');
  lines.push('   بدل العمل على أول صف بصمت. التصحيح يدوي — راجع RELEASE.md 18.3.');
  lines.push('');
  return lines.join('\n') + '\n';
}

function writeSha256(meta) {
  const lines = [];
  lines.push('SHA256.txt — بصمات التحقق لكل ملف من الملفات الـ' + ALL_FILES.length + ' داخل هذه الحزمة');
  lines.push('الكوميت المصدر: ' + meta.commit);
  lines.push('تاريخ البناء: ' + meta.date);
  lines.push('');
  lines.push('ملاحظة: بصمة أرشيف ZIP نفسه لا يمكن تضمينها داخل الأرشيف (مشكلة');
  lines.push('دائرية). بصمة الأرشيف مذكورة في ملف مرافق خارج الحزمة باسم');
  lines.push('"' + PKG_NAME + '.SHA256.txt" بجانب ملف ZIP، وكذلك في التقرير النهائي.');
  lines.push('');
  lines.push('بصمات الملفات الـ' + ALL_FILES.length + ' داخل الحزمة (SHA-256):');
  ALL_FILES.forEach(name => {
    lines.push('  ' + sha256File(path.join(STAGE, name)) + '  ' + name);
  });
  lines.push('');
  return lines.join('\n') + '\n';
}

function build() {
  const meta = stage();

  fs.writeFileSync(path.join(STAGE, 'INSTALL.txt'), writeInstall(), 'utf8');
  fs.writeFileSync(path.join(STAGE, 'MANIFEST.txt'), writeManifest(meta), 'utf8');
  fs.writeFileSync(path.join(STAGE, 'SHA256.txt'), writeSha256(meta), 'utf8');

  execFileSync('zip', ['-X', '-r', ZIP_PATH, PKG_NAME], { cwd: DIST });
  const zipSha256 = sha256File(ZIP_PATH);

  const companion = 'بصمة SHA-256 لأرشيف الحزمة ' + path.basename(ZIP_PATH) + ':\n' +
    '  ' + zipSha256 + '  ' + path.basename(ZIP_PATH) + '\n' +
    'الكوميت المصدر: ' + meta.commit + '\nتاريخ البناء: ' + meta.date + '\n';
  fs.writeFileSync(path.join(DIST, PKG_NAME + '.SHA256.txt'), companion, 'utf8');

  console.log('تم بناء الحزمة: ' + ZIP_PATH);
  console.log('SHA-256 للحزمة: ' + zipSha256);
  console.log('الكوميت المصدر: ' + meta.commit);

  return { zipPath: ZIP_PATH, stage: STAGE, commit: meta.commit, date: meta.date, zipSha256: zipSha256 };
}

if (require.main === module) {
  build();
}

module.exports = { build, ROOT, DIST, STAGE, ZIP_PATH, PKG_NAME, ALL_FILES, ALL_GS, REPLACED_FILES, NEW_FILES };
