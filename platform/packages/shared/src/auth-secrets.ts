/**
 * قيم افتراضية للتطوير فقط لمفاتيح HMAC الحساسة في طبقة المصادقة —
 * تُستخدم كـfallback عندما لا يُضبَط متغير البيئة المقابل، وأيضًا
 * كمرجع يقارَن به عند بدء تشغيل Production (راجع
 * assertProductionSecretsConfigured في apps/api/src/config/auth.config.ts)
 * لرفض الإقلاع إن بقيت هذه القيم الافتراضية مُستخدَمة في بيئة حقيقية.
 * ثلاثة مفاتيح منفصلة تمامًا — لا يُعاد استخدام أيٍّ منها للآخر:
 * rate-limit subject hashing، credential lookup (رمز المندوب)،
 * password-reset token hashing.
 */
export const AUTH_RATE_LIMIT_HMAC_KEY_DEV_DEFAULT = 'dev-only-rate-limit-hmac-key-change-me';
export const AUTH_CREDENTIAL_LOOKUP_HMAC_KEY_DEV_DEFAULT = 'dev-only-credential-lookup-hmac-key-change-me';
export const AUTH_RESET_TOKEN_HMAC_KEY_DEV_DEFAULT = 'dev-only-reset-token-hmac-key-change-me';
