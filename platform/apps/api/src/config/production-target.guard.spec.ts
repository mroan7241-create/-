import { assertE2eNotTargetingProduction, assertE2eSafetyCanary } from '../../test/utils/production-target.guard';

describe('destructive E2E safety gate', () => {
  const original = { ...process.env };
  const safe = {
    NODE_ENV: 'test',
    ALLOW_DESTRUCTIVE_E2E: 'true',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/alzad_platform_test?schema=public',
    E2E_ALLOWED_DATABASE_NAMES: 'alzad_platform_test,alzad_platform_ci',
    OBJECT_STORAGE_BUCKET: 'alzad-platform-test',
    E2E_ALLOWED_BUCKET_NAMES: 'alzad-platform-test',
  };

  beforeEach(() => { process.env = { ...safe }; });
  afterEach(() => { process.env = { ...original }; });

  test('rejects production even with every other flag set', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertE2eNotTargetingProduction()).toThrow(/SAFETY STOP.*NODE_ENV/);
  });

  test('rejects test mode without explicit destructive permission', () => {
    delete process.env.ALLOW_DESTRUCTIVE_E2E;
    expect(() => assertE2eNotTargetingProduction()).toThrow(/ALLOW_DESTRUCTIVE_E2E/);
  });

  test('rejects a database outside the parsed database-name allowlist', () => {
    process.env.DATABASE_URL = 'postgresql://user@localhost:5432/alzad_production?note=alzad_platform_test';
    expect(() => assertE2eNotTargetingProduction()).toThrow(/DATABASE_URL database/);
  });

  test('rejects a default database name despite an allowlist', () => {
    process.env.DATABASE_URL = 'postgresql://user@localhost:5432/postgres';
    process.env.E2E_ALLOWED_DATABASE_NAMES = 'postgres';
    expect(() => assertE2eNotTargetingProduction()).toThrow(/DATABASE_URL database/);
  });

  test('rejects a bucket outside the explicit test-bucket allowlist', () => {
    process.env.OBJECT_STORAGE_BUCKET = 'alzad-platform-prod';
    expect(() => assertE2eNotTargetingProduction()).toThrow(/OBJECT_STORAGE_BUCKET/);
  });

  test('rejects a remote object-storage endpoint in external mode', () => {
    process.env.OBJECT_STORAGE_EXTERNAL = 'true';
    process.env.OBJECT_STORAGE_ENDPOINT = 'https://storage.example.invalid';
    expect(() => assertE2eNotTargetingProduction()).toThrow(/OBJECT_STORAGE_ENDPOINT/);
  });

  test('rejects an inherited live API URL', () => {
    process.env.API_BASE_URL = 'https://floralwhite-tapir-393693.hostingersite.com/api/v1';
    expect(() => assertE2eNotTargetingProduction()).toThrow(/API_BASE_URL/);
  });

  test('rejects a mismatched DIRECT_URL database', () => {
    process.env.DIRECT_URL = 'postgresql://user@localhost:5432/alzad_platform_prod';
    expect(() => assertE2eNotTargetingProduction()).toThrow(/DIRECT_URL/);
  });

  test('rejects a missing database canary before any deletion callback', async () => {
    let deletions = 0;
    await expect(assertE2eSafetyCanary(async () => false)).rejects.toThrow(/canary/);
    expect(deletions).toBe(0);
    await assertE2eSafetyCanary(async () => true);
    deletions += 1;
    expect(deletions).toBe(1);
  });

  test('rejects an unavailable database as a missing canary', async () => {
    await expect(assertE2eSafetyCanary(async () => { throw new Error('table missing'); })).rejects.toThrow(/canary/);
  });

  test('allows only the complete positive test configuration and present canary', async () => {
    expect(() => assertE2eNotTargetingProduction()).not.toThrow();
    await expect(assertE2eSafetyCanary(async () => true)).resolves.toBeUndefined();
  });
});
