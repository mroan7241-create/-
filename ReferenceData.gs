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
const REFERENCE_SEED_ASSOCIATION_CATEGORIES = ['جمعية أهلية', 'جمعية خيرية', 'جمعية بر', 'مؤسسة أهلية', 'جمعية تنموية', 'أخرى'];
/** مجال عمل الجمعية — حقل جديد في نموذج تقديم الجمعيات، مستقل عن "التصنيف". */
const REFERENCE_SEED_ASSOCIATION_SECTORS = ['رعاية الأيتام', 'رعاية الأسر المنتجة', 'ذوو الإعاقة', 'رعاية كبار السن', 'الإغاثة والكوارث', 'التنمية المجتمعية', 'أخرى'];

// Phase 3.1 — محاضر استلام دفعات الأجهزة: قوائم مرجعية بذرية بسيطة،
// بلا أي نظام مشتريات أو موردين حقيقي. المواصفات (DEVICE_SPEC) تتبع نوع
// جهاز محدَّد (يتبع=قيمة النوع)، تمامًا كمبدأ CITY يتبع REGION أعلاه.
const REFERENCE_SEED_DEVICE_SPECS = Object.freeze({
  'ثلاجة': ['16 قدم', '18 قدم', 'باب واحد', 'بابين'],
  'فرن': ['5 شعلات', '6 شعلات', 'شعلتان'],
  'غسالة': ['أوتوماتيك 7 كجم', 'أوتوماتيك 9 كجم', 'نصف أوتوماتيك']
});
const REFERENCE_SEED_DIFFERENCE_REASONS = ['تلف أثناء الشحن', 'تلف أثناء التفريغ', 'نقص من المورد', 'خطأ في العدّ', 'أخرى'];
const REFERENCE_SEED_RECEIVER_TITLES = ['مدير الجمعية', 'مسؤول المستودع', 'منسّق المشروع', 'أخرى'];
// لا بذور موردين افتراضية — قائمة موردين حقيقية تُضاف عبر addReferenceValue_
// بمعرفة ADMIN فقط (لا نظام مشتريات، مجرد معلومة مرجعية). القائمة الفارغة
// تعني قبول أي اسم مورد كنص حر حتى تُضاف قيم فعلية (نفس مبدأ التحقق اللين
// المتبع في كل حقل مرجعي آخر في هذا الملف قبل seeding).
const REFERENCE_SEED_SUPPLIERS = [];

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
  REFERENCE_SEED_ASSOCIATION_SECTORS.forEach((value, index) => {
    rows.push([nextId_('REF'), 'ASSOCIATION_SECTOR', value, '', index + 1, 'نعم']);
  });
  Object.keys(REFERENCE_SEED_DEVICE_SPECS).forEach(deviceType => {
    REFERENCE_SEED_DEVICE_SPECS[deviceType].forEach((value, index) => {
      rows.push([nextId_('REF'), 'DEVICE_SPEC', value, deviceType, index + 1, 'نعم']);
    });
  });
  REFERENCE_SEED_DIFFERENCE_REASONS.forEach((value, index) => {
    rows.push([nextId_('REF'), 'DIFFERENCE_REASON', value, '', index + 1, 'نعم']);
  });
  REFERENCE_SEED_RECEIVER_TITLES.forEach((value, index) => {
    rows.push([nextId_('REF'), 'RECEIVER_TITLE', value, '', index + 1, 'نعم']);
  });
  REFERENCE_SEED_SUPPLIERS.forEach((value, index) => {
    rows.push([nextId_('REF'), 'SUPPLIER', value, '', index + 1, 'نعم']);
  });

  sheet.getRange(2, 1, rows.length, HEADERS[APP.sheets.referenceData].length).setValues(rows);
  invalidateTableCache_(APP.sheets.referenceData);
  invalidateReferenceDataCache_();
  return {ok: true, skipped: false, inserted: rows.length,
    message: 'تم إنشاء ' + rows.length + ' سجلًا مرجعيًا (مناطق، مدن، أنواع أجهزة، حالات اجتماعية، تصنيفات ومجالات جمعيات).'};
}

