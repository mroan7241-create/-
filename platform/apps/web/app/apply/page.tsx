'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiClientError, apiUpload, getReferenceData, type ReferenceData } from '../lib/api';
import { cardStyle, errorStyle, honeypotWrapperStyle, inputStyle, labelStyle, ltrStyle, mutedStyle, narrowPageStyle, primaryButtonStyle, secondaryButtonStyle, successStyle } from '../lib/ui';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const CLIENT_REQUEST_ID_KEY = 'alzad.apply.clientRequestId';
const LAST_SUBMITTED_KEY = 'alzad.apply.lastClientRequestId';
interface SubmitSuccess { id: string; message: string; duplicate?: boolean }

export default function ApplyPage() {
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [clientRequestId, setClientRequestId] = useState('');
  const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [sector, setSector] = useState('');
  const [region, setRegion] = useState(''); const [city, setCity] = useState(''); const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(''); const [contactName, setContactName] = useState(''); const [address, setAddress] = useState('');
  const [serviceScope, setServiceScope] = useState(''); const [coordinatorPhone, setCoordinatorPhone] = useState('');
  const [coordinatorEmail, setCoordinatorEmail] = useState(''); const [coordinatorTitle, setCoordinatorTitle] = useState('');
  const [beneficiaryDatabaseUpdatedAt, setBeneficiaryDatabaseUpdatedAt] = useState(''); const [approxBeneficiaryCount, setApproxBeneficiaryCount] = useState('');
  const [approxNeedCount, setApproxNeedCount] = useState(''); const [initialBeneficiaryFile, setInitialBeneficiaryFile] = useState<File | null>(null);
  const [notes, setNotes] = useState(''); const [licenseNumber, setLicenseNumber] = useState(''); const [licenseExpiryDate, setLicenseExpiryDate] = useState('');
  const [answers, setAnswers] = useState<Record<string, boolean>>({}); const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [pledgeAccepted, setPledgeAccepted] = useState(false); const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null); const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false); const [success, setSuccess] = useState<SubmitSuccess | null>(null);

  useEffect(() => { const existing = sessionStorage.getItem(CLIENT_REQUEST_ID_KEY); const value = existing || crypto.randomUUID(); if (!existing) sessionStorage.setItem(CLIENT_REQUEST_ID_KEY, value); setClientRequestId(value); }, []);
  useEffect(() => { getReferenceData().then(setReference).catch(() => setReferenceError('تعذّر تحميل القوائم المرجعية. أعد تحميل الصفحة أو تواصل مع إدارة المشروع.')); }, []);
  const cities = useMemo(() => (region && reference ? (reference.citiesByRegion[region] ?? []) : []), [region, reference]);

  function onFileChange(file: File | null) {
    setFileError(null); if (!file) return setLicenseFile(null);
    if (!ALLOWED_TYPES.includes(file.type)) { setFileError('أرفق صورة الترخيص بصيغة JPG أو PNG أو WEBP.'); return setLicenseFile(null); }
    if (file.size > MAX_FILE_BYTES) { setFileError('حجم ملف الترخيص يتجاوز 8 ميجابايت.'); return setLicenseFile(null); }
    setLicenseFile(file);
  }
  function next() {
    setError(null);
    if (step === 1 && (!name.trim() || !sector || !region || !city || !/^05\d{8}$/.test(phone) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) || !contactName.trim())) { setError('أكمل بيانات الجمعية والتواصل المطلوبة، وتحقق من رقم الجوال والبريد الإلكتروني.'); return; }
    if (step === 2 && (!licenseNumber.trim() || !licenseExpiryDate || !licenseFile)) { setError('أكمل بيانات الترخيص وأرفق صورة الترخيص.'); return; }
    setStep((step + 1) as 2 | 3); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); if (!reference || !licenseFile) return;
    const missing = reference.applicationQuestions.find(q => typeof answers[q.key] !== 'boolean'); if (missing) return setError(`${missing.label} — أجب بنعم أو لا.`);
    if (!pledgeAccepted) return setError('يجب الموافقة على نص الإقرار قبل إرسال الطلب.');
    const form = new FormData();
    const values: Record<string, string> = { clientRequestId, name, category, sector, region, city, phone, email, contactName, address, serviceScope, coordinatorPhone, coordinatorEmail, coordinatorTitle, beneficiaryDatabaseUpdatedAt, approxBeneficiaryCount, approxNeedCount, notes, licenseNumber, licenseExpiryDate, answers: JSON.stringify(answers), pledgeAccepted: 'true', website };
    for (const [key, value] of Object.entries(values)) if (value) form.append(key, value);
    if (initialBeneficiaryFile) form.append('initialBeneficiaryFile', initialBeneficiaryFile); form.append('licenseFile', licenseFile);
    setSubmitting(true); try { const result = await apiUpload<SubmitSuccess>('/association-applications', form); localStorage.setItem(LAST_SUBMITTED_KEY, clientRequestId); setSuccess(result); }
    catch (err) { setError(err instanceof ApiClientError ? err.message : 'تعذّر الاتصال بالخادم. حاول مرة أخرى.'); } finally { setSubmitting(false); }
  }

  if (success) return <main style={narrowPageStyle}><h1 style={{ fontSize: 22 }}>تم استلام طلب المشاركة</h1><section style={cardStyle}><p style={successStyle}>{success.message}</p><p>رقم الطلب: <strong style={ltrStyle}>{success.id}</strong></p><p style={mutedStyle}>احتفظ بمعرّف المتابعة للاطلاع على حالة الطلب.</p><p style={{ ...mutedStyle, ...ltrStyle, wordBreak: 'break-all' }}>{clientRequestId}</p><a href="/apply/status">متابعة حالة الطلب</a></section></main>;
  if (referenceError) return <main style={narrowPageStyle}><p style={errorStyle}>{referenceError}</p></main>;
  if (!reference) return <main style={narrowPageStyle}><p style={mutedStyle}>جارٍ تحميل النموذج…</p></main>;

  const field = (label: string, child: React.ReactNode) => <label style={labelStyle}>{label}{child}</label>;
  return <main style={{ ...narrowPageStyle, maxWidth: 920 }}>
    <h1 style={{ fontSize: 24, marginBottom: 8 }}>التقديم على فرصة المشاركة في مشروع الأجهزة الكهربائية</h1>
    <p style={{ ...mutedStyle, marginTop: 0 }}>يخضع الطلب للمراجعة والتقييم، والتقديم لا يعني القبول.</p>
    <ol aria-label="خطوات التقديم" style={progressStyle}>{['بيانات الجمعية والتواصل', 'الجاهزية والمستفيدون والترخيص', 'أسئلة القبول والإقرار والمراجعة'].map((label, i) => <li key={label} aria-current={step === i + 1 ? 'step' : undefined} style={progressItemStyle(step >= i + 1)}><strong>{i + 1}</strong><span>{label}</span></li>)}</ol>
    <form onSubmit={submit} noValidate>
      {step === 1 && <section style={sectionStyle}><h2 style={headingStyle}>بيانات الجمعية والتواصل</h2><div style={gridStyle}>
        {field('اسم الجمعية', <input required maxLength={150} value={name} onChange={e => setName(e.target.value)} style={inputStyle} />)}
        {field('التصنيف', <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}><option value="">— اختر —</option>{reference.associationCategories.map(v => <option key={v}>{v}</option>)}</select>)}
        {field('مجال العمل', <select required value={sector} onChange={e => setSector(e.target.value)} style={inputStyle}><option value="">— اختر —</option>{reference.associationSectors.map(v => <option key={v}>{v}</option>)}</select>)}
        {field('المنطقة', <select required value={region} onChange={e => { setRegion(e.target.value); setCity(''); }} style={inputStyle}><option value="">— اختر —</option>{reference.regions.map(v => <option key={v}>{v}</option>)}</select>)}
        {field('المدينة', <select required value={city} onChange={e => setCity(e.target.value)} disabled={!region} style={inputStyle}><option value="">{region ? '— اختر —' : 'اختر المنطقة أولًا'}</option>{cities.map(v => <option key={v}>{v}</option>)}</select>)}
        {field('رقم الجوال', <input required inputMode="tel" placeholder="05XXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} />)}
        {field('البريد الإلكتروني', <input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} />)}
        {field('اسم المسؤول', <input required maxLength={100} value={contactName} onChange={e => setContactName(e.target.value)} style={inputStyle} />)}
        {field('العنوان', <input value={address} onChange={e => setAddress(e.target.value)} style={inputStyle} />)}{field('نطاق الخدمة', <input value={serviceScope} onChange={e => setServiceScope(e.target.value)} style={inputStyle} />)}
        {field('صفة المنسق', <input value={coordinatorTitle} onChange={e => setCoordinatorTitle(e.target.value)} style={inputStyle} />)}{field('جوال المنسق', <input inputMode="tel" value={coordinatorPhone} onChange={e => setCoordinatorPhone(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} />)}
        {field('بريد المنسق', <input type="email" value={coordinatorEmail} onChange={e => setCoordinatorEmail(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} />)}
      </div></section>}
      {step === 2 && <section style={sectionStyle}><h2 style={headingStyle}>الجاهزية والمستفيدون والترخيص</h2><div style={gridStyle}>
        {field('آخر تحديث لقاعدة المستفيدين', <input type="date" value={beneficiaryDatabaseUpdatedAt} onChange={e => setBeneficiaryDatabaseUpdatedAt(e.target.value)} style={inputStyle} />)}
        {field('العدد التقريبي للمستفيدين', <input type="number" min="0" value={approxBeneficiaryCount} onChange={e => setApproxBeneficiaryCount(e.target.value)} style={inputStyle} />)}
        {field('العدد التقريبي للاحتياجات', <input type="number" min="0" value={approxNeedCount} onChange={e => setApproxNeedCount(e.target.value)} style={inputStyle} />)}
        {field('ملف المستفيدين الأولي للتقييم فقط (XLSX)', <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => setInitialBeneficiaryFile(e.target.files?.[0] ?? null)} style={fileInputStyle} />)}
        {field('رقم الترخيص', <input required maxLength={60} value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} />)}
        {field('تاريخ انتهاء الترخيص', <input required type="date" value={licenseExpiryDate} onChange={e => setLicenseExpiryDate(e.target.value)} style={inputStyle} />)}
        {field('صورة الترخيص (JPG أو PNG أو WEBP، بحد أقصى 8 ميجابايت)', <><input required type="file" accept="image/jpeg,image/png,image/webp" onChange={e => onFileChange(e.target.files?.[0] ?? null)} style={fileInputStyle} />{licenseFile && <small>{licenseFile.name}</small>}</>)}
      </div>{field('ملاحظات (اختياري)', <textarea maxLength={500} rows={3} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />)}{fileError && <p role="alert" style={errorStyle}>{fileError}</p>}</section>}
      {step === 3 && <><section style={sectionStyle}><h2 style={headingStyle}>أسئلة القبول</h2>{reference.applicationQuestions.map(q => <fieldset key={q.key} style={questionStyle}><legend>{q.label}</legend><label><input type="radio" name={`q-${q.key}`} checked={answers[q.key] === true} onChange={() => setAnswers(p => ({ ...p, [q.key]: true }))} /> نعم</label><label><input type="radio" name={`q-${q.key}`} checked={answers[q.key] === false} onChange={() => setAnswers(p => ({ ...p, [q.key]: false }))} /> لا</label></fieldset>)}</section><section style={sectionStyle}><h2 style={headingStyle}>الإقرار والمراجعة</h2><dl style={reviewStyle}><dt>الجمعية</dt><dd>{name}</dd><dt>التواصل</dt><dd style={ltrStyle}>{phone} — {email}</dd><dt>الموقع</dt><dd>{region} — {city}</dd><dt>الترخيص</dt><dd style={ltrStyle}>{licenseNumber}</dd></dl><label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={pledgeAccepted} onChange={e => setPledgeAccepted(e.target.checked)} /><span>{reference.pledgeText}</span></label></section></>}
      <div style={honeypotWrapperStyle} aria-hidden="true"><label>الموقع الإلكتروني<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label></div>
      {error && <p role="alert" style={{ ...errorStyle, marginTop: 14 }}>{error}</p>}
      <div style={actionsStyle}>{step > 1 && <button type="button" style={secondaryButtonStyle} onClick={() => { setError(null); setStep((step - 1) as 1 | 2); }}>السابق</button>}{step < 3 ? <button type="button" style={primaryButtonStyle} onClick={next}>التالي</button> : <button type="submit" disabled={submitting} style={primaryButtonStyle}>{submitting ? 'جارٍ الإرسال…' : 'إرسال الطلب'}</button>}<a href="/apply/status" style={{ ...secondaryButtonStyle, textDecoration: 'none' }}>متابعة طلب سابق</a></div>
    </form>
  </main>;
}

const sectionStyle: React.CSSProperties = { ...cardStyle, display: 'flex', flexDirection: 'column', gap: 16 };
const headingStyle: React.CSSProperties = { fontSize: 19, margin: 0 };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 14 };
const fileInputStyle: React.CSSProperties = { ...inputStyle, padding: 8, maxWidth: '100%' };
const progressStyle: React.CSSProperties = { listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, padding: 0, margin: '24px 0' };
const progressItemStyle = (active: boolean): React.CSSProperties => ({ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', borderRadius: 'var(--r-sm)', background: active ? 'var(--zad-100)' : 'var(--paper)', color: active ? 'var(--zad-800)' : 'var(--muted)', fontSize: 13, border: '1px solid var(--line)', minWidth: 0 });
const questionStyle: React.CSSProperties = { border: 0, borderBottom: '1px solid var(--line)', padding: '0 0 14px', display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' };
const reviewStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(80px, auto) 1fr', gap: '8px 16px', margin: 0 };
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 18 };
