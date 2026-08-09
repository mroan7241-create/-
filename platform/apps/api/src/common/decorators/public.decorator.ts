import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** يعفي endpoint من SessionAuthGuard المركزي — يُستخدم فقط لنقاط الدخول العامة فعلًا (health, login, reference-values, password-reset request/confirm). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
