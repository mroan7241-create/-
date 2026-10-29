import ExcelJS from 'exceljs';
import { DeviceType } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import type { BeneficiaryWriteInput } from './beneficiaries.service';
import { validateNeedPriority, validateThreeDeviceReason } from './beneficiary-onboarding.util';
import {
  BENEFICIARY_IMPORT_HEADER_LABELS,
  REQUIRED_BENEFICIARY_IMPORT_FIELDS,
  beneficiaryImportFieldForHeader,
  SIMPLE_BENEFICIARY_IMPORT_FIELDS, missingBeneficiaryImportFields, normalizeBeneficiaryImportRaw,
} from '@alzad/shared';
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

export const REQUIRED_XLSX_HEADERS = REQUIRED_BENEFICIARY_IMPORT_FIELDS;

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
  const originalHeaders: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    originalHeaders[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const headers = originalHeaders.map((header) => beneficiaryImportFieldForHeader(header) ?? header);
  const namedHeaders = headers.filter(Boolean);
  if (new Set(namedHeaders).size !== namedHeaders.length) throw new ApiError('BENEFICIARY_IMPORT_DUPLICATE_HEADERS', 'توجد أسماء أعمدة مكررة؛ استخدم القالب دون تكرار الأعمدة', 400);

  const missing = missingBeneficiaryImportFields(headers);
  if (missing.length > 0) {
    throw new ApiError('BENEFICIARY_IMPORT_XLSX_MISSING_HEADERS', `أعمدة إلزامية ناقصة: ${missing.map((field) => BENEFICIARY_IMPORT_HEADER_LABELS[field]).join('، ')}`, 400);
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
      if (header !== 'region' && header !== 'needPriority' && value.trim() !== '') hasContent = true;
    });
    if (!hasContent) continue; // Region and priority are prefilled guidance, not beneficiary records.
    rows.push({ index: rowNumber, raw });
  }

  return { headers, rows };
}

