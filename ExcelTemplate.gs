// -------------------- قالب استيراد المستفيدين بصيغة Excel حقيقية (.xlsx) --------------------
//
// يبني حزمة OOXML صالحة فعليًا (ZIP يحوي [Content_Types].xml وxl/workbook.xml
// وأوراق العمل...) عبر Utilities.zip المدمجة في Apps Script — بلا أي مكتبة
// خارجية وبلا أي خدمة مدفوعة. يُستدعى فقط عند ضغط المستخدم على "تنزيل
// القالب"، وليس عند تحميل شاشة الدخول أو أي شاشة أخرى.
//
// عمدًا لا يُستخدم sharedStrings.xml (كل النصوص inlineStr) لتبسيط البنية
// وتقليل عدد الأجزاء التي قد تحتوي خطأ بنيويًا.

/** يهرب أحرف XML الخاصة داخل نص عنصر (وليس داخل قيمة سمة). */
function xmlEscapeText_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** يهرب أحرف XML الخاصة داخل قيمة سمة (attribute) بين علامتي اقتباس مزدوجتين. */
function xmlEscapeAttr_(value) {
  return xmlEscapeText_(value).replace(/"/g, '&quot;');
}

/** يحوّل رقم عمود (1=A) إلى حرف عمود Excel (يدعم أكثر من حرف نظريًا وإن لم يُستخدم هنا). */
function xlsxColumnLetter_(columnNumber) {
  let letters = '';
  let n = columnNumber;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * يبني XML صف واحد. كل خلية إما نصية (inlineStr) أو رقمية (n) — الأعمدة
 * المذكورة في textColumns تُكتب دائمًا كنص (s="1", نمط "@") حتى لو كانت
 * قيمتها رقمية ظاهريًا، أهم مثال: الجوال يجب ألا يفقد الصفر الأول.
 */
function xlsxRowXml_(rowIndex, values, textColumns) {
  const cells = values.map((value, index) => {
    const col = xlsxColumnLetter_(index + 1);
    const ref = col + rowIndex;
    const isTextColumn = textColumns.indexOf(index) >= 0;
    const isNumeric = !isTextColumn && value !== '' && value !== null && value !== undefined && !isNaN(Number(value));
    if (isNumeric) {
      return '<c r="' + ref + '"><v>' + xmlEscapeText_(Number(value)) + '</v></c>';
    }
    const style = isTextColumn ? ' s="1"' : '';
    return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xmlEscapeText_(value) + '</t></is></c>';
  }).join('');
  return '<row r="' + rowIndex + '">' + cells + '</row>';
}

/**
 * يبني ورقة عمل واحدة كاملة. dataValidations اختيارية: مصفوفة عناصر
 * {sqref, options} حيث options مصفوفة نصوص قصيرة (قائمة منسدلة Excel
 * أصلية) — لا تُستخدم إن كانت طويلة جدًا (حد Excel لطول formula1 محدود).
 */
function xlsxWorksheetXml_(rows, dataValidations) {
  const rowsXml = rows.join('');
  let validationsXml = '';
  if (dataValidations && dataValidations.length) {
    const items = dataValidations.map(dv => {
      const formula = '&quot;' + dv.options.join(',') + '&quot;';
      return '<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="قيمة غير معتمدة" '
        + 'error="اختر قيمة من القائمة المعتمدة" sqref="' + xmlEscapeAttr_(dv.sqref) + '">'
        + '<formula1>' + formula + '</formula1></dataValidation>';
    }).join('');
    validationsXml = '<dataValidations count="' + dataValidations.length + '">' + items + '</dataValidations>';
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetData>' + rowsXml + '</sheetData>'
    + validationsXml
    + '</worksheet>';
}

const XLSX_CONTENT_TYPES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '</Types>';

const XLSX_ROOT_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  + '</Relationships>';

const XLSX_WORKBOOK_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
  + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

const XLSX_WORKBOOK_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + '<sheets>'
  + '<sheet name="مستفيدون" sheetId="1" r:id="rId1"/>'
  + '<sheet name="تعليمات" sheetId="2" r:id="rId2"/>'
  + '</sheets>'
  + '</workbook>';

// نمط "@" (نص) مدمج في Excel رقمه 49 — يُستخدم لعمود الجوال حصرًا حتى لا
// يُسقِط Excel الصفر الأول أو يحوّل الرقم إلى صيغة علمية.
const XLSX_STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '</cellXfs>'
  + '</styleSheet>';

const XLSX_IMPORT_HEADERS = ['الاسم', 'المنطقة', 'المدينة', 'العنوان', 'الجوال', 'عدد الأفراد',
  'الضمان الاجتماعي', 'الحالة الاجتماعية', 'الدخل', 'الاحتياج', 'الملاحظات', 'خط العرض', 'خط الطول', 'علامة مميزة'];
const XLSX_IMPORT_EXAMPLE = ['سارة العتيبي', 'الرياض', 'الرياض', 'حي النرجس، شارع الأمير', '0501234567', 4,
  'نعم', 'أرملة', 2500, 'ثلاجة، غسالة', 'يفضّل التسليم صباحًا', 24.7136, 46.6753, 'بجانب المسجد'];
const XLSX_PHONE_COLUMN_INDEX = 4; // "الجوال" — العمود الوحيد الذي يُفرَض عليه تنسيق نصي إجباريًا.

const XLSX_INSTRUCTIONS_LINES = [
  'تعليمات تعبئة قالب استيراد المستفيدين',
  '',
  '١. لا تُغيّر أسماء الأعمدة ولا ترتيبها في ورقة "مستفيدون".',
  '٢. اكتب رقم الجوال بصيغة تبدأ بصفر (05xxxxxxxx) — العمود مهيّأ كنص فيبقى الصفر الأول ظاهرًا.',
  '٣. المنطقة والمدينة والحالة الاجتماعية والضمان الاجتماعي: استخدم القوائم المنسدلة إن ظهرت، أو القيم المعتمدة نفسها كتابةً.',
  '٤. خط العرض وخط الطول اختياريان بالكامل، لكن إذا عبّأت أحدهما فيجب تعبئة الآخر أيضًا.',
  '٥. عمود "الاحتياج" يقبل أكثر من قيمة مفصولة بفاصلة، مثل: ثلاجة، غسالة.',
  '٦. لا تترك صفوفًا فارغة بين السجلات.',
  '٧. يمكن أيضًا استخدام قالب CSV كخيار احتياطي إن واجهتك أي مشكلة في فتح ملف Excel.'
];

/**
 * يبني بايتات ملف xlsx فعلي كسلسلة Base64 عبر Utilities.zip — لا يُغيَّر
 * فيها امتداد CSV فقط، بل هي حزمة OOXML قائمة بذاتها. راجع RELEASE.md
 * لتوثيق طريقة التوليد وحدودها (لا ورقة تعليمات منسّقة بألوان، لا قوائم
 * منسدلة معتمدة على ورقة مخفية، فقط formula1 نصي مباشر).
 */
function buildBeneficiaryImportXlsxBase64_() {
  const dataRows = [
    xlsxRowXml_(1, XLSX_IMPORT_HEADERS, []),
    xlsxRowXml_(2, XLSX_IMPORT_EXAMPLE, [XLSX_PHONE_COLUMN_INDEX])
  ];
  const socialSecurityCol = xlsxColumnLetter_(7);
  const socialStatusCol = xlsxColumnLetter_(8);
  const regionCol = xlsxColumnLetter_(2);
  const dataValidations = [
    {sqref: socialSecurityCol + '2:' + socialSecurityCol + '1000', options: ['نعم', 'لا']},
    {sqref: socialStatusCol + '2:' + socialStatusCol + '1000', options: REFERENCE_SEED_SOCIAL_STATUSES},
    {sqref: regionCol + '2:' + regionCol + '1000', options: Object.keys(REFERENCE_SEED_REGIONS_CITIES)}
  ];
  const sheet1Xml = xlsxWorksheetXml_(dataRows, dataValidations);

  const instructionRows = XLSX_INSTRUCTIONS_LINES.map((line, index) => xlsxRowXml_(index + 1, [line], []));
  const sheet2Xml = xlsxWorksheetXml_(instructionRows, null);

  const parts = [
    {name: '[Content_Types].xml', content: XLSX_CONTENT_TYPES_XML},
    {name: '_rels/.rels', content: XLSX_ROOT_RELS_XML},
    {name: 'xl/workbook.xml', content: XLSX_WORKBOOK_XML},
    {name: 'xl/_rels/workbook.xml.rels', content: XLSX_WORKBOOK_RELS_XML},
    {name: 'xl/styles.xml', content: XLSX_STYLES_XML},
    {name: 'xl/worksheets/sheet1.xml', content: sheet1Xml},
    {name: 'xl/worksheets/sheet2.xml', content: sheet2Xml}
  ];
  const blobs = parts.map(part => Utilities.newBlob(part.content, 'application/xml', part.name));
  const zipBlob = Utilities.zip(blobs, 'قالب_استيراد_المستفيدين.xlsx');
  return Utilities.base64Encode(zipBlob.getBytes());
}

/**
 * دالة عامة تُستدعى من الواجهة عند ضغط "تنزيل قالب Excel" فقط — لا شيء
 * يُحمَّل أو يُبنى عند فتح شاشة الدخول أو أي شاشة أخرى غير هذه.
 */
function downloadBeneficiaryImportTemplateXlsx(token) {
  requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  const base64 = buildBeneficiaryImportXlsxBase64_();
  return {
    ok: true,
    filename: 'قالب_استيراد_المستفيدين.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dataUrl: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + base64
  };
}
