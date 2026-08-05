// -------------------- المستفيدون --------------------

/**
 * قائمة مستفيدين مُرقَّمة (صفحة واحدة فقط تصل للعميل) مع بحث/فلترة —
 * هذه هي مصدر بيانات صفحة "المستفيدون" الآن بدل مصفوفة كاملة في
 * Bootstrap. العزل بين الجمعيات مفروض هنا صراحة قبل أي بحث أو ترقيم:
 * جمعية لا تستطيع طلب صفحة تخص جمعية أخرى مهما كانت options.associationId.
 */
function listBeneficiaries(token, options) {
  return perfTime_('listBeneficiaries', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    return withMeta_(listBeneficiaries_(user, options));
  });
}

/**
 * النسخة الداخلية (تأخذ المستخدم المُتحقَّق منه بدل الرمز) — تُستدعى من
 * الدالة العامة أعلاه ومن endpoint البوابة المُجمَّع getPortalBundle دون
 * إعادة التحقق من الجلسة ولا إعادة بدء الطلب، فتبقى قراءة الأوراق واحدة
 * لكل جدول في الطلب المُجمَّع بدل قراءتها مرتين.
 */
function listBeneficiaries_(user, options) {
  options = options || {};
  let rows = readTable_(APP.sheets.beneficiaries).rows;
  if (user.role === 'ASSOCIATION') {
    rows = rows.filter(row => String(row['رقم الجمعية']) === user.associationId);
  } else if (options.associationId) {
    rows = rows.filter(row => String(row['رقم الجمعية']) === cleanId_(options.associationId));
  }
  let items = rows.map(normalizeBeneficiary_);
  items = applySearch_(items, options.search, ['name', 'id', 'phone', 'region', 'city']);
  // فلترتان اصطناعيتان لا تقابلان قيمة عمود مخزَّنة فعليًا (بل حالة
  // مشتقة)، تُستخدمان من مؤشرات لوحة الإدارة/الجمعية القابلة للنقر:
  // - "بانتظار تحديد الموقع": بلا إحداثيات مؤكَّدة بعد (انظر locationConfirmed).
  // - "جاهز للإحالة": الموقع مؤكَّد + توجد أجهزة "مخصص" له + لم يُخرَج بعد —
  //   أي كل ما يلزم لتعيين مندوب متوفر الآن فعلًا.
  if (options.filter === 'بانتظار تحديد الموقع') {
    items = items.filter(item => !item.locationConfirmed);
  } else if (options.filter === 'جاهز للإحالة') {
    const allocatedBeneficiaryIds = new Set(
      readTable_(APP.sheets.devices).rows
        .filter(device => String(device['حالة الجهاز']) === 'مخصص')
        .map(device => String(device['رقم المستفيد']))
    );
    items = items.filter(item => item.locationConfirmed && item.deliveryStatus === 'لم يبدأ' && allocatedBeneficiaryIds.has(item.id));
  } else if (options.filter) {
    items = items.filter(item => item.status === options.filter || item.deliveryStatus === options.filter);
  }
  items = applySort_(items, options.sortBy, options.sortDir);
  const page = paginate_(items, options);
  // Phase 2.2 (القسم 10): بيانات الاعتماد الجديدة تُدمَج هنا بلا N+1 —
  // قراءة واحدة لورقة "احتياجات المستفيدين" كاملة (لا قراءة لكل مستفيد
  // على حدة)، ثم Map حسب رقم المستفيد يُطبَّق فقط على صفحة النتائج
  // الحالية المُرجَعة للعميل (لا كل السجلات المطابقة للبحث/الفلتر).
  page.items = attachNeedsSummaryToBeneficiaries_(page.items);
  return Object.assign({ok: true}, page);
}

/**
 * يُرفق بكل عنصر مستفيد (مصفوفة items من normalizeBeneficiary_) حقول
 * الاعتماد: reviewStatus/beneficiaryRejectReason/reviewedBy/reviewedAt
 * من صف المستفيد نفسه (بلا قراءة إضافية — موجودة أصلًا)، و
 * requestedNeeds/approvedNeeds/rejectedNeeds/fulfillment من ورقة
 * "احتياجات المستفيدين" عبر قراءة واحدة لكامل الورقة وMap حسب
 * beneficiaryId — لا قراءة منفصلة لكل مستفيد (N+1). آمنة تمامًا حتى لو
 * لم تُنشأ الورقة/الأعمدة الجديدة بعد على الشيت الحي (تُرجِع حقولًا
 * فارغة/محايدة بدل رمي استثناء، عبر try/catch على قراءة الورقة فقط —
 * لا تُخفي أي خطأ آخر).
 */
