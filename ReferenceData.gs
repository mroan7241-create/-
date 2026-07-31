// -------------------- المصادر المرجعية (مناطق/مدن وقيم موحّدة) --------------------
//
// جدول "البيانات المرجعية" إضافي بالكامل ولا يمس أي جدول قائم.
// أنواع السجلات: REGION، CITY (يتبع=اسم المنطقة)، DEVICE_TYPE، SOCIAL_STATUS،
// ASSOCIATION_CATEGORY. يمكن للإدارة تعديل القيم مباشرة من الشيت لاحقًا؛
// هذه البذرة نقطة بداية معقولة فقط وليست قائمة نهائية.

const REFERENCE_SEED_REGIONS_CITIES = Object.freeze({
  'الرياض': ['الرياض', 'الخرج', 'الدوادمي', 'المجمعة', 'الزلفي', 'وادي الدواسر', 'الأفلاج', 'القويعية', 'حوطة بني تميم', 'عفيف', 'ضرما', 'شقراء'],
  'مكة المكرمة': ['جدة', 'مكة المكرمة', 'الطائف', 'رابغ', 'القنفذة', 'الليث', 'خليص', 'الجموم'],
  'المدينة المنورة': ['المدينة المنورة', 'ينبع', 'العلا', 'بدر', 'خيبر', 'المهد'],
  'القصيم': ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'البدائع', 'المذنب', 'رياض الخبراء'],
  'الشرقية': ['الدمام', 'الخبر', 'الظهران', 'الأحساء', 'الجبيل', 'القطيف', 'حفر الباطن', 'الخفجي', 'رأس تنورة', 'النعيرية'],
  'عسير': ['أبها', 'خميس مشيط', 'بيشة', 'النماص', 'محايل عسير', 'ظهران الجنوب', 'تنومة', 'رجال ألمع'],
  'تبوك': ['تبوك', 'الوجه', 'ضباء', 'تيماء', 'أملج', 'حقل'],
  'حائل': ['حائل', 'بقعاء', 'الغزالة', 'الشنان'],
  'الحدود الشمالية': ['عرعر', 'رفحاء', 'طريف'],
  'جازان': ['جازان', 'صبيا', 'أبو عريش', 'صامطة', 'الدرب', 'بيش', 'فرسان'],
  'نجران': ['نجران', 'شرورة', 'حبونا'],
  'الباحة': ['الباحة', 'بلجرشي', 'المخواة', 'قلوة'],
  'الجوف': ['سكاكا', 'القريات', 'دومة الجندل']
});

const REFERENCE_SEED_DEVICE_TYPES = ['ثلاجة', 'غسالة', 'فرن', 'مكيف', 'فريزر', 'سخان'];
const REFERENCE_SEED_SOCIAL_STATUSES = ['يتيم', 'أرملة', 'مطلق/مطلقة', 'متزوج/متزوجة', 'أخرى'];
const REFERENCE_SEED_ASSOCIATION_CATEGORIES = ['جمعية أهلية', 'جمعية خيرية', 'مؤسسة أهلية', 'جمعية تنموية', 'أخرى'];

/**
 * ترحيل آمن وقابل لإعادة التشغيل: ينشئ ورقة "البيانات المرجعية" ويبذرها
 * بقيم ابتدائية فقط إن كانت فارغة تمامًا. لا يحذف ولا يكرر عند إعادة التشغيل.
 *
 * ⚠️ لم يُستدعَ هذا الترحيل تلقائيًا من أي مكان في المشروع.
 * يجب تشغيله يدويًا من محرر Apps Script بعد المراجعة والموافقة،
 * تمامًا مثل setupSheets ولنفس السبب: يكتب في الملف الحي.
 */
