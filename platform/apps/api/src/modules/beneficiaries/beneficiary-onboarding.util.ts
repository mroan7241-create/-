import { ApiError } from '../../common/api-error';

export function validateNeedPriority(value: number | undefined | null): number {
  if (!Number.isInteger(value) || value! < 1 || value! > 50) {
    throw new ApiError('BENEFICIARY_PRIORITY_REQUIRED', 'أدخل ترتيب الحاجة من 1 إلى 50؛ الرقم 1 للأسرة الأشد حاجة', 400);
  }
  return value!;
}

export function validateThreeDeviceReason(deviceCount: number, value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length > 1000) throw new ApiError('BENEFICIARY_REASON_TOO_LONG', 'مبرر طلب ثلاثة أجهزة يتجاوز 1000 حرف', 400);
  // Letters/numbers required: spaces or punctuation alone are not an explanation.
  if (deviceCount === 3 && !/[\p{L}\p{N}]/u.test(reason)) {
    throw new ApiError('BENEFICIARY_THREE_DEVICE_REASON_REQUIRED', 'عند طلب ثلاثة أجهزة يجب كتابة مبرر يشرح حاجة الأسرة إليها', 400);
  }
  return reason || null;
}
