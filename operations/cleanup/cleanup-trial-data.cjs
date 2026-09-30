/*
 * Launch-only trial-data cleanup. Preview is the default. Production apply is
 * intentionally guarded by a reviewed, exact snapshot and explicit consent.
 * This tool NEVER deletes object-storage objects; retain its protected manifest
 * for a separately reviewed, key-by-key storage cleanup after DB verification.
 */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, Prisma } = require('../../platform/packages/db/generated/client');

const PRODUCTION_REF = 'ojaqtsjpcjjhnmavjuue';
const CANARY = 'ALZAD_DESTRUCTIVE_E2E_TEST_DB_V1';
const PRESERVED = Object.freeze([
  '_prisma_migrations', 'activities', 'audit_logs', 'geographic_units',
  'public_code_counters', 'reference_values', 'system_settings',
]);
const WIPED = Object.freeze([
  'activity_evidence', 'application_access_tokens', 'application_answers',
  'application_applicant_sessions', 'application_attachments',
  'application_information_items', 'application_information_requests',
  'association_application_drafts', 'association_applications', 'associations',
  'auth_rate_limits', 'auth_sessions', 'beneficiaries', 'beneficiary_needs',
  'beneficiary_replacements', 'central_stock_balances',
  'central_stock_dispatches', 'central_stock_receipts',
  'coordinator_change_requests', 'damage_cases', 'delivery_approvals',
  'delivery_attempts', 'delivery_missions', 'device_allocations',
  'device_movements', 'device_units', 'escalation_cases', 'files',
  'idempotency_keys', 'notifications', 'organization_closure_reports',
  'outbox_events', 'participation_agreements', 'password_reset_tokens',
  'project_closure_reports', 'project_participations', 'purchase_order_items',
  'purchase_orders', 'receipt_batches', 'receipt_damage_photos',
  'receipt_items', 'shipment_items', 'shipment_reconciliation_issues',
  'shipments',
]);
const TARGETS = Object.freeze(['accounts', 'auth_credentials', ...WIPED]);
const EXPECTED = new Set([...PRESERVED, ...TARGETS]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function databaseName(url, label) {
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error(`SAFETY STOP: ${label} must be an explicit PostgreSQL URL.`);
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!name || name.includes('/')) throw new Error(`SAFETY STOP: ${label} must name one database.`);
  return name;
}

function assertTarget(env = process.env) {
  let url;
  try { url = new URL(env.DATABASE_URL); }
  catch { throw new Error('SAFETY STOP: DATABASE_URL is required.'); }
  const name = databaseName(url, 'DATABASE_URL');
  if (env.NODE_ENV === 'test') {
    const allowed = new Set((env.E2E_ALLOWED_DATABASE_NAMES ?? '').split(',').map((x) => x.trim()).filter(Boolean));
    if (env.ALLOW_DESTRUCTIVE_E2E !== 'true' || !allowed.has(name) ||
        !/(^|[-_])(test|ci|e2e)([-_]|$)/i.test(name) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('SAFETY STOP: isolated, allowlisted local test DB is required.');
    }
    return { kind: 'test', name };
  }
  if (env.NODE_ENV === 'production') {
    const dbIdentity = `${url.hostname} ${decodeURIComponent(url.username)}`.toLowerCase();
    if (env.ALZAD_CLEANUP_EXPECTED_PROJECT_REF !== PRODUCTION_REF ||
        env.ALZAD_CLEANUP_EXPECTED_DB_NAME !== name ||
        !dbIdentity.includes(PRODUCTION_REF) ||
        !['db.' + PRODUCTION_REF + '.supabase.co',
          'aws-0-ap-southeast-1.pooler.supabase.com'].includes(url.hostname.toLowerCase())) {
      throw new Error('SAFETY STOP: URL does not positively identify the approved Alzad production project.');
    }
    return { kind: 'production', name };
  }
  throw new Error('SAFETY STOP: NODE_ENV must explicitly be test or production.');
}

function assertApplyPermission(target, env = process.env) {
  if (!/^[a-f0-9]{64}$/.test(env.ALZAD_CLEANUP_APPROVED_SHA256 ?? '')) {
    throw new Error('SAFETY STOP: reviewed manifest SHA-256 approval is required.');
  }
  if (target.kind === 'production' &&
      env.ALZAD_CLEANUP_PRODUCTION_CONFIRM !== 'CLEAN_ALZAD_PRODUCTION_TRIAL_DATA') {
    throw new Error('SAFETY STOP: explicit production cleanup confirmation is required.');
  }
}

function quoteIdentifier(name) {
  if (!EXPECTED.has(name)) throw new Error(`SAFETY STOP: unknown table ${name}.`);
  return `"${name}"`;
}

