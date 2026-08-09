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
