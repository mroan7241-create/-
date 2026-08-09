import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { prisma } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { JPEG_1X1, PNG_1X1, cleanNode2State, submitApplication, validApplicationPayload } from './utils/node2-fixtures';
import { clearLicenseObjects, listLicenseObjectKeys, objectExists, startTestStorage, stopTestStorage } from './utils/storage-harness';
import { StorageService } from '../src/modules/files/storage.service';
import { PublicCodeService } from '../src/common/public-code.service';
import { storageConfig } from '../src/config/storage.config';

/**
 * تكامل تخزين الكائنات مقابل خادم S3 حقيقي (بروتوكول HTTP فعلي) — لا
 * mock ولا stub. محليًا: s3rver؛ في CI: MinIO حقيقي كـservice container
 * (OBJECT_STORAGE_EXTERNAL=true)، بنفس هذا الملف حرفيًا وبلا تغيير كود.
 */
describe('NODE-2 — تكامل تخزين الكائنات (خادم S3 حقيقي)', () => {
  let app: INestApplication;
  let storage: StorageService;

  beforeAll(async () => {
    await startTestStorage();
    ({ app } = await createTestApp());
    await seedTestFixtures();
    storage = app.get(StorageService);
  }, 60000);

  beforeEach(async () => {
    await cleanAuthState();
    await cleanNode2State();
    await clearLicenseObjects();
  });

  afterAll(async () => {
    await cleanNode2State();
    await app.close();
    await stopTestStorage();
  });

  it('الرفع ينجح والكائن يصبح موجودًا فعلًا في الـbucket', async () => {
    const key = `association-licenses/${randomUUID()}.png`;
    await storage.uploadPrivateObject(key, PNG_1X1, 'image/png');

    expect(await objectExists(key)).toBe(true);
    expect(await listLicenseObjectKeys()).toContain(key);
  });

  it('الرابط الموقَّع يُعيد بايتات الكائن نفسها حرفيًا عند جلبه فعليًا عبر HTTP', async () => {
    const key = `association-licenses/${randomUUID()}.jpg`;
    await storage.uploadPrivateObject(key, JPEG_1X1, 'image/jpeg');

    const url = await storage.getSignedGetUrl(key, storageConfig.licenseSignedUrlSeconds);
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toMatch(/X-Amz-Signature=/);
    expect(url).toMatch(/X-Amz-Credential=/);

    const response = await fetch(url);
    expect(response.status).toBe(200);
    const fetched = Buffer.from(await response.arrayBuffer());
    expect(fetched.equals(JPEG_1X1)).toBe(true);
  });

  it('عمر الرابط الموقَّع قصير ومضبوط من الإعدادات (لا رابط دائم)', async () => {
    const key = `association-licenses/${randomUUID()}.png`;
    await storage.uploadPrivateObject(key, PNG_1X1, 'image/png');

    const url = new URL(await storage.getSignedGetUrl(key, 120));
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(storageConfig.licenseSignedUrlSeconds).toBe(300);
  });

  it('deleteObjectBestEffort يحذف الكائن فعليًا ولا يرمي أبدًا لمفتاح غير موجود', async () => {
    const key = `association-licenses/${randomUUID()}.png`;
    await storage.uploadPrivateObject(key, PNG_1X1, 'image/png');
    expect(await objectExists(key)).toBe(true);

    await storage.deleteObjectBestEffort(key);
    expect(await objectExists(key)).toBe(false);

    // مفتاح غير موجود إطلاقًا — لا استثناء (مسار تعويض لا يجوز أن يُخفي الخطأ الأصلي).
    await expect(storage.deleteObjectBestEffort(`association-licenses/${randomUUID()}.png`)).resolves.toBeUndefined();
    await expect(storage.deleteObjectBestEffort(`no/such/prefix/${randomUUID()}`)).resolves.toBeUndefined();
    // حذف مكرر لنفس المفتاح المحذوف — لا استثناء كذلك.
    await expect(storage.deleteObjectBestEffort(key)).resolves.toBeUndefined();
  });

  it('مسار التقديم الكامل يرفع كائنًا حقيقيًا يمكن جلبه لاحقًا بالرابط الموقَّع', async () => {
    const payload = validApplicationPayload();
    expect((await submitApplication(app, payload, { file: JPEG_1X1, contentType: 'image/jpeg', filename: 'l.jpg' })).status).toBe(200);

    const row = await prisma.associationApplication.findUniqueOrThrow({
      where: { clientRequestId: payload.clientRequestId },
      include: { licenseFile: true },
    });
    expect(row.licenseFile!.bucket).toBe(storageConfig.bucket);
    expect(await objectExists(row.licenseFile!.objectKey)).toBe(true);

    const url = await storage.getSignedGetUrl(row.licenseFile!.objectKey, 300);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(JPEG_1X1)).toBe(true);
  });

  it('كائن معاملة فاشلة يختفي فعليًا من الـbucket (لا كائن يتيم بعد التعويض)', async () => {
    const publicCodeService = app.get(PublicCodeService);
    const spy = jest.spyOn(publicCodeService, 'nextPublicCode').mockRejectedValueOnce(new Error('فشل مُصطنَع بعد الرفع'));

    const res = await submitApplication(app, validApplicationPayload());
    expect(res.status).toBe(500);
    spy.mockRestore();

    expect(await listLicenseObjectKeys()).toHaveLength(0);
    expect(await prisma.fileObject.count()).toBe(0);
    expect(await prisma.associationApplication.count()).toBe(0);
  });

  it('كائن الطلب الخاسر في سباق متزامن يختفي، ويبقى كائن الفائز قابلًا للجلب', async () => {
    const payload = validApplicationPayload();
    await Promise.all([submitApplication(app, payload), submitApplication(app, payload)]);

    const rows = await prisma.associationApplication.findMany({ include: { licenseFile: true } });
    expect(rows).toHaveLength(1);

    const keys = await listLicenseObjectKeys();
    expect(keys).toEqual([rows[0].licenseFile!.objectKey]);

    const response = await fetch(await storage.getSignedGetUrl(keys[0], 300));
    expect(response.status).toBe(200);
  });
});
