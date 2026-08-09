'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '../lib/api';

type Tab = 'user' | 'delegate';

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: 'بيانات الدخول غير صحيحة.',
  AUTH_ACCOUNT_DISABLED: 'الحساب موقوف حاليًا. تواصل مع إدارة المشروع.',
  AUTH_ASSOCIATION_DISABLED: 'حساب الجمعية موقوف حاليًا. تواصل مع إدارة المشروع.',
  AUTH_RATE_LIMITED: 'محاولات كثيرة خلال وقت قصير. انتظر بضع دقائق ثم أعد المحاولة.',
};

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('user');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body =
        tab === 'user' ? { type: 'user', email, password } : { type: 'delegate', code };
      const res = await apiFetch<{ ok: true; user: { mustChangePassword: boolean } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(res.user.mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(ERROR_MESSAGES[err.code] ?? err.message);
      } else {
        setError('تعذّر الاتصال بالخادم. حاول مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '64px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>تسجيل الدخول — منصة جمعية الزاد</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setTab('user')}
          style={tabStyle(tab === 'user')}
        >
          إدارة / جمعية
        </button>
        <button
          type="button"
          onClick={() => setTab('delegate')}
          style={tabStyle(tab === 'delegate')}
        >
          مندوب
        </button>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {tab === 'user' ? (
          <>
            <label style={labelStyle}>
              البريد الإلكتروني
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
                autoComplete="email"
              />
            </label>
            <label style={labelStyle}>
              كلمة المرور
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                autoComplete="current-password"
              />
            </label>
          </>
        ) : (
          <label style={labelStyle}>
            رمز دخول المندوب
            <input
              type="text"
              required
              placeholder="MND-XXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }}
            />
          </label>
        )}

        {error && (
          <p role="alert" style={{ color: '#a32b2b', margin: 0, fontSize: 14 }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} style={submitStyle}>
          {loading ? 'جارٍ الدخول…' : 'دخول'}
        </button>
      </form>

      {tab === 'user' && (
        <p style={{ marginTop: 16, fontSize: 14 }}>
          <a href="/login/forgot-password">نسيت كلمة المرور؟</a>
        </p>
      )}
    </main>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '10px 12px',
    borderRadius: 'var(--r-sm)',
    border: `1px solid ${active ? 'var(--zad-700)' : 'var(--line)'}`,
    background: active ? 'var(--zad-100)' : 'var(--paper)',
    color: active ? 'var(--zad-800)' : 'var(--ink)',
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
  };
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
