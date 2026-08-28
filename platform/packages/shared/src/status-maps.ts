/**
 * تعريب العرض فقط — منفصل تمامًا عن قيم enum الداخلية المستقرة في
 * enums.ts (كما تطلب القاعدة: "Arabic UI labels منفصلة عن internal
 * enum values"). لا تُستخدم هذه النصوص كمفاتيح مقارنة منطقية في أي
 * مكان — فقط للعرض في apps/web.
 */
import {
  AccountRole,
  AccountStatus,
  ApplicationStatus,
  AssociationStatus,
  BeneficiaryReviewStatus,
  DeliveryFailureReason,
  DeliveryStatus,
  DeviceStatus,
  LegacyBeneficiaryStatus,
  LocationSource,
  NeedDecisionStatus,
  DeviceType,
  NeedFulfillmentStatus,
  ReceiptBatchStatus,
} from './enums';

export const ACCOUNT_ROLE_LABELS_AR: Record<AccountRole, string> = {
  [AccountRole.ADMIN]: 'مدير النظام',
  [AccountRole.ASSOCIATION]: 'جمعية',
  [AccountRole.DELEGATE]: 'مندوب',
};

export const ACCOUNT_STATUS_LABELS_AR: Record<AccountStatus, string> = {
  [AccountStatus.ACTIVE]: 'نشط',
  [AccountStatus.SUSPENDED]: 'موقوف',
};

export const ASSOCIATION_STATUS_LABELS_AR: Record<AssociationStatus, string> = {
  [AssociationStatus.ACTIVE]: 'نشطة',
  [AssociationStatus.INACTIVE]: 'غير نشطة',
};

export const APPLICATION_STATUS_LABELS_AR: Record<ApplicationStatus, string> = {
  [ApplicationStatus.UNDER_REVIEW]: 'قيد المراجعة',
  [ApplicationStatus.ACCEPTED]: 'مقبول',
  [ApplicationStatus.REJECTED]: 'مرفوض',
};

export const BENEFICIARY_REVIEW_STATUS_LABELS_AR: Record<BeneficiaryReviewStatus, string> = {
  [BeneficiaryReviewStatus.UNDER_REVIEW]: 'تحت المراجعة',
  [BeneficiaryReviewStatus.APPROVED]: 'معتمد',
  [BeneficiaryReviewStatus.REJECTED]: 'مرفوض',
};

export const LEGACY_BENEFICIARY_STATUS_LABELS_AR: Record<LegacyBeneficiaryStatus, string> = {
  [LegacyBeneficiaryStatus.NEW]: 'جديد',
  [LegacyBeneficiaryStatus.UNDER_REVIEW]: 'تحت المراجعة',
  [LegacyBeneficiaryStatus.APPROVED]: 'معتمد',
  [LegacyBeneficiaryStatus.AWAITING_DEVICES]: 'بانتظار الأجهزة',
  [LegacyBeneficiaryStatus.DELIVERY_IN_PROGRESS]: 'جاري التسليم',
  [LegacyBeneficiaryStatus.DELIVERED]: 'تم التسليم',
  [LegacyBeneficiaryStatus.CANCELLED]: 'ملغي',
};

export const NEED_DECISION_STATUS_LABELS_AR: Record<NeedDecisionStatus, string> = {
  [NeedDecisionStatus.PENDING]: 'بانتظار المراجعة',
  [NeedDecisionStatus.APPROVED]: 'معتمد',
  [NeedDecisionStatus.REJECTED]: 'مرفوض',
};

export const NEED_FULFILLMENT_STATUS_LABELS_AR: Record<NeedFulfillmentStatus, string> = {
  [NeedFulfillmentStatus.APPROVED_ENTITLEMENT]: 'استحقاق معتمد',
  [NeedFulfillmentStatus.AWAITING_DEVICE]: 'بانتظار توفر الجهاز',
  [NeedFulfillmentStatus.DEVICE_READY]: 'جهاز جاهز',
  [NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT]: 'بانتظار تعيين مندوب',
  [NeedFulfillmentStatus.ASSIGNED_TO_DELEGATE_PENDING]: 'معيّن للمندوب — بانتظار التنفيذ',
  [NeedFulfillmentStatus.OUT_WITH_DELEGATE]: 'خرج مع المندوب',
  [NeedFulfillmentStatus.DEFERRED]: 'مؤجل',
  [NeedFulfillmentStatus.AWAITING_RETURN_CONFIRMATION]: 'بانتظار تأكيد الإرجاع',
  [NeedFulfillmentStatus.RETURNED_TO_ASSOCIATION_WAREHOUSE]: 'أعيد للجمعية/المستودع',
  [NeedFulfillmentStatus.DELIVERED]: 'تم التسليم',
};

export const DEVICE_TYPE_LABELS_AR: Record<DeviceType, string> = {
  [DeviceType.REFRIGERATOR]: 'ثلاجة',
  [DeviceType.OVEN]: 'فرن',
  [DeviceType.WASHING_MACHINE]: 'غسالة',
};

