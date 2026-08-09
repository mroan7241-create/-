import { assertProductionSecretsConfigured } from './auth.config';

/**
 * NODE-1.1 §3 — يرفض بدء التشغيل بوضوح إذا NODE_ENV=production وأي
 * مفتاح HMAC أمني حسّاس ما زال بقيمته الافتراضية للتطوير.
 */
describe('assertProductionSecretsConfigured', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalKeys = {
    rateLimit: process.env.AUTH_RATE_LIMIT_HMAC_KEY,
    lookup: process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY,
    reset: process.env.AUTH_RESET_TOKEN_HMAC_KEY,
  };

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AUTH_RATE_LIMIT_HMAC_KEY = originalKeys.rateLimit;
    process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY = originalKeys.lookup;
    process.env.AUTH_RESET_TOKEN_HMAC_KEY = originalKeys.reset;
    jest.resetModules();
  });

  it('لا يرمي في development حتى لو كانت المفاتيح افتراضية', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_RATE_LIMIT_HMAC_KEY;
    delete process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY;
    delete process.env.AUTH_RESET_TOKEN_HMAC_KEY;
    expect(() => assertProductionSecretsConfigured()).not.toThrow();
  });

  it('يرمي في production إذا بقيت كل المفاتيح الافتراضية', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_RATE_LIMIT_HMAC_KEY;
    delete process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY;
    delete process.env.AUTH_RESET_TOKEN_HMAC_KEY;
    jest.resetModules();
    const { assertProductionSecretsConfigured: freshAssert } = await import('./auth.config');
    expect(() => freshAssert()).toThrow(/AUTH_RATE_LIMIT_HMAC_KEY/);
    expect(() => freshAssert()).toThrow(/AUTH_CREDENTIAL_LOOKUP_HMAC_KEY/);
    expect(() => freshAssert()).toThrow(/AUTH_RESET_TOKEN_HMAC_KEY/);
  });

  it('لا يرمي في production إذا ضُبطت كل المفاتيح بقيم حقيقية مختلفة عن الافتراضي', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_RATE_LIMIT_HMAC_KEY = 'a-real-random-production-secret-1';
    process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY = 'a-real-random-production-secret-2';
    process.env.AUTH_RESET_TOKEN_HMAC_KEY = 'a-real-random-production-secret-3';
    jest.resetModules();
    const { assertProductionSecretsConfigured: freshAssert } = await import('./auth.config');
    expect(() => freshAssert()).not.toThrow();
  });
});
