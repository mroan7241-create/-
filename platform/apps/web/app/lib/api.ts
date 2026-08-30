const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

export interface ApiErrorBody {
  ok: false;
  error: { code: string; message: string; correlationId?: string };
}

export class ApiClientError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** كل الطلبات تُرسل مع credentials:'include' — الكوكي alzad_session هو الحامل الوحيد للجلسة، لا localStorage/sessionStorage إطلاقًا. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    throw new ApiClientError(err?.error?.code ?? 'UNKNOWN_ERROR', err?.error?.message ?? 'حدث خطأ غير متوقع');
  }
  return body as T;
}

/**
 * نفس apiFetch لكن بحمولة multipart/form-data — لا نضبط Content-Type
 * يدويًا إطلاقًا (المتصفح يضبطه مع boundary الصحيح).
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    throw new ApiClientError(err?.error?.code ?? 'UNKNOWN_ERROR', err?.error?.message ?? 'حدث خطأ غير متوقع');
  }
  return body as T;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReferenceData {
  regions: string[];
  citiesByRegion: Record<string, string[]>;
  associationCategories: string[];
  associationSectors: string[];
  /** NODE-3: قائمة الحالات الاجتماعية المعتمدة — يعيدها الخادم أصلًا منذ NODE-1. */
  socialStatuses: string[];
  deviceTypes: string[];
  deviceSpecsByType: Record<string, string[]>;
  suppliers: string[];
  differenceReasons: string[];
  receiverTitles: string[];
  applicationQuestions: { key: string; label: string }[];
  pledgeText: string;
  ready: boolean;
}

export function getReferenceData(): Promise<ReferenceData> {
  return apiFetch<ReferenceData>('/reference-values');
}

export type ReferenceValueType =
  | 'REGION'
  | 'CITY'
  | 'ASSOCIATION_CATEGORY'
  | 'SOCIAL_STATUS'
  | 'DEVICE_TYPE'
  | 'ASSOCIATION_SECTOR'
  | 'DEVICE_SPEC'
  | 'SUPPLIER'
  | 'DIFFERENCE_REASON'
  | 'RECEIVER_TITLE';

export const REFERENCE_VALUE_TYPE_LABELS: Record<ReferenceValueType, string> = {
  REGION: 'منطقة',
  CITY: 'مدينة',
  ASSOCIATION_CATEGORY: 'تصنيف جمعية',
  SOCIAL_STATUS: 'حالة اجتماعية',
  DEVICE_TYPE: 'نوع جهاز',
  ASSOCIATION_SECTOR: 'قطاع جمعية',
  DEVICE_SPEC: 'مواصفة جهاز',
  SUPPLIER: 'مورّد',
  DIFFERENCE_REASON: 'سبب فرق',
  RECEIVER_TITLE: 'صفة المستلم',
};

/** الأنواع التي تشترط اختيار أب (REGION لِCITY، DEVICE_TYPE لِDEVICE_SPEC) — يطابق REQUIRED_PARENT_TYPE في الخادم. */
export const REFERENCE_VALUE_PARENT_TYPE: Partial<Record<ReferenceValueType, ReferenceValueType>> = {
  CITY: 'REGION',
  DEVICE_SPEC: 'DEVICE_TYPE',
};

export function addReferenceValue(input: { type: ReferenceValueType; value: string; parentValue?: string }): Promise<{ ok: true; id: string; value: string }> {
  return apiFetch(`/reference-values`, { method: 'POST', body: JSON.stringify({ ...input, opId: newOpId() }) });
}

export type ApplicationStatus = 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED';

/** الحالات الثلاث الوحيدة الموجودة فعلًا في النظام القديم — لا حالات إضافية. */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  UNDER_REVIEW: 'قيد المراجعة',
  ACCEPTED: 'مقبول',
  REJECTED: 'مرفوض',
};

export interface ApplicationSummary {
  id: string;
  publicCode: string;
  name: string;
  category: string | null;
  sector: string | null;
  region: string;
  city: string;
  phone: string;
  email: string | null;
  contactName: string;
  notes: string | null;
  licenseNumber: string | null;
  licenseExpiryDate: string | null;
  status: ApplicationStatus;
  rejectReason: string | null;
  resultingAssociationId: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewer: string | null;
  answers: { key: string; label: string; value: boolean | null }[];
  yesCount: number;
  totalQuestions: number;
  /** مؤشّر عرض فقط («7/8») — لا يدخل في أي قرار قبول/رفض إطلاقًا. */
  scoreLabel: string;
  hasLicenseFile: boolean;
  pledgeAccepted: boolean;
  pledgedAt: string | null;
  eligibilityStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'NEEDS_INFO';
  eligibilityNotes: string | null;
  evaluationScore: number | null;
  evaluationRank: number | null;
  selectionList: 'NONE' | 'MAIN' | 'RESERVE';
}

export interface ApplicationPublicStatus {
  ok: true;
  found: boolean;
  id?: string;
  status?: ApplicationStatus;
  submittedAt?: string;
  rejectionReason?: string;
}

export interface ReviewResult {
  ok: true;
  alreadyProcessed?: boolean;
  associationId?: string;
  associationPublicCode?: string;
  temporaryPassword?: string | null;
  temporaryPasswordPreviouslyIssued?: boolean;
}

