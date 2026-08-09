// -------------------- عمليات الصيانة: منح وصول مؤقت، preflight، وتطبيق مخطط آمن --------------------
//
// كل دالة صيانة في هذا الملف (وفي بقية المشروع: setupSheets_،
// migrateReferenceData_، migrateLegacyReferenceValues_، previewPhoneNormalization_،
// migratePhoneNumbers_، diagnoseReferenceDataIssues_، diagnoseStateIntegrity_،
// repairStateIntegrityIssues_) **تنتهي أسماؤها بشرطة سفلية `_` عمدًا**
// (اصطلاح "خاص" في هذا المشروع، يفرضه tools/verify.js آليًا بمنع أي استدعاء
// لها من Index.html)، **وتتطلب جميعها رمز وصول صيانة صالح** كأول معامل عبر
// requireMaintenanceAccess_ — طبقتا حماية مستقلتان، لا طبقة واحدة فقط.
//
// آلية منح الوصول (grantMaintenanceAccess_) لا تعتمد على جلسة ويب ولا على
// أي رمز مكتوب في الكود إطلاقًا: تُشغَّل يدويًا من محرر Apps Script فقط
// (▶ Run)، تولّد رمزًا عشوائيًا بالكامل، تخزّن بصمته المُجزَّأة فقط
// (Script Properties)، وتُظهر الرمز الخام مرة واحدة فقط في سجل التنفيذ —
// لا يُعاد الرمز أبدًا في أي قيمة راجعة قد تصل لمتصفح، ولا يُسجَّل في
// audit_ أو أي سجل آخر. راجع DEPLOYMENT.md لترتيب الاستخدام الكامل.
//
// ⚠️ لم تُستدعَ أي دالة هنا تلقائيًا من أي مكان آخر في المشروع، ولم
// تُشغَّل أي منها على أي بيانات حية من هذه الجلسة.

const MAINT_ACCESS_PROPERTY_ = 'MAINT_ACCESS_GRANT';
const MAINT_ACCESS_MAX_ATTEMPTS_ = 5;
const MAINT_ACCESS_DEFAULT_MINUTES_ = 20;
const MAINT_ACCESS_MAX_MINUTES_ = 60;

/**
 * يمنح وصول صيانة مؤقتًا لكل دوال هذا الملف/المشروع الحساسة. **شغّلها من
 * محرر Apps Script فقط (▶ Run)** — لا تُستدعى من أي مكان في الواجهة أو
 * الشبكة، ولا تتطلب أي جلسة ويب. تولّد رمزًا عشوائيًا بالكامل (لا رمز ثابت
 * في الكود إطلاقًا)، تخزّن بصمته المُجزَّأة فقط في Script Properties،
 * وتطبع الرمز الخام **مرة واحدة فقط** في سجل التنفيذ (Executions) —
 * انسخه فورًا من هناك، فلن يظهر مرة أخرى ولا يُعاد في القيمة الراجعة.
 *
 * الرمز صالح للاستخدام المتكرر (ليس أحادي الاستخدام) خلال نافذة زمنية
 * قصيرة فقط (افتراضيًا 20 دقيقة، حد أقصى 60) — يكفي لجلسة صيانة واحدة
 * متصلة (preflight ← dry-run ← تطبيق)، وينتهي تلقائيًا بعدها. يُقفَل
 * تلقائيًا بعد 5 محاولات فاشلة بصرف النظر عن الوقت المتبقي.
 */
function grantMaintenanceAccess_(minutes) {
  const windowMinutes = Math.min(MAINT_ACCESS_MAX_MINUTES_, Math.max(1, Number(minutes) || MAINT_ACCESS_DEFAULT_MINUTES_));
  const token = Utilities.getUuid() + Utilities.getUuid();
  const salt = Utilities.getUuid();
  const record = {
    hash: hashSecret_(token, salt), salt: salt,
    expiresAt: Date.now() + windowMinutes * 60 * 1000,
    attempts: 0
  };
  PropertiesService.getScriptProperties().setProperty(MAINT_ACCESS_PROPERTY_, JSON.stringify(record));
  // القناة الوحيدة لإظهار الرمز الخام — سجل تنفيذ المحرر، لا يصل لأي
  // طالب عبر google.script.run إطلاقًا مهما كانت طريقة الاستدعاء.
  Logger.log('رمز وصول الصيانة (صالح ' + windowMinutes + ' دقيقة، مرة واحدة يُعرض فيها فقط): ' + token);
  return {ok: true, message: 'انسخ الرمز من سجل التنفيذ الآن — صالح ' + windowMinutes + ' دقيقة ولن يُعرض مرة أخرى.'};
}