function migrateReferenceData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, APP.sheets.referenceData, HEADERS[APP.sheets.referenceData]);

  if (sheet.getLastRow() > 1) {
    return {ok: true, skipped: true, message: 'الجدول موجود ومُعبّأ مسبقًا — لم تُضف بذور جديدة.'};
  }

  const rows = [];
  let order = 0;

  Object.keys(REFERENCE_SEED_REGIONS_CITIES).forEach(region => {
    order += 1;
    rows.push([nextId_('REF'), 'REGION', region, '', order, 'نعم']);
    let cityOrder = 0;
    REFERENCE_SEED_REGIONS_CITIES[region].forEach(city => {
      cityOrder += 1;
      rows.push([nextId_('REF'), 'CITY', city, region, cityOrder, 'نعم']);
    });
  });
  REFERENCE_SEED_DEVICE_TYPES.forEach((value, index) => {
    rows.push([nextId_('REF'), 'DEVICE_TYPE', value, '', index + 1, 'نعم']);
  });
  REFERENCE_SEED_SOCIAL_STATUSES.forEach((value, index) => {
    rows.push([nextId_('REF'), 'SOCIAL_STATUS', value, '', index + 1, 'نعم']);
  });
  REFERENCE_SEED_ASSOCIATION_CATEGORIES.forEach((value, index) => {
    rows.push([nextId_('REF'), 'ASSOCIATION_CATEGORY', value, '', index + 1, 'نعم']);
  });

  sheet.getRange(2, 1, rows.length, HEADERS[APP.sheets.referenceData].length).setValues(rows);
  invalidateTableCache_(APP.sheets.referenceData);
  invalidateReferenceDataCache_();
  return {ok: true, skipped: false, inserted: rows.length,
    message: 'تم إنشاء ' + rows.length + ' سجلًا مرجعيًا (مناطق، مدن، أنواع أجهزة، حالات اجتماعية، تصنيفات جمعيات).'};
}

function invalidateReferenceDataCache_() {
  CacheService.getScriptCache().remove('refdata:v1');
}

/**
 * يعيد المصادر المرجعية مُهيكلة وجاهزة للعرض، مع تخزين مؤقت لتقليل قراءات الشيت.
 * إن لم تُنشأ الورقة بعد يعيد بنية فارغة بأمان دون أي خطأ — الواجهة تتراجع
 * تلقائيًا إلى الحقول النصية الحرة في هذه الحالة (توافق كامل مع الوضع الحالي).
 */
function getReferenceData(token) {
  if (token) requireSession_(token);
  const cacheKey = 'refdata:v1';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const empty = {
    regions: [], citiesByRegion: {}, deviceTypes: [],
    socialStatuses: [], associationCategories: [], ready: false
  };
  const sheet = ss ? ss.getSheetByName(APP.sheets.referenceData) : null;
  if (!sheet || sheet.getLastRow() < 2) {
    cache.put(cacheKey, JSON.stringify(empty), 300);
    return empty;
  }

  const rows = readTable_(APP.sheets.referenceData).rows
    .filter(row => String(row['نشط']) !== 'لا')
    .sort((a, b) => safeNumber_(a['الترتيب']) - safeNumber_(b['الترتيب']));

  const result = {regions: [], citiesByRegion: {}, deviceTypes: [], socialStatuses: [], associationCategories: [], ready: true};
  rows.forEach(row => {
    const type = String(row['النوع']);
    const value = String(row['القيمة']);
    if (type === 'REGION') {
      result.regions.push(value);
      if (!result.citiesByRegion[value]) result.citiesByRegion[value] = [];
    } else if (type === 'CITY') {
      const parent = String(row['يتبع']);
      if (!result.citiesByRegion[parent]) result.citiesByRegion[parent] = [];
      result.citiesByRegion[parent].push(value);
    } else if (type === 'DEVICE_TYPE') {
      result.deviceTypes.push(value);
    } else if (type === 'SOCIAL_STATUS') {
      result.socialStatuses.push(value);
    } else if (type === 'ASSOCIATION_CATEGORY') {
      result.associationCategories.push(value);
    }
  });

  cache.put(cacheKey, JSON.stringify(result), APP.cacheSeconds * 5);
  return result;
}

/**
 * تحقق لين: يُفرض فقط بعد تشغيل الترحيل وتعبئة الجدول. قبل ذلك يتصرف
 * كالسابق تمامًا (نص حر مطلوب) حتى لا يكسر أي بيانات أو استيراد قائم.
 */
