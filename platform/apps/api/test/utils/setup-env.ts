/** Jest e2e setup — executes before any test-file import. */
import { prisma } from '@alzad/db';
import { assertE2eSafetyCanary, E2E_SAFETY_CANARY } from './production-target.guard';

export const TEST_S3_PORT = 9401;
export const TEST_S3_BUCKET = 'alzad-platform-test';

// Jest awaits this ESM setup file before importing any suite/fixture. Fail before seed/cleanup.
await assertE2eSafetyCanary(async () => {
  const rows = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM public.e2e_safety_canary
      WHERE database_name = current_database() AND marker = ${E2E_SAFETY_CANARY}
    ) AS present
  `;
  return rows[0]?.present === true;
});

// Set only after proving this database is an isolated E2E target.
process.env.EMAIL_DELIVERY_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString('base64');

if (process.env.OBJECT_STORAGE_EXTERNAL !== 'true') {
  process.env.OBJECT_STORAGE_ENDPOINT = `http://127.0.0.1:${TEST_S3_PORT}`;
  process.env.OBJECT_STORAGE_REGION = 'us-east-1';
  process.env.OBJECT_STORAGE_ACCESS_KEY = 'S3RVER';
  process.env.OBJECT_STORAGE_SECRET_KEY = 'S3RVER';
  process.env.OBJECT_STORAGE_BUCKET = TEST_S3_BUCKET;
  process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = 'true';
}
