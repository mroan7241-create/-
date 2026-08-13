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

/**
 * شاشة الدخول — الهوية الكاملة مستعادة من Index.html القديم (UI-001):
 * شعارا الزاد وشريك التمويل (مؤسسة سليمان أبانمي الأهلية) جنبًا إلى جنب،
 * خلفية معالم سعودية زخرفية، مخطوطة "أهلًا وسهلًا"، بطاقة زجاجية حقيقية
 * فوق الخلفية. الأصول الفعلية مُستخرَجة من data URIs القديمة إلى
 * apps/web/public/brand/ (راجع docs/audit/05-legacy-ui-and-docs.md UI-001).
 */
export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('user');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgotCode, setShowForgotCode] = useState(false);

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
    <div className="login-solo">
      <div className="login-bg" aria-hidden="true" />
      <section className="login-panel">
        <div className="lockup-duo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/zadLogo.png" alt="جمعية الزاد" className="lockup-logo" />
          <span className="lockup-duo-divider" aria-hidden="true" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/partnerLogo.png" alt="مؤسسة سليمان أبانمي الأهلية" className="lockup-partner-logo" />
        </div>
        <div className="login-divider" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/loginCalligraphy.png" alt="أهلًا وسهلًا" className="login-calligraphy" loading="lazy" />

        <div className="segmented" role="tablist" aria-label="نوع الدخول" style={segmentedStyle}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'user'}
            onClick={() => setTab('user')}
            style={tabStyle(tab === 'user')}
          >
            دخول الإدارة والجمعيات
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'delegate'}
            onClick={() => setTab('delegate')}
            style={tabStyle(tab === 'delegate')}
          >
            دخول المندوب
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
                  className="control"
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
                  className="control"
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
                className="control"
                style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }}
              />
            </label>
          )}

          {tab === 'delegate' && (
            <p style={{ margin: 0, fontSize: 14 }}>
              <button
                type="button"
                onClick={() => setShowForgotCode(true)}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--zad-800)', textDecoration: 'underline', cursor: 'pointer', fontSize: 14 }}
              >
                نسيت رمز الدخول؟
              </button>
            </p>
          )}

          {error && (
            <p role="alert" style={{ color: '#a32b2b', margin: 0, fontSize: 14 }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} style={submitStyle}>
            {loading ? 'جارٍ الدخول…' : tab === 'delegate' ? 'دخول المندوب' : 'تسجيل الدخول'}
          </button>
        </form>

        {tab === 'user' && (
          <div className="login-secondary-act" style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a href="/apply" className="btn-ghost" style={ghostButtonStyle}>
              تقديم طلب انضمام جمعية جديدة
            </a>
            <p style={{ margin: 0, fontSize: 14, textAlign: 'center' }}>
              <a href="/login/forgot-password">نسيت كلمة المرور؟</a>
            </p>
          </div>
        )}
      </section>

      {showForgotCode && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowForgotCode(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--paper)',
              borderRadius: 'var(--r-sm)',
              padding: 24,
              maxWidth: 360,
              width: '90%',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ fontSize: 17, marginTop: 0, marginBottom: 12 }}>نسيت رمز الدخول؟</h2>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              رموز دخول المناديب لا تُرسَل عبر البريد الإلكتروني لأسباب أمنية. تواصل مع
              الجمعية المسؤولة عنك للحصول على رمز جديد.
            </p>
            <button
              type="button"
              onClick={() => setShowForgotCode(false)}
              style={{ ...submitStyle, marginTop: 18, width: '100%' }}
            >
              حسنًا
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const segmentedStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: 4,
  borderRadius: 'var(--r-sm)',
  marginBottom: 18,
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '9px 10px',
    borderRadius: 'var(--r-sm)',
    border: 'none',
    background: active ? 'rgba(255,255,255,0.8)' : 'transparent',
    color: active ? 'var(--zad-800)' : 'var(--ink)',
    fontWeight: active ? 700 : 400,
    fontSize: 13.5,
    cursor: 'pointer',
    boxShadow: active ? '0 2px 10px rgba(58,8,27,.14)' : 'none',
  };
}

const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line)',
  fontSize: 16,
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
const ghostButtonStyle: React.CSSProperties = {
  padding: '11px 16px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid rgba(58,8,27,.2)',
  background: 'rgba(255,255,255,0.4)',
  color: 'var(--zad-800)',
  fontWeight: 600,
  fontSize: 14,
  textAlign: 'center',
  textDecoration: 'none',
  display: 'block',
};