/** يبطل رمز الوصول الحالي فورًا قبل انتهاء صلاحيته الطبيعية — شغّلها من المحرر عند انتهاء جلسة الصيانة. */
function revokeMaintenanceAccess_() {
  PropertiesService.getScriptProperties().deleteProperty(MAINT_ACCESS_PROPERTY_);
  return {ok: true, message: 'أُبطل رمز وصول الصيانة (إن وُجد).'};
}

/**
 * حارس مشترك تستدعيه كل دالة صيانة كأول سطر فيها. يرمي خطأً عامًا (لا
 * يكشف أي تفصيل عن حالة المخطط أو الإعدادات) عند غياب رمز صالح، انتهاء
 * صلاحيته، أو تجاوز محاولات الفشل المسموحة — القفل نفسه يُطبَّق بمجرد
 * الفشل الخامس بصرف النظر عمّن يستدعي بعدها بالرمز الصحيح أو الخاطئ.
 */
function requireMaintenanceAccess_(token) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(MAINT_ACCESS_PROPERTY_);
  if (!raw) throw new Error('الوصول لعمليات الصيانة مقفل. شغّل grantMaintenanceAccess_() من محرر Apps Script أولًا.');
  let record;
  try { record = JSON.parse(raw); } catch (error) { props.deleteProperty(MAINT_ACCESS_PROPERTY_); throw new Error('حالة وصول الصيانة تالفة — أُعيد قفلها. شغّل grantMaintenanceAccess_() من جديد.'); }
  if (Date.now() > record.expiresAt) {
    props.deleteProperty(MAINT_ACCESS_PROPERTY_);
    throw new Error('انتهت صلاحية رمز وصول الصيانة. شغّل grantMaintenanceAccess_() من جديد.');
  }
  if (record.attempts >= MAINT_ACCESS_MAX_ATTEMPTS_) {
    props.deleteProperty(MAINT_ACCESS_PROPERTY_);
    throw new Error('أُقفل الوصول للصيانة بعد محاولات فاشلة متكررة. شغّل grantMaintenanceAccess_() من جديد.');
  }
  if (!token || !constantTimeEquals_(hashSecret_(String(token), record.salt), record.hash)) {
    record.attempts += 1;
    props.setProperty(MAINT_ACCESS_PROPERTY_, JSON.stringify(record));
    throw new Error('رمز وصول الصيانة غير صحيح.');
  }
  return true;
}

/**
 * تقرير قراءة فقط شامل عن جاهزية القاعدة الحالية لاستقبال هذا الإصدار:
 * الأوراق والأعمدة الموجودة/الناقصة وترتيبها، تعارضات الحالات، القيم
 * المرجعية غير المطابقة، إصدار المخطط الحالي/المطلوب، ومجلد الإثباتات.
 * لا تُعدِّل أي شيء إطلاقًا مهما استُدعيت — لكنها **ليست عامة**: تتطلب
 * رمز وصول صيانة صالح مثل بقية دوال هذا الملف، حتى لا تُسرِّب أسماء
 * الأوراق/الأعمدة/الإعدادات لأي طرف غير مصرَّح.
 */
function preflightRelease_(token) {
  requireMaintenanceAccess_(token);
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
  try { referenceData = diagnoseReferenceDataIssues_(token); } catch (error) { referenceData = {ok: false, error: error.message}; }

  let stateIntegrity;
  try { stateIntegrity = diagnoseStateIntegrity_(token); } catch (error) { stateIntegrity = {ok: false, error: error.message}; }

  let needsIntegrity;
  try { needsIntegrity = diagnoseNeedsIntegrity_(token); } catch (error) { needsIntegrity = {ok: false, error: error.message}; }

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
    needsIntegrity: needsIntegrity,
    proofFolder: proofFolder,
    readyForSchemaApply: missingSheets.length > 0 || sheetsWithMissingColumns.length > 0,
    summary: (missingSheets.length === 0 && sheetsWithMissingColumns.length === 0)
      ? 'المخطط مكتمل — لا أوراق ولا أعمدة ناقصة.'
      : ('ناقص: ' + missingSheets.length + ' ورقة، ' + sheetsWithMissingColumns.length + ' ورقة بها أعمدة ناقصة.')
  };
}

/**
 * تطبيق إضافي بحت لمخطط البيانات فقط (لا ترحيل مرجعيات، لا إصلاح حالات —
 * كل منها دالة صيانة منفصلة عمدًا، لا تُستدعى تلقائيًا من هنا): يُنشئ
 * الأوراق الناقصة فقط، ويضيف الأعمدة الناقصة فقط لأي ورقة موجودة — لا
 * يحذف عمودًا، لا يعيد ترتيب بيانات، لا يُنشئ حساب مدير، لا يستبدل كلمة
 * مرور، ولا يلمس أي صف بيانات قائم إطلاقًا. آمنة لإعادة التشغيل.
 */
