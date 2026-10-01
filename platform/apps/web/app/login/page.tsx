'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '../lib/api';
import { PasswordField } from '../components/PasswordField';

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
  const [passwordChanged, setPasswordChanged] = useState(false);
  useEffect(() => {
    setPasswordChanged(new URLSearchParams(window.location.search).get('passwordChanged') === '1');
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body =
        tab === 'user' ? { type: 'user', email, password } : { type: 'delegate', code };
      const res = await apiFetch<{ ok: true; user: { role: string; mustChangePassword: boolean; covenantRequired: boolean } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(res.user.mustChangePassword ? '/change-password' : res.user.role === 'ASSOCIATION' && res.user.covenantRequired ? '/association/covenant' : '/dashboard');
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
          <img src="/brand/zadLogo.png" alt="جمعية الزاد" className="lockup-logo" width={426} height={260} />
          <span className="lockup-duo-divider" aria-hidden="true" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/partnerLogo.png" alt="مؤسسة سليمان أبانمي الأهلية" className="lockup-partner-logo" width={411} height={220} />
        </div>
        <div className="login-divider" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/loginCalligraphy.png" alt="أهلًا وسهلًا" className="login-calligraphy" width={360} height={290} loading="lazy" />

        {tab === 'user' && <>
          <div className="login-application-entry">
            <a href="/apply" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--r-sm)', background: 'var(--zad-800)', color: '#fff', fontSize: 17, fontWeight: 700, lineHeight: 1.4, textDecoration: 'none' }}>
              تقديم طلب جديد للجمعية
            </a>
            <p style={{ margin: 0, fontSize: 13 }}>للمشاركة في مشروع الأجهزة الكهربائية<br />لا تحتاج إلى حساب لبدء التقديم</p>
            <p style={{ margin: 0, fontSize: 11.5, color: '#614651' }}>يخضع الطلب للمراجعة والتقييم، والتقديم لا يعني القبول.</p>
          </div>
          <div className="login-account-separator" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600, color: 'var(--zad-900)' }}>
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: 'rgba(58,8,27,.2)' }} />
            لديك حساب مُفعّل؟ سجّل الدخول
            <span aria-hidden="true" style={{ flex: 1, height: 1, background: 'rgba(58,8,27,.2)' }} />
          </div>
        </>}

        <div className="segmented" role="tablist" aria-label="نوع الدخول" style={segmentedStyle}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'user'}
            onClick={() => setTab('user')}
            style={tabStyle(tab === 'user')}
          >
            دخول عام
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'delegate'}
            onClick={() => setTab('delegate')}
            style={tabStyle(tab === 'delegate')}
          >
            دخول المناديب
          </button>
        </div>

        <form onSubmit={submit} className="login-form" style={{ display: 'flex', flexDirection: 'column' }}>
          {tab === 'user' ? (
            <>
              <label style={labelStyle}>
                البريد الإلكتروني
                <input
                  type="email"
                  name="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="control"
                  style={inputStyle}
                  autoComplete="username"
                />
              </label>
              <PasswordField label="كلمة المرور" name="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="control" style={inputStyle} autoComplete="current-password" />
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

          {passwordChanged && <p role="status" style={{ margin: 0, fontSize: 14 }}>تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.</p>}
          {tab === 'user' && <a href="/forgot-password" style={{ color: 'var(--zad-800)', textDecoration: 'underline', fontSize: 14 }}>نسيت كلمة المرور؟</a>}
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

          <button type="submit" disabled={loading} style={{ ...submitStyle, minHeight: 44, padding: '8px 16px' }}>
            {loading ? 'جارٍ الدخول…' : tab === 'delegate' ? 'دخول المندوب' : 'تسجيل الدخول'}
          </button>
        </form>

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
  padding: 2,
  borderRadius: 'var(--r-sm)',
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '6px 10px',
    minHeight: 44,
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

const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  minHeight: 44,
  lineHeight: 1.5,
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
