import { createConnection } from 'node:net';
import { CreateBucketCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { startTestS3Server } from './s3-test-server';
import { TEST_S3_BUCKET, TEST_S3_PORT } from './setup-env';

/**
 * تشغيل/إيقاف مخزن الكائنات المستخدَم في الاختبارات:
 *  - محليًا: s3rver حقيقي (بروتوكول S3 عبر HTTP فعلي، لا mock).
 *  - في CI مع OBJECT_STORAGE_EXTERNAL=true: MinIO حقيقي يُشغَّل كـservice
 *    container، فلا نُشغّل شيئًا هنا (الحاوية جاهزة والـbucket مُنشأ في الـworkflow).
 * في الحالتين، `storageClient()` أدناه يتكلّم مع نفس المخزن الذي يستخدمه
 * StorageService بالضبط (نفس OBJECT_STORAGE_* env) — لذلك تأكيدات
 * "الكائن موجود/غير موجود" تأكيدات حقيقية لا افتراضية.
 */
const external = process.env.OBJECT_STORAGE_EXTERNAL === 'true';

let server: { close: () => Promise<void> } | null = null;

/**
 * فحص TCP سريع: هل ثمة خادم مستمع فعلًا على هذا المنفذ؟ يحمي من سباق
 * تراكمي بين ملفات اختبار متعددة تحت `--runInBand`: إن سبق لملف آخر أن
 * ترك خادم s3rver يتيمًا (مثلًا afterAll لم يُنفَّذ بعد تعليق شبكي غير
 * مرتبط إطلاقًا)، فمحاولة `listen()` جديدة على نفس المنفذ تُعلِّق/تفشل
 * بـEADDRINUSE — وهو ما كان يُسقِط كل ملف لاحق في التشغيل بالكامل بلا
 * علاقة بأي عطل حقيقي في التطبيق. إن وُجد خادم مستمع بالفعل، نتجاهل
 * تشغيل خادم جديد (bucket الاختبار موجود مسبقًا فعليًا من ذلك الخادم،
 * والمسار أدناه يتعامل مع "موجود مسبقًا" بصمت أصلًا) ولا نُسجِّل ملكية
 * الخادم في `server` هنا، فلا يحاول هذا الملف إغلاق خادم لا يملكه.
 */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const done = (inUse: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(inUse);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

export async function startTestStorage(): Promise<void> {
  if (!external) {
    if (await portInUse(TEST_S3_PORT)) {
      server = null;
    } else {
      server = await startTestS3Server(TEST_S3_PORT, TEST_S3_BUCKET);
    }
  }
  // الـbucket قد يكون منشأً مسبقًا (s3rver configureBuckets / خطوة mc في CI) —
  // ننشئه هنا أيضًا حتى يكون تشغيل أي ملف اختبار منفردًا مكتفيًا بذاته.
  try {
    await storageClient().send(new CreateBucketCommand({ Bucket: testBucket() }));
  } catch {
    /* موجود مسبقًا — لا شيء نفعله */
  }
}

export async function stopTestStorage(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
  }
}

export function testBucket(): string {
  return process.env.OBJECT_STORAGE_BUCKET ?? TEST_S3_BUCKET;
}

export function storageClient(): S3Client {
  return new S3Client({
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY ?? 'S3RVER',
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? 'S3RVER',
    },
  });
}

export async function listLicenseObjectKeys(): Promise<string[]> {
  const client = storageClient();
  const res = await client.send(new ListObjectsV2Command({ Bucket: testBucket(), Prefix: 'association-licenses/' }));
  return (res.Contents ?? []).map((o) => o.Key!).filter(Boolean);
}

export async function objectExists(objectKey: string): Promise<boolean> {
  const client = storageClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: testBucket(), Key: objectKey }));
    return true;
  } catch {
    return false;
  }
}

/** ينظّف كل كائنات الترخيص بين الاختبارات حتى يبقى العدّ ذا معنى. */
export async function clearLicenseObjects(): Promise<void> {
  const keys = await listLicenseObjectKeys();
  if (keys.length === 0) return;
  const client = storageClient();
  for (const Key of keys) {
    await client.send(new DeleteObjectCommand({ Bucket: testBucket(), Key }));
  }
}
