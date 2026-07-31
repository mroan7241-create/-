#!/usr/bin/env node
/**
 * ترتيب دمج ملفات الخادم (*.gs) لأغراض الاختبار المحلي فقط.
 *
 * ملاحظة مهمة: Google Apps Script يدمج كل ملفات .gs في مشروع واحد
 * ضمن نطاق عام واحد (global namespace) بصرف النظر عن اسم الملف أو
 * ترتيبه — لا "استيراد" ولا "تصدير" بين الملفات، وكل الدوال والثوابت
 * على المستوى الأعلى تُصبح متاحة للجميع تلقائيًا. لذلك لا يوجد أي
 * اعتماد فعلي على هذا الترتيب داخل Apps Script نفسه.
 *
 * هذا الترتيب موجود فقط لأن أدوات الاختبار المحلية (verify.js/
 * smoke.js/server-test.js/perf-bench.js) تحتاج نصًا واحدًا متصلًا
 * لتحميله في vm.Script/vm.runInContext، ولإعادة بناء نفس ترتيب الأسطر
 * الذي كان عليه Code.gs الأصلي قبل التقسيم (تحقّق تطابق حرفي كامل عبر
 * diff عند التقسيم — راجع رسالة commit التقسيم للتفاصيل).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GS_FILES_ORDER = [
  'Config.gs',
  'ReferenceData.gs',
  'Auth.gs',
  'Bootstrap.gs',
  'Beneficiaries.gs',
  'ExcelTemplate.gs',
  'Delegates.gs',
  'DevicesAssociations.gs',
  'Applications.gs',
  'ExecutionTracking.gs',
  'Normalize.gs',
  'StateRules.gs',
  'Pagination.gs',
  'DataUtils.gs',
  'Validation.gs'
];

/** يقرأ كل ملفات .gs بالترتيب ويدمجها في نص واحد، ويتحقق أن لا ملف .gs في الجذر منسيّ من القائمة. */
function readMergedServerSource(rootDir) {
  rootDir = rootDir || path.join(__dirname, '..');
  const onDisk = fs.readdirSync(rootDir).filter(name => name.endsWith('.gs')).sort();
  const missing = onDisk.filter(name => GS_FILES_ORDER.indexOf(name) === -1);
  if (missing.length) {
    throw new Error('ملفات .gs غير مدرجة في GS_FILES_ORDER بأداة tools/gs-manifest.js: ' + missing.join('، '));
  }
  return GS_FILES_ORDER.map(name => fs.readFileSync(path.join(rootDir, name), 'utf8')).join('');
}

module.exports = { GS_FILES_ORDER, readMergedServerSource };