function attachNeedsSummaryToBeneficiaries_(items) {
  if (!items.length) return items;
  let needsByBeneficiary = null;
  try {
    needsByBeneficiary = {};
    readTable_(APP.sheets.beneficiaryNeeds).rows.forEach(row => {
      const bId = String(row['رقم المستفيد']);
      (needsByBeneficiary[bId] = needsByBeneficiary[bId] || []).push(normalizeNeedRow_(row));
    });
  } catch (ignore) {
    // الورقة غير موجودة بعد على هذا المشروع (المخطط الجديد لم يُطبَّق) —
    // سلوك متوقَّع، لا عطل. كل عنصر يعود بحقول فارغة أدناه.
    needsByBeneficiary = {};
  }
  const rawRowsById = {};
  readTable_(APP.sheets.beneficiaries).rows.forEach(row => { rawRowsById[String(row['رقم المستفيد'])] = row; });
  return items.map(item => {
    const rawRow = rawRowsById[item.id];
    const needs = needsByBeneficiary[item.id] || [];
    return Object.assign({}, item, {
      reviewStatus: rawRow ? String(rawRow['حالة مراجعة المستفيد'] || '') : '',
      beneficiaryRejectReason: rawRow ? String(rawRow['سبب رفض المستفيد'] || '') : '',
      reviewedBy: rawRow ? String(rawRow['مراجع اعتماد المستفيد'] || '') : '',
      reviewedAt: rawRow ? formatDateTime_(parseDate_(rawRow['تاريخ مراجعة المستفيد'])) : '',
      requestedNeeds: needs,
      approvedNeeds: needs.filter(n => n.decisionStatus === 'معتمد'),
      rejectedNeeds: needs.filter(n => n.decisionStatus === 'مرفوض'),
      pendingNeeds: needs.filter(n => n.decisionStatus === 'بانتظار المراجعة')
    });
  });
}

/** يطبّع اسمًا للمقارنة التقريبية فقط (مسافات/حالة أحرف) — إشارة "مطابق محتمل"، لا دليل قاطع أبدًا وحده. */
function normalizeNameForMatch_(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * مطابق مؤكَّد: نفس رقم الجوال (الأساسي أو الإضافي، بعد التطبيع عبر
 * normalizePhone_) لمستفيد آخر ضمن **نفس الجمعية فقط** — لا يفحص جمعيات
 * أخرى إطلاقًا فلا يكشف عن بياناتها. الجوال وحده يكفي دليلًا قاطعًا هنا
 * (لا الاسم — قد يتكرر الاسم بين أفراد مختلفين تمامًا)، مع مراعاة صيغ
 * الجوال المختلفة لأنه يمر أصلًا بـ normalizePhone_ الموحِّدة قبل المقارنة.
 */
function findConfirmedDuplicateBeneficiary_(associationId, phone, excludeId) {
  if (!phone) return null;
  const rows = readTable_(APP.sheets.beneficiaries).rows;
  return rows.find(row =>
    String(row['رقم الجمعية']) === associationId &&
    String(row['رقم المستفيد']) !== String(excludeId || '') &&
    (String(row['رقم الجوال']) === phone || (row['رقم جوال إضافي'] && String(row['رقم جوال إضافي']) === phone))
  ) || null;
}

/**
 * مطابق محتمل فقط (لا مؤكَّد): نفس الاسم (بعد تطبيع المسافات/الحالة) ونفس
 * المدينة ضمن نفس الجمعية، لكن رقم جوال مختلف — لا يُرفض تلقائيًا، فقط
 * إشارة للمراجعة اليدوية (قد يكونان فردَين مختلفين تمامًا بالمصادفة).
 */
function findPossibleDuplicateBeneficiary_(associationId, name, city, excludeId) {
  const normalizedName = normalizeNameForMatch_(name);
  if (!normalizedName) return null;
  const rows = readTable_(APP.sheets.beneficiaries).rows;
  return rows.find(row =>
    String(row['رقم الجمعية']) === associationId &&
    String(row['رقم المستفيد']) !== String(excludeId || '') &&
    normalizeNameForMatch_(row['الاسم']) === normalizedName &&
    String(row['المدينة'] || '') === String(city || '')
  ) || null;
}

function saveBeneficiary(token, payload) {
  return perfTime_('saveBeneficiary', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    payload = payload || {};
    // Phase 2.2 — إغلاق الممر القديم كتجاوز لنموذج الاحتياجات الجديد:
    // إنشاء مستفيد **جديد** (بلا payload.id) عبر هذا المسار العام يُوجَّه
    // إلزاميًا إلى المسار الذري الموحَّد (createBeneficiaryWithNeeds_ في
    // BeneficiaryNeeds.gs)، الذي يفرض احتياجًا واحدًا صالحًا على الأقل من
    // الأنواع الثلاثة الجديدة. بلا payload.deviceTypes صالحة، يُرفض
    // الإنشاء برسالة صريحة — المنع هنا خادمي بحت، لا يعتمد على تعديل
    // Index.html كضابط أمان. **تعديل** سجل قائم (payload.id موجود) يبقى
    // عبر saveBeneficiary_ التاريخية دون تغيير — الاحتياجات الجديدة
    // لسجل قائم تُدار حصرًا من مسارات BeneficiaryNeeds.gs المخصَّصة
    // (setBeneficiaryNeeds/updateBeneficiaryWithNeeds_)، لا من هنا.
    if (!payload.id) {
      if (!Array.isArray(payload.deviceTypes) || !payload.deviceTypes.length) {
        throw new Error('اختر احتياجًا واحدًا على الأقل من النموذج الجديد.');
      }
      return createBeneficiaryWithNeeds_(user, payload);
    }
    return saveBeneficiary_(user, payload);
  });
}

