'use client';

import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSION_CATALOG, normalizeAdminPermissions, type AdminPermission } from '@alzad/shared';
import { AppShell } from '../../components/AppShell';
import { ConfirmDialog, type ConfirmDialogProps } from '../../components/ConfirmDialog';
import { useRoleGuard } from '../../lib/use-role-guard';
import { ACCOUNT_STATUS_LABELS, ApiClientError, createAdminAccount, listAdminAccounts, resetAdminAccountPassword, setAdminAccountStatus, updateAdminAccount, type AdminAccountSummary } from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, ltrStyle, modalOverlayStyle, modalStyle, mutedStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, successStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

export default function AdminAccountsPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([]);
  const [editing, setEditing] = useState<AdminAccountSummary | 'new' | null>(null);
  const [credential, setCredential] = useState<{ name: string; email: string; password: string } | null>(null);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<Omit<ConfirmDialogProps, 'onCancel'> | null>(null);
  const load = useCallback(async () => {
    try { setAccounts(await listAdminAccounts()); }
    catch (reason) { setMessage(readError(reason)); }
  }, []);
  useEffect(() => { if (user) void load(); }, [user, load]);

  function toggleStatus(account: AdminAccountSummary) {
    const status = account.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setConfirmation({ title: status === 'SUSPENDED' ? 'تعطيل حساب الإدارة' : 'تفعيل حساب الإدارة', message: status === 'SUSPENDED' ? `تعطيل «${account.name}» يُنهي جلساته فورًا. متابعة؟` : `إعادة تفعيل حساب «${account.name}»؟`, confirmLabel: status === 'SUSPENDED' ? 'تعطيل' : 'تفعيل', tone: status === 'SUSPENDED' ? 'danger' : 'primary', onConfirm: async () => {
      try { await setAdminAccountStatus(account.id, status); setConfirmation(null); setMessage(status === 'SUSPENDED' ? 'تم تعطيل الحساب وإنهاء جلساته.' : 'تم تفعيل الحساب.'); await load(); }
      catch (reason) { setMessage(readError(reason)); }
    } });
  }

  function resetPassword(account: AdminAccountSummary) {
    setConfirmation({ title: 'إعادة تعيين كلمة المرور', message: `إعادة تعيين كلمة مرور «${account.name}» يُنهي جلساته ويلزمه بتغيير كلمة المرور عند الدخول. تظهر كلمة المرور المؤقتة مرة واحدة.`, confirmLabel: 'إعادة تعيين', tone: 'danger', onConfirm: async () => {
      try { const result = await resetAdminAccountPassword(account.id); setConfirmation(null); setCredential({ name: account.name, email: account.email ?? '', password: result.temporaryPassword }); setMessage('تم إصدار كلمة مرور مؤقتة جديدة.'); await load(); }
      catch (reason) { setMessage(readError(reason)); }
    } });
  }

  if (loading || !user) return null;
  return <AppShell user={user}>
    <div className="workflow-row"><h1>حسابات الإدارة</h1><button type="button" style={primaryButtonStyle} onClick={() => setEditing('new')}>إضافة موظف إدارة</button></div>
    <p style={mutedStyle}>كل موظف يستخدم حسابه باسمه وصلاحياته المحددة. إدارة هذه الحسابات متاحة لمدير المنصة فقط.</p>
    {message && <p role={message.startsWith('تم') ? 'status' : 'alert'} style={message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}
    <section style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}><table style={tableStyle}><thead><tr><th style={thStyle}>الاسم</th><th style={thStyle}>الرمز</th><th style={thStyle}>البريد</th><th style={thStyle}>الحالة</th><th style={thStyle}>الصلاحيات</th><th style={thStyle}>آخر دخول</th><th style={thStyle}>الإجراءات</th></tr></thead><tbody>
      {accounts.map((account) => <tr key={account.id}><td style={tdStyle}>{account.name}</td><td style={{ ...tdStyle, ...ltrStyle }}>{account.publicCode}</td><td style={{ ...tdStyle, ...ltrStyle }}>{account.email}</td><td style={tdStyle}><span style={statusBadgeStyle(account.status === 'ACTIVE' ? 'good' : 'bad')}>{ACCOUNT_STATUS_LABELS[account.status]}</span></td><td style={tdStyle}>{account.adminFullAccess ? 'مدير المنصة — جميع الصلاحيات' : `${account.adminPermissions.length} صلاحية`}</td><td style={tdStyle}>{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('ar-SA') : 'لم يسجّل دخولًا'}</td><td style={tdStyle}>{account.adminFullAccess || account.publicCode === 'ADM-000001' ? <span style={mutedStyle}>حساب المدير محمي</span> : <div className="button-row"><button type="button" style={secondaryButtonStyle} onClick={() => setEditing(account)}>تعديل الصلاحيات</button><button type="button" style={secondaryButtonStyle} onClick={() => toggleStatus(account)}>{account.status === 'ACTIVE' ? 'تعطيل' : 'تفعيل'}</button><button type="button" style={secondaryButtonStyle} onClick={() => resetPassword(account)}>إعادة تعيين كلمة المرور</button></div>}</td></tr>)}
      {!accounts.length && <tr><td colSpan={7} style={tdStyle}>لا توجد حسابات للعرض.</td></tr>}
    </tbody></table></section>
    {editing && <AdminAccountForm account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(name, email, password) => { setEditing(null); setMessage(password ? 'تم إنشاء حساب الموظف.' : 'تم حفظ الاسم والصلاحيات؛ تُطبّق الصلاحيات الجديدة على الطلب التالي.'); if (password) setCredential({ name, email, password }); void load(); }} />}
    {credential && <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-labelledby="admin-credentials-title"><section style={{ ...modalStyle, maxWidth: 520 }}><h2 id="admin-credentials-title">بيانات دخول مؤقتة — {credential.name}</h2><p>تظهر كلمة المرور مرة واحدة فقط. احفظها وسلّمها للموظف؛ يلزم تغييرها عند أول دخول.</p><p>البريد: <b dir="ltr">{credential.email}</b></p><p>كلمة المرور المؤقتة: <b dir="ltr">{credential.password}</b></p><div className="button-row"><button type="button" style={secondaryButtonStyle} onClick={() => void navigator.clipboard.writeText(`البريد: ${credential.email}\nكلمة المرور المؤقتة: ${credential.password}`)}>نسخ بيانات الدخول</button><button type="button" style={primaryButtonStyle} onClick={() => setCredential(null)}>حفظت البيانات — إغلاق</button></div></section></div>}
    {confirmation && <ConfirmDialog {...confirmation} onCancel={() => setConfirmation(null)} />}
  </AppShell>;
}

