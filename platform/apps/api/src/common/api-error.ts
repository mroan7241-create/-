import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthErrorCode } from '@alzad/shared';

/** استثناء API موحَّد — يحمل كودًا مستقرًا + رسالة عربية مناسبة للمستخدم، بلا أي تسريب لتفاصيل داخلية. */
export class ApiError extends HttpException {
  readonly code: string;

  constructor(code: AuthErrorCode | string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super(message, status);
    this.code = code;
  }
}

export function authInvalidCredentials(): ApiError {
  return new ApiError(AuthErrorCode.AUTH_INVALID_CREDENTIALS, 'بيانات الدخول غير صحيحة', HttpStatus.UNAUTHORIZED);
}

export function authAccountDisabled(): ApiError {
  return new ApiError(AuthErrorCode.AUTH_ACCOUNT_DISABLED, 'الحساب موقوف حاليًا. تواصل مع إدارة المشروع', HttpStatus.FORBIDDEN);
}

export function authAssociationDisabled(): ApiError {
  return new ApiError(AuthErrorCode.AUTH_ASSOCIATION_DISABLED, 'حساب الجمعية موقوف حاليًا. تواصل مع إدارة المشروع', HttpStatus.FORBIDDEN);
}

export function authSessionExpired(): ApiError {
  return new ApiError(AuthErrorCode.AUTH_SESSION_EXPIRED, 'انتهت الجلسة. يرجى تسجيل الدخول مجددًا', HttpStatus.UNAUTHORIZED);
}

export function authForbidden(): ApiError {
  return new ApiError(AuthErrorCode.AUTH_FORBIDDEN, 'ليس لديك صلاحية لتنفيذ هذه العملية', HttpStatus.FORBIDDEN);
}

export function authPasswordChangeRequired(): ApiError {
  return new ApiError(AuthErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED, 'يجب تغيير كلمة المرور المؤقتة أولًا قبل المتابعة', HttpStatus.FORBIDDEN);
}

export function authRateLimited(): ApiError {
  return new ApiError(AuthErrorCode.AUTH_RATE_LIMITED, 'محاولات كثيرة خلال وقت قصير. انتظر بضع دقائق ثم أعد المحاولة', HttpStatus.TOO_MANY_REQUESTS);
}