function validateRegionCity_(region, city) {
  region = requiredText_(region, 'المنطقة', 80);
  city = requiredText_(city, 'المدينة', 80);
  const data = getReferenceData();
  if (!data.ready) return {region: region, city: city};
  if (data.regions.indexOf(region) === -1) {
    throw new Error('المنطقة غير معروفة. اختر منطقة من القائمة المعتمدة');
  }
  const cities = data.citiesByRegion[region] || [];
  if (cities.indexOf(city) === -1) {
    throw new Error('المدينة "' + city + '" لا تتبع منطقة "' + region + '" في القائمة المعتمدة');
  }
  return {region: region, city: city};
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * ينشئ قاعدة البيانات دون المساس بأي صف موجود.
 * يسجل بيانات دخول المدير المؤقتة في سجل التنفيذ عند أول تشغيل.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(name => ensureSheet_(ss, name, HEADERS[name]));
  seedSettings_();
  const firstAdmin = seedAdmin_();
  applyValidations_();
  PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', String(APP.schemaVersion));
  Object.keys(HEADERS).forEach(invalidateTableCache_);
  clearDashboardCache();
  const result = {ok: true, message: 'تم تجهيز قاعدة البيانات بنجاح'};
  if (firstAdmin) {
    result.adminEmail = firstAdmin.email;
    result.temporaryPassword = firstAdmin.password;
    console.log('بيانات المدير المؤقتة: ' + firstAdmin.email + ' / ' + firstAdmin.password);
  }
  return result;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0];
    headers.forEach((header, index) => {
      if (!current[index]) sheet.getRange(1, index + 1).setValue(header);
    });
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#183F3A').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center').setWrap(true);
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function seedSettings_() {
  const sheet = sheet_(APP.sheets.settings);
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, 8, 3).setValues([
    ['اسم المشروع', 'مشروع توزيع الأجهزة الكهربائية', 'يظهر في رأس النظام'],
    ['الجهة المالكة', 'جمعية الزاد', 'الجهة المشرفة'],
    ['الشريك', 'مؤسسة سليمان أبانمي الأهلية', 'شريك المشروع'],
    ['المنطقة الزمنية', APP.timezone, 'تستخدم في جميع السجلات'],
    ['تاريخ البداية', '', 'yyyy/MM/dd'],
    ['تاريخ النهاية', '', 'yyyy/MM/dd'],
    ['تحديث تلقائي بالدقائق', '5', 'الحد الأدنى دقيقة واحدة'],
    ['مجلد شواهد التسليم', '', 'ينشئه النظام عند أول رفع']
  ]);
}

function seedAdmin_() {
  const sheet = sheet_(APP.sheets.users);
  if (sheet.getLastRow() > 1) return null;
  const password = createAccessCode_('ZAD', 10);
  const salt = Utilities.getUuid();
  sheet.appendRow([
    nextId_('USR'), 'مدير النظام', 'admin@alzad.org', hashSecret_(password, salt),
    salt, 'ADMIN', '', 'نشط', now_(), ''
  ]);
  return {email: 'admin@alzad.org', password: password};
}

function applyValidations_() {
  setValidation_(APP.sheets.beneficiaries, 'حالة المستفيد', BENEFICIARY_STATUSES);
  setValidation_(APP.sheets.beneficiaries, 'حالة التسليم', DELIVERY_STATUSES);
  setValidation_(APP.sheets.beneficiaries, 'ضمان اجتماعي', ['نعم', 'لا']);
  setValidation_(APP.sheets.devices, 'حالة الجهاز', DEVICE_STATUSES);
  setValidation_(APP.sheets.delegates, 'الحالة', ['نشط', 'غير نشط']);
  setValidation_(APP.sheets.associations, 'الحالة', ['نشطة', 'غير نشطة']);
}

function setValidation_(sheetName, header, values) {
  const sheet = sheet_(sheetName);
  const map = headerMap_(sheet);
  if (map[header] === undefined) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(2, map[header] + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

