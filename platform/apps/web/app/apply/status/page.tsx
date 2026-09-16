'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { APPLICATION_STATUS_LABELS, ApiClientError, apiFetch, submitApplicationInformation, trackApplicationV2, uploadApplicationAttachment, type ApplicationPublicStatus, type ApplicationTrackView } from '../../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, ltrStyle, mutedStyle, narrowPageStyle, primaryButtonStyle, secondaryButtonStyle, statusBadgeStyle, successStyle } from '../../lib/ui';

const DRAFT_KEY = 'alzad.apply.v2.draft';
const LAST_SUBMITTED_KEY = 'alzad.apply.lastClientRequestId';

export default function ApplicationStatusPage() {
  const [version, setVersion] = useState<'V2' | 'V1'>('V2');
  const [draftCode, setDraftCode] = useState(''); const [resumeToken, setResumeToken] = useState(''); const [legacyId, setLegacyId] = useState('');
  const [result, setResult] = useState<ApplicationTrackView | ApplicationPublicStatus | null>(null); const [response, setResponse] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(''); const [loading, setLoading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);

  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') as { draftCode?: string; resumeToken?: string; viaSession?: boolean } | null; if (saved?.draftCode && (saved.resumeToken || saved.viaSession)) { setDraftCode(saved.draftCode); setResumeToken(saved.resumeToken ?? ''); } } catch { /* browser convenience only */ }
    setLegacyId(localStorage.getItem(LAST_SUBMITTED_KEY) || '');
  }, []);

  async function lookup(event: FormEvent) {
    event.preventDefault(); setMessage(''); setResult(null); setLoading(true);
    try { setResult(version === 'V2' ? await trackApplicationV2(draftCode.trim(), resumeToken.trim()) : await apiFetch<ApplicationPublicStatus>(`/association-applications/status/${encodeURIComponent(legacyId.trim())}`)); }
    catch (reason) { setMessage(readError(reason)); } finally { setLoading(false); }
  }

  const current = result && 'stage' in result ? result : null; const legacy = result && 'found' in result ? result : null; const needsInfo = current?.needsInfo;
  async function sendInformation() {
    if (!needsInfo || !current?.draftCode) return; setLoading(true); setMessage('');
    try { const payload = Object.fromEntries(needsInfo.items.filter((item) => item.type === 'FIELD').map((item) => [item.key, response[item.key]?.trim()])); await submitApplicationInformation(current.draftCode, resumeToken.trim(), needsInfo.id, payload); setResult(await trackApplicationV2(current.draftCode, resumeToken.trim())); setMessage('تم إرسال المعلومات المطلوبة على الطلب نفسه بنجاح.'); }
    catch (reason) { setMessage(readError(reason)); } finally { setLoading(false); }
  }

  return <main style={narrowPageStyle}>
    <h1 style={{ fontSize: 24, marginBottom: 8 }}>متابعة طلب انضمام جمعية</h1><p style={{ ...mutedStyle, marginTop: 0 }}>يمكن متابعة الطلب المحفوظ على هذا الجهاز دون كتابة رموز سرية.</p>
    <div className="button-row" role="tablist" aria-label="نوع الطلب"><button type="button" style={version === 'V2' ? primaryButtonStyle : secondaryButtonStyle} onClick={() => { setVersion('V2'); setResult(null); }}>الطلب الحالي</button><button type="button" style={version === 'V1' ? primaryButtonStyle : secondaryButtonStyle} onClick={() => { setVersion('V1'); setResult(null); }}>طلب سابق</button></div>
    <form onSubmit={lookup} style={{ ...cardStyle, display: 'grid', gap: 14, marginTop: 16 }}>
      {version === 'V2' ? (draftCode ? <p style={{ margin: 0 }}>تم العثور على طلب محفوظ بأمان على هذا الجهاز.</p> : <p style={{ margin: 0 }}>لا يوجد طلب محفوظ على هذا الجهاز. اطلب رابط متابعة من صفحة التقديم باستخدام البريد الرسمي.</p>) : <label style={labelStyle}>معرّف المتابعة القديم<input required value={legacyId} onChange={(e) => setLegacyId(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} /></label>}
      <button disabled={loading || (version === 'V2' ? !draftCode : !legacyId.trim())} style={primaryButtonStyle}>{loading ? 'جارٍ التحميل…' : 'عرض الحالة'}</button>{message && <p role="status" style={message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}
    </form>
    {current && <section style={{ ...cardStyle, marginTop: 20 }}><h2>حالة الطلب</h2><ol style={{ display: 'grid', gap: 10, paddingInlineStart: 24 }}>{current.timeline.map((item) => <li key={item.key}><strong>{item.label}</strong> — {item.state === 'COMPLETED' ? 'مكتملة' : item.state === 'CURRENT' ? 'الحالة الحالية' : 'قادمة'}</li>)}</ol>
      {needsInfo && <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}><h3>معلومات مطلوبة لاستكمال المراجعة</h3>{needsInfo.note && <p>{needsInfo.note}</p>}{needsInfo.deadline && <p>المهلة: {new Date(needsInfo.deadline).toLocaleDateString('ar-SA')}</p>}<div style={{ display: 'grid', gap: 12 }}>{needsInfo.items.map((item) => item.type === 'FIELD' ? <label key={item.key} style={labelStyle}>{item.reason}<textarea style={{ ...inputStyle, minHeight: 90 }} value={response[item.key] || ''} onChange={(e) => setResponse((old) => ({ ...old, [item.key]: e.target.value }))} /></label> : <label key={item.key} style={labelStyle}>{item.reason}<input type="file" style={inputStyle} onChange={async (event) => { const file = event.target.files?.[0]; if (!file || !current.draftCode) return; setLoading(true); setMessage(''); try { await uploadApplicationAttachment(current.draftCode, resumeToken.trim(), item.key, file); setUploaded((old) => [...new Set([...old, item.key])]); setMessage('تم رفع المرفق وحفظه بأمان.'); } catch (reason) { setMessage(readError(reason)); } finally { setLoading(false); } }} />{uploaded.includes(item.key) && <small>تم الرفع.</small>}</label>)}</div><button type="button" disabled={loading || needsInfo.items.some((item) => item.type === 'FIELD' ? !response[item.key]?.trim() : !uploaded.includes(item.key))} style={primaryButtonStyle} onClick={() => void sendInformation()}>إرسال الاستكمال</button></div>}
    </section>}
    {legacy && <section style={{ ...cardStyle, marginTop: 20 }}>{!legacy.found ? <p>لا يوجد طلب مطابق لهذا المعرّف.</p> : <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}><dt>رقم الطلب</dt><dd style={{ ...ltrStyle, margin: 0 }}>{legacy.id}</dd><dt>الحالة</dt><dd style={{ margin: 0 }}><span style={statusBadgeStyle(legacy.status === 'ACCEPTED' ? 'good' : legacy.status === 'REJECTED' ? 'bad' : 'neutral')}>{legacy.status ? APPLICATION_STATUS_LABELS[legacy.status] : '—'}</span></dd><dt>تاريخ التقديم</dt><dd style={{ margin: 0 }}>{legacy.submittedAt ? new Date(legacy.submittedAt).toLocaleDateString('ar-SA') : '—'}</dd>{legacy.status === 'REJECTED' && legacy.rejectionReason && <><dt>سبب الرفض</dt><dd style={{ margin: 0 }}>{legacy.rejectionReason}</dd></>}</dl>}</section>}
  </main>;
}

function readError(reason: unknown) { return reason instanceof ApiClientError || reason instanceof Error ? reason.message : 'تعذّر الاتصال بالخادم. حاول مرة أخرى.'; }