/**
 * يبني كائن القيم القابل للكتابة مباشرة لصف مستفيد من payload خام —
 * دالة نقية بلا أي قراءة/كتابة، مشتركة بين saveBeneficiary_ (تعديل سجل
 * قائم) وcreateBeneficiaryWithNeeds_/updateBeneficiaryWithNeeds_ (Phase
 * 2.2 — BeneficiaryNeeds.gs) كي لا يتفرّق منطق بناء الحقول بين ملفين.
 * existing (أو null لسجل جديد) يحدّد قيم الحقول التي تُحفَظ من السجل
 * القديم بدل استبدالها (الحالة/التسليم/المندوب/تاريخ تحديث الموقع...).
 * **لا تُدرِج مفتاح "الاحتياج" هنا إطلاقًا** — الحقل النصي القديم مسؤولية
 * الطالب وحده (انظر options.skipLegacyNeedsWrite في saveBeneficiary_).
 */
function buildBeneficiaryFieldValues_(payload, place, phone, existing, associationId) {
  const coordinates = optionalCoordinate_(payload.lat, payload.lng);
  const hasCoordinates = coordinates.lat !== '';
  // لا يُحدَّث "مصدر الموقع"/"تاريخ تحديث الموقع" إلا إذا تغيّرت الإحداثيات
  // فعليًا بهذا الحفظ (أو سُجّلت لأول مرة) — تعديل حقل آخر لا علاقة له
  // بالموقع (كالملاحظات مثلًا) لا يُعيد ضبط "آخر تحديث للموقع" زورًا.
  const existingLat = existing ? existing['خط العرض'] : '';
  const existingLng = existing ? existing['خط الطول'] : '';
  const coordinatesChanged = !existing || String(coordinates.lat) !== String(existingLat || '') || String(coordinates.lng) !== String(existingLng || '');
  let locationSource, locationUpdatedAt;
  if (!hasCoordinates) {
    locationSource = '';
    locationUpdatedAt = '';
  } else if (coordinatesChanged) {
    locationSource = validateLocationSource_(payload.locationSource, true);
    locationUpdatedAt = now_();
  } else {
    locationSource = String(existing['مصدر الموقع'] || '');
    locationUpdatedAt = String(existing['تاريخ تحديث الموقع'] || '');
  }
  return {
    'رقم الجمعية': associationId || (existing ? String(existing['رقم الجمعية']) : ''),
    'الاسم': requiredText_(payload.name, 'اسم المستفيد', 120),
    'المنطقة': place.region,
    'المدينة': place.city,
    'الحي': requiredText_(payload.district, 'الحي', 120),
    'العنوان': requiredText_(payload.address, 'العنوان الوصفي (الشارع وأقرب معلم)', 250),
    'رقم الجوال': phone,
    'رقم جوال إضافي': payload.phone2 ? normalizePhone_(payload.phone2) : '',
    'عدد الأفراد': boundedNumber_(payload.familyCount, 1, 99, 'عدد الأفراد'),
    'ضمان اجتماعي': payload.socialSecurity === true || payload.socialSecurity === 'نعم' ? 'نعم' : 'لا',
    'الحالة الاجتماعية': validateSocialStatus_(payload.socialStatus, existing ? String(existing['الحالة الاجتماعية'] || '') : ''),
    'مبلغ الدخل': boundedNumber_(payload.income || 0, 0, 1000000, 'مبلغ الدخل'),
    'حالة المستفيد': existing ? String(existing['حالة المستفيد']) : 'جديد',
    'حالة التسليم': existing ? String(existing['حالة التسليم']) : 'لم يبدأ',
    'رقم المندوب': existing ? String(existing['رقم المندوب'] || '') : '',
    'الملاحظات': cleanText_(payload.notes, 1000),
    'آخر تحديث': now_(),
    'خط العرض': coordinates.lat,
    'خط الطول': coordinates.lng,
    'علامة مميزة': cleanText_(payload.landmark, 200),
    'مصدر الموقع': locationSource,
    'تاريخ تحديث الموقع': locationUpdatedAt
  };
}

/**
 * النسخة الداخلية لتعديل سجل **قائم فقط** الآن (Phase 2.2 حوّلت مسار
 * الإنشاء الجديد إلى createBeneficiaryWithNeeds_). ما زالت تُستدعى
 * مباشرة من importBeneficiaries وبعض مسارات الصيانة الداخلية، ومن
 * updateBeneficiaryWithNeeds_ (BeneficiaryNeeds.gs) لتعديل سجل قائم مع
 * مزامنة احتياجاته معًا.
 *
 * options.skipLegacyNeedsWrite (افتراضيًا false): true يمنع إدراج مفتاح
 * "الاحتياج" في القيم المكتوبة إطلاقًا — لا يُكتب حرفٌ واحد إليه، فتبقى
 * قيمته التاريخية القائمة كما هي دون أي مسح. **لا تستخدم `needs: []`
 * كحيلة لمنع الكتابة** — ذلك يكتب فعليًا سلسلة فارغة فوق أي قيمة
 * تاريخية قائمة؛ options.skipLegacyNeedsWrite هو الطريق الآمن الوحيد.
 */
