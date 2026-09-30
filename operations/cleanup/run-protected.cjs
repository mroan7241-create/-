/* One-time GitHub Actions runner. No database URL or object key enters logs. */
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { assertTarget } = require('./cleanup-trial-data.cjs');

function requiredConfig(raw) {
  let config;
  try { config = JSON.parse(raw); }
  catch { throw new Error('SAFETY STOP: backup configuration is unavailable.'); }
  if (typeof config.DATABASE_URL !== 'string' ||
      typeof config.EXPECTED_DB_NAME !== 'string' ||
      typeof config.EXPECTED_DB_HOST !== 'string') {
    throw new Error('SAFETY STOP: backup database configuration is incomplete.');
  }
  const url = new URL(config.DATABASE_URL);
  if (url.hostname !== config.EXPECTED_DB_HOST ||
      decodeURIComponent(url.pathname.slice(1)) !== config.EXPECTED_DB_NAME) {
    throw new Error('SAFETY STOP: backup database identity does not match its guard.');
  }
  return config;
}

function runCleanup(args, env) {
  const result = spawnSync(process.execPath,
    [join(__dirname, 'cleanup-trial-data.cjs'), ...args],
    { env, encoding: 'utf8', timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) {
    // Prisma/driver errors may contain connection details: never echo stderr.
    throw new Error('SAFETY STOP: cleanup command failed; see guarded source and database state.');
  }
  try { return JSON.parse(result.stdout.trim()); }
  catch { throw new Error('SAFETY STOP: cleanup result was not valid JSON.'); }
}

function main() {
  const mode = process.argv[2];
  if (!['preview', 'apply'].includes(mode)) throw new Error('Mode must be preview or apply.');
  const config = requiredConfig(process.env.ALZAD_BACKUP_CONFIG);
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: config.DATABASE_URL,
    ALZAD_CLEANUP_EXPECTED_PROJECT_REF: 'ojaqtsjpcjjhnmavjuue',
    ALZAD_CLEANUP_EXPECTED_DB_NAME: config.EXPECTED_DB_NAME,
  };
  delete env.ALZAD_BACKUP_CONFIG;
  assertTarget(env);
  if (mode === 'apply') {
    if (!/^[a-f0-9]{64}$/.test(process.env.ALZAD_CLEANUP_APPROVED_SHA256 ?? '') ||
        process.env.ALZAD_CLEANUP_PRODUCTION_CONFIRM !== 'CLEAN_ALZAD_PRODUCTION_TRIAL_DATA') {
      throw new Error('SAFETY STOP: exact preview approval and production confirmation required.');
    }
  }
  const directory = mkdtempSync(join(tmpdir(), 'alzad-launch-cleanup-'));
  try {
    const manifest = join(directory, 'preview.json');
    const preview = runCleanup(['--dry-run', `--manifest=${manifest}`], env);
    if (preview.mode !== 'dry-run' || !/^[a-f0-9]{64}$/.test(preview.sha256)) {
      throw new Error('SAFETY STOP: invalid preview.');
    }
    if (mode === 'preview') {
      process.stdout.write(JSON.stringify(preview) + '\n');
      return;
    }
    if (preview.sha256 !== env.ALZAD_CLEANUP_APPROVED_SHA256) {
      throw new Error('SAFETY STOP: production rows changed since the approved preview.');
    }
    const applied = runCleanup(['--apply', `--manifest=${manifest}`], env);
    if (applied.mode !== 'applied') throw new Error('SAFETY STOP: apply result invalid.');
    process.stdout.write(JSON.stringify(applied) + '\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { requiredConfig };