/** Blank entry sheet; examples are instructions only and cannot be imported accidentally. */
export async function generateXlsxTemplate(options: { limit?: number; region?: string; regions?: string[]; cities?: string[]; socialStatuses?: string[] } = {}): Promise<Buffer> {
  const limit = options.limit ?? 50;
  validateNeedPriority(limit);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('مستفيدون');
  sheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  sheet.addRow(SIMPLE_BENEFICIARY_IMPORT_FIELDS.map(field => BENEFICIARY_IMPORT_HEADER_LABELS[field]));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70142D' } };
  const column = (field: typeof SIMPLE_BENEFICIARY_IMPORT_FIELDS[number]) => SIMPLE_BENEFICIARY_IMPORT_FIELDS.indexOf(field) + 1;
  sheet.autoFilter = { from: 'A1', to: 'R1' };
  sheet.columns.forEach((col) => { col.width = 18; });
  sheet.getRow(1).height = 70;
  sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  sheet.getColumn(column('name')).width = 30;
  sheet.getColumn(column('threeDeviceReason')).width = 48;
  sheet.getColumn(column('needPriority')).width = 26;
  sheet.getColumn(column('familyCount')).width = 26;
  sheet.getColumn(column('socialStatus')).width = 25;
  for (const field of ['refrigerator', 'oven', 'washingMachine'] as const) sheet.getColumn(column(field)).width = 24;
  for (const field of ['phone2', 'socialSecurity', 'income', 'lat', 'lng'] as const) sheet.getColumn(column(field)).width = 28;
  sheet.getColumn(column('needPriority')).numFmt = '[=1]0" — الأشد حاجة";0';
  for (const field of ['phone2', 'notes', 'lat', 'lng'] as const) sheet.getCell(1, column(field)).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B6064' } };
  for (const field of ['phone', 'phone2'] as const) sheet.getColumn(column(field)).numFmt = '@';
  const lists = workbook.addWorksheet('قوائم');
  lists.state = 'veryHidden';
  const validationLists = [options.regions ?? [], options.cities ?? [], options.socialStatuses ?? []];
  validationLists.forEach((values, column) => values.forEach((value, row) => { lists.getCell(row + 1, column + 1).value = value; }));
  const listNames = ['ImportRegions', 'ImportCities', 'ImportSocialStatuses'];
  validationLists.forEach((values, index) => {
    if (values.length) workbook.definedNames.add(`'قوائم'!$${String.fromCharCode(65 + index)}$1:$${String.fromCharCode(65 + index)}$${values.length}`, listNames[index]);
  });
  for (let row = 2; row <= limit + 1; row++) {
    sheet.getRow(row).height = 28;
    sheet.getRow(row).alignment = { horizontal: 'right', vertical: 'middle' };
    sheet.getCell(row, column('needPriority')).value = row - 1;
    sheet.getCell(row, column('needPriority')).font = { color: { argb: 'FF70142D' }, bold: true };
    if (options.region) sheet.getCell(row, column('region')).value = options.region;
    sheet.getCell(row, column('needPriority')).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [1, limit], showErrorMessage: true, error: `ترتيب الحاجة من 1 إلى ${limit} دون تكرار؛ 1 للأشد حاجة.` };
    for (const [field, listIndex] of [['region', 0], ['city', 1], ['socialStatus', 2]] as const) if (validationLists[listIndex].length) sheet.getCell(row, column(field)).dataValidation = { type: 'list', allowBlank: true, formulae: [listNames[listIndex]], showErrorMessage: true, errorTitle: 'قيمة غير معتمدة', error: 'اختر من القائمة.' };
    for (const field of ['refrigerator', 'oven', 'washingMachine', 'socialSecurity'] as const) sheet.getCell(row, column(field)).dataValidation = { type: 'list', allowBlank: field !== 'socialSecurity', formulae: ['"نعم,لا"'], showErrorMessage: true, error: 'اختر نعم أو لا.' };
    sheet.getCell(row, column('income')).dataValidation = { type: 'whole', operator: 'between', allowBlank: false, formulae: [0, 1_000_000], showErrorMessage: true, error: 'أدخل الدخل بالريال، واكتب 0 إذا لم يكن للمستفيد دخل.' };
    sheet.getCell(row, column('familyCount')).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [1, 99], showErrorMessage: true, error: 'عدد أفراد الأسرة من 1 إلى 99.' };
    sheet.getCell(row, column('threeDeviceReason')).dataValidation = { type: 'custom', allowBlank: false, formulae: [`OR(COUNTIF(I${row}:K${row},"نعم")<3,LEN(TRIM(L${row}))>0)`], showErrorMessage: true, error: 'عند اختيار ثلاثة أجهزة اكتب مبرر الحاجة إليها.' };
  }
  for (const field of ['phone2', 'notes', 'lat', 'lng'] as const) sheet.getColumn(column(field)).outlineLevel = 1;
  sheet.addConditionalFormatting({ ref: `L2:L${limit + 1}`, rules: [{ type: 'expression', priority: 1, formulae: ['AND(COUNTIF(I2:K2,"نعم")=3,LEN(TRIM(L2))=0)'], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE5E5' } } } }] });
  sheet.addConditionalFormatting({ ref: `A2:A${limit + 1}`, rules: [{ type: 'expression', priority: 2, formulae: [`AND(A2<>"",COUNTIF($A$2:$A$${limit + 1},A2)>1)`], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE5E5' } } } }] });
  sheet.properties.outlineProperties = { summaryRight: false, summaryBelow: true };
  const instructions = workbook.addWorksheet('تعليمات');
  instructions.views = [{ rightToLeft: true }];
  instructions.addRow(['طريقة الاستخدام']);
  instructions.addRow(['١. لا تعدّل أسماء الأعمدة في الصف الأول.']);
  instructions.addRow([`٢. الحد المسموح ${limit} أسرة بصف واحد لكل أسرة. ترتيب الحاجة معبأ من 1 إلى ${limit}: ضع الأسرة الأشد حاجة عند 1، والتي تليها عند 2 وهكذا. يمكن تعديل أرقام الترتيب دون تكرار. الصفوف التي فيها ترتيب ومنطقة فقط لا تُستورد.`]);
  instructions.addRow([options.region ? '٣. المنطقة معبأة من حساب الجمعية؛ اختر المدينة التابعة لها ثم اكتب الحي. الموقع الدقيق اختياري.' : '٣. اختر منطقة جمعيتكم والمدينة التابعة لها من القوائم، ثم اكتب الحي. الموقع الدقيق اختياري.']);
  instructions.addRow(['٤. الأصل جهاز واحد لكل أسرة حسب الاحتياج الفعلي. الأسرة التي تحتاج جهازين تكون أشد حاجة من الأسرة التي تحتاج جهازًا واحدًا. عند اختيار ثلاثة أجهزة يجب كتابة مبرر يشرح حاجة الأسرة إليها؛ يُرفض الصف دونه.']);
  instructions.addRow(['٥. اكتب الجوال كنص مثل 0500000001. عدد الأسرة شامل المستفيد. أجب عن سؤال الضمان بنعم أو لا، واكتب دخل المستفيد بالريال؛ إن لم يكن له دخل فاكتب 0.']);
  instructions.addRow(['٦. ارفع الملف، وراجع جميع الصفوف في المعاينة ثم أكد الاستيراد. عند وجود خطأ لا تُحفظ الدفعة حتى تصحيحه. الأسر والاحتياجات المرفوعة ستخضع للدراسة.']);
  instructions.addRow(['٧. اسم المستفيد كاملًا هو اسم الشخص المسجل للأسرة، وليس اسم الجمعية. اكتب مدينة المستفيد وحيه ورقم جواله وعدد أفراد أسرته شاملًا المستفيد، واختر حالته الاجتماعية.']);
  instructions.addRow(['٨. لاحتياجات الأجهزة اختر نعم للمطلوب، ولا أو فارغًا لغير المطلوب، مع اختيار جهاز واحد على الأقل. الضمان الاجتماعي: نعم للمستفيد من الضمان ولا لغير المستفيد. لا تترك سؤال الضمان أو الدخل فارغًا. الأعمدة المعلّمة «اختياري» يمكن تركها فارغة.']);
  instructions.addRow(['٩. خط العرض وخط الطول هما إحداثيات موقع منزل المستفيد. إن توفرا فاكتب الإحداثيين معًا، وإلا فاتركهما فارغين. موقع المنزل الدقيق اختياري ولا يمنع رفع الأسرة.']);
  instructions.getColumn(1).width = 90;
  instructions.getColumn(1).alignment = { horizontal: 'right', wrapText: true };
  instructions.eachRow(row => { row.height = Math.max(34, Math.ceil(String(row.getCell(1).value ?? '').length / 85) * 22 + 12); row.font = { name: 'Arial', size: 12 }; row.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true }; });
  instructions.getRow(1).font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FF70142D' } };
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
  raw = normalizeBeneficiaryImportRaw(raw);
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
    needPriority: validateNeedPriority(Number(raw.needPriority)),
    threeDeviceReason: validateThreeDeviceReason(new Set(deviceTypes).size, raw.threeDeviceReason) ?? undefined,
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