function saveBeneficiary_(user, payload, options) {
  payload = payload || {};
  options = options || {};
  const existing = payload.id ? findById_(APP.sheets.beneficiaries, 'رقم المستفيد', cleanId_(payload.id)) : null;
  const associationId = user.role === 'ASSOCIATION' ? user.associationId : cleanId_(payload.associationId);
  if (!associationId || !findById_(APP.sheets.associations, 'رقم الجمعية', associationId)) throw new Error('اختر جمعية صحيحة');
  if (existing && user.role === 'ASSOCIATION') {
    if (String(existing['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية لتعديل هذا المستفيد');
    if (String(existing['حالة التسليم']) === 'تم التسليم') throw new Error('لا يمكن تعديل بيانات مستفيد تم تسليمه');
  }
  const phone = normalizePhone_(payload.phone);
  const existingId = existing ? String(existing['رقم المستفيد']) : null;
  // مطابق مؤكَّد (نفس الجوال ضمن الجمعية نفسها) يُرفض دائمًا — عند التعديل
  // يُستثنى السجل نفسه من الفحص حتى لا يرفض حفظ بياناته الخاصة.
  if (findConfirmedDuplicateBeneficiary_(associationId, phone, existingId)) {
    throw new Error('يوجد مستفيد آخر بنفس رقم الجوال لدى هذه الجمعية بالفعل — تحقق من عدم تكرار الإضافة');
  }
  const possibleDuplicate = findPossibleDuplicateBeneficiary_(associationId, payload.name, payload.city, existingId);
  // تمرير القيم المخزَّنة حاليًا لهذا السجل بالذات: قيمة قديمة خارج
  // القائمة المعتمدة لا تمنع تعديل حقل آخر في نفس السجل (grandfathering).
  const previousPlace = existing ? {region: String(existing['المنطقة'] || ''), city: String(existing['المدينة'] || '')} : null;
  const place = validateRegionCity_(payload.region, payload.city, previousPlace);
  const values = buildBeneficiaryFieldValues_(payload, place, phone, existing, associationId);
  if (options.skipLegacyNeedsWrite) {
    delete values['الاحتياج'];
  } else {
    values['الاحتياج'] = normalizeNeeds_(payload.needs);
  }
  let id;
  if (existing) {
    id = String(existing['رقم المستفيد']);
    updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', id, values);
    audit_(user, 'تعديل مستفيد', 'المستفيدون', id, '');
  } else {
    // ترتيب مقصود لمنع سباق التزامن: يُولَّد المعرّف أولًا (nextId_ له قفله
    // الداخلي الخاص)، ثم يُعاد فحص التكرار المؤكَّد والإضافة معًا داخل قفل
    // واحد — بذلك لا يمكن لطلبين متزامنين إضافة نفس رقم الجوال مرتين حتى
    // لو مرّا كلاهما من الفحص الأول قبل القفل بفارق أجزاء من الثانية.
    id = nextId_('BEN');
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      // إبطال الذاكرة المؤقتة صراحةً قبل إعادة الفحص: منذ أن صارت
      // _TABLE_CACHE_ محصورة بالطلب الواحد (لا TTL زمني)، القراءة هنا
      // بلا إبطال كانت ستعيد نفس اللقطة المأخوذة قبل الانتظار على
      // القفل — فيفقد إعادة الفحص غرضه تمامًا إن كتب طلب آخر أثناء
      // الانتظار. الإبطال يضمن قراءة فعلية جديدة من الورقة هنا.
      invalidateTableCache_(APP.sheets.beneficiaries);
      if (findConfirmedDuplicateBeneficiary_(associationId, phone, null)) {
        throw new Error('يوجد مستفيد آخر بنفس رقم الجوال لدى هذه الجمعية بالفعل — تحقق من عدم تكرار الإضافة');
      }
      appendObject_(APP.sheets.beneficiaries, Object.assign({'رقم المستفيد': id, 'تاريخ الإنشاء': now_()}, values));
    } finally {
      lock.releaseLock();
    }
    audit_(user, 'إضافة مستفيد', 'المستفيدون', id, '');
  }
  clearDashboardCache();
  const record = normalizeBeneficiary_(findById_(APP.sheets.beneficiaries, 'رقم المستفيد', id));
  const summary = computeCoreSummary_(user.role === 'ASSOCIATION' ? user.associationId : null);
  const result = {ok: true, id: id, record: record, summary: summary};
  if (possibleDuplicate) {
    result.possibleDuplicateId = String(possibleDuplicate['رقم المستفيد']);
    result.possibleDuplicateWarning = 'تنبيه: يوجد مستفيد آخر بنفس الاسم والمدينة (رقم ' + result.possibleDuplicateId + ') — تأكد أنه ليس تكرارًا قبل المتابعة';
  }
  return result;
}

function importBeneficiaries(token, rows, acceptedPledge) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  if (acceptedPledge !== true) throw new Error('يجب الموافقة على التعهد قبل الاستيراد');
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 1000) throw new Error('الملف فارغ أو يتجاوز 1000 سجل');
  const valid = [];
  const errors = [];
  // يتتبّع أرقام الجوال ضمن الملف نفسه (لكل جمعية على حدة) لاكتشاف تكرار
  // بين صفوف الملف الواحد، بالإضافة إلى فحص السجلات الموجودة مسبقًا في الجدول.
  const seenPhones = Object.create(null);
  rows.forEach((row, index) => {
    try {
      const associationId = user.role === 'ASSOCIATION' ? user.associationId : cleanId_(row.associationId);
      if (!associationId) throw new Error('رقم الجمعية مطلوب');
      const place = validateRegionCity_(row.region, row.city);
      const coordinates = optionalCoordinate_(row.lat, row.lng);
      const hasCoordinates = coordinates.lat !== '';
      const phone = normalizePhone_(row.phone);
      const phoneKey = associationId + '|' + phone;
      if (seenPhones[phoneKey]) {
        throw new Error('رقم الجوال مكرر مع الصف رقم ' + seenPhones[phoneKey] + ' داخل الملف نفسه');
      }
      if (findConfirmedDuplicateBeneficiary_(associationId, phone, null)) {
        throw new Error('يوجد مستفيد بنفس رقم الجوال لدى هذه الجمعية بالفعل — لن يتم استيراد هذا الصف');
      }
      seenPhones[phoneKey] = index + 2;
      valid.push({
        'رقم المستفيد': '',
        'رقم الجمعية': associationId,
        'الاسم': requiredText_(row.name, 'الاسم', 120),
        'المنطقة': place.region,
        'المدينة': place.city,
        'الحي': requiredText_(row.district, 'الحي', 120),
        'العنوان': requiredText_(row.address, 'العنوان', 250),
        'رقم الجوال': phone,
        'رقم جوال إضافي': row.phone2 ? normalizePhone_(row.phone2) : '',
        'عدد الأفراد': boundedNumber_(row.familyCount, 1, 99, 'عدد الأفراد'),
        'ضمان اجتماعي': row.socialSecurity === true || row.socialSecurity === 'نعم' ? 'نعم' : 'لا',
        'الحالة الاجتماعية': validateSocialStatus_(row.socialStatus),
        'مبلغ الدخل': boundedNumber_(row.income || 0, 0, 1000000, 'مبلغ الدخل'),
        'الاحتياج': normalizeNeeds_(row.needs),
        'حالة المستفيد': 'جديد',
        'حالة التسليم': 'لم يبدأ',
        'رقم المندوب': '',
        'الملاحظات': cleanText_(row.notes, 1000),
        'تاريخ الإنشاء': now_(),
        'تاريخ التسليم': '',
        'آخر تحديث': now_(),
        'خط العرض': coordinates.lat,
        'خط الطول': coordinates.lng,
        'علامة مميزة': cleanText_(row.landmark, 200),
        'مصدر الموقع': hasCoordinates ? 'استيراد' : '',
        'تاريخ تحديث الموقع': hasCoordinates ? now_() : ''
      });
    } catch (error) {
      errors.push({row: index + 2, message: error.message});
    }
  });
  if (errors.length) return {ok: false, validCount: valid.length, errorCount: errors.length, errors: errors.slice(0, 50)};
  const beneficiaryIds = nextIds_('BEN', valid.length);
  valid.forEach((record, index) => record['رقم المستفيد'] = beneficiaryIds[index]);
  // إعادة فحص التكرار المؤكَّد داخل قفل واحد قبل الكتابة الفعلية مباشرة —
  // يمنع استيرادَين متزامنَين (أو استيرادًا وإضافة فردية متزامنة) من إدخال
  // نفس رقم الجوال مرتين رغم اجتياز الفحص الأول قبل القفل.
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // إبطال ذاكرة الجدول المخزَّنة لهذا الطلب قبل إعادة الفحص: بدون هذا،
    // قد تُعاد قراءة لقطة سابقة على الانتظار للقفل نفسه، فيفوّت فحص
    // السباق تكرارًا كتبه تنفيذ آخر أثناء الانتظار.
    invalidateTableCache_(APP.sheets.beneficiaries);
    const raceDuplicate = valid.find(record => findConfirmedDuplicateBeneficiary_(String(record['رقم الجمعية']), String(record['رقم الجوال']), null));
    if (raceDuplicate) throw new Error('تم اكتشاف تكرار في رقم الجوال أثناء الاستيراد؛ أعد المحاولة');
    appendObjects_(APP.sheets.beneficiaries, valid);
  } finally {
    lock.releaseLock();
  }
  audit_(user, 'استيراد مستفيدين', 'المستفيدون', '', 'عدد السجلات: ' + valid.length);
  clearDashboardCache();
  // لا تُعاد السجلات المستوردة كاملة (قد تصل لألف سجل) — الواجهة تُعيد
  // طلب صفحة المستفيدين الأولى بعد نجاح الاستيراد بدلًا من ذلك.
  const summary = computeCoreSummary_(user.role === 'ASSOCIATION' ? user.associationId : null);
  return {ok: true, imported: valid.length, summary: summary};
}