export interface AssociationSummary {
  id: string;
  publicCode: string;
  name: string;
  category: string | null;
  region: string;
  city: string;
  phone: string | null;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  beneficiariesCount: number;
  devicesCount: number;
  delegatesCount: number;
}

export interface CurrentUser {
  id: string;
  publicCode: string;
  name: string;
  role: 'ADMIN' | 'ASSOCIATION' | 'DELEGATE';
  associationId: string | null;
  mustChangePassword: boolean;
}

export function getMe(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>('/auth/me');
}

export function logout(): Promise<{ ok: true }> {
  return apiFetch('/auth/logout', { method: 'POST' });
}

// ================================================================
// NODE-3 — المستفيدون والاحتياجات
// ================================================================

export type BeneficiaryReviewStatus = 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
export type NeedDecisionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type DeviceType = 'REFRIGERATOR' | 'OVEN' | 'WASHING_MACHINE';

/** تعريب حالات مراجعة المستفيد — مطابق لِ`StateRules.gs::BENEFICIARY_REVIEW_STATUSES`. */
export const BENEFICIARY_REVIEW_STATUS_LABELS: Record<BeneficiaryReviewStatus, string> = {
  UNDER_REVIEW: 'تحت المراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
};

export const NEED_DECISION_STATUS_LABELS: Record<NeedDecisionStatus, string> = {
  PENDING: 'بانتظار المراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
};

/** الأنواع الثلاثة المعتمدة حصرًا لاحتياج جديد (`Config.gs::NEW_NEED_DEVICE_TYPES`). */
export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  REFRIGERATOR: 'ثلاجة',
  OVEN: 'فرن',
  WASHING_MACHINE: 'غسالة',
};

export const DEVICE_TYPES: DeviceType[] = ['REFRIGERATOR', 'OVEN', 'WASHING_MACHINE'];

/** BEN-013 — صف استيراد واحد، يطابق BeneficiaryImportRowDto (بلا opId — على مستوى الدفعة كاملة). */
export interface BeneficiaryImportRow {
  name: string;
  region: string;
  city: string;
  district: string;
  phone: string;
  phone2?: string;
  familyCount: number;
  socialSecurity?: boolean;
  socialStatus: string;
  income?: number;
  notes?: string;
  lat?: number | null;
  lng?: number | null;
  deviceTypes: DeviceType[];
}

export type BeneficiaryImportResult =
  | { ok: true; createdCount: number; beneficiaryIds: string[]; replayed: boolean }
  | { ok: false; errors: { row: number; message: string }[] };

export function importBeneficiaries(input: { associationId?: string; acceptedPledge: boolean; rows: BeneficiaryImportRow[] }): Promise<BeneficiaryImportResult> {
  return apiFetch(`/beneficiaries/import`, { method: 'POST', body: JSON.stringify({ ...input, opId: newOpId() }) });
}

/** BEN-014 — معاينة ملف Excel فقط، بلا أي كتابة (يوازي inspectBeneficiaryExcel). */
export interface XlsxPreviewRow {
  row: number;
  raw: Record<string, string>;
  valid: boolean;
  error?: string;
  parsed?: BeneficiaryImportRow;
}

export function previewXlsxImport(file: File): Promise<{ ok: true; headers: string[]; rows: XlsxPreviewRow[] }> {
  const form = new FormData();
  form.set('file', file);
  return apiUpload('/beneficiaries/import/preview-xlsx', form);
}

