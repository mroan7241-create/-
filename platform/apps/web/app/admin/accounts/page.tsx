'use client';

import { useCallback, useEffect, useState } from 'react';
import { ADMIN_APPLICATION_REGIONS, ADMIN_PERMISSION_CATALOG, normalizeAdminPermissions, type AdminApplicationScope, type AdminPermission } from '@alzad/shared';
import { AppShell } from '../../components/AppShell';
import { ConfirmDialog, type ConfirmDialogProps } from '../../components/ConfirmDialog';
import { PROJECT_GROUP_LABELS } from '../selection/selection-groups';
import { useRoleGuard } from '../../lib/use-role-guard';
import { ACCOUNT_STATUS_LABELS, ApiClientError, createAdminAccount, getApplicationGeography, listAdminAccounts, resetAdminAccountPassword, setAdminAccountStatus, updateAdminAccount, type AdminAccountSummary } from '../../lib/api';
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
  const [scopeMode, setScopeMode] = useState<'legacy' | 'unset' | 'all' | 'selected'>(account ? account.adminApplicationScope == null ? 'legacy' : 'allRegions' in account.adminApplicationScope ? 'all' : 'selected' : 'unset');
  const [regionCodes, setRegionCodes] = useState<string[]>(account?.adminApplicationScope && 'regionCodes' in account.adminApplicationScope ? account.adminApplicationScope.regionCodes : []);
  const [scopeRegions, setScopeRegions] = useState<typeof ADMIN_APPLICATION_REGIONS | null>(null);
  const [scopeError, setScopeError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const groups = [...new Set(ADMIN_PERMISSION_CATALOG.map((permission) => permission.group))];
  const scopeGroups = [...new Set((scopeRegions ?? []).map((region) => region.group))];
  useEffect(() => {
    let cancelled = false;
    void getApplicationGeography().then(({ items }) => {
      const regions = items.filter((unit) => unit.unitType === 'REGION');
      if (!regions.length || regions.some((unit) => !ADMIN_APPLICATION_REGIONS.some((known) => known.code === unit.officialCode && known.group === unit.projectScopeGroup))) throw new Error('invalid-geographic-reference');
      if (!cancelled) setScopeRegions(ADMIN_APPLICATION_REGIONS.filter((known) => regions.some((unit) => unit.officialCode === known.code)));
    }).catch(() => { if (!cancelled) setScopeError('تعذّر التحقق من مرجع المناطق. أعد فتح النموذج؛ لن يُحفظ نطاق غير متحقق منه.'); });
    return () => { cancelled = true; };
  }, []);
  function toggle(key: AdminPermission, checked: boolean) {
    setPermissions((old) => checked ? normalizeAdminPermissions([...old, key]) : old.filter((permission) => permission !== key && !(key.endsWith('.read') && permission.startsWith(`${key.slice(0, -5)}.`))));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!scopeRegions) { setError(scopeError || 'انتظر اكتمال التحقق من مرجع المناطق.'); return; }
      if (scopeMode === 'unset' || (scopeMode === 'selected' && !regionCodes.length)) { setError('حدد جميع المناطق أو اختر منطقة واحدة أو عدة مناطق.'); return; }
      const adminApplicationScope: AdminApplicationScope | undefined = scopeMode === 'legacy' ? undefined : scopeMode === 'all' ? { allRegions: true } : { regionCodes };
      if (account) { await updateAdminAccount(account.id, { name: name.trim(), adminPermissions: permissions, ...(adminApplicationScope ? { adminApplicationScope } : {}) }); onSaved(name, email); }
      else if (adminApplicationScope) { const result = await createAdminAccount({ name: name.trim(), email: email.trim(), adminPermissions: permissions, adminApplicationScope }); onSaved(name, email.trim().toLowerCase(), result.temporaryPassword); }
    } catch (reason) { setError(readError(reason)); }
    finally { setBusy(false); }
  }
  return <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-labelledby="admin-account-form-title"><form onSubmit={save} style={{ ...modalStyle, maxWidth: 760 }}><div className="workflow-row"><h2 id="admin-account-form-title">{account ? `تعديل — ${account.name}` : 'إضافة موظف إدارة'}</h2><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onClose}>إغلاق</button></div><div className="form-grid"><label style={labelStyle}>اسم الموظف<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} /></label><label style={labelStyle}>البريد الإلكتروني<input required type="email" disabled={!!account} value={email} onChange={(event) => setEmail(event.target.value)} style={{ ...inputStyle, ...ltrStyle }} /></label></div>
    <p style={mutedStyle}>صلاحية تنفيذ الإجراء تضيف قراءة قسمه. إلغاء قراءة قسم يُلغي إجراءاته. دون أي صلاحيات لا يمكن فتح أقسام الإدارة.</p>
    <fieldset style={cardStyle}>
      <legend>نطاق المناطق لطلبات الانضمام والمشاركات المرتبطة</legend>
      <label style={labelStyle}>نطاق الموظف<select required value={scopeMode} onChange={(event) => setScopeMode(event.target.value as typeof scopeMode)} style={inputStyle}><option value="unset" disabled>اختر نطاقًا صريحًا</option>{account?.adminApplicationScope == null && account && <option value="legacy">إبقاء النطاق السابق دون تغيير</option>}<option value="all">جميع المناطق</option><option value="selected">منطقة واحدة أو عدة مناطق</option></select></label>
      {scopeMode === 'selected' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>{scopeGroups.map((group) => {
        const codes = scopeRegions!.filter((region) => region.group === group).map((region) => region.code);
        const selected = codes.filter((code) => regionCodes.includes(code)).length;
        return <label className="check-row" key={group}><input type="checkbox" checked={selected === codes.length} ref={(element) => { if (element) element.indeterminate = selected > 0 && selected < codes.length; }} onChange={(event) => setRegionCodes((old) => event.target.checked ? [...new Set([...old, ...codes])] : old.filter((code) => !codes.includes(code)))} />{PROJECT_GROUP_LABELS[group]}{selected > 0 && selected < codes.length ? ` (${selected} من ${codes.length} مناطق إدارية)` : ''}</label>;
      })}</div>}
      <p style={mutedStyle}>الغربية تشمل مكة المكرمة والمدينة المنورة وتبوك؛ الجنوبية تشمل عسير والباحة وجازان ونجران. النطاق يقيّد الطلبات وملفاتها وإجراءاتها والمشاركات والمواثيق والتقارير المرتبطة على الخادم. لا يمنح صلاحيات إجراء جديدة، وتظل الصلاحيات أدناه مطلوبة.</p>
      {scopeError && <p role="alert" style={errorStyle}>{scopeError}</p>}
    </fieldset>
    <p style={mutedStyle}>اختيار الجمعية في التخصيص وإنشاء المحاضر والمناديب يتطلب قراءة الجمعيات. إسناد التسليم يتطلب قراءة الجمعيات والمستفيدين والمناديب. ربط المحضر بشحنة يتطلب قراءة المشتريات. تُمنح هذه الصلاحيات صراحةً عند الحاجة.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>{groups.map((group) => <fieldset key={group} style={cardStyle}><legend>{group}</legend>{ADMIN_PERMISSION_CATALOG.filter((permission) => permission.group === group).map((permission) => <label className="check-row" key={permission.key}><input type="checkbox" checked={permissions.includes(permission.key)} onChange={(event) => toggle(permission.key, event.target.checked)} />{permission.label}</label>)}</fieldset>)}</div>
    {error && <p role="alert" style={errorStyle}>{error}</p>}<button type="submit" disabled={busy || !scopeRegions} style={primaryButtonStyle}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
  </form></div>;
}

function readError(reason: unknown): string { return reason instanceof ApiClientError ? reason.message : 'تعذّر تنفيذ العملية. حاول مرة أخرى.'; }