/**
 * يقرأ ملف Excel الحقيقي (.xlsx) بتحويل مؤقت وآمن إلى Google Sheet،
 * ثم يحذفه فور الانتهاء ويعيد نتيجة المراجعة قبل الاعتماد.
 */
function inspectBeneficiaryExcel(token, payload) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  payload = payload || {};
  const match = String(payload.dataUrl || '').match(/^data:application\/(?:vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|octet-stream);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('ارفع ملف Excel بصيغة XLSX');
  const bytes = Utilities.base64Decode(match[1]);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('حجم ملف Excel يتجاوز 8 ميجابايت');
  const boundary = 'codex_' + Utilities.getUuid().replace(/-/g, '');
  const metadata = JSON.stringify({name: 'مراجعة استيراد مؤقتة', mimeType: 'application/vnd.google-apps.spreadsheet'});
  const before = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n--' + boundary + '\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n').getBytes();
  const after = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  const payloadBytes = before.concat(bytes).concat(after);
  const response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'Content-Type': 'multipart/related; boundary=' + boundary
    },
    payload: payloadBytes,
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('تعذر قراءة ملف Excel. تحقق من سلامة الملف');
  const fileId = JSON.parse(response.getContentText()).id;
  try {
    const values = SpreadsheetApp.openById(fileId).getSheets()[0].getDataRange().getDisplayValues();
    if (values.length < 2) throw new Error('ملف Excel لا يحتوي على سجلات');
    // "خط العرض" و"خط الطول" عمودان اختياريان بالكامل — ملفات قديمة لا
    // تحتويهما تبقى مقبولة تمامًا كما كانت دائمًا؛ لذا هما خارج قائمة
    // "expected" الإلزامية، ويُتعامل معهما فقط إن وُجدا في صف العناوين.
    // "الحي" إلزامي هنا أيضًا (schemaVersion 4) — نفس قاعدة saveBeneficiary
    // بالضبط: "الحي وحده الحد الأدنى لحفظ الطلب"، ولا يُستثنى الاستيراد
    // الجماعي من هذا الشرط، فملف Excel بلا هذا العمود يُرفض من الفحص
    // الأولي بوضوح بدل أن يُنتج سجلات ناقصة بصمت.
    const expected = ['الاسم', 'المنطقة', 'المدينة', 'الحي', 'العنوان', 'الجوال', 'عدد الأفراد', 'الضمان الاجتماعي', 'الحالة الاجتماعية', 'الدخل', 'الاحتياج', 'الملاحظات'];
    const headers = values[0].map(value => String(value).trim());
    const missing = expected.filter(header => headers.indexOf(header) < 0);
    if (missing.length) throw new Error('أعمدة مفقودة: ' + missing.join('، '));
    // "خط العرض"/"خط الطول" تقبل أيضًا مرادفات إنجليزية شائعة (تُصدرها
    // بعض تطبيقات GPS/الخرائط) — عمودان اختياريان بالكامل في الحالتين.
    // "العلامة المميزة" اختيارية أيضًا (وصف موقع حر، كـ"بجانب المسجد").
    const keyMap = {
      'الاسم': 'name', 'المنطقة': 'region', 'المدينة': 'city', 'الحي': 'district', 'العنوان': 'address',
      'الجوال': 'phone', 'عدد الأفراد': 'familyCount', 'الضمان الاجتماعي': 'socialSecurity',
      'الحالة الاجتماعية': 'socialStatus', 'الدخل': 'income', 'الاحتياج': 'needs', 'الملاحظات': 'notes',
      'خط العرض': 'lat', 'خط الطول': 'lng', 'Latitude': 'lat', 'Longitude': 'lng', 'Lat': 'lat', 'Lng': 'lng',
      'العلامة المميزة': 'landmark', 'Landmark': 'landmark'
    };
    const rows = values.slice(1).filter(row => row.some(Boolean)).map((row, index) => {
      const object = {row: index + 2};
      headers.forEach((header, colIndex) => {
        if (keyMap[header]) object[keyMap[header]] = row[colIndex];
      });
      if (user.role === 'ASSOCIATION') object.associationId = user.associationId;
      return object;
    });
    const errors = [];
    // يتتبّع أرقام الجوال داخل الملف نفسه لاكتشاف التكرار بين صفوفه، إضافة
    // إلى فحص التكرار المؤكَّد مقابل السجلات الموجودة فعلًا في الجدول.
    const seenPhones = Object.create(null);
    rows.forEach(row => {
      row.matchTier = 'new';
      try {
        requiredText_(row.name, 'الاسم', 120);
        validateRegionCity_(row.region, row.city);
        requiredText_(row.district, 'الحي', 120);
        requiredText_(row.address, 'العنوان', 250);
        const phone = normalizePhone_(row.phone);
        boundedNumber_(row.familyCount, 1, 99, 'عدد الأفراد');
        boundedNumber_(row.income || 0, 0, 1000000, 'مبلغ الدخل');
        optionalCoordinate_(row.lat, row.lng);
        validateSocialStatus_(row.socialStatus);
        const associationId = row.associationId || (user.role === 'ADMIN' ? null : user.associationId);
        const phoneKey = (associationId || '') + '|' + phone;
        // مطابق مؤكَّد (تكرار داخل الملف نفسه أو مع سجل موجود): يُرفض الصف
        // ولا يُستورد أبدًا؛ مطابق محتمل (اسم+مدينة فقط): يُعرض للمراجعة
        // دون منع الاستيراد — لا يُعتمد على الاسم وحده دليلًا قاطعًا أبدًا.
        if (seenPhones[phoneKey]) {
          row.matchTier = 'confirmed';
          throw new Error('رقم الجوال مكرر مع الصف رقم ' + seenPhones[phoneKey] + ' داخل الملف نفسه');
        }
        if (associationId && findConfirmedDuplicateBeneficiary_(associationId, phone, null)) {
          row.matchTier = 'confirmed';
          throw new Error('يوجد مستفيد بنفس رقم الجوال لدى هذه الجمعية بالفعل');
        }
        seenPhones[phoneKey] = row.row;
        if (associationId) {
          const possible = findPossibleDuplicateBeneficiary_(associationId, row.name, row.city, null);
          if (possible) {
            row.matchTier = 'possible';
            row.possibleDuplicateId = String(possible['رقم المستفيد']);
          }
        }
        row.valid = true;
      } catch (error) {
        row.valid = false;
        row.error = error.message;
        errors.push({row: row.row, message: error.message});
      }
    });
    return {ok: errors.length === 0, rows: rows, validCount: rows.length - errors.length, errorCount: errors.length, errors: errors.slice(0, 50)};
  } finally {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignore) {}
  }
}