function AdminAccountForm({ account, onClose, onSaved }: { account: AdminAccountSummary | null; onClose: () => void; onSaved: (name: string, email: string, password?: string) => void }) {
  const [name, setName] = useState(account?.name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [permissions, setPermissions] = useState<AdminPermission[]>(account?.adminPermissions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const groups = [...new Set(ADMIN_PERMISSION_CATALOG.map((permission) => permission.group))];
  function toggle(key: AdminPermission, checked: boolean) {
    setPermissions((old) => checked ? normalizeAdminPermissions([...old, key]) : old.filter((permission) => permission !== key && !(key.endsWith('.read') && permission.startsWith(`${key.slice(0, -5)}.`))));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (account) { await updateAdminAccount(account.id, { name: name.trim(), adminPermissions: permissions }); onSaved(name, email); }
      else { const result = await createAdminAccount({ name: name.trim(), email: email.trim(), adminPermissions: permissions }); onSaved(name, email.trim().toLowerCase(), result.temporaryPassword); }
    } catch (reason) { setError(readError(reason)); }
    finally { setBusy(false); }
  }
  return <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-labelledby="admin-account-form-title"><form onSubmit={save} style={{ ...modalStyle, maxWidth: 760 }}><div className="workflow-row"><h2 id="admin-account-form-title">{account ? `تعديل — ${account.name}` : 'إضافة موظف إدارة'}</h2><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onClose}>إغلاق</button></div><div className="form-grid"><label style={labelStyle}>اسم الموظف<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} /></label><label style={labelStyle}>البريد الإلكتروني<input required type="email" disabled={!!account} value={email} onChange={(event) => setEmail(event.target.value)} style={{ ...inputStyle, ...ltrStyle }} /></label></div>
    <p style={mutedStyle}>صلاحية تنفيذ الإجراء تضيف قراءة قسمه. إلغاء قراءة قسم يُلغي إجراءاته. دون أي صلاحيات لا يمكن فتح أقسام الإدارة.</p>
    <p style={mutedStyle}>اختيار الجمعية في التخصيص وإنشاء المحاضر والمناديب يتطلب قراءة الجمعيات. إسناد التسليم يتطلب قراءة الجمعيات والمستفيدين والمناديب. ربط المحضر بشحنة يتطلب قراءة المشتريات. تُمنح هذه الصلاحيات صراحةً عند الحاجة.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>{groups.map((group) => <fieldset key={group} style={cardStyle}><legend>{group}</legend>{ADMIN_PERMISSION_CATALOG.filter((permission) => permission.group === group).map((permission) => <label className="check-row" key={permission.key}><input type="checkbox" checked={permissions.includes(permission.key)} onChange={(event) => toggle(permission.key, event.target.checked)} />{permission.label}</label>)}</fieldset>)}</div>
    {error && <p role="alert" style={errorStyle}>{error}</p>}<button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
  </form></div>;
}

function readError(reason: unknown): string { return reason instanceof ApiClientError ? reason.message : 'تعذّر تنفيذ العملية. حاول مرة أخرى.'; }
