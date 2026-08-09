import { SetMetadata } from '@nestjs/common';

export const ALLOW_MUST_CHANGE_PASSWORD_KEY = 'allowMustChangePassword';

/**
 * يستثني endpoint من قفل "يجب تغيير كلمة المرور المؤقتة أولًا" — نفس
 * opts.allowMustChangePassword في requireSession_ القديم. يُستخدم فقط
 * على: PATCH /auth/password، POST /auth/logout، GET /auth/me.
 */
export const AllowMustChangePassword = () => SetMetadata(ALLOW_MUST_CHANGE_PASSWORD_KEY, true);
