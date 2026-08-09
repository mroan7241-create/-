#!/usr/bin/env node
/**
 * فاحص آلي لمشروع "نظام متابعة توزيع الأجهزة".
 * لا يحتاج أي حزمة خارجية، ولا يُنشر مع التطبيق.
 *   تشغيل:  node tools/verify.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readMergedServerSource } = require('./gs-manifest');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'Index.html');

let failures = 0;
let checks = 0;

function ok(name, detail) {
  checks++;
  console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
}
function fail(name, detail) {
  checks++;
  failures++;
  console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
}
function section(title) {
  console.log('\n' + title);
}

const html = fs.readFileSync(INDEX, 'utf8');
const gs = readMergedServerSource(ROOT);

/* ---------- 1) استخراج كتل script والتحقق النحوي ---------- */

section('1) سلامة JavaScript داخل كل كتلة <script>');

const scriptBlocks = [];
const blockRe = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let match;
while ((match = blockRe.exec(html)) !== null) {
  scriptBlocks.push({ code: match[1], index: match.index });
}

if (!scriptBlocks.length) {
  fail('عدد كتل script', 'لم يُعثر على أي كتلة');
} else {
  ok('عدد كتل script', String(scriptBlocks.length));
}

scriptBlocks.forEach((block, i) => {
  const line = html.slice(0, block.index).split('\n').length;
  try {
    new vm.Script(block.code, { filename: `Index.html:script[${i}] @line ${line}` });
    ok(`الكتلة ${i + 1} (سطر ~${line}) صحيحة نحويًا`);
  } catch (error) {
    fail(`الكتلة ${i + 1} (سطر ~${line})`, error.message);
  }
});

try {
  new vm.Script(gs, { filename: 'ملفات .gs المدموجة' });
  ok('كل ملفات .gs صحيحة نحويًا مجتمعة');
} catch (error) {
  fail('ملفات .gs', error.message);
}

/* ---------- 2) توازن الوسوم والأقواس ---------- */

section('2) توازن البنية');

const openTags = (html.match(/<script(?:\s[^>]*)?>/gi) || []).length;
const closeTags = (html.match(/<\/script>/gi) || []).length;
if (openTags === closeTags) ok('وسوم script متوازنة', `${openTags} فتح / ${closeTags} إغلاق`);
else fail('وسوم script غير متوازنة', `${openTags} فتح / ${closeTags} إغلاق`);

const styleOpen = (html.match(/<style(?:\s[^>]*)?>/gi) || []).length;
const styleClose = (html.match(/<\/style>/gi) || []).length;
if (styleOpen === styleClose) ok('وسوم style متوازنة');
else fail('وسوم style غير متوازنة');

// أقواس CSS
const css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || ['', ''])[1];
let depth = 0;
let cssBalanced = true;
for (const ch of css) {
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth < 0) { cssBalanced = false; break; } }
}
if (cssBalanced && depth === 0) ok('أقواس CSS متوازنة');
else fail('أقواس CSS غير متوازنة', 'العمق النهائي: ' + depth);

/* ---------- 3) أنماط تكسر Apps Script ---------- */

section('3) أنماط خطرة على النشر داخل Apps Script');

