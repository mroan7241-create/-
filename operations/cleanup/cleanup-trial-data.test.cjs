const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertTarget, assertApplyPermission, deletionOrder, manifestFingerprint,
  PRODUCTION_REF,
} = require('./cleanup-trial-data.cjs');

test('fails closed without positive test target and explicit allowlist', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/alzad_platform_ci',
    ALLOW_DESTRUCTIVE_E2E: 'true', E2E_ALLOWED_DATABASE_NAMES: 'alzad_platform_ci' };
  assert.deepEqual(assertTarget(base), { kind: 'test', name: 'alzad_platform_ci' });
  assert.throws(() => assertTarget({ ...base, NODE_ENV: 'development' }), /SAFETY STOP/);
  assert.throws(() => assertTarget({ ...base, ALLOW_DESTRUCTIVE_E2E: 'false' }), /SAFETY STOP/);
  assert.throws(() => assertTarget({ ...base, E2E_ALLOWED_DATABASE_NAMES: 'other_ci' }), /SAFETY STOP/);
  assert.throws(() => assertTarget({ ...base, DATABASE_URL: 'postgresql://u:p@db.example/production' }), /SAFETY STOP/);
});

test('production requires exact project identity, name, SHA and confirmation', () => {
  const base = { NODE_ENV: 'production',
    DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
    ALZAD_CLEANUP_EXPECTED_PROJECT_REF: PRODUCTION_REF,
    ALZAD_CLEANUP_EXPECTED_DB_NAME: 'postgres' };
  const target = assertTarget(base);
  assert.deepEqual(target, { kind: 'production', name: 'postgres' });
  assert.throws(() => assertTarget({ ...base, ALZAD_CLEANUP_EXPECTED_PROJECT_REF: 'wrong' }), /SAFETY STOP/);
  assert.throws(() => assertTarget({ ...base, DATABASE_URL: 'postgresql://postgres:secret@localhost/postgres' }), /SAFETY STOP/);
  assert.throws(() => assertApplyPermission(target, base), /SAFETY STOP/);
  assert.throws(() => assertApplyPermission(target, { ...base, ALZAD_CLEANUP_APPROVED_SHA256: 'a'.repeat(64) }), /SAFETY STOP/);
  assert.doesNotThrow(() => assertApplyPermission(target, { ...base,
    ALZAD_CLEANUP_APPROVED_SHA256: 'a'.repeat(64),
    ALZAD_CLEANUP_PRODUCTION_CONFIRM: 'CLEAN_ALZAD_PRODUCTION_TRIAL_DATA' }));
});

test('FK order is child-first and refuses protected or cyclic dependencies', () => {
  const order = deletionOrder([
    { child: 'auth_credentials', parent: 'accounts', action: 'r' },
    { child: 'accounts', parent: 'associations', action: 'n' },
    { child: 'audit_logs', parent: 'accounts', action: 'n' },
  ]);
  assert.ok(order.indexOf('auth_credentials') < order.indexOf('accounts'));
  assert.ok(order.indexOf('accounts') < order.indexOf('associations'));
  assert.throws(() => deletionOrder([{ child: 'system_settings', parent: 'accounts', action: 'r' }]), /SAFETY STOP/);
  assert.throws(() => deletionOrder([
    { child: 'accounts', parent: 'associations', action: 'r' },
    { child: 'associations', parent: 'accounts', action: 'r' },
  ]), /cycle/);
});

test('manifest fingerprint is exact and independent of timestamp outside data', () => {
  assert.equal(manifestFingerprint({ a: 1 }), manifestFingerprint({ a: 1 }));
  assert.notEqual(manifestFingerprint({ a: 1 }), manifestFingerprint({ a: 2 }));
});
