import { assertProductionEmailConfigured, emailReadiness } from './email.config';
import { createEmailService } from '../modules/auth/email/email.module';
import { DevEmailService } from '../modules/auth/email/dev-email.service';

const complete: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  EMAIL_PROVIDER: 'SMTP',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'mailer@example.test',
  SMTP_PASSWORD: 'synthetic-secret-not-for-delivery',
  SMTP_FROM_EMAIL: 'mailer@example.test',
  SMTP_FROM_NAME: 'Test Platform',
  PUBLIC_WEB_URL: 'https://example.test',
  EMAIL_DELIVERY_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'),
};

describe('production email startup configuration', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  test.each(['', 'DEV', 'wrong'])('rejects provider %s in production', (provider) => {
    expect(() => assertProductionEmailConfigured({ ...complete, EMAIL_PROVIDER: provider })).toThrow(/EMAIL_PROVIDER/);
  });

  test.each(['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL', 'SMTP_FROM_NAME', 'PUBLIC_WEB_URL', 'EMAIL_DELIVERY_ENCRYPTION_KEY'] as const)(
    'rejects missing %s without exposing values', (variable) => {
      const env = { ...complete };
      delete env[variable];
      expect(() => assertProductionEmailConfigured(env)).toThrow(variable);
      try { assertProductionEmailConfigured(env); } catch (error) {
        expect(String(error)).not.toContain(complete.SMTP_PASSWORD);
      }
    },
  );

  test.each(['0', '65536', 'not-a-port', '1.5'])('rejects invalid SMTP_PORT %s', (port) => {
    expect(() => assertProductionEmailConfigured({ ...complete, SMTP_PORT: port })).toThrow(/SMTP_PORT/);
  });

  test.each(['', 'yes', 'TRUE'])('rejects non-boolean SMTP_SECURE %s', (secure) => {
    expect(() => assertProductionEmailConfigured({ ...complete, SMTP_SECURE: secure })).toThrow(/SMTP_SECURE/);
  });

  test('rejects invalid sender address and non-HTTPS public link', () => {
    expect(() => assertProductionEmailConfigured({ ...complete, SMTP_FROM_EMAIL: 'not-an-email' })).toThrow(/SMTP_FROM_EMAIL/);
    expect(() => assertProductionEmailConfigured({ ...complete, PUBLIC_WEB_URL: 'http://example.test' })).toThrow(/PUBLIC_WEB_URL/);
  });

  test('accepts complete configuration without sending mail', () => {
    expect(() => assertProductionEmailConfigured(complete)).not.toThrow();
    expect(emailReadiness(complete)).toBe('ok');
  });

  test.each(['not-base64', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), Buffer.alloc(32).toString('base64').replace(/=$/, '')])('rejects malformed or non-32-byte mail encryption key', (key) => {
    expect(() => assertProductionEmailConfigured({ ...complete, EMAIL_DELIVERY_ENCRYPTION_KEY: key })).toThrow('EMAIL_DELIVERY_ENCRYPTION_KEY');
  });

  test.each(['AUTH_RATE_LIMIT_HMAC_KEY', 'AUTH_CREDENTIAL_LOOKUP_HMAC_KEY', 'AUTH_RESET_TOKEN_HMAC_KEY'])('rejects mail key reuse with %s', name => {
    expect(() => assertProductionEmailConfigured({ ...complete, [name]: complete.EMAIL_DELIVERY_ENCRYPTION_KEY })).toThrow('EMAIL_DELIVERY_ENCRYPTION_KEY');
  });

  test.each(['development', 'test'])('allows DevEmailService in %s without SMTP', (mode) => {
    process.env = { NODE_ENV: mode, EMAIL_PROVIDER: 'DEV' };
    expect(() => assertProductionEmailConfigured(process.env)).not.toThrow();
    expect(createEmailService()).toBeInstanceOf(DevEmailService);
    expect(emailReadiness(process.env)).toBe('development-only');
  });

  test('module factory rejects production fallback before constructing DevEmailService', () => {
    process.env = { NODE_ENV: 'production', EMAIL_PROVIDER: 'DEV' };
    expect(() => createEmailService()).toThrow(/EMAIL_PROVIDER/);
  });
});
