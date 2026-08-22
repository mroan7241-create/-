/** Jest e2e setup — executes before any test-file import. */
import { assertE2eNotTargetingProduction } from './production-target.guard';

export const TEST_S3_PORT = 9401;
export const TEST_S3_BUCKET = 'alzad-platform-test';

// MUST execute before any local environment override below.
assertE2eNotTargetingProduction();

if (process.env.OBJECT_STORAGE_EXTERNAL !== 'true') {
  process.env.OBJECT_STORAGE_ENDPOINT = `http://127.0.0.1:${TEST_S3_PORT}`;
  process.env.OBJECT_STORAGE_REGION = 'us-east-1';
  process.env.OBJECT_STORAGE_ACCESS_KEY = 'S3RVER';
  process.env.OBJECT_STORAGE_SECRET_KEY = 'S3RVER';
  process.env.OBJECT_STORAGE_BUCKET = TEST_S3_BUCKET;
  process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = 'true';
}