function assignDelegate(token, beneficiaryId, delegateId) {
  return perfTime_('assignDelegate', () => {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  beneficiaryId = cleanId_(beneficiaryId);
  delegateId = cleanId_(delegateId);
  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
  const delegate = findById_(APP.sheets.delegates, 'رقم المندوب', delegateId);
  if (!beneficiary || !delegate || String(delegate['الحالة']) !== 'نشط') throw new Error('المستفيد أو المندوب غير صالح');
  if (String(beneficiary['رقم الجمعية']) !== String(delegate['رقم الجمعية'])) throw new Error('يجب أن يتبع المندوب والمستفيد الجمعية نفسها');
  if (user.role === 'ASSOCIATION' && String(beneficiary['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
  // لا إحالة قبل تأكيد موقع المستفيد على الخريطة — "الحي" وحده حد أدنى
  // لحفظ الطلب فقط، لا يكفي لإخراج المهمة لمندوب ميداني فعليًا.
  if (!beneficiaryLocationConfirmed_(beneficiary)) {
    throw new Error('لا يمكن إحالة هذا المستفيد قبل تأكيد موقعه على الخريطة — استكمل الموقع أولًا');
  }

  // يجب أن يتحقق كل شيء قبل أي كتابة: لا كتابة جزئية عند رفض العملية.
  const currentDeliveryStatus = String(beneficiary['حالة التسليم'] || 'لم يبدأ');
  assertDeliveryTransition_(currentDeliveryStatus, 'خرج مع المندوب');
  const activeDevices = devicesForBeneficiary_(beneficiaryId).filter(d => ['مخصص', 'مع المندوب'].indexOf(d.status) >= 0);
  if (!activeDevices.length) throw new Error('لا توجد أجهزة مخصَّصة لهذا المستفيد بعد؛ خصِّص جهازًا أولًا قبل تعيين مندوب');
  activeDevices.forEach(device => assertDeviceTransition_(device.status, 'مع المندوب'));

  const dispatchedNow = activeDevices.filter(device => device.status === 'مخصص');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // إعادة القراءة والتحقق داخل القفل: الفحوصات أعلاه تمت قبل الانتظار
    // على القفل، وقد يكون تنفيذ آخر غيّر حالة المستفيد أو الأجهزة أثناء
    // ذلك الانتظار (مثل نقرتين متتاليتين أو تسليم مُتزامن).
    invalidateTableCache_(APP.sheets.beneficiaries);
    invalidateTableCache_(APP.sheets.devices);
    const latestBeneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
    if (!latestBeneficiary) throw new Error('المستفيد غير موجود');
    if (!beneficiaryLocationConfirmed_(latestBeneficiary)) {
      throw new Error('لا يمكن إحالة هذا المستفيد قبل تأكيد موقعه على الخريطة — استكمل الموقع أولًا');
    }
    assertDeliveryTransition_(String(latestBeneficiary['حالة التسليم'] || 'لم يبدأ'), 'خرج مع المندوب');
    const latestDevices = devicesForBeneficiary_(beneficiaryId).filter(d => ['مخصص', 'مع المندوب'].indexOf(d.status) >= 0);
    if (!latestDevices.length) throw new Error('لا توجد أجهزة مخصَّصة لهذا المستفيد بعد؛ خصِّص جهازًا أولًا قبل تعيين مندوب');
    latestDevices.forEach(device => assertDeviceTransition_(device.status, 'مع المندوب'));
    const latestDispatchedNow = latestDevices.filter(device => device.status === 'مخصص');
    latestDispatchedNow.forEach(device => {
      updateById_(APP.sheets.devices, 'رقم الجهاز', device.id, {'حالة الجهاز': 'مع المندوب'});
    });
    updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
      'رقم المندوب': delegateId,
      'حالة المستفيد': 'جاري التسليم',
      'حالة التسليم': 'خرج مع المندوب',
      'آخر تحديث': now_()
    });
  } finally {
    lock.releaseLock();
  }
  audit_(user, 'تعيين مندوب', 'المستفيدون', beneficiaryId, 'المندوب: ' + delegateId + ' — عدد الأجهزة: ' + activeDevices.length);
  // سجل مستقل لكل جهاز خرج فعليًا مع المندوب الآن — هذا هو مصدر "تاريخ
  // الخروج مع المندوب" في صفحة تفاصيل الجهاز (سجل عمليات، لا عمود جديد
  // في الجدول، فلا حاجة لأي ترحيل مخطط بيانات).
  dispatchedNow.forEach(device => {
    audit_(user, 'تعديل جهاز', 'الأجهزة', device.id, 'الحالة: مخصص ← مع المندوب (تعيين مندوب: ' + delegateId + ')');
  });
  clearDashboardCache();
  const record = normalizeBeneficiary_(findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId));
  const updatedDevices = devicesForBeneficiary_(beneficiaryId);
  const summary = computeCoreSummary_(user.role === 'ASSOCIATION' ? user.associationId : null);
  return {ok: true, record: record, devices: updatedDevices, summary: summary};
  });
}

