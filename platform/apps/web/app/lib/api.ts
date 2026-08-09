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
