import { BadRequestException } from '@nestjs/common';

/**
 * يطابق normalizePhone_ القديم (Validation.gs) حرفيًا: يقبل
 * 05XXXXXXXX / 5XXXXXXXX / 9665XXXXXXXX / +9665XXXXXXXX، ويخزّن دائمًا
 * بصيغة 05XXXXXXXX (10 خانات).
 */
export function normalizeSaudiPhone(value: string): string {
  const phone = String(value ?? '').replace(/[^\d+]/g, '');
  if (!/^(?:\+?966|0)?5\d{8}$/.test(phone)) {
    throw new BadRequestException('رقم الجوال غير صحيح');
  }
  if (phone.indexOf('+966') === 0) return '0' + phone.slice(4);
  if (phone.indexOf('966') === 0) return '0' + phone.slice(3);
  if (phone.charAt(0) === '5') return '0' + phone;
  return phone;
}