function deletionOrder(edges) {
  const nodes = new Set(TARGETS);
  const incoming = new Map([...nodes].map((n) => [n, 0]));
  const parents = new Map([...nodes].map((n) => [n, new Set()]));
  for (const edge of edges) {
    if (!nodes.has(edge.parent)) continue;
    if (PRESERVED.includes(edge.child)) {
      if (!(edge.child === 'audit_logs' &&
            ['accounts', 'associations'].includes(edge.parent) && edge.action === 'n')) {
        throw new Error(`SAFETY STOP: protected table ${edge.child} references ${edge.parent}.`);
      }
      continue;
    }
    if (!nodes.has(edge.child)) throw new Error(`SAFETY STOP: unknown FK child ${edge.child}.`);
    if (!parents.get(edge.child).has(edge.parent)) {
      parents.get(edge.child).add(edge.parent);
      incoming.set(edge.parent, incoming.get(edge.parent) + 1);
    }
  }
  const ready = [...nodes].filter((n) => incoming.get(n) === 0).sort();
  const result = [];
  while (ready.length) {
    const child = ready.shift();
    result.push(child);
    for (const parent of parents.get(child)) {
      incoming.set(parent, incoming.get(parent) - 1);
      if (incoming.get(parent) === 0) ready.push(parent);
    }
    ready.sort();
  }
  if (result.length !== nodes.size) throw new Error('SAFETY STOP: FK dependency cycle; no rows deleted.');
  return result;
}

async function assertSchema(tx, target) {
  const actual = await tx.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
  const names = new Set(actual.map((r) => r.tablename));
  const extra = [...names].filter((name) => !EXPECTED.has(name) && !(target.kind === 'test' && name === 'e2e_safety_canary'));
  const missing = [...EXPECTED].filter((name) => !names.has(name));
  if (extra.length || missing.length) {
    throw new Error(`SAFETY STOP: schema differs; extra=${extra.join(',')}; missing=${missing.join(',')}.`);
  }
  if (target.kind === 'test') {
    const rows = await tx.$queryRawUnsafe(
      `SELECT 1 FROM public.e2e_safety_canary WHERE database_name=current_database() AND marker=$1 LIMIT 1`, CANARY);
    if (rows.length !== 1) throw new Error('SAFETY STOP: test database canary missing.');
  }
  const edges = await tx.$queryRawUnsafe(`
    SELECT child.relname AS child, parent.relname AS parent, c.confdeltype AS action
    FROM pg_constraint c
    JOIN pg_class child ON child.oid=c.conrelid
    JOIN pg_class parent ON parent.oid=c.confrelid
    JOIN pg_namespace ns ON ns.oid=child.relnamespace
    WHERE c.contype='f' AND ns.nspname='public'`);
  return deletionOrder(edges);
}

async function assertAdmin(tx) {
  const rows = await tx.$queryRawUnsafe(`
    SELECT public_code FROM public.accounts WHERE role='ADMIN' ORDER BY public_code`);
  if (rows.length !== 1 || rows[0].public_code !== 'ADM-000001') {
    throw new Error('SAFETY STOP: expected sole ADMIN ADM-000001 is not present.');
  }
  const credentials = await tx.$queryRawUnsafe(`
    SELECT count(*)::integer AS n FROM public.auth_credentials c
    JOIN public.accounts a ON a.id=c.account_id WHERE a.role='ADMIN'`);
  if (credentials[0].n < 1) throw new Error('SAFETY STOP: ADMIN credential missing.');
}

function targetPredicate(table) {
  if (table === 'accounts') return ` WHERE t.role <> 'ADMIN'`;
  if (table === 'auth_credentials') return ` WHERE NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id=t.account_id AND a.role='ADMIN')`;
  return '';
}

async function fingerprint(tx, table, predicate = '', expression = 'to_jsonb(t)') {
  const rows = await tx.$queryRawUnsafe(`
    SELECT count(*)::integer AS n,
      md5(coalesce(string_agg(md5((${expression})::text), '' ORDER BY md5((${expression})::text)), '')) AS digest
    FROM public.${quoteIdentifier(table)} t${predicate}`);
  return rows[0];
}

async function snapshot(tx) {
  await assertAdmin(tx);
  const targets = {};
  for (const table of TARGETS) targets[table] = await fingerprint(tx, table, targetPredicate(table));
  const protectedRows = {};
  for (const table of PRESERVED) {
    const expr = table === 'audit_logs'
      ? `to_jsonb(t) - 'actor_account_id' - 'association_id'`
      : 'to_jsonb(t)';
    protectedRows[table] = await fingerprint(tx, table, '', expr);
  }
  protectedRows.admin = await fingerprint(tx, 'accounts', ` WHERE t.role='ADMIN'`);
  protectedRows.adminCredentials = await fingerprint(tx, 'auth_credentials', ` WHERE EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id=t.account_id AND a.role='ADMIN')`);
  const files = await tx.$queryRawUnsafe(`SELECT bucket, object_key AS "objectKey" FROM public.files ORDER BY bucket, object_key`);
  const codes = {};
  for (const [label, table] of [['accounts', 'accounts'], ['associations', 'associations'],
                                ['applications', 'association_applications']]) {
    const where = table === 'accounts' ? `WHERE role <> 'ADMIN'` : '';
    const rows = await tx.$queryRawUnsafe(`SELECT public_code FROM public.${quoteIdentifier(table)} ${where} ORDER BY public_code`);
    codes[label] = rows.map((r) => r.public_code);
  }
  return { targets, protectedRows, files, codes };
}

