import {
  ACTIVITY_STATUS_LABELS,
  BENEFICIARY_REVIEW_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  DEVICE_STATUS_LABELS,
  DEVICE_TYPE_LABELS,
  NEED_DECISION_STATUS_LABELS,
  RECEIPT_BATCH_STATUS_LABELS,
} from './api';

/** مصدر التعريب الوحيد للقيم المجمعة الظاهرة في تقارير البوابات. */
export const REPORT_VALUE_LABELS: Record<string, string> = {
  ...ACTIVITY_STATUS_LABELS,
  ...BENEFICIARY_REVIEW_STATUS_LABELS,
  ...DELIVERY_STATUS_LABELS,
  ...DEVICE_STATUS_LABELS,
  ...DEVICE_TYPE_LABELS,
  ...NEED_DECISION_STATUS_LABELS,
  ...RECEIPT_BATCH_STATUS_LABELS,
  ACTIVE: 'نشط', INACTIVE: 'غير نشط', SUSPENDED: 'موقوف',
  ACCEPTED: 'مقبول', PASSED: 'مجتاز', FAILED: 'غير مجتاز', NEEDS_INFO: 'يحتاج معلومات',
  NONE: 'غير محدد', MAIN: 'القائمة الأساسية', RESERVE: 'قائمة الاحتياط',
  APPROVED_AWAITING_SETUP: 'معتمد بانتظار الإعداد', EXECUTING: 'قيد التنفيذ', READY_TO_CLOSE: 'جاهز للإغلاق', CLOSURE_SUBMITTED: 'رُفع للإغلاق', CLOSED: 'مغلق', WITHDRAWN: 'منسحب',
  SENT: 'مُرسل', SIGNED_BY_ORG: 'موقّع من الجمعية', SIGNED: 'موقّع نهائيًا', SUPERSEDED: 'مستبدل بإصدار أحدث',
  APPROVED_ENTITLEMENT: 'استحقاق معتمد', AWAITING_DEVICE: 'بانتظار الجهاز', DEVICE_READY: 'الجهاز جاهز', AWAITING_DELEGATE_ASSIGNMENT: 'بانتظار إسناد مندوب', ASSIGNED_TO_DELEGATE_PENDING: 'مسند بانتظار تأكيد المندوب', AWAITING_RETURN_CONFIRMATION: 'بانتظار تأكيد الإرجاع', RETURNED_TO_ASSOCIATION_WAREHOUSE: 'أعيد إلى مستودع الجمعية',
  RELEASED: 'محرر', PARTIALLY_DELIVERED: 'مسلّم جزئيًا', FULFILLED: 'مكتمل', CANCELLED: 'ملغى', PLANNED: 'مخطط', DISPATCHED: 'تم الشحن', PARTIALLY_RECEIVED: 'مستلم جزئيًا', RECEIVED: 'مستلم', RECONCILIATION_REQUIRED: 'تتطلب مطابقة',
  OPEN: 'مفتوح', AWAITING_RETURN: 'بانتظار الإرجاع', AWAITING_REPLACEMENT: 'بانتظار الاستبدال', REPLACED: 'تم الاستبدال', SETTLED: 'تمت التسوية',
  INFO: 'معلومة', WARNING: 'تحذير', LOW: 'منخفض', MEDIUM: 'متوسط', HIGH: 'مرتفع', CRITICAL: 'حرج',
  GOOD: 'سليم', ASSOCIATION: 'الجمعية', ZAAD: 'الزاد', RETURNED_FOR_FIX: 'أعيد للتصحيح',
  GENERATED: 'مُنشأ', SUBMITTED: 'مُرسل للمراجعة', REOPENED: 'أعيد فتحه',
};

export function reportValueLabel(value: string | null | undefined): string {
  if (!value || value === 'null') return '—';
  return REPORT_VALUE_LABELS[value] ?? value;
}
