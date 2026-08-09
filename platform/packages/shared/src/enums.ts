/**
 * قيم enum داخلية مستقرة بالإنجليزية — لا تتغيّر أبدًا حتى لو تغيّر
 * النص العربي المعروض. المرجع الحرفي لكل حالة هنا هو StateRules.gs
 * وConfig.gs على الفرع القديم claude/code-index-review-kz5k4u
 * (baseline: daa5e6d5d98b3b724bd867ce1d9117ded14db3f9). راجع
 * platform/docs/STATE_MAPPING.md للتفصيل الكامل ومصدر كل قيمة.
 */

export enum AccountRole {
  ADMIN = 'ADMIN',
  ASSOCIATION = 'ASSOCIATION',
  DELEGATE = 'DELEGATE',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum AuthCredentialType {
  EMAIL_PASSWORD = 'EMAIL_PASSWORD',
  DELEGATE_ACCESS_CODE = 'DELEGATE_ACCESS_CODE',
}

export enum AssociationStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum ApplicationStatus {
  UNDER_REVIEW = 'UNDER_REVIEW',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/** حالة مراجعة المستفيد نفسه — StateRules.gs BENEFICIARY_REVIEW_STATUSES. */
export enum BeneficiaryReviewStatus {
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** حالة الحقل القديم "حالة المستفيد" (Config.gs BENEFICIARY_STATUSES) — تُحفظ للقراءة التاريخية فقط، ليست Source of Truth جديدًا. */
export enum LegacyBeneficiaryStatus {
  NEW = 'NEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  AWAITING_DEVICES = 'AWAITING_DEVICES',
  DELIVERY_IN_PROGRESS = 'DELIVERY_IN_PROGRESS',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

/** حالة قرار احتياج واحد — StateRules.gs NEED_DECISION_STATUSES. */
export enum NeedDecisionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** حالة تنفيذ احتياج معتمد — StateRules.gs NEED_FULFILLMENT_STATUSES (عشر حالات). */
export enum NeedFulfillmentStatus {
  APPROVED_ENTITLEMENT = 'APPROVED_ENTITLEMENT',
  AWAITING_DEVICE = 'AWAITING_DEVICE',
  DEVICE_READY = 'DEVICE_READY',
  AWAITING_DELEGATE_ASSIGNMENT = 'AWAITING_DELEGATE_ASSIGNMENT',
  ASSIGNED_TO_DELEGATE_PENDING = 'ASSIGNED_TO_DELEGATE_PENDING',
  OUT_WITH_DELEGATE = 'OUT_WITH_DELEGATE',
  DEFERRED = 'DEFERRED',
  AWAITING_RETURN_CONFIRMATION = 'AWAITING_RETURN_CONFIRMATION',
  RETURNED_TO_ASSOCIATION_WAREHOUSE = 'RETURNED_TO_ASSOCIATION_WAREHOUSE',
  DELIVERED = 'DELIVERED',
}

/** أنواع الاحتياج الجديدة المعتمدة فقط — Config.gs NEW_NEED_DEVICE_TYPES. */
export enum NeedDeviceType {
  REFRIGERATOR = 'REFRIGERATOR',
  OVEN = 'OVEN',
  WASHING_MACHINE = 'WASHING_MACHINE',
}

/** حالة الجهاز المادي — StateRules.gs DEVICE_STATUS_TRANSITIONS_. */
export enum DeviceStatus {
  WAREHOUSE = 'WAREHOUSE',
  ALLOCATED = 'ALLOCATED',
  WITH_DELEGATE = 'WITH_DELEGATE',
  DELIVERED = 'DELIVERED',
  DAMAGED = 'DAMAGED',
}

/** حالة تسليم المستفيد (المسار التشغيلي) — StateRules.gs DELIVERY_STATUS_TRANSITIONS_، تُستخدم أيضًا كحالة delivery_missions/delivery_attempts. */
export enum DeliveryStatus {
  NOT_STARTED = 'NOT_STARTED',
  PREPARING = 'PREPARING',
  OUT_WITH_DELEGATE = 'OUT_WITH_DELEGATE',
  DELIVERED = 'DELIVERED',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
}

/** أسباب تعذّر التسليم — Config.gs FAILED_REASONS. */
export enum DeliveryFailureReason {
  COULD_NOT_REACH = 'COULD_NOT_REACH',
  NO_ANSWER = 'NO_ANSWER',
  POSTPONEMENT_REQUESTED = 'POSTPONEMENT_REQUESTED',
  INCORRECT_ADDRESS = 'INCORRECT_ADDRESS',
  NOT_FOUND = 'NOT_FOUND',
  RECEIPT_REFUSED = 'RECEIPT_REFUSED',
}

/** حالة محضر استلام الأجهزة — StateRules.gs RECEIPT_BATCH_TRANSITIONS_. */
export enum ReceiptBatchStatus {
  DRAFT = 'DRAFT',
  AWAITING_ASSOCIATION_CONFIRMATION = 'AWAITING_ASSOCIATION_CONFIRMATION',
  RECEIVED_COMPLETE = 'RECEIVED_COMPLETE',
  RECEIVED_WITH_DISCREPANCIES = 'RECEIVED_WITH_DISCREPANCIES',
}

/** مصدر تحديد الموقع الجغرافي — Config.gs LOCATION_SOURCES. */
export enum LocationSource {
  MAP = 'MAP',
  CURRENT_LOCATION = 'CURRENT_LOCATION',
  IMPORT = 'IMPORT',
  MANUAL = 'MANUAL',
}

/** أنواع البيانات المرجعية (reference_values.type) — ReferenceData.gs. */
export enum ReferenceValueType {
  REGION = 'REGION',
  CITY = 'CITY',
  ASSOCIATION_CATEGORY = 'ASSOCIATION_CATEGORY',
  SOCIAL_STATUS = 'SOCIAL_STATUS',
  DEVICE_TYPE = 'DEVICE_TYPE',
}

/** فئات الملفات الخاصة (files.category) — يستبدل Google Drive metadata. */
export enum FileCategory {
  ASSOCIATION_LICENSE = 'ASSOCIATION_LICENSE',
  RECEIPT_QUANTITY_PHOTO = 'RECEIPT_QUANTITY_PHOTO',
  RECEIPT_SIGNATURE_PHOTO = 'RECEIPT_SIGNATURE_PHOTO',
  RECEIPT_DAMAGE_PHOTO = 'RECEIPT_DAMAGE_PHOTO',
  DELIVERY_PROOF_PHOTO = 'DELIVERY_PROOF_PHOTO',
  DELIVERY_RECIPIENT_SIGNATURE = 'DELIVERY_RECIPIENT_SIGNATURE',
  ACTIVITY_EVIDENCE = 'ACTIVITY_EVIDENCE',
}

/** حالة تخصيص جهاز لاستحقاق (device_allocations.status). */
export enum DeviceAllocationStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
}

/** حالة idempotency_keys.status. */
export enum IdempotencyKeyStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** أنواع أحداث outbox_events — قائمة أولية فقط، تُوسَّع مستقبلًا (لا Notification Engine كامل في NODE-0). */
export enum OutboxEventType {
  BENEFICIARY_APPROVED = 'BENEFICIARY_APPROVED',
  RECEIPT_CONFIRMED = 'RECEIPT_CONFIRMED',
  STOCK_INCREASED = 'STOCK_INCREASED',
}

export enum OutboxEventStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}
