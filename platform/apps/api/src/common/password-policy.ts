import { BadRequestException } from '@nestjs/common';
import { authConfig } from '../config/auth.config';
import { verifySecret } from './password.util';

/**
 * ضوابط قوة كلمة المرور الجديدة ومنع إعادة الاستخدام — منقولة حرفيًا من
 * assertPasswordPolicy_ في Validation.gs (الفرع القديم)، لكن التحقق من
 * "هل تطابق الحالية/السابقة" يستخدم argon2.verify بدل مقارنة hash نصي
 * مباشر (النظام الجديد لا يعيد استخدام تنسيق hashSecret_ القديم إطلاقًا
 * — راجع platform/docs/LEGACY_DATA_MIGRATION.md لاستراتيجية التوافق
 * المستقبلية عند NODE-8).
 */
export async function assertPasswordPolicy(
  newPassword: string,
  currentSecretHash: string | null,
  previousSecretHash: string | null,
): Promise<string> {
  const value = String(newPassword || '');
  if (value.length < authConfig.passwordMinLength || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new BadRequestException(
      `كلمة المرور الجديدة يجب أن تكون ${authConfig.passwordMinLength} خانات على الأقل وتضم حروفًا وأرقامًا`,
    );
  }
  if (currentSecretHash && (await verifySecret(currentSecretHash, value))) {
    throw new BadRequestException('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
  }
  if (previousSecretHash && (await verifySecret(previousSecretHash, value))) {
    throw new BadRequestException('لا يمكن استخدام كلمة المرور السابقة نفسها. اختر كلمة مرور مختلفة');
  }
  return value;
}
