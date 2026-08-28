/**
 * setupFiles لِJest e2e — يُنفَّذ قبل أي `import` في ملف الاختبار نفسه،
 * وهو المكان الوحيد الصالح لضبط OBJECT_STORAGE_* لأن
 * `src/config/storage.config.ts` يقرأ process.env مرة واحدة عند أول
 * import (module-level const)، أي قبل أي beforeAll.
 *
 * السلوك:
 *  - محليًا (بلا Docker): لا شيء مضبوط مسبقًا → نستخدم s3rver على
 *    127.0.0.1:9401 (يُشغَّل داخل الاختبارات نفسها).
 *  - في CI: OBJECT_STORAGE_EXTERNAL=true مع MinIO حقيقي كـservice
 *    container → نترك كل OBJECT_STORAGE_* كما ضبطها الـworkflow بلا مساس.
 */
export const TEST_S3_PORT = 9401;
export const TEST_S3_BUCKET = 'alzad-platform-test';

if (process.env.OBJECT_STORAGE_EXTERNAL !== 'true') {
  process.env.OBJECT_STORAGE_ENDPOINT = `http://127.0.0.1:${TEST_S3_PORT}`;
  process.env.OBJECT_STORAGE_REGION = 'us-east-1';
  process.env.OBJECT_STORAGE_ACCESS_KEY = 'S3RVER';
  process.env.OBJECT_STORAGE_SECRET_KEY = 'S3RVER';
  process.env.OBJECT_STORAGE_BUCKET = TEST_S3_BUCKET;
  process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = 'true';
}
