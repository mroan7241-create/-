'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ApiClientError,
  apiUpload,
  getReferenceData,
  type ReferenceData,
} from '../lib/api';
import {
  cardStyle,
  errorStyle,
  honeypotWrapperStyle,
  inputStyle,
  labelStyle,
  ltrStyle,
  mutedStyle,
  narrowPageStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  successStyle,
} from '../lib/ui';

/** يطابق حدود الخادم (file-validation.util.ts) — تحقق مسبق لتحسين التجربة فقط؛ الخادم هو البوابة الحقيقية. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const CLIENT_REQUEST_ID_KEY = 'alzad.apply.clientRequestId';
const LAST_SUBMITTED_KEY = 'alzad.apply.lastClientRequestId';

interface SubmitSuccess {
  id: string;
  message: string;
  duplicate?: boolean;
}

export default function ApplyPage() {
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const [clientRequestId, setClientRequestId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [sector, setSector] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [address, setAddress] = useState('');
  const [serviceScope, setServiceScope] = useState('');
  const [coordinatorPhone, setCoordinatorPhone] = useState('');
  const [coordinatorEmail, setCoordinatorEmail] = useState('');
  const [coordinatorTitle, setCoordinatorTitle] = useState('');
  const [beneficiaryDatabaseUpdatedAt, setBeneficiaryDatabaseUpdatedAt] = useState('');
  const [approxBeneficiaryCount, setApproxBeneficiaryCount] = useState('');
  const [approxNeedCount, setApproxNeedCount] = useState('');
  const [initialBeneficiaryFile, setInitialBeneficiaryFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiryDate, setLicenseExpiryDate] = useState('');
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [pledgeAccepted, setPledgeAccepted] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot — يبقى فارغًا من إنسان دائمًا

  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SubmitSuccess | null>(null);

  // معرّف الطلب يُولَّد مرة واحدة فقط ويُحفَظ في sessionStorage — أي إعادة
  // محاولة (بعد خطأ شبكة/خادم) تستخدم نفس المعرّف فلا تُنشئ طلبًا مكرَّرًا.
  useEffect(() => {
    const existing = sessionStorage.getItem(CLIENT_REQUEST_ID_KEY);
    if (existing) {
      setClientRequestId(existing);
      return;
    }
    const generated = crypto.randomUUID();
    sessionStorage.setItem(CLIENT_REQUEST_ID_KEY, generated);
    setClientRequestId(generated);
  }, []);

  useEffect(() => {
    getReferenceData()
      .then(setReference)
      .catch(() => setReferenceError('تعذّر تحميل القوائم المرجعية. أعد تحميل الصفحة أو تواصل مع إدارة المشروع.'));
  }, []);

  const cities = useMemo(() => (region && reference ? (reference.citiesByRegion[region] ?? []) : []), [region, reference]);

  function onRegionChange(value: string) {
    setRegion(value);
    setCity('');
  }

  function onFileChange(file: File | null) {
    setFileError(null);
    if (!file) {
      setLicenseFile(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('أرفق صورة الترخيص بصيغة JPG أو PNG أو WEBP.');
      setLicenseFile(null);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError('حجم ملف الترخيص يتجاوز 8 ميجابايت.');
      setLicenseFile(null);
      return;
    }
    setLicenseFile(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!reference) return;
    if (!licenseFile) {
      setFileError('أرفق صورة الترخيص بصيغة JPG أو PNG أو WEBP.');
      return;
    }
    const missingAnswer = reference.applicationQuestions.find((q) => typeof answers[q.key] !== 'boolean');
    if (missingAnswer) {
      setError(`${missingAnswer.label} — أجب بنعم أو لا.`);
      return;
    }
    if (!pledgeAccepted) {
      setError('يجب الموافقة على نص الإقرار قبل إرسال الطلب.');
      return;
    }

    const form = new FormData();
    form.append('clientRequestId', clientRequestId);
    form.append('name', name);
    form.append('category', category);
    form.append('sector', sector);
    form.append('region', region);
    form.append('city', city);
    form.append('phone', phone);
    form.append('email', email);
    form.append('contactName', contactName);
    if (address) form.append('address', address);
    if (serviceScope) form.append('serviceScope', serviceScope);
    if (coordinatorPhone) form.append('coordinatorPhone', coordinatorPhone);
    if (coordinatorEmail) form.append('coordinatorEmail', coordinatorEmail);
    if (coordinatorTitle) form.append('coordinatorTitle', coordinatorTitle);
    if (beneficiaryDatabaseUpdatedAt) form.append('beneficiaryDatabaseUpdatedAt', beneficiaryDatabaseUpdatedAt);
    if (approxBeneficiaryCount) form.append('approxBeneficiaryCount', approxBeneficiaryCount);
    if (approxNeedCount) form.append('approxNeedCount', approxNeedCount);
    if (initialBeneficiaryFile) form.append('initialBeneficiaryFile', initialBeneficiaryFile);
    if (notes) form.append('notes', notes);
    form.append('licenseNumber', licenseNumber);
    form.append('licenseExpiryDate', licenseExpiryDate);
    form.append('answers', JSON.stringify(answers));
    form.append('pledgeAccepted', String(pledgeAccepted));
    form.append('website', website);
    form.append('licenseFile', licenseFile);

    setSubmitting(true);
    try {
      const res = await apiUpload<SubmitSuccess>('/association-applications', form);
      localStorage.setItem(LAST_SUBMITTED_KEY, clientRequestId);
      setSuccess(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main style={narrowPageStyle}>
        <h1 style={{ fontSize: 22, marginBottom: 16 }}>تم استلام طلب الانضمام</h1>
        <section style={cardStyle}>
          <p style={successStyle}>{success.message}</p>
          <p style={{ marginBottom: 6 }}>
            رقم الطلب: <strong style={ltrStyle}>{success.id}</strong>
          </p>
          <p style={mutedStyle}>
            احتفظ برقم الطلب ومعرّف المتابعة أدناه — يمكنك متابعة حالة الطلب في أي وقت من صفحة المتابعة.
          </p>
          <p style={{ ...mutedStyle, ...ltrStyle, wordBreak: 'break-all' }}>{clientRequestId}</p>
          <p style={{ marginTop: 16, marginBottom: 0 }}>
            <a href="/apply/status">متابعة حالة الطلب</a>
          </p>
        </section>
      </main>
    );
  }

  if (referenceError) {
    return (
      <main style={narrowPageStyle}>
        <p style={errorStyle}>{referenceError}</p>
      </main>
    );
  }

  if (!reference) {
    return (
      <main style={narrowPageStyle}>
        <p style={mutedStyle}>جارٍ تحميل النموذج…</p>
      </main>
    );
  }

  return (
    <main style={narrowPageStyle}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>طلب انضمام جمعية — منصة جمعية الزاد</h1>
      <p style={{ ...mutedStyle, marginTop: 0, marginBottom: 24 }}>
        عبّئ البيانات التالية بدقّة وأرفق صورة الترخيص. سيتم التواصل معكم بعد مراجعة الطلب.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate={false}>
        <section style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 17 }}>بيانات الجمعية</h2>

          <label style={labelStyle}>
            اسم الجمعية
            <input required name="name" maxLength={150} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <label style={labelStyle}>
              تصنيف الجمعية
              <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                <option value="">— اختر —</option>
                {reference.associationCategories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              مجال عمل الجمعية
              <select required name="sector" value={sector} onChange={(e) => setSector(e.target.value)} style={inputStyle}>
                <option value="">— اختر —</option>
                {reference.associationSectors.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              المنطقة
              <select required name="region" value={region} onChange={(e) => onRegionChange(e.target.value)} style={inputStyle}>
                <option value="">— اختر —</option>
                {reference.regions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              المدينة
              <select required name="city" value={city} onChange={(e) => setCity(e.target.value)} style={inputStyle} disabled={!region}>
                <option value="">{region ? '— اختر —' : 'اختر المنطقة أولًا'}</option>
                {cities.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              رقم الجوال
              <input
                required
                name="phone"
                inputMode="tel"
                placeholder="05XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ ...inputStyle, ...ltrStyle }}
              />
            </label>

            <label style={labelStyle}>
              البريد الإلكتروني
              <input
                required
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ ...inputStyle, ...ltrStyle }}
              />
            </label>

            <label style={labelStyle}>
              اسم المسؤول
              <input required name="contactName" maxLength={100} value={contactName} onChange={(e) => setContactName(e.target.value)} style={inputStyle} />
            </label>
            <label style={labelStyle}>العنوان<input value={address} onChange={(e) => setAddress(e.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>نطاق الخدمة<input value={serviceScope} onChange={(e) => setServiceScope(e.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>صفة المنسق<input value={coordinatorTitle} onChange={(e) => setCoordinatorTitle(e.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>جوال المنسق<input value={coordinatorPhone} onChange={(e) => setCoordinatorPhone(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} /></label>
            <label style={labelStyle}>بريد المنسق<input type="email" value={coordinatorEmail} onChange={(e) => setCoordinatorEmail(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} /></label>
            <label style={labelStyle}>آخر تحديث لقاعدة المستفيدين<input type="date" value={beneficiaryDatabaseUpdatedAt} onChange={(e) => setBeneficiaryDatabaseUpdatedAt(e.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>العدد التقريبي للمستفيدين<input type="number" min="0" value={approxBeneficiaryCount} onChange={(e) => setApproxBeneficiaryCount(e.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>العدد التقريبي للاحتياجات<input type="number" min="0" value={approxNeedCount} onChange={(e) => setApproxNeedCount(e.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>ملف المستفيدين الأولي للتقييم فقط (XLSX)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setInitialBeneficiaryFile(e.target.files?.[0] ?? null)} style={inputStyle} /></label>
          </div>

          <label style={labelStyle}>
            ملاحظات (اختياري)
            <textarea name="notes" maxLength={500} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
          </label>
        </section>

        <section style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 17 }}>الترخيص</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <label style={labelStyle}>
              رقم الترخيص
              <input
                required
                name="licenseNumber"
                maxLength={60}
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                style={{ ...inputStyle, ...ltrStyle }}
              />
            </label>
            <label style={labelStyle}>
              تاريخ انتهاء الترخيص
              <input
                required
                name="licenseExpiryDate"
                type="date"
                value={licenseExpiryDate}
                onChange={(e) => setLicenseExpiryDate(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>

          <label style={labelStyle}>
            صورة الترخيص (JPG أو PNG أو WEBP، بحد أقصى 8 ميجابايت)
            <input
              required
              name="licenseFile"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              style={{ ...inputStyle, padding: 8 }}
            />
          </label>
          {licenseFile && <p style={mutedStyle}>الملف المُرفَق: {licenseFile.name}</p>}
          {fileError && (
            <p role="alert" style={errorStyle}>
              {fileError}
            </p>
          )}
        </section>

        <section style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 17 }}>أسئلة القبول</h2>
          {reference.applicationQuestions.map((question) => (
            <div
              key={question.key}
              style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
            >
              <span style={{ fontSize: 14, flex: '1 1 240px' }}>{question.label}</span>
              <span style={{ display: 'flex', gap: 12 }}>
                {[
                  { label: 'نعم', value: true },
                  { label: 'لا', value: false },
                ].map((option) => (
                  <label key={option.label} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                    <input
                      type="radio"
                      name={`q-${question.key}`}
                      checked={answers[question.key] === option.value}
                      onChange={() => setAnswers((prev) => ({ ...prev, [question.key]: option.value }))}
                    />
                    {option.label}
                  </label>
                ))}
              </span>
            </div>
          ))}
        </section>

        <section style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 17 }}>الإقرار</h2>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
            <input type="checkbox" name="pledgeAccepted" checked={pledgeAccepted} onChange={(e) => setPledgeAccepted(e.target.checked)} style={{ marginTop: 4 }} />
            <span>{reference.pledgeText}</span>
          </label>
        </section>

        {/* فخ العناكب الآلية — مخفي عن الإنسان وقارئات الشاشة، وأي قيمة فيه تعني برنامجًا آليًا. */}
        <div style={honeypotWrapperStyle} aria-hidden="true">
          <label>
            الموقع الإلكتروني
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" disabled={submitting} style={primaryButtonStyle}>
            {submitting ? 'جارٍ الإرسال…' : 'إرسال الطلب'}
          </button>
          <a href="/apply/status" style={{ ...secondaryButtonStyle, textDecoration: 'none' }}>
            متابعة طلب سابق
          </a>
        </div>
      </form>
    </main>
  );
}
