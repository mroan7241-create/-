import {
  AUTH_CREDENTIAL_LOOKUP_HMAC_KEY_DEV_DEFAULT,
  AUTH_RATE_LIMIT_HMAC_KEY_DEV_DEFAULT,
  AUTH_RESET_TOKEN_HMAC_KEY_DEV_DEFAULT,
} from '@alzad/shared';

/**
 * إعدادات مركزية للمصادقة — قابلة للضبط عبر متغيرات بيئة، بلا أي secret
 * حقيقي هنا (قيم افتراضية آمنة للتطوير فقط). المصدر السلوكي: Auth.gs/
 * Config.gs/Validation.gs على الفرع القديم — راجع platform/docs/
 * AUTHENTICATION.md لشرح كل قيمة ومصدرها.
 */
export const authConfig = {
  /** Legacy: APP.sessionSeconds = 21600 (6h) — sliding/idle TTL. */
  sessionIdleSeconds: Number(process.env.AUTH_SESSION_IDLE_SECONDS ?? 21600),
  /** Legacy: APP.maxSessionSeconds = 43200 (12h) — سقف مطلق لا يُمدَّد. */
  sessionAbsoluteSeconds: Number(process.env.AUTH_SESSION_ABSOLUTE_SECONDS ?? 43200),

  /** Legacy: PASSWORD_RESET_TTL_SECONDS = 900 (15 دقيقة). */
  passwordResetTtlSeconds: Number(process.env.AUTH_PASSWORD_RESET_TTL_SECONDS ?? 900),
  /** Legacy: PASSWORD_RESET_MAX_ATTEMPTS = 6. */
  passwordResetMaxAttempts: Number(process.env.AUTH_PASSWORD_RESET_MAX_ATTEMPTS ?? 6),

  /** Legacy throttle_: login:user و login:delegate كلاهما 8/15m. */
  rateLimitUserLogin: { limit: 8, windowSeconds: 900 },
  rateLimitDelegateLogin: { limit: 8, windowSeconds: 900 },
  /** Legacy throttle_: pwreset-req 5/15m لكل بريد. */
  rateLimitPasswordResetRequest: { limit: 5, windowSeconds: 900 },
  /** Legacy throttle_: pwreset-verify 10/15m لكل بريد. */
  rateLimitPasswordResetVerify: { limit: 10, windowSeconds: 900 },
  /** Legacy throttle_: reset-assoc-pwd 5/15m لكل association_id. */
  rateLimitAssociationPasswordReset: { limit: 5, windowSeconds: 900 },

  /** Legacy assertPasswordPolicy_: 10 خانات على الأقل + حرف ورقم معًا. */
  passwordMinLength: 10,

  /** اسم الـcookie الثابت لجلسة المتصفح. */
  sessionCookieName: 'alzad_session',

  /**
   * مفتاح HMAC لتجزئة subject_hash في auth_rate_limits (لا يُخزَّن أي
   * معرِّف خام — بريد/رمز مندوب — في الجدول، فقط HMAC-SHA256 له). قيمة
   * تطوير افتراضية فقط؛ يجب ضبط AUTH_RATE_LIMIT_HMAC_KEY في أي بيئة
   * حقيقية عبر متغير بيئة خارج GitHub تمامًا.
   */
  rateLimitHmacKey: process.env.AUTH_RATE_LIMIT_HMAC_KEY ?? AUTH_RATE_LIMIT_HMAC_KEY_DEV_DEFAULT,

  /**
   * مفتاح HMAC لحساب lookup hash لبيانات اعتماد المندوب (identifier في
   * auth_credentials لنوع DELEGATE_ACCESS_CODE) — يتيح بحثًا O(1) بدل
   * فحص خطي على كل بيانات الاعتماد النشطة، بلا تخزين الرمز الخام أو
   * إعادة استخدام مفتاح HMAC آخر. راجع packages/shared/src/credential-lookup.ts.
   */
  credentialLookupHmacKey: process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY ?? AUTH_CREDENTIAL_LOOKUP_HMAC_KEY_DEV_DEFAULT,

  /**
   * مفتاح HMAC لتجزئة رمز إعادة تعيين كلمة المرور (password_reset_tokens.token_hash)
   * — مفتاح مستقل تمامًا عن rateLimitHmacKey وcredentialLookupHmacKey،
   * لأن الرمز نفسه أقل entropy بكثير من رمز الجلسة (8 خانات فقط).
   */
  resetTokenHmacKey: process.env.AUTH_RESET_TOKEN_HMAC_KEY ?? AUTH_RESET_TOKEN_HMAC_KEY_DEV_DEFAULT,

  /** Argon2id parameters (النوع يُضبط argon2id صراحة عند الاستدعاء — راجع common/password.util.ts). */
  argon2: {
    memoryCost: Number(process.env.AUTH_ARGON2_MEMORY_COST_KIB ?? 19456), // ~19 MiB — OWASP minimum recommendation
    timeCost: Number(process.env.AUTH_ARGON2_TIME_COST ?? 2),
    parallelism: Number(process.env.AUTH_ARGON2_PARALLELISM ?? 1),
  },
} as const;

/**
 * يرفض بدء تشغيل الخادم بوضوح إذا كان NODE_ENV=production وأي من
 * مفاتيح HMAC الأمنية الثلاثة ما زال يحمل القيمة الافتراضية المخصَّصة
 * للتطوير فقط — بدل السماح بتشغيل Production بمفاتيح معروفة عامةً
 * (موجودة في الكود المصدري نفسه على GitHub) بصمت. يُستدعى مرة واحدة في
 * apps/api/src/main.ts قبل NestFactory.create.
 */
export function assertProductionSecretsConfigured(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const insecureVars: string[] = [];
  if (authConfig.rateLimitHmacKey === AUTH_RATE_LIMIT_HMAC_KEY_DEV_DEFAULT) insecureVars.push('AUTH_RATE_LIMIT_HMAC_KEY');
  if (authConfig.credentialLookupHmacKey === AUTH_CREDENTIAL_LOOKUP_HMAC_KEY_DEV_DEFAULT) insecureVars.push('AUTH_CREDENTIAL_LOOKUP_HMAC_KEY');
  if (authConfig.resetTokenHmacKey === AUTH_RESET_TOKEN_HMAC_KEY_DEV_DEFAULT) insecureVars.push('AUTH_RESET_TOKEN_HMAC_KEY');

  if (insecureVars.length > 0) {
    throw new Error(
      `رفض بدء التشغيل: NODE_ENV=production لكن القيم الافتراضية للتطوير ما زالت مُستخدَمة لمتغيرات البيئة الحساسة التالية: ` +
        `${insecureVars.join(', ')}. اضبط قيمًا حقيقية عبر متغيرات بيئة خارج GitHub تمامًا قبل التشغيل.`,
    );
  }
}
