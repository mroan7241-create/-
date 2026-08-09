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

/** الحد الأدنى لطول أي مفتاح HMAC أمني في Production — 32 بايت UTF-8 (256 بت من العشوائية على الأقل). */
const MIN_PRODUCTION_SECRET_BYTES = 32;

interface ProductionSecretSpec {
  envVar: string;
  devDefault: string;
}

const PRODUCTION_SECRET_SPECS: ProductionSecretSpec[] = [
  { envVar: 'AUTH_RATE_LIMIT_HMAC_KEY', devDefault: AUTH_RATE_LIMIT_HMAC_KEY_DEV_DEFAULT },
  { envVar: 'AUTH_CREDENTIAL_LOOKUP_HMAC_KEY', devDefault: AUTH_CREDENTIAL_LOOKUP_HMAC_KEY_DEV_DEFAULT },
  { envVar: 'AUTH_RESET_TOKEN_HMAC_KEY', devDefault: AUTH_RESET_TOKEN_HMAC_KEY_DEV_DEFAULT },
];

/**
 * يرفض بدء تشغيل الخادم بوضوح إذا كان NODE_ENV=production ولم تُضبَط
 * مفاتيح HMAC الأمنية الثلاثة (AUTH_RATE_LIMIT_HMAC_KEY،
 * AUTH_CREDENTIAL_LOOKUP_HMAC_KEY، AUTH_RESET_TOKEN_HMAC_KEY) بقيم
 * حقيقية صالحة — بدل السماح بتشغيل Production بمفاتيح ضعيفة أو
 * معروفة عامةً (موجودة في الكود المصدري نفسه على GitHub) بصمت. تُقرأ
 * متغيرات البيئة الخام مباشرة هنا (لا `authConfig.*HmacKey` الذي يستبدل
 * القيمة الفارغة/غير المضبوطة بالافتراضي التطويري ضمنيًا عبر `??`، وهو
 * ما كان يُخفي حالات فارغة/whitespace-only عن الفحص السابق). يُستدعى
 * مرة واحدة في apps/api/src/main.ts قبل NestFactory.create.
 *
 * الشروط الأربعة لكل متغير:
 * 1) موجود وغير فارغ بعد trim (لا مفقود، لا فارغ، لا whitespace فقط).
 * 2) ليس القيمة الافتراضية المخصَّصة للتطوير.
 * 3) طوله (UTF-8 بايت، بعد trim) ≥ 32 بايت.
 * 4) مختلف عن قيمتَي المتغيرين الآخرين (لا مفتاح واحد يُعاد استخدامه لأكثر من غرض).
 *
 * رسالة الخطأ تذكر **أسماء** المتغيرات غير الصالحة فقط — لا تطبع أي
 * قيمة سرّية أبدًا، حتى في حالة الفشل.
 */
export function assertProductionSecretsConfigured(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const invalidVars = new Set<string>();
  const validTrimmedByVar = new Map<string, string>();

  for (const spec of PRODUCTION_SECRET_SPECS) {
    const trimmed = (process.env[spec.envVar] ?? '').trim();
    if (!trimmed) {
      invalidVars.add(spec.envVar); // مفقود، فارغ، أو whitespace فقط
      continue;
    }
    if (trimmed === spec.devDefault) {
      invalidVars.add(spec.envVar);
      continue;
    }
    if (Buffer.byteLength(trimmed, 'utf8') < MIN_PRODUCTION_SECRET_BYTES) {
      invalidVars.add(spec.envVar);
      continue;
    }
    validTrimmedByVar.set(spec.envVar, trimmed);
  }

  // فحص التكرار: فقط بين المتغيرات التي اجتازت الشروط 1-3 أعلاه بالفعل.
  const validEntries = [...validTrimmedByVar.entries()];
  for (let i = 0; i < validEntries.length; i++) {
    for (let j = i + 1; j < validEntries.length; j++) {
      if (validEntries[i][1] === validEntries[j][1]) {
        invalidVars.add(validEntries[i][0]);
        invalidVars.add(validEntries[j][0]);
      }
    }
  }

  if (invalidVars.size > 0) {
    const orderedNames = PRODUCTION_SECRET_SPECS.map((s) => s.envVar).filter((name) => invalidVars.has(name));
    throw new Error(
      `رفض بدء التشغيل: NODE_ENV=production لكن متغيرات البيئة الحساسة التالية غير صالحة ` +
        `(مفقودة/فارغة/whitespace فقط/قيمة افتراضية للتطوير/أقصر من ٣٢ بايت/مكررة بين أكثر من غرض): ` +
        `${orderedNames.join(', ')}. اضبط قيمًا عشوائية حقيقية مختلفة تمامًا لكل متغير (32 بايت على الأقل) ` +
        `عبر متغيرات بيئة خارج GitHub تمامًا قبل التشغيل.`,
    );
  }
}
