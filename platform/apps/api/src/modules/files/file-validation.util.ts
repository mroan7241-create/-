/**
 * تحقق ملفات ترخيص الجمعية — يطابق قيود Legacy: JPEG/PNG/WEBP فقط،
 * 8 MiB كحد أقصى. لا يُعتمَد على الامتداد أو MIME المُعلَن وحدهما —
 * magic bytes الفعلية هي الحكم. راجع ASSOCIATION_APPLICATIONS.md.
 */
export const LICENSE_FILE_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB
export const LICENSE_FILE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type DetectedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** يفحص أول بايتات الملف فعليًا (magic bytes) — لا يثق بالامتداد أو Content-Type المُرسَل من العميل. */
export function detectImageMimeFromBytes(buffer: Buffer): DetectedImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface LicenseFileValidationResult {
  valid: boolean;
  reason?: 'TOO_LARGE' | 'INVALID_TYPE';
  detectedMimeType?: DetectedImageType;
}

/** التحقق الكامل: الحجم أولًا (رفض مبكر بلا فحص محتوى)، ثم magic bytes، ثم مطابقة MIME المُعلَن (إن وُجد) لما اكتُشف فعليًا. */
export function validateLicenseFile(buffer: Buffer, declaredMimeType: string | undefined): LicenseFileValidationResult {
  if (buffer.length > LICENSE_FILE_MAX_BYTES) {
    return { valid: false, reason: 'TOO_LARGE' };
  }
  const detected = detectImageMimeFromBytes(buffer);
  if (!detected) {
    return { valid: false, reason: 'INVALID_TYPE' };
  }
  // المُعلَن غير موثوق به وحده، لكن تناقضه الصريح مع المكتشَف فعليًا (تزوير MIME) يُرفَض أيضًا.
  if (declaredMimeType && LICENSE_FILE_ALLOWED_MIME_TYPES.includes(declaredMimeType as DetectedImageType) && declaredMimeType !== detected) {
    return { valid: false, reason: 'INVALID_TYPE' };
  }
  return { valid: true, detectedMimeType: detected };
}
