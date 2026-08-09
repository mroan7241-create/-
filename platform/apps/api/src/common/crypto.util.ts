import { createHash, createHmac, randomBytes } from 'node:crypto';
import { computeCredentialLookupHash, normalizeDelegateCode } from '@alzad/shared';
import { authConfig } from '../config/auth.config';

/**
 * رمز جلسة عالي العشوائية — القيمة الخام تُرسَل للعميل مرة واحدة فقط
 * (عبر HttpOnly cookie)، ولا تُخزَّن أبدًا في قاعدة البيانات؛ فقط
 * sha256Hex(raw) يُخزَّن في auth_sessions.token_hash.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HMAC للمعرِّفات الحساسة (بريد/رمز مندوب) قبل استخدامها كـsubject_hash في auth_rate_limits — لا تُخزَّن القيمة الخام أبدًا. */
export function hmacHex(value: string): string {
  return createHmac('sha256', authConfig.rateLimitHmacKey).update(value, 'utf8').digest('hex');
}

/**
 * lookup hash حتمي لرمز دخول مندوب مطبَّع مسبقًا (trim+uppercase) —
 * يُستخدم كـ`AuthCredential.identifier` لنوع DELEGATE_ACCESS_CODE بدل
 * الرمز الخام، فيتيح findUnique O(1) بدل فحص خطي على كل بيانات اعتماد
 * المناديب النشطة. مفتاح HMAC مستقل تمامًا عن rateLimitHmacKey/
 * resetTokenHmacKey — راجع AUTHENTICATION.md.
 */
export function delegateCredentialLookupHash(normalizedDelegateCode: string): string {
  return computeCredentialLookupHash(normalizedDelegateCode, authConfig.credentialLookupHmacKey);
}

export { normalizeDelegateCode };

/**
 * HMAC-SHA256 لرمز إعادة تعيين كلمة المرور (مطبَّع مسبقًا: trim+uppercase)
 * — يُستخدم كـ`password_reset_tokens.token_hash` بدل SHA-256 عادي، لأن
 * الرمز نفسه أقل entropy بكثير من رمز جلسة عشوائي (8 خانات فقط)؛ مفتاح
 * HMAC مستقل تمامًا عن rateLimitHmacKey/credentialLookupHmacKey.
 */
export function resetTokenHash(normalizedCode: string): string {
  return createHmac('sha256', authConfig.resetTokenHmacKey).update(normalizedCode, 'utf8').digest('hex');
}

/** أبجدية بلا أحرف/أرقام متشابهة بصريًا (0/O، 1/I/L) — نفس مبدأ createAccessCode_ القديم في Validation.gs. */
const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** يولّد كودًا عشوائيًا بصيغة "PREFIX-XXXXXX" (نفس نمط createAccessCode_ القديم) — يُستخدم لرموز دخول المناديب ورموز استعادة كلمة المرور وكلمات المرور المؤقتة. */
export function generateAccessCode(prefix: string, length: number): string {
  const bytes = randomBytes(length);
  let output = '';
  for (let i = 0; i < length; i++) {
    output += ACCESS_CODE_ALPHABET[bytes[i] % ACCESS_CODE_ALPHABET.length];
  }
  return `${prefix}-${output}`;
}

/** كلمة مرور مؤقتة قوية (طول كافٍ + حرف ورقم معًا) — نفس مبدأ generateStrongTempPassword_ القديم. */
export function generateStrongTempPassword(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = generateAccessCode('T', 12).replace(/^T-/, '');
    if (candidate.length >= 10 && /[A-Za-z]/.test(candidate) && /\d/.test(candidate)) return candidate;
  }
  return `Az9${generateAccessCode('T', 9).replace(/^T-/, '')}`;
}
