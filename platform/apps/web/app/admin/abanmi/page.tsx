'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { apiFetch, ApiClientError } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, errorStyle, inputStyle, labelStyle, primaryButtonStyle, successStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

interface AbanmiAccount { id: string; publicCode: string; name: string; email: string | null; status: string; lastLoginAt: string | null; createdAt: string }

export default function AdminAbanmiAccountsPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [accounts, setAccounts] = useState<AbanmiAccount[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(() => apiFetch<AbanmiAccount[]>('/accounts/abanmi').then(setAccounts).catch(() => setMessage('تعذّر تحميل حسابات أبانمي.')), []);
  useEffect(() => { if (user) void load(); }, [user, load]);
  if (loading || !user) return null;
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await apiFetch<{ ok: true; emailQueued: true }>('/accounts/abanmi', { method: 'POST', body: JSON.stringify({ email, invite: true }) });
      setEmail(''); setMessage('تم حفظ دعوة أبانمي للإرسال إلى البريد. يكتب المستخدم اسمه ويختار كلمة مروره من الرابط، ولا تحتاج تسليمه كلمة مرور.'); await load();
    } catch (error) { setMessage(error instanceof ApiClientError ? error.message : 'تعذّر إنشاء الحساب.'); }
    finally { setBusy(false); }
  }
  return <AppShell user={user}>
    <h1>حسابات بوابة أبانمي</h1><p>حسابات مستقلة للعرض التجميعي ومتابعة المشروع فقط. لا ترتبط بجمعية ولا تملك صلاحية تعديل.</p>
    {message && <p role="status" style={message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}
    <form onSubmit={create} style={{ ...cardStyle, marginBottom: 22 }}><h2>دعوة إلى بوابة أبانمي</h2><p>أدخل البريد فقط؛ يكتب المدعو اسمه ويختار كلمة مروره بنفسه عبر رابط مؤقت يُستخدم مرة واحدة. لإعادة دعوة لم تُفعّل، أدخل البريد نفسه. الحسابات المستخدمة لا تتغير.</p><label style={labelStyle}>البريد الإلكتروني<input required type="email" dir="ltr" style={inputStyle} value={email} onChange={(event) => setEmail(event.target.value)} /></label><button style={{ ...primaryButtonStyle, marginTop: 12 }} disabled={busy}>{busy ? 'جارٍ تجهيز الدعوة…' : 'إرسال دعوة أبانمي'}</button></form>
    <section style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}><table style={tableStyle}><thead><tr><th style={thStyle}>الرمز</th><th style={thStyle}>الاسم</th><th style={thStyle}>البريد</th><th style={thStyle}>الحالة</th><th style={thStyle}>آخر دخول</th></tr></thead><tbody>{accounts.length ? accounts.map((account) => <tr key={account.id}><td style={tdStyle}>{account.publicCode}</td><td style={tdStyle}>{account.name}</td><td style={tdStyle} dir="ltr">{account.email}</td><td style={tdStyle}>{account.status === 'ACTIVE' ? 'نشط' : 'موقوف'}</td><td style={tdStyle}>{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('ar-SA') : 'لم يسجل الدخول'}</td></tr>) : <tr><td style={tdStyle} colSpan={5}>لا توجد حسابات أبانمي حتى الآن.</td></tr>}</tbody></table></section>
  </AppShell>;
}
