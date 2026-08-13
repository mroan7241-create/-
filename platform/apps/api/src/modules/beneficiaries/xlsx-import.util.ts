import ExcelJS from 'exceljs';
import { DeviceType } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import type { BeneficiaryWriteInput } from './beneficiaries.service';
// ملاحظة: استيراد نوع فقط (import type) — يُحذَف بالكامل عند الترجمة، لا دورة استيراد فعلية زمن التشغيل رغم أن beneficiaries.service.ts يستورد من هذا الملف أيضًا.

/** يطابق DEVICE_TYPE_LABELS في الواجهة حرفيًا — نفس تسميات عمود deviceTypes في قالب CSV/XLSX. */
const DEVICE_LABEL_TO_TYPE: Record<string, DeviceType> = {
  'ثلاجة': DeviceType.REFRIGERATOR,
  'فرن': DeviceType.OVEN,
  'غسالة': DeviceType.WASHING_MACHINE,
};

/**
 * BEN-014 — تحليل XLSX لاستيراد المستفيدين، يوازي `inspectBeneficiaryExcel`
 * القديمة (Beneficiaries.gs:523-647): يقرأ الصفوف فقط، **لا كتابة أبدًا هنا**.
 * أعمدة الرأس مطابقة لقالب CSV (BEN-013) حتى تتشارك القوالب/التدريب نفسه.
 * حزمة `exceljs` (MIT، صيانة نشطة) بدل `xlsx`/SheetJS — الأخيرة لها سجل CVE
 * حقيقي (ReDoS/prototype pollution) غير مُصلَح على npm عند وقت هذا القرار.
 * حد الحجم الأقصى مفروض هنا صراحةً (لا يعتمد فقط على حد جسم الطلب العام).
 */

export const XLSX_MAX_BYTES = 8 * 1024 * 1024; // 8MB — نفس حد Legacy لملف الاستيراد.
export const XLSX_MAX_ROWS = 1000; // نفس سقف BEN-013 (JSON/CSV) — قرار عمل موحَّد، لا فرق حسب صيغة الملف.

export const REQUIRED_XLSX_HEADERS = ['name', 'region', 'city', 'district', 'phone', 'familyCount', 'socialStatus', 'deviceTypes'] as const;
const ALL_XLSX_HEADERS = [...REQUIRED_XLSX_HEADERS, 'phone2', 'socialSecurity', 'income', 'notes', 'lat', 'lng'] as const;

export interface RawXlsxRow {
  index: number; // رقم الصف الظاهر للمستخدم (يبدأ من 2 — الصف 1 عناوين).
  raw: Record<string, string>;
}

export async function parseXlsxBeneficiaryRows(buffer: Buffer): Promise<{ headers: string[]; rows: RawXlsxRow[] }> {
  if (buffer.length > XLSX_MAX_BYTES) {
    throw new ApiError('BENEFICIARY_IMPORT_XLSX_TOO_LARGE', 'حجم ملف Excel يتجاوز الحد المسموح (٨ ميجابايت)', 400);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // عدم تطابق أنواع Buffer<ArrayBufferLike> بين إصدار Node الحالي وتعريفات exceljs
    // القديمة — القيمة الفعلية Buffer صحيح دائمًا، لا تحويل بيانات خطر هنا.
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ApiError('BENEFICIARY_IMPORT_XLSX_INVALID', 'تعذّر قراءة الملف — تأكد أنه ملف Excel (.xlsx) صالح', 400);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ApiError('BENEFICIARY_IMPORT_XLSX_EMPTY', 'الملف لا يحتوي أي ورقة عمل', 400);
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const missing = REQUIRED_XLSX_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new ApiError('BENEFICIARY_IMPORT_XLSX_MISSING_HEADERS', `أعمدة إلزامية ناقصة: ${missing.join('، ')}`, 400);
  }

  const rows: RawXlsxRow[] = [];
  const totalRows = sheet.rowCount;
  if (totalRows - 1 > XLSX_MAX_ROWS) {
    throw new ApiError('BENEFICIARY_IMPORT_TOO_MANY_ROWS', `عدد الصفوف يتجاوز الحد المسموح (${XLSX_MAX_ROWS})`, 400);
  }

  for (let rowNumber = 2; rowNumber <= totalRows; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;
    const raw: Record<string, string> = {};
    let hasContent = false;
    headers.forEach((header, i) => {
      if (!header) return;
      const cell = row.getCell(i + 1);
      const value = cellToString(cell.value);
      raw[header] = value;
      if (value.trim() !== '') hasContent = true;
    });
    if (!hasContent) continue; // صف فارغ تمامًا — يُتجاهَل بصمت (نفس سلوك القديم).
    rows.push({ index: rowNumber, raw });
  }

  return { headers, rows };
}

/** يوازي `downloadImportTemplateXlsx` القديمة — رأس أعمدة + صف مثال واحد. */
export async function generateXlsxTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('مستفيدون');
  sheet.addRow([...ALL_XLSX_HEADERS]);
  sheet.addRow(['اسم تجريبي', 'الرياض', 'الرياض', 'حي النرجس', '0500000001', '', 5, 'أرملة', '2000', '', '', '', 'ثلاجة،فرن']);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col) => { col.width = 18; });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text; // rich text
    if ('result' in value) return String((value as { result: unknown }).result ?? ''); // formula
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value);
}

/**
 * صف خام (Record<string,string>) → شكل BeneficiaryWriteInput — يطابق منطق
 * تحليل CSV في الواجهة (`apps/web/app/lib/beneficiary-import.tsx`) حرفيًا،
 * حتى يعطي القالب الواحد نفس النتيجة بصرف النظر عن صيغة الملف (CSV/XLSX).
 * أخطاء التحويل هنا (رقم غير صالح، نوع جهاز غير معروف) تُرفَع كـApiError
 * عادي فيلتقطها `validateImportRows` كخطأ صف عادي — لا معاملة خاصة.
 */
export function parseXlsxRowToImportRow(raw: Record<string, string>): Omit<BeneficiaryWriteInput, 'opId'> {
  const deviceTypes = (raw.deviceTypes ?? '')
    .split(/[،,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => {
      const type = DEVICE_LABEL_TO_TYPE[label];
      if (!type) throw new ApiError('BENEFICIARY_IMPORT_UNKNOWN_DEVICE_TYPE', `نوع جهاز غير معروف: "${label}"`, 400);
      return type;
    });

  const familyCount = Number(raw.familyCount);
  if (!Number.isFinite(familyCount)) throw new ApiError('BENEFICIARY_IMPORT_INVALID_FAMILY_COUNT', 'familyCount ليس رقمًا صالحًا', 400);

  return {
    name: raw.name ?? '',
    region: raw.region ?? '',
    city: raw.city ?? '',
    district: raw.district ?? '',
    phone: raw.phone ?? '',
    phone2: raw.phone2 || undefined,
    familyCount,
    socialSecurity: raw.socialSecurity === 'نعم' || raw.socialSecurity?.toLowerCase() === 'true',
    socialStatus: raw.socialStatus ?? '',
    income: raw.income ? Number(raw.income) : undefined,
    notes: raw.notes || undefined,
    lat: raw.lat ? Number(raw.lat) : undefined,
    lng: raw.lng ? Number(raw.lng) : undefined,
    deviceTypes,
  };
}
