/**
 * حدّ حجم جسم طلب JSON/urlencoded — الافتراضي في body-parser (100kb) غير
 * كافٍ لِBEN-013 (استيراد حتى 1000 صف مستفيد في طلب JSON واحد يمكن أن
 * يتجاوز 100kb بسهولة). يُستخدَم في main.ts (إنتاج) وtest/utils/bootstrap.ts
 * (اختبارات) معًا حتى لا ينحرف السلوكان. لا يشمل رفع الملفات (multipart) —
 * تلك محدودة بحدودها الخاصة في كل وحدة (receipts/deliveries).
 */
export const JSON_BODY_LIMIT = '5mb';