function invalidateReferenceDataCache_() {
  CacheService.getScriptCache().remove('refdata:v4');
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

/**
 * أسماء سابقة معروفة بثقة لتصنيف جمعية معتمد حاليًا — "بر" كانت الاسم
 * المُستخدَم فعليًا قبل اعتماد "جمعية بر" رسميًا. سجلّات قديمة تحمل هذه
 * القيمة تبقى كما هي بلا أي تعديل تلقائي أو جماعي (لا ترحيل هنا)، ولا
 * تُعتبر "تصنيفًا مجهولًا" في diagnoseReferenceDataIssues_، بينما أي
 * إنشاء أو تعديل جديد يمر عبر validateAssociationCategory_ يُخزَّن
 * دائمًا بالاسم الرسمي "جمعية بر" (راجع validateAssociationCategory_).
 */
const REFERENCE_LEGACY_CATEGORY_SYNONYMS = Object.freeze({
  'بر': 'جمعية بر'
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
    if (category && data.associationCategories.length && data.associationCategories.indexOf(category) === -1
      && !REFERENCE_LEGACY_CATEGORY_SYNONYMS[category]) {
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
/**
 * القائمة المعتمدة المضمَّنة في الكود — تُستخدم عندما تكون ورقة
 * "البيانات المرجعية" غير موجودة أو فارغة (أي قبل تشغيل
 * migrateReferenceData_، وهو ترحيل يدوي محروس برمز صيانة).
 *
 * لماذا هذا التغيير: قبله كانت الورقة الفارغة تعني `ready: false`،
 * فتسقط **كل** النماذج بصمت إلى حقول نصية حرة — وهو بالضبط ما رُصد حيًّا
 * بتاريخ 2026/08/01 (تصنيف/منطقة/مدينة الجمعية ونوع الجهاز حقول نصية
 * رغم وجود getReferenceData). القيم كانت أصلًا موجودة في هذا الملف
 * كبذور للترحيل؛ جعلها مصدرًا صالحًا مباشرة يوفّر قوائم منسدلة مترابطة
 * فورًا **بلا أي كتابة في الملف الحي ولا أي ترحيل**. الورقة — متى
 * عُبِّئت — تبقى المصدر الأعلى وتتجاوز المضمَّن بالكامل.
 */
function builtinReferenceData_() {
  const result = {
    regions: [], citiesByRegion: {},
    deviceTypes: REFERENCE_SEED_DEVICE_TYPES.slice(),
    socialStatuses: REFERENCE_SEED_SOCIAL_STATUSES.slice(),
    associationCategories: REFERENCE_SEED_ASSOCIATION_CATEGORIES.slice(),
    associationSectors: REFERENCE_SEED_ASSOCIATION_SECTORS.slice(),
    deviceSpecsByType: {}, suppliers: REFERENCE_SEED_SUPPLIERS.slice(),
    differenceReasons: REFERENCE_SEED_DIFFERENCE_REASONS.slice(), receiverTitles: REFERENCE_SEED_RECEIVER_TITLES.slice(),
    applicationQuestions: APPLICATION_QUESTIONS.map(q => ({key: q.key, label: q.label})),
    pledgeText: APPLICATION_PLEDGE_TEXT,
    ready: true, source: 'builtin'
  };
  Object.keys(REFERENCE_SEED_REGIONS_CITIES).forEach(region => {
    result.regions.push(region);
    result.citiesByRegion[region] = REFERENCE_SEED_REGIONS_CITIES[region].slice();
  });
  Object.keys(REFERENCE_SEED_DEVICE_SPECS).forEach(deviceType => {
    result.deviceSpecsByType[deviceType] = REFERENCE_SEED_DEVICE_SPECS[deviceType].slice();
  });
  return result;
}

function getReferenceData(token) {
  if (token) requireSession_(token);
  // v4 (Phase 3.1): أضيفت deviceSpecsByType/suppliers/differenceReasons/
  // receiverTitles — رفع رقم الإصدار يمنع إعادة قيمة مخزَّنة مؤقتًا من
  // نسخة سابقة لا تحمل هذه الحقول الجديدة.
  const cacheKey = 'refdata:v4';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(APP.sheets.referenceData) : null;
  if (!sheet || sheet.getLastRow() < 2) {
    const builtin = builtinReferenceData_();
    cache.put(cacheKey, JSON.stringify(builtin), 300);
    return builtin;
  }

  const rows = readTable_(APP.sheets.referenceData).rows
    .filter(row => String(row['نشط']) !== 'لا')
    .sort((a, b) => safeNumber_(a['الترتيب']) - safeNumber_(b['الترتيب']));

  const result = {regions: [], citiesByRegion: {}, deviceTypes: [], socialStatuses: [],
    associationCategories: [], associationSectors: [],
    deviceSpecsByType: {}, suppliers: [], differenceReasons: [], receiverTitles: [],
    applicationQuestions: APPLICATION_QUESTIONS.map(q => ({key: q.key, label: q.label})),
    pledgeText: APPLICATION_PLEDGE_TEXT,
    ready: true, source: 'sheet'};
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
    } else if (type === 'ASSOCIATION_SECTOR') {
      result.associationSectors.push(value);
    } else if (type === 'DEVICE_SPEC') {
      const parent = String(row['يتبع']);
      if (!result.deviceSpecsByType[parent]) result.deviceSpecsByType[parent] = [];
      result.deviceSpecsByType[parent].push(value);
    } else if (type === 'SUPPLIER') {
      result.suppliers.push(value);
    } else if (type === 'DIFFERENCE_REASON') {
      result.differenceReasons.push(value);
    } else if (type === 'RECEIVER_TITLE') {
      result.receiverTitles.push(value);
    }
  });

  cache.put(cacheKey, JSON.stringify(result), APP.cacheSeconds * 5);
  return result;
}

/**
 * تحقق لين: يُفرض فقط بعد تشغيل الترحيل وتعبئة الجدول. قبل ذلك يتصرف
 * كالسابق تمامًا (نص حر مطلوب) حتى لا يكسر أي بيانات أو استيراد قائم.
 */
/**
 * تمرير القيم التاريخية (grandfathering): قيمة مخزَّنة مسبقًا في سجل
 * قائم تُقبل كما هي حتى لو لم تعد ضمن القائمة المعتمدة — بشرط أن تكون
 * **مطابقة حرفيًا** لما هو مخزَّن فعلًا في ذلك السجل بالذات.
 *
 * ضروري لأن القائمة المعتمدة صارت مفعَّلة افتراضيًا (المصدر المضمَّن)،
 * فبدون هذا الاستثناء قد يعجز مستخدم عن تعديل *حقل آخر تمامًا* (ملاحظة
 * مثلًا) في سجل قديم لمجرد أن مدينته كُتبت يدويًا قبل توحيد القوائم.
 * لا يفتح أي ثغرة: لا يقبل إلا قيمة موجودة أصلًا في الجدول لنفس السجل،
 * ولا يُطبَّق إطلاقًا على السجلات الجديدة (previous فارغة عند الإنشاء).
 */
function isGrandfatheredValue_(value, previous) {
  return !!previous && String(value) === String(previous);
}

function validateRegionCity_(region, city, previous) {
  region = requiredText_(region, 'المنطقة', 80);
  city = requiredText_(city, 'المدينة', 80);
  previous = previous || {};
  const data = getReferenceData();
  if (!data.ready) return {region: region, city: city};
  const regionOk = data.regions.indexOf(region) >= 0 || isGrandfatheredValue_(region, previous.region);
  if (!regionOk) {
    throw new Error('المنطقة غير معروفة. اختر منطقة من القائمة المعتمدة');
  }
  const cities = data.citiesByRegion[region] || [];
  const cityOk = cities.indexOf(city) >= 0 || isGrandfatheredValue_(city, previous.city);
  if (!cityOk) {
    throw new Error('المدينة "' + city + '" لا تتبع منطقة "' + region + '" في القائمة المعتمدة');
  }
  return {region: region, city: city};
}

/**
 * نفس مبدأ validateRegionCity_ (تحقّق لين، مفروض فقط بعد تشغيل الترحيل)
 * لبقية القوائم الموحَّدة — التحقق هنا في الخادم دائمًا، لا في الواجهة
 * فقط، حتى لو تجاوز طلب مباشر نموذج الواجهة كليًا.
 */
function validateSocialStatus_(value, previous) {
  value = requiredText_(value, 'الحالة الاجتماعية', 80);
  const data = getReferenceData();
  if (!data.ready || !data.socialStatuses.length) return value;
  if (data.socialStatuses.indexOf(value) === -1 && !isGrandfatheredValue_(value, previous)) {
    throw new Error('الحالة الاجتماعية "' + value + '" غير معروفة. اختر من القائمة المعتمدة');
  }
  return value;
}

function validateAssociationCategory_(value, previous) {
  value = cleanText_(value, 80);
  if (!value) return value; // التصنيف اختياري دائمًا، بخلاف المنطقة/المدينة/الحالة الاجتماعية
  // اسم سابق معروف (مثل "بر") يُطبَّع دائمًا إلى الاسم الرسمي عند أي
  // إنشاء أو تعديل جديد — لا يُترك بصيغته القديمة في سجل يُكتَب الآن.
  const canonical = REFERENCE_LEGACY_CATEGORY_SYNONYMS[value] || value;
  const data = getReferenceData();
  if (!data.ready || !data.associationCategories.length) return canonical;
  if (data.associationCategories.indexOf(canonical) === -1 && !isGrandfatheredValue_(value, previous)) {
    throw new Error('تصنيف الجمعية "' + value + '" غير معروف. اختر من القائمة المعتمدة');
  }
  return canonical;
}

/**
 * مجال عمل الجمعية (حقل جديد في نموذج التقديم) — مطلوب دائمًا، بنفس
 * نمط validateAssociationCategory_ (قائمة معتمدة + grandfathering).
 * القائمة المعتمدة نفسها تتضمن قيمة "أخرى" صراحةً
 * (REFERENCE_SEED_ASSOCIATION_SECTORS)، فاختيار "أخرى" من الواجهة يمر
 * دون أي معالجة خاصة — لا حاجة لمسار تحقّق منفصل للنص الحر.
 */
function validateAssociationSector_(value, previous) {
  value = requiredText_(value, 'مجال عمل الجمعية', 80);
  const data = getReferenceData();
  if (!data.ready || !data.associationSectors.length) return value;
  if (data.associationSectors.indexOf(value) === -1 && !isGrandfatheredValue_(value, previous)) {
    throw new Error('مجال عمل الجمعية "' + value + '" غير معروف. اختر من القائمة المعتمدة');
  }
  return value;
}

function validateDeviceType_(value, previous) {
  value = requiredText_(value, 'نوع الجهاز', 80);
  const data = getReferenceData();
  if (!data.ready || !data.deviceTypes.length) return value;
  if (data.deviceTypes.indexOf(value) === -1 && !isGrandfatheredValue_(value, previous)) {
    throw new Error('نوع الجهاز "' + value + '" غير معروف. اختر من القائمة المعتمدة');
  }
  return value;
}

/** Phase 3.1 — مواصفة/مقاس/سعة جهاز، تتبع نوعًا محدَّدًا (نفس مبدأ المدينة تتبع المنطقة). */
function validateDeviceSpec_(deviceType, value, previous) {
  value = requiredText_(value, 'المواصفة', 120);
  const data = getReferenceData();
  const specsForType = (data.deviceSpecsByType && data.deviceSpecsByType[deviceType]) || [];
  if (!data.ready || !specsForType.length) return value;
  if (specsForType.indexOf(value) === -1 && !isGrandfatheredValue_(value, previous)) {
    throw new Error('المواصفة "' + value + '" غير معروفة لنوع "' + deviceType + '". اختر من القائمة المعتمدة');
  }
  return value;
}

/** Phase 3.1 — اسم مورد مرجعي فقط (بلا نظام مشتريات) — نص حر ما لم تُبذر قائمة معتمدة. */
function validateSupplier_(value, previous) {
  value = requiredText_(value, 'اسم المورد', 150);
  const data = getReferenceData();
  if (!data.ready || !data.suppliers.length) return value;
  if (data.suppliers.indexOf(value) === -1 && !isGrandfatheredValue_(value, previous)) {
    throw new Error('المورد "' + value + '" غير معروف. اختر من القائمة المعتمدة أو أضِفه أولًا');
  }
  return value;
}

/** Phase 3.1 — سبب فرق كمية استلام (تلف/نقص) — مطلوب فقط عند وجود فرق فعلي في بند المحضر. */
function validateDifferenceReason_(value) {
  value = requiredText_(value, 'سبب الفرق', 150);
  const data = getReferenceData();
  if (!data.ready || !data.differenceReasons.length) return value;
  if (data.differenceReasons.indexOf(value) === -1) {
    throw new Error('سبب الفرق "' + value + '" غير معروف. اختر من القائمة المعتمدة');
  }
  return value;
}

/** Phase 3.1 — صفة مستلم محضر الاستلام لدى الجمعية. */
function validateReceiverTitle_(value) {
  value = requiredText_(value, 'صفة المستلم', 100);
  const data = getReferenceData();
  if (!data.ready || !data.receiverTitles.length) return value;
  if (data.receiverTitles.indexOf(value) === -1) {
    throw new Error('صفة المستلم "' + value + '" غير معروفة. اختر من القائمة المعتمدة');
  }
  return value;
}

/**
 * Phase 3.1 (القسم 7) — يسمح لـADMIN بإضافة قيمة مرجعية جديدة لأي نوع
 * موجود بالفعل ضمن هذا الملف (device_spec يتطلب "يتبع" نوع جهاز صالحًا؛
 * بقية الأنواع تتجاهله). يرفض نوعًا غير معروف أو قيمة مكرَّرة (نصًا،
 * ضمن نفس "يتبع" إن وُجد) قبل أي كتابة. لا ينشئ نوعًا جديدًا كليًا —
 * فقط يضيف صفًا لأحد الأنواع المعروفة أصلًا، فيتجنّب "نوع مرجعي" عشوائي
 * تخترعه الواجهة لاحقًا بلا مراجعة هنا أولًا.
 */
const REFERENCE_DATA_TYPES_ = Object.freeze([
  'REGION', 'CITY', 'DEVICE_TYPE', 'SOCIAL_STATUS', 'ASSOCIATION_CATEGORY', 'ASSOCIATION_SECTOR',
  'DEVICE_SPEC', 'SUPPLIER', 'DIFFERENCE_REASON', 'RECEIVER_TITLE'
]);
function addReferenceValue(token, payload) {
  const user = requireSession_(token, ['ADMIN']);
  payload = payload || {};
  const type = requiredText_(payload.type, 'نوع القيمة المرجعية', 40);
  if (REFERENCE_DATA_TYPES_.indexOf(type) === -1) {
    throw new Error('نوع قيمة مرجعية غير معروف: ' + type);
  }
  const value = requiredText_(payload.value, 'القيمة', 150);
  const parent = cleanText_(payload.parent, 80);

  invalidateTableCache_(APP.sheets.referenceData);
  const existing = readTable_(APP.sheets.referenceData).rows.filter(row => String(row['النوع']) === type);
  const duplicate = existing.some(row => String(row['القيمة']) === value && String(row['يتبع'] || '') === parent);
  if (duplicate) throw new Error('هذه القيمة موجودة بالفعل ضمن نفس النوع' + (parent ? ' والتبعية' : ''));

  const nextOrder = existing.reduce((max, row) => Math.max(max, safeNumber_(row['الترتيب'])), 0) + 1;
  const id = nextId_('REF');
  appendObject_(APP.sheets.referenceData, {'المعرف': id, 'النوع': type, 'القيمة': value, 'يتبع': parent, 'الترتيب': nextOrder, 'نشط': 'نعم'});
  invalidateTableCache_(APP.sheets.referenceData);
  invalidateReferenceDataCache_();
  try {
    audit_(user, 'إضافة قيمة مرجعية', 'البيانات المرجعية', id, 'النوع: ' + type);
  } catch (auditError) {
    Logger.log('تحذير: فشل تسجيل العملية بعد نجاح إضافة القيمة المرجعية فعليًا — traceId=' + requestMeta_().traceId + ' — ' + auditError.message);
  }
  return {ok: true, id: id};
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

