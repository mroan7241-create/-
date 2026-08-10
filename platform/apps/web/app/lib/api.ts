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
  applicationQuestions: { key: string; label: string }[];
  pledgeText: string;
  ready: boolean;
}

export function getReferenceData(): Promise<ReferenceData> {
  return apiFetch<ReferenceData>('/reference-values');
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
