/** Fail-closed safety gate for the destructive E2E suite. No production bypass. */
export const E2E_SAFETY_CANARY = 'ALZAD_DESTRUCTIVE_E2E_TEST_DB_V1';

function allowedNames(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((name) => name.trim()).filter(Boolean));
}

function databaseName(raw: string | undefined, variable: string): string {
  if (!raw) throw new Error(`SAFETY STOP: ${variable} is required for destructive E2E tests.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SAFETY STOP: ${variable} is not a valid PostgreSQL URL.`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error(`SAFETY STOP: ${variable} must be a PostgreSQL URL with a host.`);
  }
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(`SAFETY STOP: ${variable} contains an invalid database name.`);
  }
  if (!name || name.includes('/')) {
    throw new Error(`SAFETY STOP: ${variable} must name exactly one database.`);
  }
  return name;
}

export function assertE2eNotTargetingProduction(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('SAFETY STOP: destructive E2E tests require NODE_ENV=test.');
  }
  if (process.env.ALLOW_DESTRUCTIVE_E2E !== 'true') {
    throw new Error('SAFETY STOP: ALLOW_DESTRUCTIVE_E2E=true is required.');
  }

  const databases = allowedNames(process.env.E2E_ALLOWED_DATABASE_NAMES);
  if (databases.size === 0) {
    throw new Error('SAFETY STOP: E2E_ALLOWED_DATABASE_NAMES must explicitly list test databases.');
  }
  const name = databaseName(process.env.DATABASE_URL, 'DATABASE_URL');
  if (!databases.has(name) || !/(^|[-_])(test|ci|e2e)([-_]|$)/i.test(name)) {
    throw new Error('SAFETY STOP: DATABASE_URL database is not in E2E_ALLOWED_DATABASE_NAMES.');
  }
  if (process.env.DIRECT_URL && !databases.has(databaseName(process.env.DIRECT_URL, 'DIRECT_URL'))) {
    throw new Error('SAFETY STOP: DIRECT_URL database is not in E2E_ALLOWED_DATABASE_NAMES.');
  }

  const buckets = allowedNames(process.env.E2E_ALLOWED_BUCKET_NAMES);
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  if (!bucket || buckets.size === 0 || !buckets.has(bucket) || !/(^|[-_])(test|ci|e2e)([-_]|$)/i.test(bucket)) {
    throw new Error('SAFETY STOP: OBJECT_STORAGE_BUCKET must be in E2E_ALLOWED_BUCKET_NAMES.');
  }

  if (process.env.OBJECT_STORAGE_EXTERNAL === 'true') {
    let endpoint: URL;
    try {
      endpoint = new URL(process.env.OBJECT_STORAGE_ENDPOINT ?? '');
    } catch {
      throw new Error('SAFETY STOP: OBJECT_STORAGE_ENDPOINT must be a local test endpoint.');
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
      throw new Error('SAFETY STOP: OBJECT_STORAGE_ENDPOINT must be a local test endpoint.');
    }
  }

  // E2E never needs a live public API/Web endpoint. Reject inherited production URLs.
  for (const key of ['API_BASE_URL', 'NEXT_PUBLIC_API_BASE_URL', 'WEB_BASE_URL']) {
    const raw = process.env[key];
    if (!raw) continue;
    let endpoint: URL;
    try {
      endpoint = new URL(raw);
    } catch {
      throw new Error(`SAFETY STOP: ${key} is not a valid URL.`);
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
      throw new Error(`SAFETY STOP: ${key} must point to a local test endpoint.`);
    }
  }
}

/** Query must read the canary from the connected database, never an env variable. */
export async function assertE2eSafetyCanary(readFromDatabase: () => Promise<boolean>): Promise<void> {
  assertE2eNotTargetingProduction();
  let present = false;
  try {
    present = await readFromDatabase();
  } catch {
    // Missing table or unreachable database is an explicit safety failure.
  }
  if (!present) throw new Error('SAFETY STOP: the connected database has no valid E2E safety canary.');
}