/** يوازي downloadImportTemplateXlsx القديمة — يبدأ تنزيل قالب Excel حقيقي من الخادم. */
export async function downloadXlsxTemplate(): Promise<void> {
  const res = await fetch(`${API_BASE}/beneficiaries/import/template.xlsx`, { credentials: 'include' });
  if (!res.ok) throw new ApiClientError('DOWNLOAD_FAILED', 'تعذّر تنزيل القالب.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'beneficiary-import-template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

export interface BeneficiaryNeed {
  id: string;
  publicCode: string;
  deviceType: DeviceType;
  decisionStatus: NeedDecisionStatus;
  rejectReason: string | null;
  fulfillmentStatus: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface BeneficiarySummary {
  id: string;
  publicCode: string;
  associationId: string;
  name: string;
  region: string;
  city: string;
  district: string | null;
  address: string;
  phone: string;
  phone2: string | null;
  familyCount: number;
  socialSecurity: boolean;
  socialStatus: string;
  income: number;
  /** `address`/`landmark`: حقول قراءة تاريخية فقط — لا تُرسَل في أي طلب حفظ. */
  landmark: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  locationSource: string | null;
  locationUpdatedAt: string | null;
  /** مشتقة خادميًا: الموقع مؤكَّد ⇔ الإحداثيتان موجودتان معًا. */
  locationConfirmed: boolean;
  reviewStatus: BeneficiaryReviewStatus;
  beneficiaryRejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  needsTotal: number;
  needsPending: number;
  needsApproved: number;
  needsRejected: number;
}

export interface BeneficiaryDetail extends Omit<BeneficiarySummary, 'needsTotal' | 'needsPending' | 'needsApproved' | 'needsRejected'> {
  needs: BeneficiaryNeed[];
}

/**
 * تنبيه "مطابق محتمل" (نفس الاسم والمدينة داخل نفس الجمعية) — **غير حاجب**:
 * الحفظ نجح فعلًا، ويُرفَق التنبيه ليعرضه المستخدم ويقرّر. يحمل الرمز العام
 * البشري فقط، بلا أي معرّف داخلي.
 */
export interface PossibleDuplicateWarning {
  publicCode: string;
  message: string;
}

export interface SaveResult {
  ok: true;
  beneficiaryId?: string;
  replayed?: boolean;
  possibleDuplicate?: PossibleDuplicateWarning;
}

export interface BulkReviewResponse {
  ok: true;
  success: { beneficiaryId: string; approvedCount: number; rejectedCount: number }[];
  failed: { beneficiaryId: string; code: string; error: string }[];
  allocationWarnings?: { associationId: string; error: string }[];
}

/** معرّف عملية فريد لكل كتابة — أساس الـidempotency على الخادم. */
export function newOpId(): string {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================
// NODE-4 — محاضر استلام دفعات الأجهزة + مخزون الأجهزة
// ============================================================
export type ReceiptBatchStatus = 'DRAFT' | 'AWAITING_ASSOCIATION_CONFIRMATION' | 'RECEIVED_COMPLETE' | 'RECEIVED_WITH_DISCREPANCIES';

export const RECEIPT_BATCH_STATUS_LABELS: Record<ReceiptBatchStatus, string> = {
  DRAFT: 'مسودة',
  AWAITING_ASSOCIATION_CONFIRMATION: 'بانتظار تأكيد الجمعية',
  RECEIVED_COMPLETE: 'تم الاستلام كاملًا',
  RECEIVED_WITH_DISCREPANCIES: 'تم الاستلام مع فروقات',
};

export interface ReceiptItemSummary {
  id: string;
  publicCode: string;
  deviceType: DeviceType | null;
  spec: string | null;
  sentQty: number;
  receivedQty: number;
  damagedQty: number;
  missingQty: number;
  differenceReason: string | null;
  differenceNotes: string | null;
  damagePhotos: { id: string }[];
  damagePhotoCount: number;
}

interface ReceiptBatchCore {
  id: string;
  publicCode: string;
  associationId: string;
  supplierName: string;
  sentDate: string | null;
  status: ReceiptBatchStatus;
  notes: string | null;
  receiverName: string | null;
  receiverTitle: string | null;
  confirmedAt: string | null;
  hasQuantityPhoto: boolean;
  hasSignature: boolean;
  createdAt: string;
  updatedAt: string;
}

/** NODE-4.1 — صف قائمة خفيف: بلا بنود/صور تلف، `itemCount` فقط (`GET /receipts`). */
export interface ReceiptBatchListItem extends ReceiptBatchCore {
  itemCount: number;
}

/** تفاصيل كاملة — بنود+كميات+صور تلف، تُجلَب فقط عند فتح محضر واحد (`GET /receipts/:id`). NODE-4.2: رقم مستند + إثبات إداري + محضر/ختم الجمعية. */
export interface ReceiptBatchDetail extends ReceiptBatchCore {
  documentNumber: string | null;
  hasAdminProof: boolean;
  hasAssociationReport: boolean;
  items: ReceiptItemSummary[];
}

export function listReceiptBatches(params: { page?: number; pageSize?: number; associationId?: string; status?: ReceiptBatchStatus } = {}): Promise<Paginated<ReceiptBatchListItem>> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.associationId) q.set('associationId', params.associationId);
  if (params.status) q.set('status', params.status);
  return apiFetch(`/receipts?${q.toString()}`);
}

export function getReceiptBatch(id: string): Promise<ReceiptBatchDetail> {
  return apiFetch(`/receipts/${id}`);
}

export interface CreateReceiptItemInput {
  deviceType: DeviceType;
  spec: string;
  sentQty: number;
}

export interface CreateReceiptBatchInput {
  associationId: string;
  supplierName: string;
  sentDate: string;
  notes?: string;
  /** NODE-4.2 — رقم مستند مرجعي اختياري. */
  documentNumber?: string;
  items: CreateReceiptItemInput[];
  /** NODE-4.2 — إثبات شراء إداري اختياري (PDF/JPEG/PNG/WEBP، 8 MiB). */
  adminProofFile?: File;
}

export function createReceiptBatch(input: CreateReceiptBatchInput): Promise<{ ok: true; id: string }> {
  const form = new FormData();
  form.set('associationId', input.associationId);
  form.set('supplierName', input.supplierName);
  form.set('sentDate', input.sentDate);
  if (input.notes) form.set('notes', input.notes);
  if (input.documentNumber) form.set('documentNumber', input.documentNumber);
  form.set('items', JSON.stringify(input.items));
  form.set('opId', newOpId());
  if (input.adminProofFile) form.set('adminProofFile', input.adminProofFile);
  return apiUpload(`/receipts`, form);
}

export function sendReceiptBatch(id: string): Promise<{ ok: true }> {
  return apiFetch(`/receipts/${id}/send`, { method: 'POST', body: JSON.stringify({ opId: newOpId() }) });
}

export interface ConfirmReceiptItemInput {
  itemId: string;
  receivedQty: number;
  damagedQty: number;
  missingQty: number;
  differenceReason?: string;
  differenceNotes?: string;
}

export interface ConfirmReceiptBatchInput {
  receiverTitle: string;
  items: ConfirmReceiptItemInput[];
  damagePhotoLinks: string[][];
  quantityPhoto: File;
  signatureImage: File;
  damagePhotos: File[];
  /** NODE-4.2 — محضر/ختم الجمعية اختياري افتراضيًا (PDF/JPEG/PNG/WEBP، 8 MiB) — إلزامه عبر system_settings. */
  associationReportFile?: File;
}

export function confirmReceiptBatch(id: string, input: ConfirmReceiptBatchInput): Promise<{ ok: true; id: string; status: ReceiptBatchStatus }> {
  const form = new FormData();
  form.set('receiverTitle', input.receiverTitle);
  form.set('opId', newOpId());
  form.set('items', JSON.stringify(input.items));
  form.set('damagePhotoLinks', JSON.stringify(input.damagePhotoLinks));
  form.set('quantityPhoto', input.quantityPhoto);
  form.set('signatureImage', input.signatureImage);
  for (const photo of input.damagePhotos) form.append('damagePhotos', photo);
  if (input.associationReportFile) form.set('associationReportFile', input.associationReportFile);
  return apiUpload(`/receipts/${id}/confirm`, form);
}

export function getReceiptEvidenceUrl(batchId: string, evidenceType: 'quantity' | 'signature' | 'damage' | 'adminProof' | 'report', damagePhotoId?: string): Promise<{ url: string }> {
  const q = damagePhotoId ? `?damagePhotoId=${encodeURIComponent(damagePhotoId)}` : '';
  return apiFetch(`/receipts/${batchId}/evidence/${evidenceType}${q}`);
}

export type DeviceStatus = 'WAREHOUSE' | 'ALLOCATED' | 'WITH_DELEGATE' | 'DELIVERED' | 'DAMAGED';

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  WAREHOUSE: 'بالمستودع',
  ALLOCATED: 'مخصَّص',
  WITH_DELEGATE: 'مع المندوب',
  DELIVERED: 'تم التسليم',
  DAMAGED: 'تالف',
};

export interface DeviceUnitSummary {
  id: string;
  publicCode: string;
  associationId: string;
  deviceType: string | null;
  spec: string | null;
  status: DeviceStatus;
  currentLocationType: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}

export function listDeviceUnits(params: { page?: number; pageSize?: number; associationId?: string; deviceType?: DeviceType; status?: DeviceStatus } = {}): Promise<Paginated<DeviceUnitSummary>> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.associationId) q.set('associationId', params.associationId);
  if (params.deviceType) q.set('deviceType', params.deviceType);
  if (params.status) q.set('status', params.status);
  return apiFetch(`/inventory/devices?${q.toString()}`);
}

