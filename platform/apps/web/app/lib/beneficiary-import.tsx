'use client';

import { useState } from 'react';
import {
  ApiClientError,
  DEVICE_TYPE_LABELS,
  downloadXlsxTemplate,
  importBeneficiaries,
  previewXlsxImport,
  type BeneficiaryImportRow,
  type DeviceType,
} from './api';
import { AssociationSelect } from './association-select';
import { cardStyle, errorStyle, inputStyle, modalOverlayStyle, modalStyle, mutedStyle, primaryButtonStyle, secondaryButtonStyle, successStyle, tableStyle, tdStyle, thStyle } from './ui';

/**
 * استيراد بالجملة (BEN-013/BEN-014) — مساران:
 *  - CSV: يُحلَّل بالكامل في المتصفح (بلا مكتبة خارجية، تحليل بسيط كافٍ
 *    لصيغة أعمدة ثابتة).
 *  - XLSX (.xlsx): التحليل الثنائي يحدث **حصرًا** على الخادم (`exceljs`،
 *    راجع apps/api/src/modules/beneficiaries/xlsx-import.util.ts للقرار
 *    الموثَّق حول اختيار المكتبة) — يوازي `inspectBeneficiaryExcel` القديمة
 *    (معاينة بلا كتابة)، ثم الالتزام الفعلي عبر نفس مسار الاستيراد
 *    المُتشارَك مع CSV (`POST /beneficiaries/import`).
 * كلا المسارين ينتهيان بنفس شكل معاينة موحَّد (`PreviewRow[]`) فيتشاركان
 * جدول العرض وزر الالتزام نفسه.
 */

const REQUIRED_HEADERS = ['name', 'region', 'city', 'district', 'phone', 'familyCount', 'socialStatus', 'deviceTypes'] as const;
const ALL_HEADERS = [...REQUIRED_HEADERS, 'phone2', 'socialSecurity', 'income', 'notes', 'lat', 'lng'] as const;

const DEVICE_LABEL_TO_TYPE: Record<string, DeviceType> = Object.fromEntries(
  Object.entries(DEVICE_TYPE_LABELS).map(([type, label]) => [label, type as DeviceType]),
);

function downloadCsvTemplate() {
  const headerRow = ALL_HEADERS.join(',');
  const exampleRow = ['اسم تجريبي', 'الرياض', 'الرياض', 'حي النرجس', '0500000001', '', '5', 'أرملة', 'لا', '2000', '', '', '', 'ثلاجة،فرن'].join(',');
  const csv = `${headerRow}\n${exampleRow}\n`;
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'قالب-استيراد-المستفيدين.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** تحليل CSV بسيط — يدعم فواصل حقول مقتبَسة بـ"" (تكفي لحالة أسماء/ملاحظات تحوي فواصل). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // تجاهل — \n التالية تُنهي السطر
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  return rows;
}

interface PreviewRow {
  raw: Record<string, string>;
  row?: BeneficiaryImportRow;
  error?: string;
}

function buildPreviewRows(csvRows: string[][]): { headers: string[]; preview: PreviewRow[]; headerError?: string } {
  if (csvRows.length === 0) return { headers: [], preview: [], headerError: 'الملف فارغ.' };
  const headers = csvRows[0].map((h) => h.trim());
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return { headers, preview: [], headerError: `أعمدة إلزامية ناقصة: ${missing.join('، ')}` };
  }

  const preview: PreviewRow[] = [];
  for (const dataRow of csvRows.slice(1)) {
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { raw[h] = (dataRow[i] ?? '').trim(); });

    try {
      const deviceTypes = raw.deviceTypes
        .split(/[،,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label) => {
          const type = DEVICE_LABEL_TO_TYPE[label];
          if (!type) throw new Error(`نوع جهاز غير معروف: "${label}"`);
          return type;
        });
      if (deviceTypes.length === 0) throw new Error('عمود deviceTypes فارغ — اكتب نوعًا واحدًا على الأقل (ثلاجة/فرن/غسالة)');

      const familyCount = Number(raw.familyCount);
      if (!Number.isFinite(familyCount)) throw new Error('familyCount ليس رقمًا صالحًا');

      const row: BeneficiaryImportRow = {
        name: raw.name,
        region: raw.region,
        city: raw.city,
        district: raw.district,
        phone: raw.phone,
        phone2: raw.phone2 || undefined,
        familyCount,
        socialSecurity: raw.socialSecurity === 'نعم' || raw.socialSecurity?.toLowerCase() === 'true',
        socialStatus: raw.socialStatus,
        income: raw.income ? Number(raw.income) : undefined,
        notes: raw.notes || undefined,
        lat: raw.lat ? Number(raw.lat) : undefined,
        lng: raw.lng ? Number(raw.lng) : undefined,
        deviceTypes,
      };
      if (!row.name || !row.region || !row.city || !row.district || !row.phone || !row.socialStatus) {
        throw new Error('حقل إلزامي فارغ');
      }
      preview.push({ raw, row });
    } catch (err) {
      preview.push({ raw, error: err instanceof Error ? err.message : 'صف غير صالح' });
    }
  }
  return { headers, preview };
}

export function BulkImportButton({ isAdmin, onImported }: { isAdmin: boolean; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" style={secondaryButtonStyle} onClick={() => setOpen(true)}>استيراد بالجملة</button>
      {open && <BulkImportModal isAdmin={isAdmin} onClose={() => setOpen(false)} onImported={() => { setOpen(false); onImported(); }} />}
    </>
  );
}