/**
 * يمنع تعديل موقع مستفيد عبر updateBeneficiaryLocation خارج نطاق الصلاحية:
 * - ASSOCIATION: مستفيدو جمعيته فقط.
 * - DELEGATE: المستفيدون المُسندون إليه هو تحديدًا فقط، ولا شيء غير ذلك —
 *   لا يستطيع لمس موقع مستفيد لدى مندوب آخر حتى لو كان في جمعيته نفسها.
 * - سجل تم تسليمه بالفعل: حالة نهائية محمية من أي تعديل موقع لاحق.
 */
function assertLocationUpdatePermission_(user, beneficiary) {
  if (user.role === 'ASSOCIATION' && String(beneficiary['رقم الجمعية']) !== user.associationId) {
    throw new Error('ليس لديك صلاحية لتعديل موقع هذا المستفيد');
  }
  if (user.role === 'DELEGATE' && String(beneficiary['رقم المندوب']) !== user.id) {
    throw new Error('ليس لديك صلاحية — هذا المستفيد ليس ضمن مهامك الحالية');
  }
  if (String(beneficiary['حالة التسليم']) === 'تم التسليم') {
    throw new Error('لا يمكن تعديل موقع مستفيد تم تسليمه بالفعل');
  }
}

/**
 * استكمال موقع مستفيد بعد حفظه بلا إحداثيات (أو تصحيحه لاحقًا) — مسار
 * كتابة ضيّق مخصَّص لحقول الموقع فقط (لا يلمس الاسم/الجوال/الاحتياج ولا
 * أي حقل آخر مهما أُرسل في payload). يفتح هذا المسار للمندوب أيضًا
 * (خلافًا لـ saveBeneficiary المقصور على ADMIN/ASSOCIATION) لكن بنطاق
 * محدود جدًا يفرضه assertLocationUpdatePermission_، ويُسجَّل في سجل
 * العمليات دائمًا (بند ٧/٨ من متطلبات إعادة ضبط منطق الموقع).
 */
