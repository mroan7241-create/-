'use client';

import { useState } from 'react';
import { apiFetch, ApiClientError } from '../../lib/api';

type Stage = 'request' | 'confirm' | 'done';

export default function ForgotPasswordPage() {
  const [stage, setStage] = useState<Stage>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: true; message: string }>('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      // رسالة موحَّدة دائمًا — لا تُفصح عن وجود الحساب من عدمه، ولا عن حالته.
      setMessage(res.message);
      setStage('confirm');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  async function submitConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ email, code, newPassword }),
      });
      setStage('done');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '64px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>استعادة كلمة المرور</h1>
      <p style={{ fontSize: 14, color: 'var(--ink)', opacity: 0.8, marginBottom: 20 }}>
        متاحة لحسابات الإدارة والجمعيات فقط. لا يمكن للمناديب استعادة رمز الدخول عبر البريد.
      </p>

      {stage === 'request' && (
        <form onSubmit={submitRequest} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={labelStyle}>
            البريد الإلكتروني
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </label>
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" disabled={loading} style={submitStyle}>
            {loading ? 'جارٍ الإرسال…' : 'إرسال رمز الاستعادة'}
          </button>
        </form>
      )}

      {stage === 'confirm' && (
        <>
          {message && <p style={{ fontSize: 14, marginBottom: 16 }}>{message}</p>}
          <form onSubmit={submitConfirm} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={labelStyle}>
              رمز الاستعادة (من البريد)
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }}
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
            {error && <p style={errorStyle}>{error}</p>}
            <button type="submit" disabled={loading} style={submitStyle}>
              {loading ? 'جارٍ التأكيد…' : 'تعيين كلمة المرور'}
            </button>
          </form>
        </>
      )}

      {stage === 'done' && (
        <>
          <p style={{ fontSize: 15 }}>تم تعيين كلمة المرور الجديدة بنجاح. يمكنك الآن تسجيل الدخول.</p>
          <a href="/login">الذهاب لتسجيل الدخول</a>
        </>
      )}
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
const errorStyle: React.CSSProperties = { color: '#a32b2b', margin: 0, fontSize: 14 };
