/**
 * إعدادات تخزين الكائنات (S3-compatible) — MinIO محليًا/في CI،
 * ومزوّد Production حقيقي يُربَط لاحقًا خلف نفس العقد (لا يُربَط في
 * NODE-2). لا Public bucket ولا رابط دائم — كل وصول عبر signed URL
 * قصير العمر أو streaming موثَّق. راجع ASSOCIATION_APPLICATIONS.md.
 */
export const storageConfig = {
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
  accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY ?? 'alzad-dev',
  secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? 'change-me-dev-only',
  bucket: process.env.OBJECT_STORAGE_BUCKET ?? 'alzad-platform-dev',
  forcePathStyle: (process.env.OBJECT_STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
  /** عمر signed URL لعرض ملفات الترخيص لـADMIN — قصير عمدًا. */
  licenseSignedUrlSeconds: Number(process.env.OBJECT_STORAGE_LICENSE_SIGNED_URL_SECONDS ?? 300),
} as const;

/**
 * يمنع تشغيل Production بتخزين محلي عابر أو بقيم التطوير المعروفة. لا نطبع
 * أي قيمة هنا؛ رسالة الفشل تعرض اسم المتغير الذي يحتاج ضبطًا فقط.
 */
export function assertProductionStorageConfigured(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const invalidVars = new Set<string>();
  const driver = (process.env.OBJECT_STORAGE_DRIVER ?? '').trim();
  if (driver !== 's3') invalidVars.add('OBJECT_STORAGE_DRIVER');

  const endpoint = (process.env.OBJECT_STORAGE_ENDPOINT ?? '').trim();
  try {
    const parsed = new URL(endpoint);
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' || localHost) invalidVars.add('OBJECT_STORAGE_ENDPOINT');
  } catch {
    invalidVars.add('OBJECT_STORAGE_ENDPOINT');
  }

  const required = [
    ['OBJECT_STORAGE_REGION', 'us-east-1'],
    ['OBJECT_STORAGE_ACCESS_KEY', 'alzad-dev'],
    ['OBJECT_STORAGE_SECRET_KEY', 'change-me-dev-only'],
    ['OBJECT_STORAGE_BUCKET', 'alzad-platform-dev'],
  ] as const;
  for (const [name, devDefault] of required) {
    const value = (process.env[name] ?? '').trim();
    if (!value || value === devDefault) invalidVars.add(name);
  }

  if (invalidVars.size > 0) {
    throw new Error(
      `رفض بدء التشغيل: NODE_ENV=production لكن إعدادات التخزين التالية غير صالحة ` +
        `(مفقودة/محلية/غير HTTPS/قيمة تطوير): ${[...invalidVars].sort().join(', ')}. ` +
        'اضبط مزود S3 متوافقًا ودائمًا خاصًا بالإنتاج خارج GitHub قبل التشغيل.',
    );
  }
}