function updateBeneficiaryLocation(token, beneficiaryId, payload) {
  return perfTime_('updateBeneficiaryLocation', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION', 'DELEGATE']);
    beneficiaryId = cleanId_(beneficiaryId);
    payload = payload || {};
    const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
    if (!beneficiary) throw new Error('المستفيد غير موجود');
    assertLocationUpdatePermission_(user, beneficiary);
    const coordinates = optionalCoordinate_(payload.lat, payload.lng);
    if (coordinates.lat === '') throw new Error('أدخل إحداثيات صحيحة لتأكيد الموقع');
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    let latest;
    try {
      // إعادة القراءة والتحقق تحت القفل: قد يتغيّر إسناد المندوب أو تُقفَل
      // حالة التسليم أثناء الانتظار على القفل نفسه.
      invalidateTableCache_(APP.sheets.beneficiaries);
      latest = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
      if (!latest) throw new Error('المستفيد غير موجود');
      assertLocationUpdatePermission_(user, latest);
      updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
        'خط العرض': coordinates.lat,
        'خط الطول': coordinates.lng,
        'علامة مميزة': payload.landmark !== undefined ? cleanText_(payload.landmark, 200) : String(latest['علامة مميزة'] || ''),
        'مصدر الموقع': validateLocationSource_(payload.locationSource, true),
        'تاريخ تحديث الموقع': now_(),
        'آخر تحديث': now_()
      });
    } finally {
      lock.releaseLock();
    }
    audit_(user, 'استكمال موقع مستفيد', 'المستفيدون', beneficiaryId, user.role === 'DELEGATE' ? 'بواسطة المندوب: ' + user.id : '');
    clearDashboardCache();
    const record = normalizeBeneficiary_(findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId));
    return {ok: true, record: record};
  });
}

