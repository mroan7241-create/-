import { BadRequestException } from '@nestjs/common';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]', 'g');

/** يطابق cleanText_ القديم — يزيل أحرف التحكم، يقصّ المسافات، يقصّ الطول الأقصى. */
export function cleanText(value: unknown, max: number): string {
  const raw = String(value ?? '');
  const stripped = raw.replace(CONTROL_CHARS_RE, '').trim();
  return stripped.length > max ? stripped.slice(0, max) : stripped;
}

export function requiredText(value: unknown, label: string, max: number): string {
  const cleaned = cleanText(value, max);
  if (!cleaned) throw new BadRequestException(`${label} مطلوب`);
  return cleaned;
}

export function requiredEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 180) {
    throw new BadRequestException('البريد الإلكتروني غير صحيح');
  }
  return email;
}
