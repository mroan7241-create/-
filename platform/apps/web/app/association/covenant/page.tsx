'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/AppShell';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SignaturePad } from '../../components/SignaturePad';
import { ApiClientError, covenantTemplateUrl, getFinalCovenantUrl, getOwnCovenant, signAssociationCovenant, type CovenantView } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, errorStyle, inputStyle, labelStyle, primaryButtonStyle, secondaryButtonStyle, successStyle } from '../../lib/ui';

export default function AssociationCovenantPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ASSOCIATION']);
  const router = useRouter();
  const [covenant, setCovenant] = useState<CovenantView | null>(null);
  const [representativeName, setRepresentativeName] = useState('');
  const [representativeTitle, setRepresentativeTitle] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [password, setPassword] = useState('');
  const [signature, setSignature] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (user) void getOwnCovenant().then((value) => { setCovenant(value); setRepresentativeName(value.representativeName ?? ''); setRepresentativeTitle(value.representativeTitle ?? ''); }).catch((reason) => setError(readError(reason))); }, [user]);

  async function submit() {
    if (!signature || !authorized || !accepted || !representativeName.trim() || !representativeTitle.trim() || !password) { setError('أكمل بيانات الممثل والإقرارين والتوقيع وكلمة المرور الحالية.'); setConfirming(false); return; }
    setBusy(true); setError('');
    try { await signAssociationCovenant({ representativeName, representativeTitle, currentPassword: password, signature }); setPassword(''); setConfirming(false); setCovenant(await getOwnCovenant()); }
    catch (reason) { setError(readError(reason)); setConfirming(false); }
    finally { setBusy(false); }
  }

  async function downloadFinal() { const result = await getFinalCovenantUrl(); window.open(result.url, '_blank', 'noopener,noreferrer'); }

  if (guardLoading || !user) return null;
  return <AppShell user={user} restricted>
    <div style={{ maxWidth: 1040, marginInline: 'auto', display: 'grid', gap: 18 }}>
      <header><p style={{ margin: 0, color: 'var(--muted)' }}>مشروع الأجهزة الكهربائية</p><h1 style={{ margin: '6px 0' }}>ميثاق الالتزام بالمشاركة والتنفيذ</h1><p style={{ margin: 0 }}>النسخة القانونية المعتمدة 1.0 — اقرأ الوثيقة كاملة قبل التوقيع.</p></header>
      {error && <p role="alert" style={errorStyle}>{error}</p>}
      {!covenant ? <section style={cardStyle}>جارٍ تحميل الميثاق…</section> : covenant.status === 'SIGNED' ? <section style={{ ...cardStyle, ...successStyle }}><h2>الميثاق معتمد ومكتمل</h2><p>رقم الميثاق: <b dir="ltr">{covenant.reference}</b></p><p>الإصدار: {covenant.version} — تاريخ الاعتماد: {formatDate(covenant.fullyExecutedAt)}</p><button type="button" style={primaryButtonStyle} onClick={() => void downloadFinal()}>تنزيل النسخة النهائية</button><button type="button" style={{ ...secondaryButtonStyle, marginInlineStart: 8 }} onClick={() => router.replace('/association')}>الدخول إلى بوابة الجمعية</button></section> : <>
        <section style={cardStyle}><h2>الوثيقة المعتمدة</h2><iframe title="ميثاق الالتزام — النسخة 1.0" src={covenantTemplateUrl()} style={{ width: '100%', minHeight: '72vh', border: '1px solid #d7c8cf', borderRadius: 10, background: '#fff' }} /></section>
        {covenant.status === 'SIGNED_BY_ORG' ? <section style={{ ...cardStyle, ...successStyle }}><h2>تم اعتماد الميثاق من الجمعية</h2><p>بانتظار استكمال اعتماد الطرف الأول. ستظل العمليات مقيدة حتى اكتمال التوقيعين.</p><p>ممثل الجمعية: {covenant.representativeName} — {covenant.representativeTitle}</p></section> : <section style={cardStyle}><h2>توقيع ممثل الجمعية المخول</h2><div className="form-grid"><label style={labelStyle}>اسم الممثل المخول<input style={inputStyle} maxLength={200} value={representativeName} onChange={(event) => setRepresentativeName(event.target.value)} /></label><label style={labelStyle}>الصفة<input style={inputStyle} maxLength={120} value={representativeTitle} onChange={(event) => setRepresentativeTitle(event.target.value)} /></label></div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBlock: 14 }}><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />أقر بأنني مخول بتمثيل الجمعية واعتماد هذا الميثاق نيابة عنها.</label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBlock: 14 }}><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />أقر بأنني اطلعت على الميثاق وفهمت أحكامه وأوافق عليها.</label>
          <SignaturePad onReady={setSignature} />
          <label style={{ ...labelStyle, marginTop: 14 }}>كلمة المرور الحالية للتأكيد النهائي<input type="password" autoComplete="current-password" style={inputStyle} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button type="button" style={{ ...primaryButtonStyle, marginTop: 14 }} disabled={busy} onClick={() => setConfirming(true)}>مراجعة واعتماد الميثاق</button>
        </section>}
      </>}
    </div>
    {confirming && <ConfirmDialog title="التأكيد النهائي لتوقيع الجمعية" message="سيُحفظ توقيعك وإقرارك كجزء ثابت من ميثاق النسخة 1.0، ولا يمكن استبداله بعد الاعتماد. هل تريد المتابعة؟" confirmLabel={busy ? 'جارٍ الاعتماد…' : 'اعتماد التوقيع'} tone="primary" onConfirm={() => void submit()} onCancel={() => setConfirming(false)} />}
  </AppShell>;
}

function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function readError(reason: unknown) { return reason instanceof ApiClientError ? reason.message : 'تعذّر إكمال العملية. حاول مرة أخرى.'; }