export function getDeviceUnit(id: string): Promise<DeviceUnitSummary & { receiptBatchId: string | null; receiptBatchPublicCode: string | null }> {
  return apiFetch(`/inventory/devices/${id}`);
}

/** DEV-005/006 (نطاق مصغَّر) — تصحيح نوع/مواصفة جهاز لا يزال بالمستودع فقط. */
export function updateDeviceUnit(id: string, input: { deviceType?: DeviceType; spec?: string }): Promise<{ ok: true; id: string }> {
  return apiFetch(`/inventory/devices/${id}`, { method: 'PATCH', body: JSON.stringify({ ...input, opId: newOpId() }) });
}

export function markDeviceDamaged(id: string, notes?: string): Promise<{ ok: true; id: string }> {
  return apiFetch(`/inventory/devices/${id}/mark-damaged`, { method: 'POST', body: JSON.stringify({ notes, opId: newOpId() }) });
}

// ============================================================
// NODE-6 — المناديب + الإسناد + مهام التسليم
// ============================================================
export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = { ACTIVE: 'نشط', SUSPENDED: 'معطَّل' };

export interface DelegateSummary {
  id: string;
  publicCode: string;
  name: string;
  phone: string | null;
  status: AccountStatus;
  associationId: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export function listDelegates(params: { page?: number; pageSize?: number; search?: string; associationId?: string; status?: AccountStatus } = {}): Promise<Paginated<DelegateSummary>> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.search) q.set('search', params.search);
  if (params.associationId) q.set('associationId', params.associationId);
  if (params.status) q.set('status', params.status);
  return apiFetch(`/delegates?${q.toString()}`);
}

export function getDelegate(id: string): Promise<DelegateSummary> {
  return apiFetch(`/delegates/${id}`);
}

export function createDelegate(input: { name: string; phone: string; associationId?: string }): Promise<{ ok: true; delegateId: string; accessCode: string | null }> {
  return apiFetch(`/delegates`, { method: 'POST', body: JSON.stringify({ ...input, opId: newOpId() }) });
}