export const DEVICE_STATUS_LABELS_AR: Record<DeviceStatus, string> = {
  [DeviceStatus.WAREHOUSE]: 'بالمستودع',
  [DeviceStatus.ALLOCATED]: 'مخصص',
  [DeviceStatus.WITH_DELEGATE]: 'مع المندوب',
  [DeviceStatus.DELIVERED]: 'تم التسليم',
  [DeviceStatus.DAMAGED]: 'تالف',
  [DeviceStatus.WITH_BENEFICIARY_PENDING_APPROVAL]: 'لدى المستفيد — بانتظار الاعتماد',
};

export const DELIVERY_STATUS_LABELS_AR: Record<DeliveryStatus, string> = {
  [DeliveryStatus.NOT_STARTED]: 'لم يبدأ',
  [DeliveryStatus.PREPARING]: 'جاري التجهيز',
  [DeliveryStatus.OUT_WITH_DELEGATE]: 'خرج مع المندوب',
  [DeliveryStatus.DELIVERED]: 'تم التسليم',
  [DeliveryStatus.DELIVERY_FAILED]: 'تعذر التسليم',
  [DeliveryStatus.PENDING_DELEGATE_ACKNOWLEDGEMENT]: 'بانتظار استلام المندوب للعهدة',
  [DeliveryStatus.PENDING_DELIVERY_APPROVAL]: 'بانتظار اعتماد التسليم',
  [DeliveryStatus.DEFERRED]: 'مؤجل',
  [DeliveryStatus.PENDING_RETURN_APPROVAL]: 'بانتظار تأكيد الإرجاع',
  [DeliveryStatus.RETURNED]: 'أعيد للمستودع',
  [DeliveryStatus.DELIVERY_CLOSED]: 'أغلق التسليم نهائيًا',
};

export const DELIVERY_FAILURE_REASON_LABELS_AR: Record<DeliveryFailureReason, string> = {
  [DeliveryFailureReason.COULD_NOT_REACH]: 'لم يتم التواصل',
  [DeliveryFailureReason.NO_ANSWER]: 'لا يرد',
  [DeliveryFailureReason.POSTPONEMENT_REQUESTED]: 'طلب تأجيل',
  [DeliveryFailureReason.INCORRECT_ADDRESS]: 'العنوان غير صحيح',
  [DeliveryFailureReason.NOT_FOUND]: 'غير موجود',
  [DeliveryFailureReason.RECEIPT_REFUSED]: 'رفض الاستلام',
};

export const RECEIPT_BATCH_STATUS_LABELS_AR: Record<ReceiptBatchStatus, string> = {
  [ReceiptBatchStatus.DRAFT]: 'مسودة',
  [ReceiptBatchStatus.AWAITING_ASSOCIATION_CONFIRMATION]: 'بانتظار تأكيد الجمعية',
  [ReceiptBatchStatus.RECEIVED_COMPLETE]: 'تم الاستلام كاملًا',
  [ReceiptBatchStatus.RECEIVED_WITH_DISCREPANCIES]: 'تم الاستلام مع فروقات',
};

export const LOCATION_SOURCE_LABELS_AR: Record<LocationSource, string> = {
  [LocationSource.MAP]: 'خريطة',
  [LocationSource.CURRENT_LOCATION]: 'الموقع الحالي',
  [LocationSource.IMPORT]: 'استيراد',
  [LocationSource.MANUAL]: 'يدوي',
};

/**
 * جداول الانتقال المسموحة — نسخة TypeScript حرفية من StateRules.gs
 * (BENEFICIARY_REVIEW_TRANSITIONS_ وNEED_DECISION_TRANSITIONS_)، تُستخدم
 * لاحقًا في NODE-3 عند نقل منطق المراجعة الفعلي. لا حلقة ذاتية على
 * الحالات النهائية — نفس القاعدة الحرفية في النظام القديم.
 */
export const BENEFICIARY_REVIEW_TRANSITIONS: Record<BeneficiaryReviewStatus, BeneficiaryReviewStatus[]> = {
  [BeneficiaryReviewStatus.UNDER_REVIEW]: [
    BeneficiaryReviewStatus.UNDER_REVIEW,
    BeneficiaryReviewStatus.APPROVED,
    BeneficiaryReviewStatus.REJECTED,
  ],
  [BeneficiaryReviewStatus.APPROVED]: [],
  [BeneficiaryReviewStatus.REJECTED]: [],
};

export const NEED_DECISION_TRANSITIONS: Record<NeedDecisionStatus, NeedDecisionStatus[]> = {
  [NeedDecisionStatus.PENDING]: [
    NeedDecisionStatus.PENDING,
    NeedDecisionStatus.APPROVED,
    NeedDecisionStatus.REJECTED,
  ],
  [NeedDecisionStatus.APPROVED]: [NeedDecisionStatus.APPROVED],
  [NeedDecisionStatus.REJECTED]: [NeedDecisionStatus.REJECTED],
};
