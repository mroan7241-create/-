'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, confirmPasswordReset, requestPasswordReset } from '../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, narrowPageStyle, primaryButtonStyle, secondaryButtonStyle, successStyle } from '../lib/ui';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState(false);
  const [adminInvitation, setAdminInvitation] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const mode = params.get('invitation');
    if (mode !== '1' && mode !== 'admin') return;
    setInvitation(mode === '1'); setAdminInvitation(mode === 'admin'); setEmail(params.get('email') ?? ''); setCode(params.get('code') ?? ''); setStep('confirm');
    // The fragment never travels to the server; remove it from browser history too.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  async function request(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const result = await requestPasswordReset(email.trim()); setMessage(result.message); setStep('confirm'); }
    catch (reason) { setError(readError(reason)); }
    finally { setBusy(false); }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault(); setError('');
    if (password !== confirmPassword) return setError('كلمتا المرور غير متطابقتين.');
    setBusy(true);
    try { await confirmPasswordReset(email.trim(), code.trim(), password, invitation ? name.trim() : undefined); router.replace('/login?passwordChanged=1'); }
    catch (reason) { setError(readError(reason)); }
    finally { setBusy(false); }
  }

  return <main style={narrowPageStyle}>
    <h1 style={{ fontSize: 24 }}>{adminInvitation ? 'تفعيل حساب الإدارة' : invitation ? 'تفعيل حساب أبانمي' : 'استعادة كلمة المرور'}</h1>
    <p>{adminInvitation ? 'اختر كلمة مرورك، ثم سجّل الدخول ببريدك إلى حساب الإدارة بصلاحياتك المحددة.' : invitation ? 'اكتب اسمك واختر كلمة مرورك، ثم سجّل الدخول إلى بوابة أبانمي.' : 'متاحة لحسابات الإدارة والجمعيات وأبانمي. حساب المندوب يستخدم رمز دخول مختلفًا.'}</p>
    <form onSubmit={step === 'request' ? request : confirm} style={{ ...cardStyle, display: 'grid', gap: 14 }}>
      <label style={labelStyle}>البريد الإلكتروني<input type="email" required dir="ltr" autoComplete="email" style={inputStyle} value={email} onChange={(event) => setEmail(event.target.value)} disabled={step === 'confirm'} /></label>
      {step === 'confirm' && <>
        {invitation ? <label style={labelStyle}>الاسم<input required minLength={2} maxLength={120} autoComplete="name" style={inputStyle} value={name} onChange={(event) => setName(event.target.value)} /></label> : !adminInvitation && <label style={labelStyle}>رمز الاستعادة<input required dir="ltr" autoComplete="one-time-code" style={inputStyle} value={code} onChange={(event) => { const value = event.target.value.toUpperCase(); setCode(value); if (/^INV-[A-Z0-9]{32}$/.test(value)) setInvitation(true); }} /></label>}
        <label style={labelStyle}>كلمة المرور الجديدة<input type="password" required autoComplete="new-password" style={inputStyle} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label style={labelStyle}>تأكيد كلمة المرور<input type="password" required autoComplete="new-password" style={inputStyle} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      </>}
      {message && <p role="status" style={successStyle}>{message}</p>}
      {error && <p role="alert" style={errorStyle}>{error}</p>}
      <button disabled={busy} style={primaryButtonStyle}>{busy ? 'جارٍ التنفيذ…' : step === 'request' ? 'إرسال رمز الاستعادة' : invitation || adminInvitation ? 'تفعيل حسابي' : 'تعيين كلمة المرور الجديدة'}</button>
      {step === 'confirm' && <button type="button" style={secondaryButtonStyle} onClick={() => { setStep('request'); setCode(''); setMessage(''); setInvitation(false); setAdminInvitation(false); }}>طلب رمز جديد</button>}
      <a href="/login" style={{ textAlign: 'center' }}>العودة إلى تسجيل الدخول</a>
    </form>
  </main>;
}

function readError(reason: unknown) { return reason instanceof ApiClientError || reason instanceof Error ? reason.message : 'تعذّر الاتصال بالخادم. حاول مرة أخرى.'; }