export function updateDelegate(id: string, input: { name?: string; phone?: string }): Promise<{ ok: true }> {
  return apiFetch(`/delegates/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function setDelegateStatus(id: string, status: AccountStatus): Promise<{ ok: true }> {
  return apiFetch(`/delegates/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
}

export function regenerateDelegateCode(id: string): Promise<{ ok: true; accessCode: string }> {
  return apiFetch(`/delegates/${id}/regenerate-code`, { method: 'POST' });
}

export type DeliveryStatus = 'NOT_STARTED' | 'PREPARING' | 'PENDING_DELEGATE_ACKNOWLEDGEMENT' | 'OUT_WITH_DELEGATE' | 'DELIVERED' | 'DELIVERY_FAILED' | 'RETURNED' | 'PENDING_DELIVERY_APPROVAL' | 'DEFERRED' | 'PENDING_RETURN_APPROVAL' | 'DELIVERY_CLOSED';

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  NOT_STARTED: 'لم يبدأ',
  PREPARING: 'جاري التجهيز',
  PENDING_DELEGATE_ACKNOWLEDGEMENT: 'بانتظار تأكيد استلام المندوب',
  OUT_WITH_DELEGATE: 'مع المندوب',
  DELIVERED: 'تم التسليم',
  DELIVERY_FAILED: 'تعذّر التسليم',
  RETURNED: 'أعيد للمستودع',
  PENDING_DELIVERY_APPROVAL: 'بانتظار اعتماد التسليم',
  DEFERRED: 'مؤجل',
  PENDING_RETURN_APPROVAL: 'بانتظار تأكيد الاستلام الفعلي من الجمعية',
  DELIVERY_CLOSED: 'أغلق التسليم نهائيًا',
};

export type DeliveryFailureReason = 'COULD_NOT_REACH' | 'NO_ANSWER' | 'POSTPONEMENT_REQUESTED' | 'INCORRECT_ADDRESS' | 'NOT_FOUND' | 'RECEIPT_REFUSED';

export const DELIVERY_FAILURE_REASON_LABELS: Record<DeliveryFailureReason, string> = {
  COULD_NOT_REACH: 'لم يتم التواصل',
  NO_ANSWER: 'لا يرد',
  POSTPONEMENT_REQUESTED: 'طلب تأجيل',
  INCORRECT_ADDRESS: 'العنوان غير صحيح',
  NOT_FOUND: 'غير موجود',
  RECEIPT_REFUSED: 'رفض الاستلام',
};

export interface DeliveryMissionSummary {
  id: string;
  publicCode: string;
  status: DeliveryStatus;
  assignedAt: string | null;
  scheduledFor: string | null;
  createdAt: string;
  beneficiaryId: string;
  associationId: string;
  delegateAccountId: string | null;
  beneficiary: { name: string; region: string; city: string; district: string | null; phone: string; latitude: number | null; longitude: number | null; needs: Array<{ deviceType: DeviceType }> };
  delegate: { name: string; phone: string | null } | null;
}

export interface DeliveryAttemptSummary {
  id: string;
  publicCode: string;
  status: DeliveryStatus;
  failureReason: DeliveryFailureReason | null;
  notes: string | null;
  attemptedAt: string;
  hasProof: boolean;
}

export interface DeliveryMissionDetail extends DeliveryMissionSummary {
  beneficiary: DeliveryMissionSummary['beneficiary'] & { address: string };
  delegate: (DeliveryMissionSummary['delegate'] & { publicCode: string }) | null;
  attempts: DeliveryAttemptSummary[];
}

export function listDeliveries(params: { page?: number; pageSize?: number; associationId?: string; delegateId?: string; beneficiaryId?: string; status?: DeliveryStatus } = {}): Promise<Paginated<DeliveryMissionSummary>> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.associationId) q.set('associationId', params.associationId);
  if (params.delegateId) q.set('delegateId', params.delegateId);
  if (params.beneficiaryId) q.set('beneficiaryId', params.beneficiaryId);
  if (params.status) q.set('status', params.status);
  return apiFetch(`/deliveries?${q.toString()}`);
}

export function getDelivery(id: string): Promise<DeliveryMissionDetail> {
  return apiFetch(`/deliveries/${id}`);
}

export function assignDelegate(beneficiaryId: string, delegateId: string): Promise<{ ok: true; missionId: string }> {
  return apiFetch(`/deliveries/assign`, { method: 'POST', body: JSON.stringify({ beneficiaryId, delegateId, opId: newOpId() }) });
}

export function confirmHandover(missionId: string): Promise<{ ok: true }> {
  return apiFetch(`/deliveries/${missionId}/confirm-handover`, { method: 'POST', body: JSON.stringify({ opId: newOpId() }) });
}

export function confirmDelivery(missionId: string, proofPhoto: File, recipientSignature: File, acknowledged: true): Promise<{ ok: true; attemptId: string }> {
  const form = new FormData();
  form.set('opId', newOpId());
  form.set('acknowledgement', String(acknowledged));
  form.set('proofPhoto', proofPhoto);
  form.set('recipientSignature', recipientSignature);
  return apiUpload(`/deliveries/${missionId}/confirm`, form);
}