function BulkImportModal({ isAdmin, onClose, onImported }: { isAdmin: boolean; onClose: () => void; onImported: () => void }) {
  const [associationId, setAssociationId] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [headerError, setHeaderError] = useState('');
  const [pledge, setPledge] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitErrors, setSubmitErrors] = useState<{ row: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);

  function resetPreview() {
    setSubmitError('');
    setSubmitErrors([]);
    setHeaders([]);
    setPreview([]);
    setHeaderError('');
  }

  function handleCsvFile(file: File) {
    setFileName(file.name);
    resetPreview();
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const csvRows = parseCsv(text);
      const result = buildPreviewRows(csvRows);
      setHeaders(result.headers);
      setPreview(result.preview);
      setHeaderError(result.headerError ?? '');
    };
    reader.readAsText(file, 'utf-8');
  }

  async function handleXlsxFile(file: File) {
    setFileName(file.name);
    resetPreview();
    setParsing(true);
    try {
      const res = await previewXlsxImport(file);
      setHeaders(res.headers);
      setPreview(res.rows.map((r) => ({ raw: r.raw, row: r.parsed, error: r.error })));
    } catch (err) {
      setHeaderError(err instanceof ApiClientError ? err.message : 'تعذّرت قراءة الملف — تأكد أنه ملف Excel (.xlsx) صالح.');
    } finally {
      setParsing(false);
    }
  }

  function handleFile(file: File) {
    if (file.name.toLowerCase().endsWith('.xlsx')) void handleXlsxFile(file);
    else handleCsvFile(file);
  }

  const validRows = preview.filter((p) => p.row && !p.error).map((p) => p.row!);
  const errorRows = preview.filter((p) => p.error);
  const canSubmit = !headerError && preview.length > 0 && errorRows.length === 0 && pledge && (!isAdmin || associationId) && !busy;

  async function submit() {
    setBusy(true);
    setSubmitError('');
    setSubmitErrors([]);
    try {
      const res = await importBeneficiaries({ associationId: isAdmin ? associationId : undefined, acceptedPledge: pledge, rows: validRows });
      if (res.ok) {
        onImported();
      } else {
        setSubmitErrors(res.errors);
      }
    } catch (err) {
      setSubmitError(err instanceof ApiClientError ? err.message : 'تعذّر تنفيذ الاستيراد. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <section style={{ ...modalStyle, maxWidth: 720, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 19 }}>استيراد مستفيدين بالجملة</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق</button>
        </div>

        <p style={mutedStyle}>
          ارفع ملف CSV أو Excel (.xlsx) بنفس ترتيب أعمدة القالب. عمود <code>deviceTypes</code> يقبل أكثر من نوع مفصولة بفاصلة عربية «،» (مثال: ثلاجة،فرن).
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={secondaryButtonStyle} onClick={downloadCsvTemplate}>⬇ تنزيل قالب CSV</button>
          <button type="button" style={secondaryButtonStyle} onClick={() => void downloadXlsxTemplate().catch(() => setHeaderError('تعذّر تنزيل قالب Excel.'))}>⬇ تنزيل قالب Excel</button>
        </div>

        {isAdmin && (
          <div style={{ marginTop: 14, maxWidth: 320 }}>
            <label style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>الجمعية</label>
            <AssociationSelect value={associationId} onChange={setAssociationId} placeholder="ابحث واختر الجمعية..." />
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} style={inputStyle} />
          {fileName && <p style={mutedStyle}>الملف: {fileName}</p>}
          {parsing && <p style={mutedStyle}>جارٍ قراءة الملف على الخادم…</p>}
        </div>

        {headerError && <p role="alert" style={errorStyle}>{headerError}</p>}

        {preview.length > 0 && !headerError && (
          <>
            <h3 style={{ fontSize: 15, marginTop: 16 }}>معاينة ({preview.length} صف، {errorRows.length} به خطأ)</h3>
            <div style={{ ...cardStyle, padding: 0, overflowX: 'auto', maxHeight: 260 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>الاسم</th>
                    <th style={thStyle}>الجوال</th>
                    <th style={thStyle}>الأجهزة</th>
                    <th style={thStyle}>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} style={p.error ? { background: 'var(--gold-100)' } : undefined}>
                      <td style={tdStyle}>{i + 2}</td>
                      <td style={tdStyle}>{p.raw.name}</td>
                      <td style={tdStyle}>{p.raw.phone}</td>
                      <td style={tdStyle}>{p.raw.deviceTypes}</td>
                      <td style={tdStyle}>{p.error ? <span style={errorStyle}>{p.error}</span> : '✓ صالح'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {errorRows.length === 0 && preview.length > 0 && !headerError && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 14 }}>
            <input type="checkbox" checked={pledge} onChange={(e) => setPledge(e.target.checked)} />
            <span>أقرّ بصحة البيانات أعلاه ({validRows.length} مستفيد) وأرغب في استيرادها الآن.</span>
          </label>
        )}

        {submitError && <p role="alert" style={errorStyle}>{submitError}</p>}
        {submitErrors.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <p role="alert" style={errorStyle}>تعذّر الاستيراد — الدفعة كاملة لم تُنفَّذ (لا كتابة جزئية):</p>
            <ul style={{ fontSize: 13, color: 'var(--err)', margin: 0, paddingInlineStart: 18 }}>
              {submitErrors.map((e, i) => (<li key={i}>الصف {e.row}: {e.message}</li>))}
            </ul>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <button type="button" disabled={!canSubmit} style={primaryButtonStyle} onClick={submit}>
            {busy ? 'جارٍ الاستيراد…' : `استيراد ${validRows.length || ''} مستفيد`}
          </button>
        </div>
      </section>
    </div>
  );
}
