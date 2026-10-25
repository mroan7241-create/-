'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SignaturePad } from '../components/SignaturePad';
import { LoadingState } from '../components/States';
import { apiFetch, apiUpload, ApiClientError, newOpId, signerTemplateBlob } from '../lib/api';
import { useRoleGuard } from '../lib/use-role-guard';
import { cardStyle, errorStyle, primaryButtonStyle, secondaryButtonStyle, successStyle } from '../lib/ui';

type Row = { id: string; reference: string | null; associationName: string; status: string; signedByOrgAt: string | null; signedByZaadAt: string | null };
type View = { reference: string; version: string; status: string; associationName: string; associationRepresentative: string; associationRepresentativeTitle: string; partyOneRepresentative: string; partyOneTitle: string };

export default function SignerPage() {
  const { user, loading } = useRoleGuard(['COVENANT_SIGNER']);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [image, setImage] = useState('');
  const [template, setTemplate] = useState('');
  const [signature, setSignature] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submitting = useRef(false);
  const opId = useRef('');
  const deepLinkHandled = useRef(false);
  const load = useCallback(async () => { setRows(await apiFetch<Row[]>('/participations/signer/agreements')); }, []);
  useEffect(() => { if (!user) return; void load().catch(() => setError('تعذّر تحميل المواثيق. أعد المحاولة.')); }, [user, load]);
  useEffect(() => {
    if (!rows || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const id = new URLSearchParams(window.location.search).get('agreement');
    if (id && rows.some(row => row.id === id)) setSelected(id);
    // Consume the deep link once; back-to-list must not reopen it.
  }, [rows]);
  useEffect(() => {
    setView(null); setImage(''); setTemplate(''); setSignature(null); opId.current = newOpId(); setError('');
    if (!user || !selected) return;
    let active = true;
    let objectUrl = '';
    const base = `/participations/signer/agreements/${encodeURIComponent(selected)}`;
    void Promise.all([apiFetch<View>(base), apiFetch<{ url: string }>(`${base}/association-signature`), signerTemplateBlob(selected)]).then(([data, file, pdf]) => { if (active) { objectUrl = URL.createObjectURL(pdf); setView(data); setImage(file.url); setTemplate(objectUrl); } }).catch(reason => { if (active) setError(readError(reason)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [user, selected]);

  async function sign() {
    if (submitting.current || !selected || !signature) { setConfirming(false); return; }
    submitting.current = true; setBusy(true); setError('');
    const form = new FormData(); form.set('opId', opId.current); form.set('signature', signature);
    try {
      await apiUpload(`/participations/signer/agreements/${encodeURIComponent(selected)}/sign`, form);
      setSelected(null); setView(null); setSignature(null); setNotice('اكتمل اعتماد الميثاق. سُجّلت النسخ النهائية للإرسال.');
      await load();
    } catch (reason) { setError(readError(reason)); }
    finally { setBusy(false); submitting.current = false; setConfirming(false); }
  }

  async function final(id: string) {
    setError('');
    try { const file = await apiFetch<{ url: string }>(`/participations/signer/agreements/${encodeURIComponent(id)}/final`); window.location.assign(file.url); }
    catch (reason) { setError(readError(reason)); }
  }

  if (loading || !user) return <LoadingState label="جارٍ فتح بوابة المواثيق…" />;
  const pending = rows?.filter(row => row.status === 'SIGNED_BY_ORG') ?? [];
  const completed = rows?.filter(row => row.status === 'SIGNED') ?? [];
  return <AppShell user={user}>
    <header><h1>المواثيق</h1><p>مرحبًا، {user.name} — مراجعة واعتماد المواثيق المسندة إليكم.</p></header>
    {error && <p role="alert" style={errorStyle}>{error}</p>}
    {notice && <p role="status" style={successStyle}>{notice}</p>}
    {!selected ? <>
      <section style={cardStyle}><h2>بانتظار توقيعكم: {rows ? pending.length : '…'}</h2><p>المكتملة: {rows ? completed.length : '…'}</p>
        <button type="button" style={secondaryButtonStyle} onClick={() => void load().catch(() => setError('تعذّر تحديث المواثيق.'))}>تحديث القائمة</button>
      </section>
      {!rows ? <LoadingState /> : <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
        {pending.length === 0 && <p>لا توجد مواثيق بانتظار توقيعكم.</p>}
        {[...pending, ...completed].map(row => <section style={cardStyle} key={row.id}>
          <h2>{row.associationName}</h2><p>رقم الميثاق: <b dir="ltr">{row.reference}</b></p>
          <p>توقيع الجمعية: {row.signedByOrgAt ? new Date(row.signedByOrgAt).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' }) : '—'}</p>
          {row.status === 'SIGNED' ? <><p>مكتمل — موقّع من الطرفين</p><button type="button" style={secondaryButtonStyle} onClick={() => void final(row.id)}>تنزيل النسخة النهائية</button></> :
            <button type="button" style={primaryButtonStyle} onClick={() => { setNotice(''); setSelected(row.id); }}>مراجعة وتوقيع</button>}
        </section>)}
      </div>}
    </> : <>
      <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => { setSelected(null); setView(null); setSignature(null); }}>العودة إلى قائمة المواثيق</button>
      {!view ? (!error && <LoadingState />) : <div style={{ display: 'grid', gap: 18, marginTop: 18 }}>
        <section style={cardStyle}><h2>{view.associationName}</h2><p>الميثاق: <b dir="ltr">{view.reference}</b> — الإصدار {view.version}</p>
          <p>ممثل الجمعية: {view.associationRepresentative} — {view.associationRepresentativeTitle}</p>
          {image && <><h3>توقيع الجمعية</h3><img src={image} alt="توقيع ممثل الجمعية" style={{ width: '100%', maxWidth: 360, height: 150, objectFit: 'contain', background: 'white' }} /></>}
        </section>
        <section style={cardStyle}><h2>الميثاق المعتمد للمراجعة</h2><iframe title="نص الميثاق" src={template} style={{ width: '100%', minHeight: '65vh', border: '1px solid #d7c8cf', borderRadius: 10 }} /></section>
        {view.status === 'SIGNED_BY_ORG' ? <section style={cardStyle}><h2>توقيع الطرف الأول</h2><p>{view.partyOneRepresentative} — {view.partyOneTitle}</p>
          <SignaturePad key={selected} onReady={setSignature} label="توقيع الطرف الأول" />
          <button type="button" style={{ ...primaryButtonStyle, marginTop: 16 }} disabled={busy || !signature} onClick={() => setConfirming(true)}>مراجعة واعتماد الميثاق</button>
        </section> : <section style={cardStyle}><p>اكتمل توقيع هذا الميثاق.</p><button type="button" style={secondaryButtonStyle} onClick={() => void final(selected)}>تنزيل النسخة النهائية</button></section>}
      </div>}
    </>}
    {confirming && <ConfirmDialog title="اعتماد الميثاق" message={`أؤكد أنني الممثل المخول، وراجعت ميثاق ${view?.associationName ?? ''} وأوافق على اعتماده بتوقيعي. ستُحفظ نسخة نهائية ويُغلق توقيع هذا الميثاق.`} confirmLabel={busy ? 'جارٍ الاعتماد…' : 'توقيع واعتماد هذا الميثاق'} tone="primary" onConfirm={sign} onCancel={() => { if (!busy) setConfirming(false); }} />}
  </AppShell>;
}
function readError(error: unknown) { return error instanceof ApiClientError ? error.message : 'تعذّر إكمال العملية. تحقق من الاتصال ثم أعد المحاولة.'; }
