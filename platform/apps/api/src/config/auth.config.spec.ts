import { assertProductionSecretsConfigured } from './auth.config';

const VARS = ['AUTH_RATE_LIMIT_HMAC_KEY', 'AUTH_CREDENTIAL_LOOKUP_HMAC_KEY', 'AUTH_RESET_TOKEN_HMAC_KEY'] as const;

// ثلاثة أسرار صالحة، مختلفة تمامًا عن بعضها، كل واحد ≥ 32 بايت UTF-8.
const VALID_SECRET_A = 'a-real-random-production-secret-AAAA';
const VALID_SECRET_B = 'a-real-random-production-secret-BBBB';
const VALID_SECRET_C = 'a-real-random-production-secret-CCCC';

/**
 * NODE-1.2 — يرفض بدء التشغيل بوضوح إذا NODE_ENV=production وأي من
 * مفاتيح HMAC الأمنية الثلاثة: مفقود/فارغ/whitespace فقط/قيمة افتراضية
 * للتطوير/أقصر من 32 بايت/مكرَّر بين أكثر من غرض. القراءة مباشرة من
 * process.env في كل استدعاء — لا حاجة لإعادة استيراد الموديول بين الاختبارات.
 */
describe('assertProductionSecretsConfigured', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalValues: Record<string, string | undefined> = {};
  for (const v of VARS) originalValues[v] = process.env[v];

  function setAll(a: string | undefined, b: string | undefined, c: string | undefined) {
    if (a === undefined) delete process.env.AUTH_RATE_LIMIT_HMAC_KEY;
    else process.env.AUTH_RATE_LIMIT_HMAC_KEY = a;
    if (b === undefined) delete process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY;
    else process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY = b;
    if (c === undefined) delete process.env.AUTH_RESET_TOKEN_HMAC_KEY;
    else process.env.AUTH_RESET_TOKEN_HMAC_KEY = c;
  }

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    for (const v of VARS) {
      if (originalValues[v] === undefined) delete process.env[v];
      else process.env[v] = originalValues[v];
    }
  });

  it('لا يرمي في development حتى لو كانت المفاتيح مفقودة/افتراضية', () => {
    process.env.NODE_ENV = 'development';
    setAll(undefined, undefined, undefined);
    expect(() => assertProductionSecretsConfigured()).not.toThrow();
  });

  it('مفتاح مفقود (undefined) في production يُرفض باسم المتغير', () => {
    process.env.NODE_ENV = 'production';
    setAll(undefined, VALID_SECRET_B, VALID_SECRET_C);
    expect(() => assertProductionSecretsConfigured()).toThrow(/AUTH_RATE_LIMIT_HMAC_KEY/);
  });

  it('مفتاح فارغ ("") في production يُرفض', () => {
    process.env.NODE_ENV = 'production';
    setAll(VALID_SECRET_A, '', VALID_SECRET_C);
    expect(() => assertProductionSecretsConfigured()).toThrow(/AUTH_CREDENTIAL_LOOKUP_HMAC_KEY/);
  });

  it('مفتاح يحوي مسافات فقط (whitespace-only) في production يُرفض', () => {
    process.env.NODE_ENV = 'production';
    setAll(VALID_SECRET_A, VALID_SECRET_B, '    \t  ');
    expect(() => assertProductionSecretsConfigured()).toThrow(/AUTH_RESET_TOKEN_HMAC_KEY/);
  });

  it('القيمة الافتراضية للتطوير في production تُرفض', () => {
    process.env.NODE_ENV = 'production';
    setAll(undefined, VALID_SECRET_B, VALID_SECRET_C); // undefined يقع افتراضيًا هنا؛ نتحقق أيضًا من dev-default الصريح
    process.env.AUTH_RATE_LIMIT_HMAC_KEY = 'dev-only-rate-limit-hmac-key-change-me';
    expect(() => assertProductionSecretsConfigured()).toThrow(/AUTH_RATE_LIMIT_HMAC_KEY/);
  });

  it('مفتاح أقصر من 32 بايت UTF-8 في production يُرفض', () => {
    process.env.NODE_ENV = 'production';
    setAll(VALID_SECRET_A, 'short-secret-16b', VALID_SECRET_C); // أقل من 32 بايت
    expect(() => assertProductionSecretsConfigured()).toThrow(/AUTH_CREDENTIAL_LOOKUP_HMAC_KEY/);
  });

  it('ثلاثة أسرار صالحة ومختلفة تمامًا (≥32 بايت لكل واحد) لا تُرمى في production', () => {
    process.env.NODE_ENV = 'production';
    setAll(VALID_SECRET_A, VALID_SECRET_B, VALID_SECRET_C);
    expect(() => assertProductionSecretsConfigured()).not.toThrow();
  });

  it('تكرار نفس السرّ بين أي غرضين (حتى لو كان صالحًا لحاله) يُرفض — ويذكر كلا المتغيرين', () => {
    process.env.NODE_ENV = 'production';
    setAll(VALID_SECRET_A, VALID_SECRET_A, VALID_SECRET_C);
    expect(() => assertProductionSecretsConfigured()).toThrow(/AUTH_RATE_LIMIT_HMAC_KEY/);
    expect(() => assertProductionSecretsConfigured()).toThrow(/AUTH_CREDENTIAL_LOOKUP_HMAC_KEY/);
  });

  it('رسالة الخطأ لا تطبع قيمة أي سرّ إطلاقًا — أسماء المتغيرات فقط', () => {
    process.env.NODE_ENV = 'production';
    const secretValue = 'this-exact-secret-value-should-never-leak-anywhere';
    setAll(secretValue, VALID_SECRET_B, 'short'); // "short" غير صالح فيضمن رمي الخطأ
    try {
      assertProductionSecretsConfigured();
      fail('كان يجب أن يرمي');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(secretValue);
      expect(message).not.toContain('short');
      expect(message).toContain('AUTH_RESET_TOKEN_HMAC_KEY');
    }
  });
});