// PASS B workflow clients. Every mutation receives a fresh idempotency key;
// bulk defaults in the UI are advisory and the API remains authoritative.
export type WorkflowRecord = Record<string, unknown> & { id: string };
export function listParticipations(): Promise<WorkflowRecord[]> { return apiFetch('/participations'); }
export function createAgreement(participationId: string, version: number, templateVersion: string) { return apiFetch(`/participations/${participationId}/agreements`, { method: 'POST', body: JSON.stringify({ version, templateVersion, opId: newOpId() }) }); }
export function transitionAgreement(id: string, status: string, signerName?: string) { return apiFetch(`/participations/agreements/${id}/transition`, { method: 'POST', body: JSON.stringify({ status, signerName, opId: newOpId() }) }); }
export function completeParticipationSetup(id: string) { return apiFetch(`/participations/${id}/setup-complete`, { method: 'POST', body: JSON.stringify({ opId: newOpId() }) }); }
export function activateParticipation(id: string) { return apiFetch(`/participations/${id}/activate`, { method: 'POST', body: JSON.stringify({ opId: newOpId() }) }); }
export function listProcurement(): Promise<WorkflowRecord[]> { return apiFetch('/procurement/orders'); }
export function listEscalations(): Promise<WorkflowRecord[]> { return apiFetch('/escalations'); }
export function openEscalation(input: { associationId?: string; beneficiaryId?: string; deliveryMissionId?: string; receiptBatchId?: string; category: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; description: string; requestedAction: string }) { return apiFetch('/escalations', { method: 'POST', body: JSON.stringify({ ...input, opId: newOpId() }) }); }
export function decideEscalation(id: string, decision: 'NEEDS_INFO' | 'APPROVED' | 'REJECTED' | 'RESOLVED', resolution: string) { return apiFetch(`/escalations/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision, resolution, opId: newOpId() }) }); }
export function listNotifications(): Promise<WorkflowRecord[]> { return apiFetch('/notifications'); }
export function listOutboxFailures(): Promise<{ summary: { pending: number; processing: number; failed: number }; items: WorkflowRecord[] }> { return apiFetch('/notifications/outbox'); }
export function markNotificationRead(id: string) { return apiFetch(`/notifications/${id}/read`, { method: 'POST' }); }
export function listSystemSettings(): Promise<Record<string, unknown>> { return apiFetch('/settings'); }
export function saveSystemSetting(key: string, value: unknown) { return apiFetch('/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }); }
export function decideDelivery(missionId: string, stage: 'association' | 'zaad', decision: 'APPROVED' | 'RETURNED_FOR_FIX' | 'REJECTED', reason?: string) { return apiFetch(`/deliveries/${missionId}/${stage}-approval`, { method: 'POST', body: JSON.stringify({ decision, reason, opId: newOpId() }) }); }
export function rescheduleDelivery(missionId: string, reason: string, scheduledFor: string) { return apiFetch(`/deliveries/${missionId}/reschedule`, { method: 'POST', body: JSON.stringify({ reason, scheduledFor, opId: newOpId() }) }); }
export function resumeDelivery(missionId: string) { return apiFetch(`/deliveries/${missionId}/resume`, { method: 'POST', body: JSON.stringify({ opId: newOpId() }) }); }
export function confirmPhysicalReturn(missionId: string, condition: 'GOOD' | 'DAMAGED', notes: string) { return apiFetch(`/deliveries/${missionId}/confirm-return`, { method: 'POST', body: JSON.stringify({ condition, notes, opId: newOpId() }) }); }
export function generateOrganizationClosure(participationId: string) { return apiFetch('/reports/closure/organization/generate', { method: 'POST', body: JSON.stringify({ participationId, opId: newOpId() }) }); }
export function getOrganizationClosure(id: string) { return apiFetch(`/reports/closure/organization/${id}`); }
export function transitionOrganizationClosure(id: string, status: string) { return apiFetch(`/reports/closure/organization/${id}/transition`, { method: 'POST', body: JSON.stringify({ status, opId: newOpId() }) }); }
export function updateOrganizationClosure(id: string, fields: { challenges?: string; lessonsLearned?: string; recommendations?: string; finalNotes?: string }) { return apiFetch(`/reports/closure/organization/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }); }
export function reopenOrganizationClosure(id: string, reason: string) { return apiFetch(`/reports/closure/organization/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }); }
export function getProjectClosure(): Promise<WorkflowRecord | null> { return apiFetch('/reports/closure/project'); }
export function generateProjectClosure(): Promise<WorkflowRecord> { return apiFetch('/reports/closure/project/generate', { method: 'POST' }); }
export function transitionProjectClosure(status: string, donorFeedbackNotes?: string) { return apiFetch('/reports/closure/project/transition', { method: 'POST', body: JSON.stringify({ status, donorFeedbackNotes }) }); }
export function getRecipientSignatureUrl(attemptId: string): Promise<{ url: string }> { return apiFetch(`/deliveries/attempts/${attemptId}/signature`); }
export function setBeneficiaryList(id: string, listType: 'MAIN' | 'RESERVE' | 'REJECTED', listRank: number | null, reason: string) { return apiFetch(`/beneficiaries/${id}/list-decision`, { method: 'POST', body: JSON.stringify({ listType, listRank, reason, opId: newOpId() }) }); }
export function promoteReserve(id: string, reason: string) { return apiFetch(`/beneficiaries/${id}/promote-reserve`, { method: 'POST', body: JSON.stringify({ reason, opId: newOpId() }) }); }
export function requestCoordinatorChange(participationId: string, input: { proposedName: string; proposedPhone: string; proposedEmail?: string; proposedTitle?: string; reason: string }) { return apiFetch(`/participations/${participationId}/coordinator-change`, { method: 'POST', body: JSON.stringify({ ...input, opId: newOpId() }) }); }
export function createPurchaseOrder(input: { associationId: string; orderNumber: string; supplierName: string; orderedAt?: string; expectedDeliveryAt?: string; items: Array<{ deviceType: DeviceType; spec?: string; approvedQty: number }> }) { return apiFetch('/procurement/orders', { method: 'POST', body: JSON.stringify({ ...input, opId: newOpId() }) }); }
export function transitionPurchaseOrder(id: string, status: 'APPROVED' | 'CANCELLED') { return apiFetch(`/procurement/orders/${id}/transition`, { method: 'POST', body: JSON.stringify({ status, opId: newOpId() }) }); }
export function createShipment(input: { purchaseOrderId: string; route: 'SUPPLIER_TO_ASSOCIATION' | 'ZAAD_TO_ASSOCIATION'; scheduledAt?: string; location?: string; receiverInstructions?: string; items: Array<{ purchaseOrderItemId: string; shippedQty: number }> }) { return apiFetch('/procurement/shipments', { method: 'POST', body: JSON.stringify({ ...input, opId: newOpId() }) }); }
export function transitionShipment(id: string, status: 'DISPATCHED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'RECONCILIATION_REQUIRED' | 'CLOSED' | 'CANCELLED') { return apiFetch(`/procurement/shipments/${id}/transition`, { method: 'POST', body: JSON.stringify({ status, opId: newOpId() }) }); }
export function decideApplicationEligibility(id: string, decision: 'PASSED' | 'FAILED' | 'NEEDS_INFO', notes?: string) { return apiFetch(`/association-applications/${id}/eligibility`, { method: 'POST', body: JSON.stringify({ decision, notes, opId: newOpId() }) }); }
export function evaluateApplication(id: string, scores: { operationalReadiness: number; technicalCapability: number; previousExperience: number; integrityTransparency: number; participationCommitment: number; sustainabilityImpact: number; geographicProjectNeed: number }) { return apiFetch(`/association-applications/${id}/evaluation`, { method: 'POST', body: JSON.stringify({ ...scores, opId: newOpId() }) }); }
export function previewApplicationSelection(): Promise<{ threshold: number; items: WorkflowRecord[] }> { return apiFetch('/association-applications/selection/preview', { method: 'POST' }); }
export function commitApplicationSelection(mainTargetCount: number, supporterApprovalReference: string) { return apiFetch('/association-applications/selection/commit', { method: 'POST', body: JSON.stringify({ mainTargetCount, supporterApprovalReference, opId: newOpId() }) }); }

export function failDelivery(missionId: string, failureReason: DeliveryFailureReason, notes?: string): Promise<{ ok: true; attemptId: string }> {
  return apiFetch(`/deliveries/${missionId}/fail`, { method: 'POST', body: JSON.stringify({ failureReason, notes, opId: newOpId() }) });
}

export function retryDelivery(missionId: string): Promise<{ ok: true }> {
  return apiFetch(`/deliveries/${missionId}/retry`, { method: 'POST', body: JSON.stringify({ opId: newOpId() }) });
}

/** تخلٍّ نهائي عن التسليم — الجهاز يعود فعليًا للمستودع (يوازي "أعيد للجمعية/المستودع" القديمة). */
/** طلب إرجاع؛ لا يعيد جهازًا للمستودع قبل تأكيد الاستلام الفعلي من الجمعية. */
export function returnDelivery(missionId: string, notes?: string): Promise<{ ok: true; attemptId: string }> {
  return apiFetch(`/deliveries/${missionId}/return`, { method: 'POST', body: JSON.stringify({ notes, opId: newOpId() }) });
}

export function getDeliveryProofUrl(attemptId: string): Promise<{ url: string }> {
  return apiFetch(`/deliveries/attempts/${attemptId}/proof`);
}

export interface AllocationBasket {
  beneficiary: { id: string; publicCode: string; name: string };
  association: { id: string; publicCode: string; name: string };
  complete: boolean;
  readyForAssignment: boolean;
  missing: { needId: string; deviceType: DeviceType; reason: string }[];
  needs: { id: string; deviceType: DeviceType; fulfillmentStatus: string | null; allocation: { id: string; device: { id: string; publicCode: string; status: DeviceStatus } } | null }[];
}

export interface AllocationBaskets {
  association: { id: string; publicCode: string; name: string };
  stock: Record<DeviceType, number>;
  summary: { total: number; complete: number; incomplete: number; readyForAssignment: number };
  complete: AllocationBasket[];
  incomplete: AllocationBasket[];
}

export function getAllocationBaskets(associationId: string): Promise<AllocationBaskets> {
  return apiFetch(`/allocation/baskets?associationId=${encodeURIComponent(associationId)}`);
}

export function runAllocation(associationId: string): Promise<{ skipped: string | null; completed: number; filled: number; reclaimed: number; baskets: AllocationBaskets }> {
  return apiFetch('/allocation/run', { method: 'POST', body: JSON.stringify({ associationId, opId: newOpId() }) });
}

/** BEN-016/017 — تعديل/تأكيد موقع مستفيد فقط (لا حقول أخرى) — متاح لِADMIN/ASSOCIATION/DELEGATE (الأخير لمستفيده المُسنَد حاليًا حصرًا). */
export function updateBeneficiaryLocation(beneficiaryId: string, input: { lat: number; lng: number; locationSource?: string }): Promise<{ ok: true }> {
  return apiFetch(`/beneficiaries/${beneficiaryId}/location`, { method: 'PATCH', body: JSON.stringify({ ...input, opId: newOpId() }) });
}

// ============================================================
// NODE-7 — متابعة المشروع (أنشطة) + سجل العمليات
// ============================================================
export type ActivityStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'LATE' | 'COMPLETED';

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  NOT_STARTED: 'لم يبدأ',
  IN_PROGRESS: 'جارٍ',
  LATE: 'متأخر',
  COMPLETED: 'مكتمل',
};

export interface Activity {
  id: string;
  phaseOrder: number;
  phaseName: string;
  mainActivityOrder: number;
  mainActivityName: string;
  subActivityName: string | null;
  responsible: string | null;
  startDate: string | null;
  endDate: string | null;
  completionPercent: string;
  status: ActivityStatus;
  notes: string | null;
  evidenceUrl: string | null;
  evidence: { id: string; approvalStatus: string; notes: string | null; uploadedAt: string }[];
}

export function listActivities(): Promise<Activity[]> {
  return apiFetch(`/activities`);
}

export interface SaveActivityInput {
  id?: string;
  phaseOrder: number;
  phaseName: string;
  mainActivityOrder: number;
  mainActivityName: string;
  subActivityName?: string;
  responsible?: string;
  startDate?: string;
  endDate?: string;
  completionPercent?: number;
  status: ActivityStatus;
  notes?: string;
  evidenceUrl?: string;
}

export function saveActivity(input: SaveActivityInput): Promise<{ ok: true; activityId: string }> {
  return apiFetch(`/activities`, { method: 'POST', body: JSON.stringify(input) });
}

export const PROJECT_ACTIVITY_DRILLDOWN: Record<number, { label: string; href: string }> = {
  5: { label: 'طلبات انضمام الجمعيات', href: '/admin/applications' },
  6: { label: 'نتائج تقييم الطلبات', href: '/admin/applications?status=UNDER_REVIEW' },
  7: { label: 'الجمعيات المفعَّلة', href: '/admin/associations' },
  10: { label: 'محاضر استلام الأجهزة', href: '/admin/receipts' },
  11: { label: 'عمليات تسليم الأجهزة', href: '/admin/deliveries' },
  12: { label: 'الجمعيات (إغلاق التقارير)', href: '/admin/associations' },
};

export interface ProjectActivityScheduleSummary {
  total: number;
  actualCompleted: number;
  current: { order: number; name: string; planned: boolean } | null;
  upcoming: { order: number; name: string; startDate: string | null } | null;
  delayedCount: number;
}

export function computeProjectActivitySchedule(
  activities: Activity[],
  today: Date = new Date(),
): ProjectActivityScheduleSummary {
  const headers = activities
    .filter((activity) => activity.subActivityName === null)
    .sort((a, b) => a.mainActivityOrder - b.mainActivityOrder);
  const total = new Set(activities.map((activity) => activity.mainActivityOrder)).size;
  const actualCompleted = headers.filter((activity) => activity.status === 'COMPLETED').length;
  const todayTime = today.getTime();
  let current: ProjectActivityScheduleSummary['current'] = null;
  let upcoming: ProjectActivityScheduleSummary['upcoming'] = null;
  let delayedCount = 0;

  for (let index = 0; index < headers.length; index += 1) {
    const activity = headers[index];
    const start = activity.startDate ? new Date(activity.startDate).getTime() : null;
    const end = activity.endDate ? new Date(activity.endDate).getTime() : null;
    if (start != null && end != null && todayTime >= start && todayTime <= end) {
      current = { order: activity.mainActivityOrder, name: activity.mainActivityName, planned: true };
      const next = headers[index + 1];
      upcoming = next
        ? { order: next.mainActivityOrder, name: next.mainActivityName, startDate: next.startDate }
        : null;
    }
    if (end != null && todayTime > end && activity.status !== 'COMPLETED') delayedCount += 1;
  }
  if (!current) {
    const next = headers.find(
      (activity) => activity.startDate && new Date(activity.startDate).getTime() > todayTime,
    );
    if (next) upcoming = { order: next.mainActivityOrder, name: next.mainActivityName, startDate: next.startDate };
  }

  return { total, actualCompleted, current, upcoming, delayedCount };
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actorAccount: { name: string; role: string; publicCode: string } | null;
}

export function listAuditLog(params: { page?: number; pageSize?: number; associationId?: string; entityType?: string; entityId?: string } = {}): Promise<Paginated<AuditLogEntry>> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.associationId) q.set('associationId', params.associationId);
  if (params.entityType) q.set('entityType', params.entityType);
  if (params.entityId) q.set('entityId', params.entityId);
  return apiFetch(`/audit?${q.toString()}`);
}

export interface AssociationReport {
  association: { id: string; publicCode: string; name: string; region: string; city: string };
  period: { from: string; to: string; generatedAt: string };
  beneficiaries: { total: number; byReviewStatus: Record<string, number> };
  needs: { total: number; byDecisionStatus: Record<string, number>; byFulfillmentStatus: Record<string, number> };
  inventory: { total: number; byStatus: Record<string, number>; byDeviceType: Record<string, number> };
  receipts: { periodTotal: number; byStatus: Record<string, number> };
  deliveries: { currentTotal: number; byStatus: Record<string, number>; attemptsInPeriod: number; attemptsByStatus: Record<string, number> };
  custody: { movementsInPeriod: number };
  recentOperations: { action: string; entityType: string; createdAt: string }[];
}

export function getAssociationReport(from: string, to: string): Promise<AssociationReport> {
  const query = new URLSearchParams({ from, to });
  return apiFetch(`/reports/association?${query.toString()}`);
}