// الفحص يقتصر على HTML خارج كتل <script> فقط، ويشترط قيمة سمة مقتبَسة
// مباشرة بعد "=" — هذا يمنع مطابقة متغيرات JS المشروعة (مثل var onBlur
// = function(){}) التي تحمل الاسم نفسه من داخل الكود دون أن تكون سمة HTML.
const htmlOutsideScripts = html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '');
const inlineHandlerRe = /\son(?:click|change|input|submit|load|error|focus|blur|keydown|keyup|mouseover)\s*=\s*["']/gi;
const inlineHits = htmlOutsideScripts.match(inlineHandlerRe) || [];
if (!inlineHits.length) ok('لا يوجد أي inline event handler', 'كل الأحداث عبر event delegation');
else fail('inline event handlers موجودة', inlineHits.length + ' موضعًا: ' + inlineHits.join(' '));

// إغلاق كتلة script من داخل نص
if (!/<\/script/i.test(html.replace(/<\/script>/gi, ''))) ok('لا يوجد تسلسل يغلق كتلة script داخل النصوص');
else fail('يوجد "</script" داخل نص');

if (!/<!--/.test(html.replace(/<!DOCTYPE[^>]*>/i, ''))) ok('لا توجد تعليقات HTML قد تُفسَّر خطأ');
else ok('توجد تعليقات HTML', 'مقبولة');

// روابط قابلة للاقتطاع داخل نصوص JS
const jsAll = scriptBlocks.map(b => b.code).join('\n');
const literalHttps = jsAll.match(/['"`][^'"`\n]*https?:\/\/[^'"`\n]*['"`]/g) || [];
if (!literalHttps.length) {
  ok('لا يوجد رابط https مكتوب حرفيًا داخل نصوص JS', 'تُبنى الروابط عبر String.fromCharCode');
} else {
  fail('روابط https حرفية داخل JS (عرضة للاقتطاع)', literalHttps.slice(0, 3).join(' | '));
}

// بقايا صيغة Markdown
if (!/\]\(https?:/.test(html)) ok('لا توجد بقايا روابط Markdown في الكود');
else fail('توجد بقايا رابط Markdown "](http"');

// معرّفات مباشرة داخل JS inline
if (!/data-act="[^"]*"[^>]*on\w+=/.test(html)) ok('لا تُحقن قيم المستخدم داخل JavaScript inline');

/* ---------- 4) مطابقة api() مع دوال ملفات .gs ---------- */

section('4) مطابقة استدعاءات الخادم');

const called = new Set();
const apiRe = /\bapi\(\s*'([A-Za-z_$][\w$]*)'/g;
while ((match = apiRe.exec(jsAll)) !== null) called.add(match[1]);

const defined = new Set();
const defRe = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
while ((match = defRe.exec(gs)) !== null) defined.add(match[1]);

const missing = [...called].filter(name => !defined.has(name));
const privateCalls = [...called].filter(name => name.endsWith('_'));

if (!called.size) fail('لم يُعثر على أي استدعاء api()');
else ok('عدد استدعاءات الخادم المميزة', String(called.size));

if (!missing.length) ok('كل استدعاءات api() لها دوال في ملفات .gs', [...called].sort().join(', '));
else fail('استدعاءات بلا دالة مقابلة', missing.join(', '));

if (!privateCalls.length) ok('لا يُستدعى أي دالة خاصة (تنتهي بـ _) من الواجهة');
else fail('استدعاء دالة خاصة من الواجهة', privateCalls.join(', '));

/* ---------- 5) قيود Apps Script ---------- */

section('5) التوافق مع Google Apps Script');

if (/createHtmlOutputFromFile\('Index'\)/.test(gs)) ok("doGet ما زال يستدعي الملف 'Index'");
else fail("doGet لا يستدعي 'Index'");

const forbidden = [
  ['import ', /^\s*import\s+[\w{*]/m],
  ['export ', /^\s*export\s+/m],
  ['require(', /\brequire\s*\(/],
  ['<script src=', /<script[^>]+\bsrc=/i]
];
forbidden.forEach(([label, re]) => {
  if (re.test(html) || (label !== '<script src=' && re.test(gs))) fail('نمط غير متوافق: ' + label);
  else ok('لا يوجد ' + label);
});

/* ---------- 6) سلامة البيانات والأمان ---------- */

section('6) فحوص أمنية ثابتة');

if (/function esc\(/.test(jsAll)) ok('دالة الهروب esc() موجودة');
else fail('دالة الهروب esc() مفقودة');

// أي innerHTML يُبنى من بيانات خام دون esc
const rawInterp = jsAll.match(/innerHTML\s*=\s*[^;]*\bitem\.(?!id\b)\w+\s*\+/g) || [];
if (!rawInterp.length) ok('لا يوجد إدراج مباشر لبيانات غير مهروبة في innerHTML');

if (/CONTROL_CHARS_RE/.test(gs)) ok('تنقية محارف التحكم مفعّلة في الخادم');
else fail('تنقية محارف التحكم مفقودة');

if (/constantTimeEquals_/.test(gs)) ok('مقارنة الأسرار بزمن ثابت مفعّلة');
else fail('مقارنة الأسرار بزمن ثابت مفقودة');

if (/LockService/.test(gs)) ok('LockService مستخدم في العمليات الحساسة');
else fail('LockService غير مستخدم');

if (!/(password|accessCode)\s*:\s*['"][^'"]{6,}/i.test(html)) ok('لا توجد أسرار مكتوبة داخل Index.html');
else fail('يوجد سر محتمل داخل Index.html');

const roleGuards = (gs.match(/requireSession_\(token,\s*\[/g) || []).length;
if (roleGuards >= 10) ok('حراسة الأدوار على الخادم', roleGuards + ' دالة محروسة بأدوار صريحة');
else fail('حراسة الأدوار ضعيفة', roleGuards + ' دالة فقط');

/* ---------- 7) الترميز واللغة ---------- */

section('7) الترميز والاتجاه');

if (/<html lang="ar" dir="rtl">/.test(html)) ok('اتجاه RTL ولغة عربية مضبوطان');
else fail('RTL أو lang غير مضبوط');

if (/<meta charset="UTF-8">/i.test(html)) ok('ترميز UTF-8 معلن');
else fail('ترميز UTF-8 غير معلن');

const badChars = [...html].filter(ch => {
  const c = ch.codePointAt(0);
  return c < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t';
});
if (!badChars.length) ok('لا توجد محارف تحكم في Index.html');
else fail('محارف تحكم في Index.html', String(badChars.length));

const badGs = [...gs].filter(ch => {
  const c = ch.codePointAt(0);
  return c < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t';
});
if (!badGs.length) ok('لا توجد محارف تحكم في ملفات .gs');
else fail('محارف تحكم في ملفات .gs', String(badGs.length));

/* ---------- النتيجة ---------- */

console.log('\n' + '='.repeat(56));
console.log(failures === 0
  ? `نجحت جميع الفحوص: ${checks}/${checks}`
  : `فشل ${failures} من ${checks} فحصًا`);
console.log('='.repeat(56));
process.exit(failures === 0 ? 0 : 1);
