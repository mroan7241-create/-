#!/usr/bin/env node
/**
 * اختبار وحدة قواعد انتقال حالة مراجعة المستفيد وقرار/تنفيذ الاحتياج
 * (StateRules.gs، القسم المضاف لدورة الاعتماد). دوال نقية بلا اعتماد
 * على أوراق بيانات — تُحمَّل داخل vm فارغ يكفي لتفسير الملف المدمج.
 *   تشغيل:  node tools/needs-state-test.js
 */
'use strict';
const path = require('path');
const vm = require('vm');
const { readMergedServerSource } = require('./gs-manifest');

const source = readMergedServerSource(path.join(__dirname, '..'));
const sandbox = {
  console, Object, Array, String, Number, Boolean, JSON, Error, Date, Math,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  Utilities: { getUuid: () => 'uuid', sleep() {} },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'gs-merged(needs-state)' });
const S = sandbox;

let failures = 0;
const assert = (name, cond, detail) => {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const throws = (name, fn, fragment) => {
  try {
    fn();
    failures++;
    console.log('  ✗ ' + name + ' — لم تُرمَ أي استثناء');
  } catch (e) {
    if (!fragment || e.message.includes(fragment)) console.log('  ✓ ' + name);
    else { failures++; console.log('  ✗ ' + name + ' — رسالة غير متوقعة: ' + e.message); }
  }
};

console.log('\n1) حالة مراجعة المستفيد');
assert('تحت المراجعة → معتمد مسموح', S.assertBeneficiaryReviewTransition_('تحت المراجعة', 'معتمد'));
assert('تحت المراجعة → مرفوض مسموح', S.assertBeneficiaryReviewTransition_('تحت المراجعة', 'مرفوض'));
throws('معتمد → مرفوض ممنوع (حالة نهائية)', () => S.assertBeneficiaryReviewTransition_('معتمد', 'مرفوض'), 'غير مسموح');
throws('مرفوض → معتمد ممنوع (حالة نهائية)', () => S.assertBeneficiaryReviewTransition_('مرفوض', 'معتمد'), 'غير مسموح');
throws('حالة غير معروفة تُرفض', () => S.assertBeneficiaryReviewTransition_('تحت المراجعة', 'شيء غريب'), 'غير معروفة');

console.log('\n2) حالة قرار الاحتياج الواحد');
assert('بانتظار المراجعة → معتمد مسموح', S.assertNeedDecisionTransition_('بانتظار المراجعة', 'معتمد'));
assert('بانتظار المراجعة → مرفوض مسموح', S.assertNeedDecisionTransition_('بانتظار المراجعة', 'مرفوض'));
throws('معتمد → بانتظار المراجعة ممنوع (لا رجوع)', () => S.assertNeedDecisionTransition_('معتمد', 'بانتظار المراجعة'), 'غير مسموح');
throws('مرفوض → معتمد ممنوع (لا رجوع)', () => S.assertNeedDecisionTransition_('مرفوض', 'معتمد'), 'غير مسموح');

console.log('\n3) حالة تنفيذ الاحتياج المعتمد');
assert('استحقاق معتمد → بانتظار توفر الجهاز', S.assertNeedFulfillmentTransition_('استحقاق معتمد', 'بانتظار توفر الجهاز'));
assert('بانتظار توفر الجهاز → جهاز جاهز', S.assertNeedFulfillmentTransition_('بانتظار توفر الجهاز', 'جهاز جاهز'));
assert('جهاز جاهز → بانتظار تعيين مندوب', S.assertNeedFulfillmentTransition_('جهاز جاهز', 'بانتظار تعيين مندوب'));
assert('بانتظار تعيين مندوب → معيّن للمندوب — بانتظار التنفيذ', S.assertNeedFulfillmentTransition_('بانتظار تعيين مندوب', 'معيّن للمندوب — بانتظار التنفيذ'));
assert('معيّن للمندوب — بانتظار التنفيذ → خرج مع المندوب', S.assertNeedFulfillmentTransition_('معيّن للمندوب — بانتظار التنفيذ', 'خرج مع المندوب'));
assert('خرج مع المندوب → تم التسليم', S.assertNeedFulfillmentTransition_('خرج مع المندوب', 'تم التسليم'));
assert('خرج مع المندوب → مؤجل', S.assertNeedFulfillmentTransition_('خرج مع المندوب', 'مؤجل'));
assert('مؤجل → خرج مع المندوب (في الموعد الجديد)', S.assertNeedFulfillmentTransition_('مؤجل', 'خرج مع المندوب'));
assert('خرج مع المندوب → بانتظار تأكيد الإرجاع', S.assertNeedFulfillmentTransition_('خرج مع المندوب', 'بانتظار تأكيد الإرجاع'));
assert('بانتظار تأكيد الإرجاع → أعيد للجمعية/المستودع (بعد موافقتها)', S.assertNeedFulfillmentTransition_('بانتظار تأكيد الإرجاع', 'أعيد للجمعية/المستودع'));
throws('استحقاق معتمد → خرج مع المندوب مباشرة ممنوع (يجب المرور بالمراحل الوسيطة)', () => S.assertNeedFulfillmentTransition_('استحقاق معتمد', 'خرج مع المندوب'), 'غير مسموح');
throws('تم التسليم → أي حالة أخرى ممنوع (نهائية)', () => S.assertNeedFulfillmentTransition_('تم التسليم', 'استحقاق معتمد'), 'غير مسموح');
throws('بانتظار تأكيد الإرجاع → خرج مع المندوب مباشرة ممنوع (لا يُغلق الإرجاع إلا بتأكيد الجمعية)', () => S.assertNeedFulfillmentTransition_('بانتظار تأكيد الإرجاع', 'خرج مع المندوب'), 'غير مسموح');

console.log(failures === 0 ? '\n=== ALL PASS ===' : '\n=== ' + failures + ' FAILURE(S) ===');
process.exit(failures === 0 ? 0 : 1);
