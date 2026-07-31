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
 * تمامًا مثل setupSheets_ ولنفس السبب: يكتب في الملف الحي. يتطلب رمز
 * وصول صيانة صالح (راجع ReleaseOps.gs) — دالة خاصة، لا تُستدعى من الواجهة.
 */
function migrateReferenceData_(token) {
  requireMaintenanceAccess_(token);
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
 * مرادفات معروفة بثقة فقط (اختصارات شائعة) — قائمة قصيرة عمدًا. أي قيمة
 * لا تطابق منطقة معتمدة حرفيًا ولا توجد في هذه القائمة تُعتبر غامضة ولا
 * يُخمَّن لها بديل إطلاقًا.
 */
const REFERENCE_LEGACY_REGION_SYNONYMS = Object.freeze({
  'مكة': 'مكة المكرمة',
  'المدينة': 'المدينة المنورة',
  'الشرقيه': 'الشرقية',
  'الجوف ': 'الجوف'
});

/** فهرس عكسي: كل مدينة معتمدة ← قائمة المناطق التي تظهر تحتها (عادة منطقة واحدة فقط). */
function buildCityToRegionIndex_(data) {
  const index = {};
  Object.keys(data.citiesByRegion).forEach(region => {
    (data.citiesByRegion[region] || []).forEach(city => {
      if (!index[city]) index[city] = [];
      if (index[city].indexOf(region) === -1) index[city].push(region);
    });
  });
  return index;
}

/** يعيد {value, changed} إن وُجد بديل مؤكَّد بلا غموض، أو null إن كانت القيمة غامضة/غير معروفة. */
function proposeCanonicalRegion_(rawRegion, data) {
  const trimmed = cleanText_(rawRegion, 80);
  if (data.regions.indexOf(trimmed) >= 0) return {value: trimmed, changed: trimmed !== rawRegion};
  const synonym = REFERENCE_LEGACY_REGION_SYNONYMS[trimmed] || REFERENCE_LEGACY_REGION_SYNONYMS[rawRegion];
  if (synonym && data.regions.indexOf(synonym) >= 0) return {value: synonym, changed: true};
  return null;
}

/** نفس المبدأ للمدينة، ضمن منطقة معيَّنة (بعد تصحيح المنطقة إن أمكن). */
function proposeCanonicalCity_(rawCity, canonicalRegion, data, cityToRegionIndex) {
  const trimmed = cleanText_(rawCity, 80);
  const citiesOfRegion = data.citiesByRegion[canonicalRegion] || [];
  if (citiesOfRegion.indexOf(trimmed) >= 0) return {value: trimmed, changed: trimmed !== rawCity};
  // المدينة موجودة حرفيًا في القائمة المرجعية لكن تحت منطقة أخرى — لا
  // نقترح نقلها تلقائيًا لأن ذلك تغيير أوسع من مجرد تصحيح إملائي؛ إن
  // كانت تتبع تلك المنطقة نفسها فقط (بلا غموض) فهي مطابقة فعلًا لا تحتاج تعديلًا.
  const owners = cityToRegionIndex[trimmed] || [];
  if (owners.length === 1 && owners[0] === canonicalRegion) return {value: trimmed, changed: trimmed !== rawCity};
  return null;
}

/**
 * تشخيص قراءة فقط — لا تكتب أي شيء إطلاقًا. يقارن المستفيدين والجمعيات
 * والأجهزة بالقوائم المرجعية المعتمدة (بعد تشغيل migrateReferenceData_)
 * ويُخرج تقريرًا مُصنَّفًا بعدد السجلات المتأثرة وموقعها. يتطلب رمز وصول
 * صيانة صالح رغم كونها قراءة فقط — لا تُسرِّب أسماء أوراق/قيم مرجعية لأي
 * طرف غير مصرَّح. دالة خاصة، لا تُستدعى من الواجهة.
 */
function diagnoseReferenceDataIssues_(token) {
  requireMaintenanceAccess_(token);
  const data = getReferenceData();
  if (!data.ready) {
    return {
      ok: true, ready: false, issueCount: 0, issues: [],
      message: 'لم يُشغَّل migrateReferenceData بعد — لا توجد قائمة معتمدة للمقارنة حاليًا. كل الحقول تُقبل كنص حر (سلوك متوافق مع الوضع الحالي).'
    };
  }
  const issues = [];
  function report(type, severity, sheet, id, field, value, message) {
    issues.push({type: type, severity: severity, sheet: sheet, id: String(id || ''), field: field, value: String(value || ''), message: message});
  }

  readTable_(APP.sheets.beneficiaries).rows.forEach(row => {
    const id = row['رقم المستفيد'];
    const region = String(row['المنطقة'] || '');
    const city = String(row['المدينة'] || '');
    if (region && data.regions.indexOf(region) === -1) {
      report('UNKNOWN_REGION', 'high', 'المستفيدون', id, 'المنطقة', region, 'منطقة غير معروفة في القائمة المعتمدة');
    } else if (region && city && (data.citiesByRegion[region] || []).indexOf(city) === -1) {
      report('CITY_REGION_MISMATCH', 'high', 'المستفيدون', id, 'المدينة', city, 'مدينة لا تتبع منطقتها المسجَّلة "' + region + '"');
    }
    const socialStatus = String(row['الحالة الاجتماعية'] || '');
    if (socialStatus && data.socialStatuses.length && data.socialStatuses.indexOf(socialStatus) === -1) {
      report('UNKNOWN_SOCIAL_STATUS', 'medium', 'المستفيدون', id, 'الحالة الاجتماعية', socialStatus, 'حالة اجتماعية غير معروفة في القائمة المعتمدة');
    }
  });

  readTable_(APP.sheets.associations).rows.forEach(row => {
    const id = row['رقم الجمعية'];
    const region = String(row['المنطقة'] || '');
    const city = String(row['المدينة'] || '');
    if (region && data.regions.indexOf(region) === -1) {
      report('UNKNOWN_REGION', 'high', 'الجمعيات', id, 'المنطقة', region, 'منطقة غير معروفة في القائمة المعتمدة');
    } else if (region && city && (data.citiesByRegion[region] || []).indexOf(city) === -1) {
      report('CITY_REGION_MISMATCH', 'high', 'الجمعيات', id, 'المدينة', city, 'مدينة لا تتبع منطقتها المسجَّلة "' + region + '"');
    }
    const category = String(row['التصنيف'] || '');
    if (category && data.associationCategories.length && data.associationCategories.indexOf(category) === -1) {
      report('UNKNOWN_CATEGORY', 'low', 'الجمعيات', id, 'التصنيف', category, 'تصنيف جمعية غير معروف في القائمة المعتمدة');
    }
  });

  readTable_(APP.sheets.devices).rows.forEach(row => {
    const id = row['رقم الجهاز'];
    const type = String(row['النوع'] || '');
    if (type && data.deviceTypes.length && data.deviceTypes.indexOf(type) === -1) {
      report('UNKNOWN_DEVICE_TYPE', 'low', 'الأجهزة', id, 'النوع', type, 'نوع جهاز غير معروف في القائمة المعتمدة');
    }
  });

  const bySeverity = {high: 0, medium: 0, low: 0};
  const byType = {};
  issues.forEach(issue => {
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byType[issue.type] = (byType[issue.type] || 0) + 1;
  });

  return {
    ok: true, ready: true, generatedAt: formatDateTime_(new Date()),
    issueCount: issues.length, bySeverity: bySeverity, byType: byType, issues: issues
  };
}

/**
 * ⚠️ ترحيل كتابة فعلي — لم يُستدعَ تلقائيًا من أي مكان في المشروع، ويجب
 * تشغيله يدويًا من محرر Apps Script بعد المراجعة والموافقة فقط. يتطلب
 * رمز وصول صيانة صالح. دالة خاصة، لا تُستدعى من الواجهة.
 *
 * dryRun (افتراضيًا true — معاينة آمنة بالكامل): يبني قائمة الاقتراحات
 * (القيمة القديمة والجديدة المقترحة) دون كتابة أي شيء إطلاقًا. مرِّر
 * false صراحة لتطبيق الاقتراحات المؤكَّدة فقط (لا الغامضة).
 *
 * لا يُخمِّن أبدًا: يقترح تصحيحًا فقط عند تطابق حرفي بعد تنظيف المسافات،
 * أو مرادف معروف بثقة (REFERENCE_LEGACY_REGION_SYNONYMS)، أو مدينة تتبع
 * منطقة واحدة فقط بلا غموض. أي حالة غير ذلك تُدرَج في "ambiguous" دون
 * أي تعديل مقترَح لها — تحتاج مراجعة يدوية دائمًا.
 *
 * آمنة لإعادة التشغيل: بعد تطبيق تصحيح، القيمة تصبح مطابقة للقائمة
 * المعتمدة فتُستبعَد تلقائيًا من proposals في أي تشغيل تالٍ (لا تكرار).
 */
function migrateLegacyReferenceValues_(token, dryRun) {
  requireMaintenanceAccess_(token);
  dryRun = dryRun !== false;
  const data = getReferenceData();
  if (!data.ready) {
    return {ok: false, ready: false, dryRun: dryRun,
      message: 'شغّل migrateReferenceData_ أولًا لبناء القائمة المعتمدة قبل أي ترحيل لقيم قديمة.'};
  }
  const cityToRegionIndex = buildCityToRegionIndex_(data);
  const proposals = [];
  const ambiguous = [];
  let applied = 0;

  function proposeField(sheetName, idHeader, id, field, oldValue, newValue) {
    if (newValue === null) {
      ambiguous.push({sheet: sheetName, id: String(id || ''), field: field, value: String(oldValue || ''),
        reason: 'قيمة غامضة أو غير معروفة — لم يُخمَّن أي بديل، تحتاج مراجعة يدوية'});
      return;
    }
    if (String(newValue) === String(oldValue || '')) return;
    proposals.push({sheet: sheetName, id: String(id || ''), field: field, oldValue: String(oldValue || ''), newValue: String(newValue)});
    if (!dryRun) {
      updateById_(sheetName, idHeader, id, {[field]: newValue});
      applied++;
    }
  }

  function migrateRegionCity(sheetName, idHeader, row, idField) {
    const id = row[idField];
    const rawRegion = String(row['المنطقة'] || '');
    let effectiveRegion = rawRegion;
    if (rawRegion) {
      const regionProposal = proposeCanonicalRegion_(rawRegion, data);
      proposeField(sheetName, idHeader, id, 'المنطقة', rawRegion, regionProposal ? regionProposal.value : null);
      if (regionProposal) effectiveRegion = regionProposal.value;
    }
    const rawCity = String(row['المدينة'] || '');
    if (rawCity && effectiveRegion) {
      const cityProposal = proposeCanonicalCity_(rawCity, effectiveRegion, data, cityToRegionIndex);
      proposeField(sheetName, idHeader, id, 'المدينة', rawCity, cityProposal ? cityProposal.value : null);
    }
  }

  readTable_(APP.sheets.beneficiaries).rows.forEach(row => {
    migrateRegionCity(APP.sheets.beneficiaries, 'رقم المستفيد', row, 'رقم المستفيد');
    const id = row['رقم المستفيد'];
    const rawStatus = String(row['الحالة الاجتماعية'] || '');
    if (rawStatus && data.socialStatuses.length && data.socialStatuses.indexOf(rawStatus) === -1) {
      ambiguous.push({sheet: APP.sheets.beneficiaries, id: String(id), field: 'الحالة الاجتماعية', value: rawStatus,
        reason: 'لا مرادف معروف بثقة — تحتاج مراجعة يدوية'});
    }
  });

  readTable_(APP.sheets.associations).rows.forEach(row => {
    migrateRegionCity(APP.sheets.associations, 'رقم الجمعية', row, 'رقم الجمعية');
    const id = row['رقم الجمعية'];
    const rawCategory = String(row['التصنيف'] || '');
    if (rawCategory && data.associationCategories.length && data.associationCategories.indexOf(rawCategory) === -1) {
      ambiguous.push({sheet: APP.sheets.associations, id: String(id), field: 'التصنيف', value: rawCategory,
        reason: 'لا مرادف معروف بثقة — تحتاج مراجعة يدوية'});
    }
  });

  readTable_(APP.sheets.devices).rows.forEach(row => {
    const id = row['رقم الجهاز'];
    const rawType = String(row['النوع'] || '');
    if (rawType && data.deviceTypes.length && data.deviceTypes.indexOf(rawType) === -1) {
      ambiguous.push({sheet: APP.sheets.devices, id: String(id), field: 'النوع', value: rawType,
        reason: 'لا مرادف معروف بثقة — تحتاج مراجعة يدوية'});
    }
  });

  if (!dryRun) { invalidateTableCache_(APP.sheets.beneficiaries); invalidateTableCache_(APP.sheets.associations); }

  return {
    ok: true, ready: true, dryRun: dryRun,
    proposedCount: proposals.length, ambiguousCount: ambiguous.length, appliedCount: dryRun ? 0 : applied,
    proposals: proposals, ambiguous: ambiguous,
    message: dryRun
      ? 'وضع المعاينة (dry-run): لم يُعدَّل أي شيء. راجع proposals وambiguous قبل أي تشغيل فعلي.'
      : 'تم تطبيق ' + applied + ' تعديلًا مؤكَّدًا. راجع ambiguous للحالات التي تحتاج مراجعة يدوية.'
  };
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

/**
 * نفس مبدأ validateRegionCity_ (تحقّق لين، مفروض فقط بعد تشغيل الترحيل)
 * لبقية القوائم الموحَّدة — التحقق هنا في الخادم دائمًا، لا في الواجهة
 * فقط، حتى لو تجاوز طلب مباشر نموذج الواجهة كليًا.
 */
function validateSocialStatus_(value) {
  value = requiredText_(value, 'الحالة الاجتماعية', 80);
  const data = getReferenceData();
  if (!data.ready || !data.socialStatuses.length) return value;
  if (data.socialStatuses.indexOf(value) === -1) {
    throw new Error('الحالة الاجتماعية "' + value + '" غير معروفة. اختر من القائمة المعتمدة');
  }
  return value;
}

function validateAssociationCategory_(value) {
  value = cleanText_(value, 80);
  if (!value) return value; // التصنيف اختياري دائمًا، بخلاف المنطقة/المدينة/الحالة الاجتماعية
  const data = getReferenceData();
  if (!data.ready || !data.associationCategories.length) return value;
  if (data.associationCategories.indexOf(value) === -1) {
    throw new Error('تصنيف الجمعية "' + value + '" غير معروف. اختر من القائمة المعتمدة');
  }
  return value;
}

function validateDeviceType_(value) {
  value = requiredText_(value, 'نوع الجهاز', 80);
  const data = getReferenceData();
  if (!data.ready || !data.deviceTypes.length) return value;
  if (data.deviceTypes.indexOf(value) === -1) {
    throw new Error('نوع الجهاز "' + value + '" غير معروف. اختر من القائمة المعتمدة');
  }
  return value;
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * ينشئ قاعدة البيانات دون المساس بأي صف موجود.
 * يسجل بيانات دخول المدير المؤقتة في سجل التنفيذ عند أول تشغيل.
 * يتطلب رمز وصول صيانة صالح (شغّل grantMaintenanceAccess_() أولًا —
 * تعمل حتى على مشروع فارغ تمامًا، لا تعتمد على أي ورقة موجودة). دالة
 * خاصة، لا تُستدعى من الواجهة.
 */
function setupSheets_(token) {
  requireMaintenanceAccess_(token);
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