async function runPreview(client, target) {
  return client.$transaction(async (tx) => {
    await assertSchema(tx, target);
    return snapshot(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 180000 });
}

function manifestFingerprint(data) { return sha256(JSON.stringify(data)); }

function writeManifest(filePath, manifest) {
  if (!path.isAbsolute(filePath)) throw new Error('SAFETY STOP: manifest path must be absolute.');
  const parent = fs.realpathSync(path.dirname(filePath));
  const repo = fs.realpathSync(path.resolve(__dirname, '../..'));
  const relative = path.relative(repo, parent);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('SAFETY STOP: write sensitive manifest outside the repository.');
  }
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(manifest, null, 2)); }
  finally { fs.closeSync(fd); }
}

async function runApply(client, target, manifest, env = process.env) {
  assertApplyPermission(target, env);
  if (manifest.version !== 1 || manifest.target !== target.kind ||
      manifest.database !== target.name || manifest.sha256 !== env.ALZAD_CLEANUP_APPROVED_SHA256 ||
      manifest.sha256 !== manifestFingerprint(manifest.data)) {
    throw new Error('SAFETY STOP: manifest/approval mismatch.');
  }
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout='5s'`);
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout='30s'`);
    const order = await assertSchema(tx, target);
    const lockTables = [...EXPECTED].sort().map((n) => `public.${quoteIdentifier(n)}`).join(', ');
    await tx.$executeRawUnsafe(`LOCK TABLE ${lockTables} IN SHARE ROW EXCLUSIVE MODE`);
    const before = await snapshot(tx);
    if (manifestFingerprint(before) !== manifest.sha256) {
      throw new Error('SAFETY STOP: data changed after preview, including new applications.');
    }
    for (const table of order) {
      const clause = targetPredicate(table).replaceAll('t.', '');
      await tx.$executeRawUnsafe(`DELETE FROM public.${quoteIdentifier(table)} ${clause}`);
    }
    const after = await snapshot(tx);
    for (const [table, value] of Object.entries(after.targets)) {
      if (value.n !== 0) throw new Error(`SAFETY STOP: residual rows in ${table}.`);
    }
    for (const [table, value] of Object.entries(before.protectedRows)) {
      if (JSON.stringify(after.protectedRows[table]) !== JSON.stringify(value)) {
        throw new Error(`SAFETY STOP: protected data changed in ${table}.`);
      }
    }
    return { deleted: Object.fromEntries(Object.entries(before.targets).map(([k, v]) => [k, v.n])),
      objectKeysRequireSeparateReview: before.files.length, auditLinksNulled: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 180000 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => !['--apply', '--dry-run', '--manifest'].includes(a) && !a.startsWith('--manifest='))) {
    throw new Error('Usage: node cleanup-trial-data.cjs [--dry-run|--apply] [--manifest=/absolute/protected/path.json]');
  }
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) throw new Error('Choose one mode.');
  const manifestArg = args.find((a) => a.startsWith('--manifest='));
  const manifestPath = manifestArg?.slice('--manifest='.length);
  if (apply && !manifestPath) throw new Error('SAFETY STOP: --apply requires --manifest=path.');
  const target = assertTarget();
  const client = new PrismaClient();
  try {
    if (apply) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const result = await runApply(client, target, manifest);
      process.stdout.write(JSON.stringify({ mode: 'applied', ...result }) + '\n');
    } else {
      const data = await runPreview(client, target);
      const manifest = { version: 1, target: target.kind, database: target.name,
        createdAt: new Date().toISOString(), sha256: manifestFingerprint(data), data };
      if (manifestPath) writeManifest(manifestPath, manifest);
      process.stdout.write(JSON.stringify({ mode: 'dry-run', sha256: manifest.sha256,
        counts: Object.fromEntries(Object.entries(data.targets).map(([k, v]) => [k, v.n])),
        accountCodes: data.codes.accounts, associationCodes: data.codes.associations,
        applicationCodes: data.codes.applications, objectKeysRequireSeparateReview: data.files.length,
        manifestWritten: Boolean(manifestPath) }) + '\n');
    }
  } finally { await client.$disconnect(); }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Cleanup failed.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertTarget, assertApplyPermission, deletionOrder, manifestFingerprint,
  runPreview, runApply, writeManifest, PRODUCTION_REF, PRESERVED, WIPED, TARGETS };
