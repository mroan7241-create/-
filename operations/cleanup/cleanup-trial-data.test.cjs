const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  assertTarget, assertApplyPermission, assertSchema, deletionOrder, manifestFingerprint,
  targetPredicate, PRODUCTION_REF, PRESERVED, TARGETS,
} = require('./cleanup-trial-data.cjs');
const { requiredConfig } = require('./run-protected.cjs');

test('manual workflow never interpolates dispatch input into a shell command', () => {
  const workflow = readFileSync(join(__dirname, '../../.github/workflows/launch-trial-cleanup.yml'), 'utf8');
  assert.match(workflow, /ALZAD_CLEANUP_MODE: \$\{\{ inputs\.mode \}\}/);
  assert.doesNotMatch(workflow, /run:[^\n]*\$\{\{\s*inputs\./);
});

test('protected runner refuses a mismatched backup database identity', () => {
  const config = {
    DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
    EXPECTED_DB_NAME: 'postgres', EXPECTED_DB_HOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
  };
  assert.equal(requiredConfig(JSON.stringify(config)).EXPECTED_DB_NAME, 'postgres');
  assert.throws(() => requiredConfig(JSON.stringify({ ...config, EXPECTED_DB_NAME: 'other' })), /SAFETY STOP/);
  assert.throws(() => requiredConfig(JSON.stringify({ ...config, EXPECTED_DB_HOST: 'other' })), /SAFETY STOP/);
  assert.throws(() => requiredConfig('{'), /SAFETY STOP/);
});

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
  for (const action of ['c', 'n', 'r']) {
    assert.throws(() => deletionOrder([
      { childSchema: 'storage', child: 'foreign_objects', parent: 'accounts', action },
    ]), /external FK child storage\.foreign_objects/);
  }
});

test('ADMIN sessions and credentials are excluded from deletion targets', () => {
  for (const table of ['auth_credentials', 'auth_sessions']) {
    assert.match(targetPredicate(table), /NOT EXISTS/);
    assert.match(targetPredicate(table), /a\.id=t\.account_id AND a\.role='ADMIN'/);
  }
  assert.match(targetPredicate('accounts'), /role <> 'ADMIN'/);
  assert.equal(targetPredicate('application_answers'), '');
});

test('schema inspection reads inbound FKs from every child schema', async () => {
  const tx = { $queryRawUnsafe: async (sql) => {
    if (sql.includes('FROM pg_tables')) {
      return [...PRESERVED, ...TARGETS].map((tablename) => ({ tablename }));
    }
    assert.match(sql, /parent_ns\.nspname='public'/);
    assert.doesNotMatch(sql, /child_ns\.nspname='public'/);
    return [{ childSchema: 'storage', child: 'objects', parent: 'accounts', action: 'c' }];
  } };
  await assert.rejects(assertSchema(tx, { kind: 'production' }), /external FK child storage\.objects/);
});

test('manifest fingerprint is exact and independent of timestamp outside data', () => {
  assert.equal(manifestFingerprint({ a: 1 }), manifestFingerprint({ a: 1 }));
  assert.notEqual(manifestFingerprint({ a: 1 }), manifestFingerprint({ a: 2 }));
});