function applyReleaseSchema_(token, options) {
  requireMaintenanceAccess_(token);
  options = options || {};
  const before = preflightRelease_(token);
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
  const after = preflightRelease_(token);

  return {
    ok: true,
    generatedAt: formatDateTime_(new Date()),
    createdSheets: createdSheets,
    addedColumns: addedColumns,
    before: {schemaVersion: before.schemaVersion, missingSheets: before.missingSheets, sheetsWithMissingColumns: before.sheetsWithMissingColumns.map(row => row.sheet)},
    after: {schemaVersion: after.schemaVersion, missingSheets: after.missingSheets, sheetsWithMissingColumns: after.sheetsWithMissingColumns.map(row => row.sheet)}
  };
}

/**
 * معاينة قراءة-فقط (Phase 2 — لم تُشغَّل، ولا تُشغَّل تلقائيًا من أي
 * مكان) لِما يمكن اشتقاقه من الحقل النصي القديم "الاحتياج" لو أُريد
 * تحويله لصفوف "احتياجات المستفيدين" الجديدة مستقبلًا. **لا تكتب أي
 * شيء إطلاقًا** — لا تُنشئ صف احتياج، ولا تُعدّل أي عمود قديم أو جديد.
 *
 * عمدًا لا تفترض أي قرار اعتماد تلقائي: كل احتياج تاريخي يُصنَّف هنا
 * "قابل للتحويل" (نوعه يطابق NEW_NEED_DEVICE_TYPES حرفيًا) أو "يتطلب
 * قرارًا يدويًا" (نص غير مطابق تمامًا، أو نوع تاريخي خارج الثلاثة
 * الجديدة كـ"مكيف"/"فريزر"/"سخان" — هذه لم تُحذف من REFERENCE_SEED_
 * DEVICE_TYPES ولن تُحذف، لكنها لا تدخل تلقائيًا في التحويل الجديد).
 * لا توجد بعد أي دالة "تطبيق" فعلية لهذا التحويل — القاعدة الصريحة
 * لكيفية تحديد "معتمد تلقائيًا" (إن وُجدت) يجب أن تُعتمَد صراحةً أولًا،
 * ثم تُكتب دالة تطبيق منفصلة كباقي أنماط هذا الملف.
 */
function previewNeedsMigration_(token) {
  requireMaintenanceAccess_(token);
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  const convertible = [];
  const needsManualReview = [];
  let totalLegacyTokens = 0;

  beneficiaries.forEach(row => {
    const beneficiaryId = String(row['رقم المستفيد']);
    const legacyNeeds = splitList_(row['الاحتياج']);
    if (!legacyNeeds.length) return;
    legacyNeeds.forEach(token => {
      totalLegacyTokens++;
      const clean = String(token || '').trim();
      const entry = {beneficiaryId: beneficiaryId, associationId: String(row['رقم الجمعية']), rawValue: clean};
      if (NEW_NEED_DEVICE_TYPES.indexOf(clean) !== -1) {
        convertible.push(Object.assign({deviceType: clean}, entry));
      } else {
        needsManualReview.push(Object.assign({
          reason: REFERENCE_SEED_DEVICE_TYPES.indexOf(clean) !== -1
            ? 'نوع جهاز تاريخي صالح لكنه خارج الأنواع الثلاثة الجديدة المعتمدة'
            : 'نص غير مطابق لأي نوع جهاز معروف'
        }, entry));
      }
    });
  });

  const legacyApprovedStatusCounts = {};
  beneficiaries.forEach(row => {
    if (!splitList_(row['الاحتياج']).length) return;
    const status = String(row['حالة المستفيد'] || '') || '(فارغة)';
    legacyApprovedStatusCounts[status] = (legacyApprovedStatusCounts[status] || 0) + 1;
  });

  return {
    ok: true,
    generatedAt: formatDateTime_(new Date()),
    note: 'قراءة فقط — لم يُكتب أو يُعدَّل أي شيء. لا تحويل تلقائي بعد؛ هذا تقرير معاينة فقط.',
    totalBeneficiariesWithLegacyNeeds: beneficiaries.filter(row => splitList_(row['الاحتياج']).length).length,
    totalLegacyNeedTokens: totalLegacyTokens,
    convertibleCount: convertible.length,
    needsManualReviewCount: needsManualReview.length,
    convertible: convertible,
    needsManualReview: needsManualReview,
    // توزيع "حالة المستفيد" القديمة (BENEFICIARY_STATUSES) بين من لديهم
    // احتياج نصي قديم — لإطلاع من سيعتمد قاعدة "معتمد تلقائيًا" المستقبلية
    // على البيانات الفعلية قبل اعتمادها، لا لاتخاذ أي قرار هنا.
    legacyBeneficiaryStatusDistribution: legacyApprovedStatusCounts
  };
}
