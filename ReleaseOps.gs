// -------------------- تجهيز الإصدار: preflight وتطبيق مخطط آمن --------------------
//
// هذا الملف بديل آمن لاستخدام setupSheets() كخطوة "نشر عامة" متكررة.
// preflightRelease() قراءة فقط بالكامل — لا تكتب أي شيء إطلاقًا مهما
// استُدعيت. applyReleaseSchema(options) تكتب فقط الأعمدة/الأوراق الناقصة
// إضافةً لا استبدالًا، ولا تعمل إطلاقًا دون رمز موافقة صريح مطابق تمامًا.
//
// ⚠️ لم تُستدعَ أي من الدالتين هنا تلقائيًا من أي مكان آخر في المشروع،
// ولم تُشغَّلا على أي بيانات حية من هذه الجلسة. راجع DEPLOYMENT.md لترتيب
// الاستخدام الموصى به قبل أي تركيب حي.

/**
 * رمز موافقة applyReleaseSchema — نص ثابت يجب مطابقته حرفيًا، وليس سرًّا
 * بمعنى كلمة مرور (لا يحمي من مطوّر يقرأ الكود)، بل حاجز واضح يمنع
 * الاستدعاء العرضي أو التشغيل بلا قصد (مثل نسخ/لصق أو استدعاء بمعامل فارغ).
 */
const RELEASE_SCHEMA_APPROVAL_CODE_ = 'أوافق-على-تطبيق-مخطط-الإصدار';

/**
 * تقرير قراءة فقط شامل عن جاهزية القاعدة الحالية لاستقبال هذا الإصدار:
 * الأوراق والأعمدة الموجودة/الناقصة وترتيبها، تعارضات الحالات، القيم
 * المرجعية غير المطابقة، إصدار المخطط الحالي/المطلوب، ومجلد الإثباتات.
 * آمنة للاستدعاء في أي وقت وبأي عدد من المرات — لا تُعدِّل أي شيء إطلاقًا.
 */
function preflightRelease() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsReport = Object.keys(HEADERS).map(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      return {sheet: name, exists: false, rowCount: 0, missingColumns: HEADERS[name].slice(), columnOrderMatches: false};
    }
    const width = Math.max(sheet.getLastColumn(), HEADERS[name].length);
    const current = width ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0] : [];
    const missingColumns = HEADERS[name].filter(header => current.indexOf(header) === -1);
    const columnOrderMatches = HEADERS[name].every((header, index) => current[index] === header);
    return {
      sheet: name, exists: true, rowCount: Math.max(0, sheet.getLastRow() - 1),
      missingColumns: missingColumns, columnOrderMatches: columnOrderMatches
    };
  });

  let referenceData;
  try { referenceData = diagnoseReferenceDataIssues(); } catch (error) { referenceData = {ok: false, error: error.message}; }

  let stateIntegrity;
  try { stateIntegrity = diagnoseStateIntegrity(); } catch (error) { stateIntegrity = {ok: false, error: error.message}; }

  let proofFolder;
  try {
    const folderId = PropertiesService.getScriptProperties().getProperty('PROOF_FOLDER_ID');
    if (!folderId) {
      proofFolder = {configured: false, message: 'لم يُنشأ بعد — يُنشأ تلقائيًا عند أول رفع صورة إثبات تسليم'};
    } else {
      const folder = DriveApp.getFolderById(folderId);
      proofFolder = {configured: true, id: folderId, name: folder.getName(), url: folder.getUrl()};
    }
  } catch (error) {
    proofFolder = {configured: true, error: 'خاصية PROOF_FOLDER_ID مسجَّلة لكن تعذّر الوصول للمجلد فعليًا: ' + error.message};
  }

  const currentSchemaVersion = Number(PropertiesService.getScriptProperties().getProperty('SCHEMA_VERSION') || 0);
  const missingSheets = sheetsReport.filter(row => !row.exists).map(row => row.sheet);
  const sheetsWithMissingColumns = sheetsReport.filter(row => row.exists && row.missingColumns.length);

  return {
    ok: true,
    generatedAt: formatDateTime_(new Date()),
    schemaVersion: {current: currentSchemaVersion, required: APP.schemaVersion, matches: currentSchemaVersion === APP.schemaVersion},
    sheets: sheetsReport,
    missingSheets: missingSheets,
    sheetsWithMissingColumns: sheetsWithMissingColumns,
    referenceData: referenceData,
    stateIntegrity: stateIntegrity,
    proofFolder: proofFolder,
    readyForSchemaApply: missingSheets.length > 0 || sheetsWithMissingColumns.length > 0,
    summary: (missingSheets.length === 0 && sheetsWithMissingColumns.length === 0)
      ? 'المخطط مكتمل — لا أوراق ولا أعمدة ناقصة.'
      : ('ناقص: ' + missingSheets.length + ' ورقة، ' + sheetsWithMissingColumns.length + ' ورقة بها أعمدة ناقصة.')
  };
}

/**
 * تطبيق إضافي بحت لمخطط البيانات: يُنشئ الأوراق الناقصة فقط، ويضيف
 * الأعمدة الناقصة فقط لأي ورقة موجودة — لا يحذف عمودًا، لا يعيد ترتيب
 * بيانات، لا يُنشئ حساب مدير، لا يستبدل كلمة مرور، ولا يلمس أي صف بيانات
 * قائم إطلاقًا (يستخدم نفس ensureSheet_ المستخدَمة في setupSheets نفسها).
 * يرفض العمل تمامًا دون options.approvalCode مطابق حرفيًا لتفادي أي
 * استدعاء عرضي. آمنة لإعادة التشغيل (لا تكرار عند تشغيلها على مخطط مكتمل
 * أصلًا).
 */
function applyReleaseSchema(options) {
  options = options || {};
  if (options.approvalCode !== RELEASE_SCHEMA_APPROVAL_CODE_) {
    throw new Error('applyReleaseSchema يتطلب options.approvalCode مطابقًا حرفيًا للرمز الموثَّق في DEPLOYMENT.md — لم يُطبَّق أي تغيير. راجع preflightRelease() أولًا دائمًا قبل هذه الدالة.');
  }
  const before = preflightRelease();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const createdSheets = [];
  const addedColumns = [];

  Object.keys(HEADERS).forEach(name => {
    const existingSheet = ss.getSheetByName(name);
    const existed = !!existingSheet;
    const beforeColumns = existed
      ? (existingSheet.getLastColumn() ? existingSheet.getRange(1, 1, 1, existingSheet.getLastColumn()).getDisplayValues()[0] : [])
      : [];
    ensureSheet_(ss, name, HEADERS[name]);
    if (!existed) {
      createdSheets.push(name);
    } else {
      const missing = HEADERS[name].filter(header => beforeColumns.indexOf(header) === -1);
      if (missing.length) addedColumns.push({sheet: name, columns: missing});
    }
  });

  Object.keys(HEADERS).forEach(invalidateTableCache_);
  PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', String(APP.schemaVersion));
  clearDashboardCache();
  const after = preflightRelease();

  return {
    ok: true,
    generatedAt: formatDateTime_(new Date()),
    createdSheets: createdSheets,
    addedColumns: addedColumns,
    before: {schemaVersion: before.schemaVersion, missingSheets: before.missingSheets, sheetsWithMissingColumns: before.sheetsWithMissingColumns.map(row => row.sheet)},
    after: {schemaVersion: after.schemaVersion, missingSheets: after.missingSheets, sheetsWithMissingColumns: after.sheetsWithMissingColumns.map(row => row.sheet)}
  };
}
