import S3rver from 's3rver';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * خادم S3-compatible حقيقي (بروتوكول HTTP فعلي، لا mock داخل نفس العملية)
 * لاختبارات storage integration — بديل محلي عن MinIO في هذه البيئة (بلا
 * Docker). في CI (GitHub Actions) نفس اختبارات apps/api يمكن أن تعمل
 * ضد MinIO حقيقي فقط بتغيير OBJECT_STORAGE_* env، بلا أي تغيير كود.
 */
export async function startTestS3Server(port: number, bucket: string): Promise<{ close: () => Promise<void> }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's3rver-'));
  const instance = new S3rver({
    port,
    address: '127.0.0.1',
    silent: true,
    directory,
    resetOnClose: true,
    allowMismatchedSignatures: true,
    vhostBuckets: false,
    configureBuckets: [{ name: bucket, configs: [] }],
  });
  await instance.run();
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        instance.close((err?: Error) => (err ? reject(err) : resolve()));
      }),
  };
}
