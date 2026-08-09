import { createHmac } from 'node:crypto';

/**
 * مطبِّع رمز دخول المندوب (trim + uppercase) — نقطة واحدة مشتركة بين
 * apps/api (تسجيل الدخول) وpackages/db (بذر بيانات التطوير/الاختبار)
 * لضمان أن أي تغيير مستقبلي (NODE-6: saveDelegate/regenerateDelegateCode)
 * يستخدم نفس التطبيع دون إعادة اختراعه في مكان آخر.
 */
export function normalizeDelegateCode(code: string): string {
  return String(code || '').trim().toUpperCase();
}

/**
 * يحسب مفتاح بحث حتمي (deterministic) وآمن لبيانات اعتماد لا يمكن
 * فهرستها مباشرة (رمز مندوب) — HMAC-SHA256 بمفتاح سرّي مخصَّص، وليس
 * hash عادي، حتى لا يمكن لأي طرف يملك القيمة المخزَّنة فقط (دون المفتاح)
 * توليد lookup hash صالح لقيمة أخرى أو التحقق من تخمين. القيمة المدخلة
 * يجب أن تكون مطبَّعة مسبقًا (normalizeDelegateCode) لضمان hash ثابت
 * لنفس الرمز المنطقي بصرف النظر عن حالة الأحرف/المسافات.
 */
export function computeCredentialLookupHash(normalizedValue: string, hmacKey: string): string {
  return createHmac('sha256', hmacKey).update(normalizedValue, 'utf8').digest('hex');
}
