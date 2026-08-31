'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { apiFetch, ApiClientError } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, errorStyle, inputStyle, labelStyle, primaryButtonStyle, secondaryButtonStyle, successStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

interface AbanmiAccount { id: string; publicCode: string; name: string; email: string | null; status: string; lastLoginAt: string | null; createdAt: string }

export default function AdminAbanmiAccountsPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [accounts, setAccounts] = useState<AbanmiAccount[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const load = useCallback(() => apiFetch<AbanmiAccount[]>('/accounts/abanmi').then(setAccounts).catch(() => setMessage('تعذّر تحميل حسابات أبانمي.')), []);
  useEffect(() => { if (user) void load(); }, [user, load]);
  if (loading || !user) return null;
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await apiFetch<{ ok: true; temporaryPassword: string }>('/accounts/abanmi', { method: 'POST', body: JSON.stringify({ name, email }) });
      setCredential({ email: email.trim().toLowerCase(), password: result.temporaryPassword });
      setName(''); setEmail(''); setMessage('تم إنشاء حساب أبانمي. احفظ بيانات الدخول المؤقتة مرة واحدة فقط.'); await load();
    } catch (error) { setMessage(error instanceof ApiClientError ? error.message : 'تعذّر إنشاء الحساب.'); }
    finally { setBusy(false); }
  }
  return <AppShell user={user}>
    <h1>حسابات بوابة أبانمي</h1><p>حسابات مستقلة للعرض التجميعي ومتابعة المشروع فقط. لا ترتبط بجمعية ولا تملك صلاحية تعديل.</p>
    {message && <p role="status" style={message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}
    {credential && <section style={{ ...cardStyle, border: '2px solid #d46a2e' }}><h2>بيانات دخول مؤقتة — تُعرض مرة واحدة</h2><p>البريد: <b dir="ltr">{credential.email}</b></p><p>كلمة المرور المؤقتة: <b dir="ltr">{credential.password}</b></p><p>سيُلزم المستخدم بتغييرها عند أول دخول.</p><button style={secondaryButtonStyle} onClick={() => setCredential(null)}>فهمت وحفظت البيانات بأمان</button></section>}
    <form onSubmit={create} style={cardStyle}><h2>إنشاء حساب أبانمي</h2><div className="form-grid"><label style={labelStyle}>الاسم<input required minLength={2} maxLength={120} style={inputStyle} value={name} onChange={(event) => setName(event.target.value)} /></label><label style={labelStyle}>البريد الإلكتروني<input required type="email" style={inputStyle} value={email} onChange={(event) => setEmail(event.target.value)} /></label></div><button style={primaryButtonStyle} disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء حساب قراءة فقط'}</button></form>
    <section style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}><table style={tableStyle}><thead><tr><th style={thStyle}>الرمز</th><th style={thStyle}>الاسم</th><th style={thStyle}>البريد</th><th style={thStyle}>الحالة</th><th style={thStyle}>آخر دخول</th></tr></thead><tbody>{accounts.length ? accounts.map((account) => <tr key={account.id}><td style={tdStyle}>{account.publicCode}</td><td style={tdStyle}>{account.name}</td><td style={tdStyle} dir="ltr">{account.email}</td><td style={tdStyle}>{account.status === 'ACTIVE' ? 'نشط' : 'موقوف'}</td><td style={tdStyle}>{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('ar-SA') : 'لم يسجل الدخول'}</td></tr>) : <tr><td style={tdStyle} colSpan={5}>لا توجد حسابات أبانمي حتى الآن.</td></tr>}</tbody></table></section>
  </AppShell>;
}
