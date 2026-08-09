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
