/**
 * يترجم رمز إجراء AuditLog داخلي إلى عبارة عربية مقروءة للإدارة — لا رموز
 * نظام خام في أي شاشة/تقرير تنفيذي. مصدر واحد مشترك (Admin/Association
 * dashboards + تقرير المشروع الشامل) بدل تكرار الخريطة في كل مكان.
 */
export const ACTION_LABELS: Record<string, string> = {
  BENEFICIARY_CREATED: 'تسجيل مستفيد جديد',
  BENEFICIARY_REVIEWED: 'مراجعة/اعتماد مستفيد',
  BENEFICIARY_BULK_REVIEWED: 'اعتماد مستفيدين بالجملة',
  BENEFICIARY_UPDATED: 'تعديل بيانات مستفيد',
  BENEFICIARY_LOCATION_UPDATED: 'تحديث موقع مستفيد',
  BENEFICIARIES_IMPORTED: 'استيراد مستفيدين',
  RECEIPT_BATCH_CREATED: 'إنشاء محضر استلام',
  RECEIPT_BATCH_SENT: 'إرسال محضر استلام للجمعية',
  RECEIPT_BATCH_CONFIRMED: 'تأكيد استلام محضر',
  AUTO_ALLOCATION_RUN: 'تخصيص تلقائي للأجهزة (سلال)',
  DELIVERY_ASSIGNED: 'إسناد تسليم لمندوب',
  DELIVERY_HANDOVER_CONFIRMED: 'تأكيد المندوب استلام العهدة',
  DELIVERY_OTP_ISSUED: 'إصدار رمز تحقق تسليم',
  DELIVERY_OTP_VERIFIED: 'التحقق من رمز تسليم',
  DELIVERY_PROOF_SUBMITTED: 'إرسال إثبات تسليم',
  DELIVERY_PROOF_VIEWED: 'عرض إثبات تسليم',
  DELIVERY_APPROVED: 'اعتماد تسليم نهائي',
  DELIVERY_PROOF_CORRECTION_REQUESTED: 'طلب تصحيح إثبات تسليم',
  DELIVERY_FAILED: 'تسجيل تعذّر تسليم',
  DELIVERY_DEFERRED: 'تأجيل تسليم',
  DELIVERY_RETURN_REQUESTED: 'طلب إعادة جهاز',
  DELIVERY_RETURN_ACCEPTED: 'قبول إعادة جهاز',
  DELIVERY_RETRIED: 'إعادة محاولة تسليم',
  ACTIVITY_CREATED: 'إضافة نشاط مشروع',
  ACTIVITY_UPDATED: 'تعديل نشاط مشروع',
  ACTIVITY_EVIDENCE_ADDED: 'إضافة شاهد نشاط',
  ACTIVITY_EVIDENCE_VIEWED: 'عرض شاهد نشاط',
  APPLICATION_ACCEPTED: 'قبول طلب انضمام جمعية',
  APPLICATION_REJECTED: 'رفض طلب انضمام جمعية',
  APPLICATION_LICENSE_VIEWED: 'عرض ترخيص جمعية',
  ASSOCIATION_CREATED: 'تفعيل جمعية جديدة',
  ASSOCIATION_UPDATED: 'تعديل بيانات جمعية',
  ASSOCIATION_SETTINGS_UPDATED: 'تحديث إعدادات جمعية',
  ASSOCIATION_PASSWORD_RESET: 'إعادة تعيين كلمة مرور جمعية',
  DELEGATE_CREATED: 'إضافة مندوب',
  DELEGATE_UPDATED: 'تعديل بيانات مندوب',
  DELEGATE_ACTIVATED: 'تفعيل مندوب',
  DELEGATE_DEACTIVATED: 'إيقاف مندوب',
  DELEGATE_CODE_REGENERATED: 'إعادة توليد رمز دخول مندوب',
  DEVICE_UPDATED: 'تعديل بيانات جهاز',
  DEVICE_MARKED_DAMAGED: 'تسجيل جهاز تالف',
  REFERENCE_VALUE_CREATED: 'إضافة قيمة مرجعية',
  LOGIN_SUCCESS: 'تسجيل دخول',
  LOGOUT: 'تسجيل خروج',
  PASSWORD_CHANGED: 'تغيير كلمة مرور',
  PASSWORD_RESET_REQUESTED: 'طلب إعادة تعيين كلمة مرور',
  PASSWORD_RESET_COMPLETED: 'إتمام إعادة تعيين كلمة مرور',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll('_', ' ').toLowerCase();
}

