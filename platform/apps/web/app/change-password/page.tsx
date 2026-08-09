'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '../lib/api';

/**
 * شاشة تغيير كلمة المرور الإلزامي — تُعرض عندما mustChangePassword=true
 * (بعد دخول أول مرة أو بعد إعادة تعيين من ADMIN). الخادم يمنع أي endpoint
 * آخر حتى تُنجَز هذه الخطوة (راجع SessionAuthGuard + AUTHENTICATION.md).
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      // كل الجلسات (بما فيها الحالية) أُبطلت بعد النجاح — لا بد من تسجيل الدخول من جديد.
      router.push('/login');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '64px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>يجب تغيير كلمة المرور</h1>
      <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 20 }}>
        كلمة المرور الحالية مؤقتة — لا يمكن متابعة استخدام النظام قبل تعيين كلمة مرور جديدة.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          كلمة المرور الحالية
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          كلمة المرور الجديدة
          <input
            type="password"
            required
            minLength={10}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={inputStyle}
          />
        </label>
        {error && (
          <p role="alert" style={{ color: '#a32b2b', margin: 0, fontSize: 14 }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} style={submitStyle}>
          {loading ? 'جارٍ الحفظ…' : 'حفظ وتسجيل الدخول من جديد'}
        </button>
      </form>
    </main>
  );
}

const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line)',
  fontSize: 15,
  fontFamily: 'inherit',
};
const submitStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 'var(--r-sm)',
  border: 'none',
  background: 'var(--zad-800)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
};
