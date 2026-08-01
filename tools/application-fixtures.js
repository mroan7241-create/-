#!/usr/bin/env node
/**
 * حمولة صالحة كاملة لطلب انضمام جمعية — تُستخدَم في كل ملفات الاختبار
 * كي لا يتكرر بناء الحقول الـ18 الجديدة (الأسئلة الثمانية، الترخيص،
 * الإقرار، معرف العميل) في كل موضع استدعاء على حدة. clientRequestId
 * يُولَّد عشوائيًا افتراضيًا فيختلف مع كل نداء ما لم يُمرَّر صراحة —
 * ضروري لأن نفس المعرّف يُعامَل الآن كإعادة إرسال (idempotency) لا كطلب
 * جديد.
 */
'use strict';

/** صورة JPEG صالحة الحد الأدنى (FF D8 FF D9) — تجتاز فحص التوقيع الفعلي. */
const VALID_LICENSE_DATA_URL = 'data:image/jpeg;base64,/9j/2Q==';

let counter = 0;
function uniqueClientRequestId() {
  counter += 1;
  return 'test-req-' + Date.now().toString(36) + '-' + counter + '-' + Math.random().toString(36).slice(2, 8);
}

function validAnswers(overrides) {
  return Object.assign({
    'الترخيص ساري': true,
    'المشروع ضمن نطاق الجمعية': true,
    'قاعدة بيانات محدثة': true,
    'نظام إلكتروني للمستفيدين': true,
    'خبرة مشاريع مشابهة': true,
    'القدرة على الاستلام والتسليم والتوثيق': true,
    'الالتزام بالجدول والنماذج وحماية البيانات': true,
    'الالتزام بالاتفاقية وتعيين منسق': true
  }, overrides || {});
}

function applicationFixture(overrides) {
  overrides = overrides || {};
  const answers = overrides.answers ? validAnswers(overrides.answers) : validAnswers();
  const payload = Object.assign({
    name: 'جمعية تجريبية', category: 'جمعية أهلية', region: 'الرياض', city: 'الرياض',
    contactName: 'أحمد', phone: '0501234567', email: 'test@example.org',
    licenseNumber: 'LIC-1000', licenseExpiryDate: '2030-01-01', sector: 'رعاية الأيتام',
    licenseFileDataUrl: VALID_LICENSE_DATA_URL, pledgeAccepted: true,
    clientRequestId: uniqueClientRequestId()
  }, overrides);
  payload.answers = answers;
  return payload;
}

module.exports = { applicationFixture, VALID_LICENSE_DATA_URL, uniqueClientRequestId };
