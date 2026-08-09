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
