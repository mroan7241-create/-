// Disposable local DB only; never runs migrations or fixture cleanup on the source DB.
const { readFileSync, writeFileSync, mkdtempSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { randomBytes } = require('node:crypto');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const name = 'alzad_beneficiary_test_20261029';
Object.assign(process.env, parseEnv(readFileSync(process.argv[2], 'utf8')));
const source = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) throw Error('Local DB required');
const { PrismaClient } = require('../packages/db/generated/client');
const pgBin = process.env.E2E_POSTGRES_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const cluster = mkdtempSync(resolve(tmpdir(), 'alzad-onboarding-test-'));
let started = false;
const pg = (file, args) => {
  const result = spawnSync(resolve(pgBin, `${file}.exe`), args, { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw Error('Isolated PostgreSQL setup failed');
};
async function main() {
  const password = randomBytes(24).toString('hex'), passwordFile = resolve(cluster, 'password.tmp');
  writeFileSync(passwordFile, password);
  pg('initdb', ['-D', resolve(cluster, 'data'), '-U', 'alzad_test_admin', '--pwfile', passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--no-locale']);
  unlinkSync(passwordFile);
  pg('pg_ctl', ['-D', resolve(cluster, 'data'), '-l', resolve(cluster, 'postgres.log'), '-o', '-p 55439 -h 127.0.0.1', '-w', 'start']);
  started = true;
  source.hostname = '127.0.0.1'; source.port = '55439'; source.username = 'alzad_test_admin'; source.password = password; source.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: source.toString() } } });
  const found = await admin.$queryRaw`SELECT datname FROM pg_database WHERE datname=${name}`;
  if (!found.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  for (const role of ['anon', 'authenticated', 'postgres']) await admin.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
  await admin.$disconnect();
  source.pathname = `/${name}`;
  Object.assign(process.env, {
    DATABASE_URL: source.toString(), DIRECT_URL: source.toString(), NODE_ENV: 'test',
    ALLOW_DESTRUCTIVE_E2E: 'true', E2E_ALLOWED_DATABASE_NAMES: name,
    E2E_ALLOWED_BUCKET_NAMES: 'alzad-platform-test', OBJECT_STORAGE_BUCKET: 'alzad-platform-test',
    OBJECT_STORAGE_EXTERNAL: 'false', OBJECT_STORAGE_DRIVER: 's3',
    API_BASE_URL: 'http://localhost:3001/api/v1', NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001/api/v1', WEB_BASE_URL: 'http://localhost:3000',
    PUBLIC_WEB_URL: 'http://localhost:3000', EMAIL_DRIVER: 'dev',
  });
  const run = (file, args, cwd = root) => {
    const result = spawnSync(process.execPath, [file, ...args], { cwd, env: process.env, stdio: 'inherit' });
    if (result.status !== 0) throw Error('Test command failed');
  };
  run(resolve(root, 'node_modules/prisma/build/index.js'), ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], resolve(root, 'packages/db'));
  const db = new PrismaClient({ datasources: { db: { url: source.toString() } } });
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS e2e_safety_canary (database_name text PRIMARY KEY, marker text NOT NULL)');
  await db.$executeRaw`INSERT INTO e2e_safety_canary(database_name, marker) VALUES (${name}, 'ALZAD_DESTRUCTIVE_E2E_TEST_DB_V1') ON CONFLICT (database_name) DO NOTHING`;
  await db.$disconnect();
  run('--experimental-vm-modules', [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', 'test/jest-e2e.json', '--runInBand', 'beneficiary-onboarding.e2e-spec.ts'], resolve(root, 'apps/api'));
}
main().catch(error => { console.error(error.code ?? error.message, error.meta?.code ?? '', error.meta?.message ?? ''); process.exitCode = 1; }).finally(() => { if (started) pg('pg_ctl', ['-D', resolve(cluster, 'data'), '-m', 'fast', '-w', 'stop']); });
