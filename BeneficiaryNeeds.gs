// -------------------- دورة اعتماد المستفيد والاحتياج (Phase 2.1 — خادميًا فقط) --------------------
//
// هذا الملف يطبّق منطق الخادم لدورة الاعتماد المعتمدة: الجمعية تسجّل
// احتياجات المستفيد (نوع جهاز واحد لكل صف)، ADMIN يقبل أو يرفض المستفيد
// ويقرر كل احتياج على حدة في عملية واحدة مترابطة، والاعتماد ينشئ فورًا
// "استحقاقًا معتمدًا" بلا أي خطوة تخصيص يدوية ثانية.
//
// مصدر الحقيقة النهائي (لا مصدر موازٍ):
// - قرار مراجعة المستفيد نفسه: عمود "حالة مراجعة المستفيد" الجديد في
//   ورقة "المستفيدون" (BENEFICIARY_REVIEW_STATUSES من StateRules.gs).
// - قرار/تنفيذ كل احتياج: ورقة "احتياجات المستفيدين" الجديدة بالكامل.
// - الحقلان القديمان "حالة المستفيد" (BENEFICIARY_STATUSES) و"الاحتياج"
//   (نص حر) **يبقيان للتوافق التاريخي والقراءة فقط**. أي سجل يمر عبر
//   saveBeneficiaryWithNeeds أدناه (المسار الموحَّد الجديد) لا يكتب
//   إليهما إطلاقًا — saveBeneficiary_ الداخلية تُستدعى بـneeds:[] دائمًا
//   من هذا المسار، فيبقى عمود "الاحتياج" فارغًا لأي سجل جديد يمر من هنا
//   (لا فارغًا قسرًا لسجل قديم قائم لم يُعدَّل). saveBeneficiary العام
//   (المسار القديم، ما زال يعمل كما كان تمامًا لأي شاشة لم تنتقل بعد
//   للنموذج الجديد) يستمر بكتابة "الاحتياج" كما كان دون أي تغيير — لا
//   تعارض ممكن بين المسارين لأن كل سجل يُدار بمسار واحد فقط باختيار
//   الجهة المستدعية (Index.html الحالي لم يتغيّر بعد، يستخدم القديم).
//
// ⚠️ لا شيء في هذا الملف يعمل على أي بيانات حية بعد: ورقة "احتياجات
// المستفيدين" وأعمدة "المستفيدون" الأربعة الجديدة غير موجودة على الشيت
// الحي حتى يُشغَّل applyReleaseSchema_ يدويًا (schemaVersion 5) من
// خارج هذه الجلسة. أي استدعاء لدوال هذا الملف على مشروع لم يُطبَّق عليه
// المخطط الجديد سيفشل بخطأ "الورقة غير موجودة" من sheet_() — سلوك آمن
// ومتوقَّع، لا عطل صامت.
//
// ⚠️ انضباط الأقفال (Phase 2.1 hardening): كل دالة كتابة هنا تُمسك
// ScriptLock **مرة واحدة فقط** لكامل عمرها (لا قفل متداخل)، وتُعيد قراءة
// كل شيء تحتاجه (invalidateTableCache_ ثم readTable_/findById_) من
// **داخل** القفل قبل أي قرار — لا قراءة مسبقة خارج القفل يمكن أن تُستخدَم
// لاحقًا لاتخاذ قرار (يمنع سباقًا كلاسيكيًا: قراءة → انتظار قفل → قرار
// مبني على بيانات تجاوزها الزمن). دوال nextIdsLocked_/nextIds_ في
// DataUtils.gs تعكس نفس المبدأ (نسخة "مجرَّدة من القفل" تُستدعى من
// داخل قفل خارجي ممسوك مسبقًا، ونسخة عامة تُمسك قفلها الخاص).

/**
 * يتحقق من صيغة قائمة أنواع الاحتياج فقط (بلا أي قراءة بيانات مشتركة) —
 * يرمي خطأً واضحًا إن كانت غائبة/فارغة/ليست مصفوفة/بلا نوع صالح واحد
 * بعد التنظيف، أو تحتوي نوعًا خارج الثلاثة المعتمدة. يُستخدَم في كل
 * نقاط الدخول التي تقبل deviceTypes (Phase 2.2 — القرار المعتمد: كل
 * مستفيد جديد يجب أن يحمل احتياجًا واحدًا على الأقل).
 */
function validateNewNeedDeviceTypes_(deviceTypes) {
  if (!Array.isArray(deviceTypes) || !deviceTypes.length) {
    throw new Error('اختر احتياجًا واحدًا على الأقل من الأنواع المتاحة: ' + NEW_NEED_DEVICE_TYPES.join('، '));
  }
  const uniqueTypes = [];
  deviceTypes.forEach(t => {
    const clean = String(t || '').trim();
    if (!clean) return;
    if (NEW_NEED_DEVICE_TYPES.indexOf(clean) === -1) {
      throw new Error('نوع جهاز غير مسموح به في احتياج جديد: «' + clean + '» — الأنواع المتاحة: ' + NEW_NEED_DEVICE_TYPES.join('، '));
    }
    if (uniqueTypes.indexOf(clean) === -1) uniqueTypes.push(clean);
  });
  if (!uniqueTypes.length) throw new Error('اختر احتياجًا واحدًا على الأقل من الأنواع المتاحة: ' + NEW_NEED_DEVICE_TYPES.join('، '));
  return uniqueTypes;
}

/**
 * تحوّل نص "الاحتياج" الحر من ملف استيراد Excel/CSV (Phase 2.3) إلى
 * مصفوفة deviceTypes مُتحقَّق منها — تدعم الفواصل الواقعية الثلاث معًا
 * في النص نفسه (، أو , أو -) بمسافات زائدة حولها، ثم تمر عبر نفس
 * validateNewNeedDeviceTypes_ (مصدر تحقق واحد لا مصدرين). ترمي خطأً
 * يسمّي النوع غير الصالح صراحة — لا تتجاهله بصمت وتقبل بقية الصف.
 */
function parseDeviceTypesFromLegacyText_(text) {
  const tokens = String(text || '')
    .split(/[،,\-]+/)
    .map(t => t.trim())
    .filter(Boolean);
  return validateNewNeedDeviceTypes_(tokens);
}

/**
 * تسجّل/تُزامن احتياجات مستفيد (نوع جهاز واحد لكل صف). idempotent
 * بطبيعتها: استدعاؤها مرتين بنفس القائمة لا يُنشئ صفوفًا مكرَّرة (تضيف
 * الناقص فقط، ولا تحذف احتياجًا موجودًا وارد ضمن deviceTypes نفسها —
 * لإزالة احتياج معلَّق صراحة استخدم removePendingBeneficiaryNeed أدناه).
 * تُستخدَم لإضافة احتياجات على مستفيد **موجود بالفعل** بعد إنشائه —
 * الإنشاء نفسه يمر حصرًا عبر createBeneficiaryWithNeeds_ (ذرّي).
 */
function setBeneficiaryNeeds(token, beneficiaryId, deviceTypes) {
  return perfTime_('setBeneficiaryNeeds', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    return setBeneficiaryNeeds_(user, beneficiaryId, deviceTypes);
  });
}

function setBeneficiaryNeeds_(user, beneficiaryId, deviceTypes) {
  beneficiaryId = cleanId_(beneficiaryId);
  // التحقق من صيغة الأنواع المطلوبة لا يحتاج قراءة بيانات ولا قفلًا —
  // يبقى خارج القفل عمدًا (تحقق صيغة بحت، لا قرار مبني على حالة مشتركة).
  const uniqueTypes = validateNewNeedDeviceTypes_(deviceTypes);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // كل قراءة تُبنى عليها صلاحية أو قرار تحدث **هنا، داخل القفل**، لا
    // قبله — يمنع سباقًا حقيقيًا (مثال: الإدارة تعتمد المستفيد بينما
    // كان طلب الجمعية بالفعل بالطريق لهذا القفل؛ إعادة القراءة هنا تراه).
    invalidateTableCache_(APP.sheets.beneficiaries);
    invalidateTableCache_(APP.sheets.beneficiaryNeeds);

    const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
    if (!beneficiary) throw new Error('المستفيد غير موجود');
    if (user.role === 'ASSOCIATION' && String(beneficiary['رقم الجمعية']) !== user.associationId) {
      throw new Error('ليس لديك صلاحية على هذا المستفيد');
    }
    const reviewStatus = String(beneficiary['حالة مراجعة المستفيد'] || '');
    if (reviewStatus === 'معتمد' || reviewStatus === 'مرفوض') {
      throw new Error('تم اتخاذ قرار مراجعة نهائي لهذا المستفيد، ولا يمكن تعديل احتياجاته بعد ذلك');
    }

    const existingNeeds = readTable_(APP.sheets.beneficiaryNeeds).rows
      .filter(row => String(row['رقم المستفيد']) === beneficiaryId);
    const existingByType = {};
    existingNeeds.forEach(row => { existingByType[String(row['نوع الجهاز'])] = row; });

    const toCreate = uniqueTypes.filter(t => !existingByType[t]);
    if (toCreate.length) {
      // nextIdsLocked_ (لا nextIds_) عمدًا: القفل ممسوك بالفعل أعلاه —
      // استدعاء nextIds_ هنا كان يعني إمساك ScriptLock مرتين ضمن نفس
      // التنفيذ (قفل متداخل)، وهو ما أُصلح في هذه المرحلة.
      const ids = nextIdsLocked_('NED', toCreate.length);
      const nowStamp = now_();
      const rows = toCreate.map((deviceType, index) => ({
        'رقم الاحتياج': ids[index],
        'رقم المستفيد': beneficiaryId,
        'رقم الجمعية': String(beneficiary['رقم الجمعية']),
        'نوع الجهاز': deviceType,
        'حالة القرار': 'بانتظار المراجعة',
        'سبب الرفض': '',
        'المراجع': '',
        'تاريخ القرار': '',
        'حالة التنفيذ': '',
        'تاريخ الإنشاء': nowStamp,
        'آخر تحديث': nowStamp
      }));
      appendObjects_(APP.sheets.beneficiaryNeeds, rows);
    }
    if (reviewStatus !== 'تحت المراجعة') {
      assertBeneficiaryReviewTransition_(reviewStatus, 'تحت المراجعة');
      updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {'حالة مراجعة المستفيد': 'تحت المراجعة'});
    }
  } finally {
    lock.releaseLock();
  }
  clearDashboardCache();
  audit_(user, 'تسجيل احتياجات مستفيد', 'احتياجات المستفيدين', beneficiaryId, uniqueTypes.join('، '));
  return {ok: true, beneficiaryId: beneficiaryId, needs: beneficiaryNeeds_(beneficiaryId)};
}

/**
 * إزالة احتياج **قبل المراجعة فقط** — للجمعية المالكة أو ADMIN، عندما
 * تُعدّل الجمعية النموذج قبل قرار الإدارة (مثال: أزالت "غسالة" من طلب
 * لم تراجعه الإدارة بعد). لا تحذف أبدًا احتياجًا محسومًا (معتمد/مرفوض)،
 * ولا تترك المستفيد بلا أي احتياج على الإطلاق.
 *
 * opId اختياري (Phase 2.2): عند تمريره، تُدار العملية كاملة عبر
 * runLockedIdempotent_ (قفل واحد + فحص/تخزين النتيجة داخله) بنطاق مميَّز
 * 'removePendingBeneficiaryNeed:' + needId — إعادة نفس الطلب بنفس opId
 * (مثال: انتهاء مهلة الواجهة قبل وصول الرد الأول رغم نجاح الحذف فعليًا)
 * تُعيد نفس النتيجة الأصلية بدل الاصطدام بـ"الاحتياج غير موجود" على من
 * نجح حذفه بالفعل. بلا opId، يبقى السلوك بلا idempotency كما في Phase 2.1.
 */
function removePendingBeneficiaryNeed(token, needId, opId) {
  return perfTime_('removePendingBeneficiaryNeed', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    const cleanNeedId = cleanId_(needId);
    if (opId) {
      return runLockedIdempotent_('removePendingBeneficiaryNeed:' + cleanNeedId, user.id, opId, () => removePendingBeneficiaryNeed_(user, needId));
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      return removePendingBeneficiaryNeed_(user, needId);
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * ⚠️ تفترض أن المستدعي يُمسك ScriptLock فعلًا (من removePendingBeneficiaryNeed
 * أعلاه، مباشرة أو عبر runLockedIdempotent_) — لا تُمسك أي قفل بنفسها.
 *
 * كل قراءة يُبنى عليها القرار — الاحتياج، المستفيد المرتبط، تطابق جمعية
 * الاحتياج مع جمعية المستفيد، حالة مراجعة المستفيد، عدد الاحتياجات
 * المتبقية — تحدث **هنا داخل القفل** بعد invalidateTableCache_، لا قبله.
 */
function removePendingBeneficiaryNeed_(user, needId) {
  needId = cleanId_(needId);
  if (!needId) throw new Error('رقم احتياج غير صالح');
  invalidateTableCache_(APP.sheets.beneficiaryNeeds);
  invalidateTableCache_(APP.sheets.beneficiaries);

  const row = findById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', needId);
  if (!row) throw new Error('الاحتياج غير موجود');
  const beneficiaryId = String(row['رقم المستفيد']);
  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
  if (!beneficiary) throw new Error('المستفيد المرتبط بهذا الاحتياج غير موجود');
  if (String(beneficiary['رقم الجمعية']) !== String(row['رقم الجمعية'])) {
    throw new Error('عدم تطابق جمعية الاحتياج مع جمعية المستفيد — يتطلب مراجعة بيانات (تشخيص: diagnoseNeedsIntegrity_)');
  }
  if (user.role === 'ASSOCIATION' && String(row['رقم الجمعية']) !== user.associationId) {
    throw new Error('ليس لديك صلاحية على هذا الاحتياج');
  }
  const reviewStatus = String(beneficiary['حالة مراجعة المستفيد'] || '');
  if (reviewStatus !== 'تحت المراجعة') {
    throw new Error('لا يمكن تعديل احتياجات مستفيد ليس تحت المراجعة حاليًا (حالته: ' + (reviewStatus || 'بلا حالة مسجَّلة') + ')');
  }
  if (String(row['حالة القرار']) !== 'بانتظار المراجعة') {
    throw new Error('لا يمكن إزالة احتياج سبق البتّ فيه (الحالة الحالية: ' + row['حالة القرار'] + ')');
  }
  const remainingCount = readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(r => String(r['رقم المستفيد']) === beneficiaryId && String(r['رقم الاحتياج']) !== needId).length;
  if (!remainingCount) {
    throw new Error('لا يمكن ترك المستفيد بلا أي احتياج — أضف احتياجًا بديلًا أولًا إن أردت إزالة هذا');
  }
  deleteRowById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', needId);
  clearDashboardCache();
  // فشل audit بعد نجاح الحذف الفعلي لا يُعتبر فشلًا للحذف نفسه — النتيجة
  // الراجعة يجب أن تعكس حالة البيانات الفعلية (الحذف تم)، لا حالة السجل.
  try {
    audit_(user, 'إزالة احتياج قبل المراجعة', 'احتياجات المستفيدين', needId, row['نوع الجهاز'] + ' — للمستفيد ' + beneficiaryId);
  } catch (auditError) {
    Logger.log('تحذير: فشل تسجيل العملية في سجل العمليات بعد نجاح إزالة الاحتياج فعليًا — traceId=' + requestMeta_().traceId
      + ' needId=' + needId + ' — ' + auditError.message);
  }
  return {ok: true, beneficiaryId: beneficiaryId, needs: beneficiaryNeeds_(beneficiaryId)};
}

/**
 * مسار موحَّد عام: يوجّه لإنشاء ذرّي (createBeneficiaryWithNeeds_) إن لم
 * يحمل payload.id، أو لتعديل مترابط (updateBeneficiaryWithNeeds_) إن
 * حمله. هذا هو نفس التوجيه الذي يطبّقه saveBeneficiary العام في
 * Beneficiaries.gs الآن للإنشاء — الاسمان يؤديان لنفس المسار الذري.
 */
function saveBeneficiaryWithNeeds(token, payload) {
  return perfTime_('saveBeneficiaryWithNeeds', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    payload = payload || {};
    return payload.id ? updateBeneficiaryWithNeeds_(user, payload) : createBeneficiaryWithNeeds_(user, payload);
  });
}

/**
 * إنشاء مستفيد جديد + احتياجاته **كعملية ذرّية واحدة** ضمن ScriptLock
 * واحد (Phase 2.2 — القسمان 1 و2 من المراجعة): لا نجاح جزئي، ولا مستفيد
 * بلا احتياج، ولا احتياج يتيم بلا مستفيد.
 *
 * الترتيب داخل القفل: تحقّق كامل من كل شيء أولًا (لا كتابة قبل اكتمال
 * التحقق) → توليد رقم المستفيد ورقم/أرقام الاحتياجات معًا عبر
 * nextIdsLocked_ → كتابة صفوف الاحتياجات "بانتظار المراجعة" أولًا →
 * كتابة صف المستفيد بحالة "تحت المراجعة" أخيرًا. هذا الترتيب (احتياجات
 * ثم مستفيد، لا العكس) مقصود: حذف صف احتياج معلَّق مسموح دائمًا
 * (deleteRowById_)، بينما حذف صف مستفيد ممنوع كليًا في هذا النظام —
 * فإذا فشلت كتابة المستفيد بعد نجاح الاحتياجات، تُزال الاحتياجات
 * المعلَّقة الجديدة فقط (لم يرها أي طلب آخر بعد، لم يُحرَّر القفل)، ولا
 * يُعاد للمستخدم أبدًا "نجاح جزئي". إن فشلت كتابة الاحتياجات نفسها، لا
 * يُكتب صف المستفيد إطلاقًا (لم تبدأ كتابته بعد في هذا الترتيب).
 */
function createBeneficiaryWithNeeds_(user, payload) {
  payload = payload || {};
  const uniqueTypes = validateNewNeedDeviceTypes_(payload.deviceTypes);
  const associationId = user.role === 'ASSOCIATION' ? user.associationId : cleanId_(payload.associationId);
  if (!associationId) throw new Error('اختر جمعية صحيحة');
  const phone = normalizePhone_(payload.phone);
  const place = validateRegionCity_(payload.region, payload.city, null);
  // بناء قيم الحقول (تحقق صيغة بحت، بلا مفتاح "الاحتياج" إطلاقًا — انظر
  // توثيق مصدر الحقيقة أعلى الملف) يحدث قبل القفل؛ فحوصات التكرار
  // والجمعية تُعاد **داخل** القفل أدناه (قد تتغيّر أثناء الانتظار عليه).
  const values = buildBeneficiaryFieldValues_(payload, place, phone, null, associationId);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    invalidateTableCache_(APP.sheets.beneficiaries);
    invalidateTableCache_(APP.sheets.associations);
    invalidateTableCache_(APP.sheets.beneficiaryNeeds);

    if (!findById_(APP.sheets.associations, 'رقم الجمعية', associationId)) throw new Error('اختر جمعية صحيحة');
    if (findConfirmedDuplicateBeneficiary_(associationId, phone, null)) {
      throw new Error('يوجد مستفيد آخر بنفس رقم الجوال لدى هذه الجمعية بالفعل — تحقق من عدم تكرار الإضافة');
    }
    const possibleDuplicate = findPossibleDuplicateBeneficiary_(associationId, payload.name, payload.city, null);

    const beneficiaryId = nextIdsLocked_('BEN', 1)[0];
    const needIds = nextIdsLocked_('NED', uniqueTypes.length);
    const nowStamp = now_();
    const needRowsToWrite = uniqueTypes.map((deviceType, index) => ({
      'رقم الاحتياج': needIds[index], 'رقم المستفيد': beneficiaryId, 'رقم الجمعية': associationId,
      'نوع الجهاز': deviceType, 'حالة القرار': 'بانتظار المراجعة', 'سبب الرفض': '', 'المراجع': '',
      'تاريخ القرار': '', 'حالة التنفيذ': '', 'تاريخ الإنشاء': nowStamp, 'آخر تحديث': nowStamp
    }));

    let needsWritten = false;
    try {
      appendObjects_(APP.sheets.beneficiaryNeeds, needRowsToWrite);
      needsWritten = true;
      appendObject_(APP.sheets.beneficiaries, Object.assign(
        {'رقم المستفيد': beneficiaryId, 'رقم الجمعية': associationId, 'تاريخ الإنشاء': nowStamp, 'حالة مراجعة المستفيد': 'تحت المراجعة'},
        values
      ));
    } catch (writeError) {
      if (needsWritten) {
        const cleanupErrors = [];
        needIds.forEach(id => {
          try { deleteRowById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', id); }
          catch (cleanupError) { cleanupErrors.push(id + ': ' + cleanupError.message); }
        });
        if (cleanupErrors.length) {
          Logger.log('حرج جدًا: فشل تنظيف احتياجات معلَّقة بعد تعذّر إنشاء المستفيد — traceId=' + requestMeta_().traceId + ' — ' + cleanupErrors.join('؛ '));
          throw new Error('تعذّر إنشاء المستفيد، وتعذّر تنظيف الاحتياجات المؤقتة المرتبطة أيضًا — يتطلب مراجعة يدوية فورية (traceId: ' + requestMeta_().traceId + ')');
        }
      }
      throw new Error('تعذّر إنشاء المستفيد: ' + writeError.message);
    }

    clearDashboardCache();
    try {
      audit_(user, 'إضافة مستفيد باحتياجاته', 'المستفيدون', beneficiaryId, uniqueTypes.join('، '));
    } catch (auditError) {
      Logger.log('تحذير: فشل تسجيل العملية بعد نجاح إنشاء المستفيد فعليًا — traceId=' + requestMeta_().traceId + ' — ' + auditError.message);
    }
    const record = normalizeBeneficiary_(findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId));
    const summary = computeCoreSummary_(user.role === 'ASSOCIATION' ? user.associationId : null);
    const result = {ok: true, id: beneficiaryId, record: record, summary: summary, needs: beneficiaryNeeds_(beneficiaryId)};
    if (possibleDuplicate) {
      result.possibleDuplicateId = String(possibleDuplicate['رقم المستفيد']);
      result.possibleDuplicateWarning = 'تنبيه: يوجد مستفيد آخر بنفس الاسم والمدينة (رقم ' + result.possibleDuplicateId + ') — تأكد أنه ليس تكرارًا قبل المتابعة';
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * تعديل مستفيد قائم + مزامنة قائمة احتياجاته النهائية معًا (Phase 2.2 —
 * القسم 3): كل قراءة تُبنى عليها القرار (المستفيد، حالة مراجعته،
 * احتياجاته الحالية) تُعاد **داخل القفل**. إن كان معتمدًا أو مرفوضًا:
 * لا يُسمح بلمس قائمة الاحتياجات إطلاقًا (لا تُمرَّر payload.deviceTypes
 * لهذا المستفيد بعد قراره النهائي — تُرفض العملية كلها قبل أي كتابة).
 * إن كان تحت المراجعة: تُضاف الأنواع الجديدة، وتُحذف الأنواع المعلَّقة
 * التي غابت عن القائمة الجديدة (لا يُحذف احتياج محسوم أبدًا)، مع بقاء
 * احتياج واحد على الأقل. تعديلات حقول المستفيد نفسها قابلة للتراجع إلى
 * لقطتها السابقة إذا فشلت أي كتابة تالية (احتياج أو غيره).
 *
 * payload.deviceTypes: إن غابت تمامًا (undefined/null)، لا تُمس قائمة
 * الاحتياجات إطلاقًا (استدعاء تعديل حقول المستفيد العامة فقط). إن
 * أُرسلت كمصفوفة (حتى لو فارغة)، تُعامَل كقائمة نهائية جديدة كاملة —
 * فارغة صراحة تُرفض دائمًا (لا يجوز ترك المستفيد بلا احتياج).
 */
function updateBeneficiaryWithNeeds_(user, payload) {
  payload = payload || {};
  const beneficiaryId = cleanId_(payload.id);
  if (!beneficiaryId) throw new Error('رقم مستفيد غير صالح');
  const touchesNeeds = payload.deviceTypes !== undefined && payload.deviceTypes !== null;
  const requestedTypes = touchesNeeds ? validateNewNeedDeviceTypes_(payload.deviceTypes) : null;
  const phone = normalizePhone_(payload.phone);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    invalidateTableCache_(APP.sheets.beneficiaries);
    invalidateTableCache_(APP.sheets.beneficiaryNeeds);
    invalidateTableCache_(APP.sheets.associations);

    const existing = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
    if (!existing) throw new Error('المستفيد غير موجود');
    if (user.role === 'ASSOCIATION' && String(existing['رقم الجمعية']) !== user.associationId) {
      throw new Error('ليس لديك صلاحية لتعديل هذا المستفيد');
    }
    if (String(existing['حالة التسليم']) === 'تم التسليم') throw new Error('لا يمكن تعديل بيانات مستفيد تم تسليمه');
    const associationId = String(existing['رقم الجمعية']);
    const reviewStatus = String(existing['حالة مراجعة المستفيد'] || '');
    if (touchesNeeds && (reviewStatus === 'معتمد' || reviewStatus === 'مرفوض')) {
      throw new Error('تم اتخاذ قرار مراجعة نهائي لهذا المستفيد، ولا يمكن تعديل احتياجاته بعد ذلك');
    }

    if (findConfirmedDuplicateBeneficiary_(associationId, phone, beneficiaryId)) {
      throw new Error('يوجد مستفيد آخر بنفس رقم الجوال لدى هذه الجمعية بالفعل — تحقق من عدم تكرار الإضافة');
    }
    const possibleDuplicate = findPossibleDuplicateBeneficiary_(associationId, payload.name, payload.city, beneficiaryId);
    const place = validateRegionCity_(payload.region, payload.city, {region: String(existing['المنطقة'] || ''), city: String(existing['المدينة'] || '')});
    const values = buildBeneficiaryFieldValues_(payload, place, phone, existing, associationId);

    const beneficiarySnapshot = {};
    Object.keys(values).forEach(k => { beneficiarySnapshot[k] = existing[k]; });

    const existingNeeds = readTable_(APP.sheets.beneficiaryNeeds).rows.filter(r => String(r['رقم المستفيد']) === beneficiaryId);
    let toAdd = [];
    let toRemove = [];
    if (touchesNeeds) {
      const existingByType = {};
      existingNeeds.forEach(r => { existingByType[String(r['نوع الجهاز'])] = r; });
      toAdd = requestedTypes.filter(t => !existingByType[t]);
      existingNeeds.forEach(r => {
        const type = String(r['نوع الجهاز']);
        if (requestedTypes.indexOf(type) === -1) {
          if (String(r['حالة القرار']) !== 'بانتظار المراجعة') {
            throw new Error('لا يمكن إزالة احتياج سبق البتّ فيه من القائمة (' + type + ') — الحالة الحالية: ' + r['حالة القرار']);
          }
          toRemove.push(r);
        }
      });
      const remainingCount = existingNeeds.length - toRemove.length + toAdd.length;
      if (!remainingCount) throw new Error('لا يمكن ترك المستفيد بلا أي احتياج');
    }

    let beneficiaryWritten = false;
    const addedIds = [];
    const removedRows = [];
    const nowStamp = now_();
    try {
      updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, values);
      beneficiaryWritten = true;
      if (toAdd.length) {
        const ids = nextIdsLocked_('NED', toAdd.length);
        appendObjects_(APP.sheets.beneficiaryNeeds, toAdd.map((deviceType, index) => {
          addedIds.push(ids[index]);
          return {
            'رقم الاحتياج': ids[index], 'رقم المستفيد': beneficiaryId, 'رقم الجمعية': associationId,
            'نوع الجهاز': deviceType, 'حالة القرار': 'بانتظار المراجعة', 'سبب الرفض': '', 'المراجع': '',
            'تاريخ القرار': '', 'حالة التنفيذ': '', 'تاريخ الإنشاء': nowStamp, 'آخر تحديث': nowStamp
          };
        }));
      }
      toRemove.forEach(r => {
        deleteRowById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', String(r['رقم الاحتياج']));
        removedRows.push(r);
      });
    } catch (writeError) {
      const rollbackErrors = [];
      if (beneficiaryWritten) {
        try { updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, beneficiarySnapshot); }
        catch (e) { rollbackErrors.push('beneficiary: ' + e.message); }
      }
      addedIds.forEach(id => {
        try { deleteRowById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', id); }
        catch (e) { rollbackErrors.push(id + ': ' + e.message); }
      });
      removedRows.forEach(r => {
        try { appendObject_(APP.sheets.beneficiaryNeeds, r); }
        catch (e) { rollbackErrors.push(r['رقم الاحتياج'] + ': ' + e.message); }
      });
      clearDashboardCache();
      if (rollbackErrors.length) {
        Logger.log('حرج جدًا: فشل تراجع تعويضي بعد خطأ كتابة في updateBeneficiaryWithNeeds_ — traceId=' + requestMeta_().traceId + ' — ' + rollbackErrors.join('؛ '));
        throw new Error('تعذّر إتمام تعديل المستفيد (traceId: ' + requestMeta_().traceId + ') — تعذّر التراجع الكامل أيضًا، يتطلب مراجعة يدوية فورية.');
      }
      throw new Error('تعذّر إتمام تعديل المستفيد (traceId: ' + requestMeta_().traceId + ') — أُعيدت كل السجلات المتأثرة لحالتها السابقة تلقائيًا.');
    }

    clearDashboardCache();
    try {
      audit_(user, 'تعديل مستفيد واحتياجاته', 'المستفيدون', beneficiaryId, '');
    } catch (auditError) {
      Logger.log('تحذير: فشل تسجيل العملية بعد نجاح التعديل فعليًا — traceId=' + requestMeta_().traceId + ' — ' + auditError.message);
    }
    const record = normalizeBeneficiary_(findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId));
    const summary = computeCoreSummary_(user.role === 'ASSOCIATION' ? user.associationId : null);
    const result = {ok: true, id: beneficiaryId, record: record, summary: summary, needs: beneficiaryNeeds_(beneficiaryId)};
    if (possibleDuplicate) {
      result.possibleDuplicateId = String(possibleDuplicate['رقم المستفيد']);
      result.possibleDuplicateWarning = 'تنبيه: يوجد مستفيد آخر بنفس الاسم والمدينة (رقم ' + result.possibleDuplicateId + ') — تأكد أنه ليس تكرارًا قبل المتابعة';
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** كل صفوف احتياج مستفيد معيّن، مطبَّعة لعرض الواجهة لاحقًا. */
function beneficiaryNeeds_(beneficiaryId) {
  beneficiaryId = cleanId_(beneficiaryId);
  return readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(row => String(row['رقم المستفيد']) === beneficiaryId)
    .map(normalizeNeedRow_);
}

/** بنفس نمط normalizeBeneficiary_ (Normalize.gs): تواريخ عبر parseDate_/formatDateTime_، لا نص Sheets الخام. */
function normalizeNeedRow_(row) {
  return {
    id: String(row['رقم الاحتياج']),
    beneficiaryId: String(row['رقم المستفيد']),
    associationId: String(row['رقم الجمعية']),
    deviceType: String(row['نوع الجهاز']),
    decisionStatus: String(row['حالة القرار'] || ''),
    rejectReason: String(row['سبب الرفض'] || ''),
    reviewedBy: String(row['المراجع'] || ''),
    decidedAt: formatDateTime_(parseDate_(row['تاريخ القرار'])),
    fulfillmentStatus: String(row['حالة التنفيذ'] || ''),
    createdAt: formatDateTime_(parseDate_(row['تاريخ الإنشاء'])),
    updatedAt: formatDateTime_(parseDate_(row['آخر تحديث']))
  };
}

/**
 * قرار ADMIN المترابط: مراجعة المستفيد نفسه + قرار كل احتياج معًا.
 *
 * payload = {
 *   beneficiaryDecision: 'معتمد' | 'مرفوض',
 *   beneficiaryRejectReason: نص (إلزامي إذا كان القرار "مرفوض"),
 *   needDecisions: [{needId, decision: 'معتمد'|'مرفوض', rejectReason}],
 *   opId: نص اختياري لمنع التنفيذ المزدوج (idempotency)
 * }
 *
 * انضباط القفل/الـidempotency (Phase 2.1): قفل واحد فقط لكامل العملية —
 * فحص opId، القرار، الكتابة، وتخزين نتيجة opId كلها **داخل نفس القفل**
 * قبل تحريره (runLockedIdempotent_ أدناه)؛ لا يوجد قفل منفصل داخل
 * reviewBeneficiaryNeeds_ نفسها (كانت تُمسك قفلها الخاص سابقًا، فتُمسك
 * الآن قفلًا واحدًا فقط من نقطة واحدة). هذا يمنع سيناريو: طلبان بنفس
 * opId يصلان معًا، كلاهما يفوت فحص الكاش قبل أن يكتب أيّهما — الطلب
 * الثاني الآن ينتظر تحرير القفل فعليًا ثم يجد النتيجة المخزَّنة جاهزة.
 */
function reviewBeneficiaryNeeds(token, beneficiaryId, payload) {
  return perfTime_('reviewBeneficiaryNeeds', () => {
    const user = requireSession_(token, ['ADMIN']);
    payload = payload || {};
    return runLockedIdempotent_('reviewBeneficiaryNeeds:' + cleanId_(beneficiaryId), user.id, payload.opId, () => reviewBeneficiaryNeeds_(user, beneficiaryId, payload));
  });
}

/**
 * ⚠️ تفترض أن المستدعي يُمسك ScriptLock فعلًا (عبر runLockedIdempotent_
 * في reviewBeneficiaryNeeds أعلاه) — لا تُمسك أي قفل بنفسها ولا تُستدعى
 * مباشرة من أي مسار آخر.
 */
function reviewBeneficiaryNeeds_(user, beneficiaryId, payload) {
  beneficiaryId = cleanId_(beneficiaryId);
  const beneficiaryDecision = String(payload.beneficiaryDecision || '');
  if (['معتمد', 'مرفوض'].indexOf(beneficiaryDecision) === -1) {
    throw new Error('قرار المستفيد يجب أن يكون "معتمد" أو "مرفوض"');
  }
  const beneficiaryRejectReason = requiredIfRejected_(beneficiaryDecision, payload.beneficiaryRejectReason, 'سبب رفض المستفيد');
  const requestedDecisions = Array.isArray(payload.needDecisions) ? payload.needDecisions : [];

  invalidateTableCache_(APP.sheets.beneficiaries);
  invalidateTableCache_(APP.sheets.beneficiaryNeeds);

  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
  if (!beneficiary) throw new Error('المستفيد غير موجود');
  const currentReviewStatus = String(beneficiary['حالة مراجعة المستفيد'] || '');
  assertBeneficiaryReviewTransition_(currentReviewStatus, beneficiaryDecision);

  const allNeeds = readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(row => String(row['رقم المستفيد']) === beneficiaryId);
  const needById = {};
  allNeeds.forEach(row => { needById[String(row['رقم الاحتياج'])] = row; });

  // "كل شيء أو لا شيء" في التحقق: تُبنى قائمة القرارات كاملة أولًا —
  // أول خطأ يوقف العملية قبل أي كتابة على الإطلاق.
  const pendingNeeds = allNeeds.filter(row => String(row['حالة القرار']) === 'بانتظار المراجعة');
  if (!pendingNeeds.length) throw new Error('لا توجد احتياجات بانتظار المراجعة لهذا المستفيد');

  const resolvedDecisions = [];
  const seenNeedIds = {};
  requestedDecisions.forEach(entry => {
    const needId = String((entry && entry.needId) || '');
    if (seenNeedIds[needId]) throw new Error('الاحتياج «' + needId + '» مكرَّر أكثر من مرة في نفس الطلب');
    seenNeedIds[needId] = true;
    const row = needById[needId];
    if (!row) throw new Error('احتياج غير موجود لهذا المستفيد: ' + needId);
    if (String(row['حالة القرار']) !== 'بانتظار المراجعة') {
      throw new Error('سبق اتخاذ قرار لهذا الاحتياج (' + row['نوع الجهاز'] + ') — لا يمكن إعادة تقرير احتياج محسوم');
    }
    let decision = beneficiaryDecision === 'مرفوض' ? 'مرفوض' : String((entry && entry.decision) || '');
    if (['معتمد', 'مرفوض'].indexOf(decision) === -1) {
      throw new Error('قرار الاحتياج (' + row['نوع الجهاز'] + ') يجب أن يكون "معتمد" أو "مرفوض"');
    }
    assertNeedDecisionTransition_(String(row['حالة القرار']), decision);
    const rejectReason = requiredIfRejected_(decision, entry && entry.rejectReason, 'سبب رفض الاحتياج (' + row['نوع الجهاز'] + ')');
    resolvedDecisions.push({row: row, decision: decision, rejectReason: rejectReason});
  });

  pendingNeeds.forEach(row => {
    const needId = String(row['رقم الاحتياج']);
    if (seenNeedIds[needId]) return;
    if (beneficiaryDecision === 'مرفوض') {
      resolvedDecisions.push({row: row, decision: 'مرفوض', rejectReason: beneficiaryRejectReason});
    } else {
      throw new Error('يجب البتّ في كل احتياجات المستفيد المعلَّقة قبل اعتماده — لم يُذكر قرار للاحتياج: ' + row['نوع الجهاز']);
    }
  });

  if (beneficiaryDecision === 'معتمد' && !resolvedDecisions.some(d => d.decision === 'معتمد')) {
    throw new Error('لا يمكن قبول المستفيد نهائيًا دون اعتماد احتياج واحد على الأقل');
  }

  // -------- الكتابة الفعلية، بلقطة "قبل" لكل صف متأثر لأجل التراجع --------
  // Phase 2.2: اللقطات تحتفظ بالقيم الخام كما قُرئت من Sheets (Date/رقم/
  // فارغ...) لا String(...) — التراجع يعيد كتابة القيمة الأصلية حرفيًا
  // بلا أي تحويل ضمني قد يغيّر نوعها.
  const beneficiarySnapshot = {
    'حالة مراجعة المستفيد': beneficiary['حالة مراجعة المستفيد'],
    'سبب رفض المستفيد': beneficiary['سبب رفض المستفيد'],
    'مراجع اعتماد المستفيد': beneficiary['مراجع اعتماد المستفيد'],
    'تاريخ مراجعة المستفيد': beneficiary['تاريخ مراجعة المستفيد']
  };
  const needSnapshots = {};
  resolvedDecisions.forEach(item => {
    const id = String(item.row['رقم الاحتياج']);
    needSnapshots[id] = {
      'حالة القرار': item.row['حالة القرار'],
      'سبب الرفض': item.row['سبب الرفض'],
      'المراجع': item.row['المراجع'],
      'تاريخ القرار': item.row['تاريخ القرار'],
      'حالة التنفيذ': item.row['حالة التنفيذ'],
      'آخر تحديث': item.row['آخر تحديث']
    };
  });

  const written = []; // 'beneficiary' أو رقم احتياج — لتحديد ما يحتاج تراجعًا فعليًا فقط عند الفشل
  const nowStamp = now_();
  try {
    updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
      'حالة مراجعة المستفيد': beneficiaryDecision,
      'سبب رفض المستفيد': beneficiaryRejectReason,
      'مراجع اعتماد المستفيد': user.name,
      'تاريخ مراجعة المستفيد': nowStamp
    });
    written.push('beneficiary');
    resolvedDecisions.forEach(item => {
      const needId = String(item.row['رقم الاحتياج']);
      updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', needId, {
        'حالة القرار': item.decision,
        'سبب الرفض': item.rejectReason,
        'المراجع': user.name,
        'تاريخ القرار': nowStamp,
        'حالة التنفيذ': item.decision === 'معتمد' ? 'استحقاق معتمد' : '',
        'آخر تحديث': nowStamp
      });
      written.push(needId);
    });
  } catch (writeError) {
    // تراجع best-effort (Phase 2.2): تُحاوَل إعادة **كل** سجل مكتوب فعليًا
    // (لا تتوقف الحلقة عند أول فشل تراجع)، وتُجمَع كل الأخطاء في تقرير
    // واحد بدل إخفاء أي منها. السجل الناتج معرّفات فقط، بلا بيانات شخصية.
    const restored = [];
    const failedToRestore = [];
    if (written.indexOf('beneficiary') !== -1) {
      try {
        updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, beneficiarySnapshot);
        restored.push('beneficiary:' + beneficiaryId);
      } catch (rollbackError) {
        failedToRestore.push('beneficiary:' + beneficiaryId + ' (' + rollbackError.message + ')');
      }
    }
    written.forEach(id => {
      if (id === 'beneficiary') return;
      try {
        updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', id, needSnapshots[id]);
        restored.push(id);
      } catch (rollbackError) {
        failedToRestore.push(id + ' (' + rollbackError.message + ')');
      }
    });
    clearDashboardCache();
    const traceId = requestMeta_().traceId;
    if (failedToRestore.length) {
      Logger.log('حرج جدًا: فشل تراجع بعض السجلات بعد خطأ كتابة في reviewBeneficiaryNeeds_ — traceId=' + traceId
        + ' — أُعيدت: [' + restored.join('، ') + '] — تعذّر إعادة: [' + failedToRestore.join('، ') + '] — خطأ الكتابة الأصلي: ' + writeError.message);
      throw new Error('تعذّر إتمام قرار المراجعة (traceId: ' + traceId + ') — تعذّر التراجع الكامل، يتطلب مراجعة يدوية فورية للسجلات: ' + failedToRestore.map(s => s.split(' (')[0]).join('، '));
    }
    throw new Error('تعذّر إتمام قرار المراجعة (traceId: ' + traceId + ') — أُعيدت كل السجلات المتأثرة لحالتها السابقة تلقائيًا.');
  }

  clearDashboardCache();
  const approvedCount = resolvedDecisions.filter(d => d.decision === 'معتمد').length;
  const rejectedCount = resolvedDecisions.length - approvedCount;
  // فشل تسجيل audit بعد نجاح القرار فعليًا لا يُعتبر فشلًا للقرار نفسه —
  // البيانات الأساسية اكتملت وصحيحة؛ فقط سجل العمليات قد يفوّت هذه الحركة.
  try {
    audit_(user, 'مراجعة مستفيد واحتياجاته', 'المستفيدون', beneficiaryId,
      'قرار المستفيد: ' + beneficiaryDecision + ' — احتياجات معتمدة: ' + approvedCount + '، مرفوضة: ' + rejectedCount);
  } catch (auditError) {
    Logger.log('تحذير: فشل تسجيل العملية في سجل العمليات بعد نجاح قرار المراجعة فعليًا — traceId=' + requestMeta_().traceId
      + ' beneficiaryId=' + beneficiaryId + ' — ' + auditError.message);
  }

  return {
    ok: true,
    beneficiaryId: beneficiaryId,
    beneficiaryDecision: beneficiaryDecision,
    approvedCount: approvedCount,
    rejectedCount: rejectedCount,
    needs: beneficiaryNeeds_(beneficiaryId)
  };
}

function requiredIfRejected_(decision, reason, label) {
  const clean = cleanText_(reason, 500);
  if (decision === 'مرفوض' && !clean) throw new Error(label + ' إلزامي عند الرفض');
  return clean;
}

/**
 * تجميع كميات نوع جهاز واحد — مؤشرات واضحة الحساب، كل واحد بمعادلته:
 *
 * requestedTotal   = عدد كل صفوف الاحتياج المسجَّلة (أي قرار).
 * approvedTotal    = عدد الاحتياجات بحالة قرار "معتمد".
 * rejectedTotal    = عدد الاحتياجات بحالة قرار "مرفوض".
 * deliveredTotal   = عدد الاحتياجات المعتمدة التي اكتمل تسليمها فعليًا
 *                    (حالة التنفيذ = "تم التسليم").
 * outstandingApproved = max(0, approvedTotal - deliveredTotal)
 *                    — المعتمد الذي لم يكتمل تسليمه بعد.
 * physicalAvailable = عدد الأجهزة المادية من ورقة "الأجهزة" بحالة
 *                    "بالمستودع" **وغير مرتبطة بأي مستفيد** — القابلة
 *                    للتخصيص فعليًا الآن.
 * readyOrAllocated = عدد الأجهزة المادية المرتبطة فعليًا بمستفيد وحالتها
 *                    "مخصص" أو "مع المندوب" (استحقاق له جهاز حقيقي، لم
 *                    يُسلَّم بعد) — لا يُحسب الجهاز نفسه في هذا العدّاد
 *                    وphysicalAvailable معًا (الشرطان متنافيان: إما غير
 *                    مرتبط بمستودع، أو مرتبط بمستفيد بإحدى الحالتين).
 * shortage         = max(0, outstandingApproved - physicalAvailable - readyOrAllocated)
 *
 * أجهزة بحالة "تم التسليم" أو "تالف" لا تدخل physicalAvailable ولا
 * readyOrAllocated (خرجت من التداول التشغيلي فعليًا). associationId
 * اختياري لتضييق النطاق لجمعية واحدة (عزل الجمعيات)؛ بلا تمرير قيمة
 * يُحسب على مستوى المشروع كله.
 */
/**
 * Phase 2.3.1 (القسم 8): "بانتظار تعيين مندوب" حالة حقيقية بين جاهزية
 * الأجهزة وتعيين المندوب فعليًا — لا تظهر إلا إذا أصبحت **كل** احتياجات
 * المستفيد المعتمدة مرتبطة بأجهزة صحيحة معًا في اللحظة نفسها؛ إن بقي
 * احتياج واحد "بانتظار توفر الجهاز" (لا جهاز مرتبط أصلًا)، يبقى كل شيء
 * آخر كما هو — لا "جاهزية جزئية" تُعرَض كاكتمال. تُستدعى من داخل قفل
 * saveDevice القائم أصلًا (لا تُمسك قفلها الخاص).
 */
function maybeAdvanceNeedsToPendingDelegate_(beneficiaryId) {
  const needs = readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(row => String(row['رقم المستفيد']) === beneficiaryId && String(row['حالة القرار']) === 'معتمد');
  if (!needs.length) return;
  const deviceByNeed = {};
  readTable_(APP.sheets.devices).rows.forEach(row => {
    const needId = String(row['رقم الاحتياج'] || '');
    if (needId) deviceByNeed[needId] = row;
  });
  const allReady = needs.every(need => {
    const fulfillment = String(need['حالة التنفيذ']);
    if (fulfillment === 'بانتظار تعيين مندوب') return true; // مكتمل بالفعل
    if (fulfillment !== 'جهاز جاهز') return false;
    const device = deviceByNeed[String(need['رقم الاحتياج'])];
    return device
      && String(device['النوع']) === String(need['نوع الجهاز'])
      && String(device['رقم الجمعية']) === String(need['رقم الجمعية'])
      && String(device['رقم المستفيد']) === beneficiaryId
      && String(device['حالة الجهاز']) === 'مخصص';
  });
  if (!allReady) return;
  needs.forEach(need => {
    if (String(need['حالة التنفيذ']) === 'جهاز جاهز') {
      assertNeedFulfillmentChain_('جهاز جاهز', 'بانتظار تعيين مندوب');
      updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', String(need['رقم الاحتياج']), {'حالة التنفيذ': 'بانتظار تعيين مندوب', 'آخر تحديث': now_()});
    }
  });
}

function needsSummaryByDeviceType_(associationId) {
  const needs = readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(row => !associationId || String(row['رقم الجمعية']) === associationId);
  const devices = readTable_(APP.sheets.devices).rows
    .filter(row => !associationId || String(row['رقم الجمعية']) === associationId);

  function blankBucket() {
    return {
      requestedTotal: 0, approvedTotal: 0, rejectedTotal: 0, deliveredTotal: 0,
      outstandingApproved: 0, physicalAvailable: 0, readyOrAllocated: 0, shortage: 0,
      historicalUnlinkedCount: 0
    };
  }
  const summary = {};
  NEW_NEED_DEVICE_TYPES.forEach(type => { summary[type] = blankBucket(); });

  needs.forEach(row => {
    const type = String(row['نوع الجهاز']);
    if (!summary[type]) summary[type] = blankBucket();
    summary[type].requestedTotal++;
    const decision = String(row['حالة القرار']);
    if (decision === 'معتمد') summary[type].approvedTotal++;
    else if (decision === 'مرفوض') summary[type].rejectedTotal++;
    if (String(row['حالة التنفيذ']) === 'تم التسليم') summary[type].deliveredTotal++;
  });

  // Phase 2.2: readyOrAllocated يتطلب ربطًا فعليًا صحيحًا برقم احتياج
  // معتمد (عبر linkDeviceToNeed_) — لا مجرد حالة "مخصص"/"مع المندوب" مع
  // وجود رقم مستفيد، كما كان في Phase 2.1 (كان يُحسِّن عجزًا غير صحيح
  // لأي جهاز مرتبط بمستفيد بالمسار القديم بلا أي استحقاق معتمد فعليًا
  // يغطيه). جهاز برقم احتياج يشير لاستحقاق غير معتمد أو غير موجود لا
  // يُحسَب هنا (يظهر بدل ذلك في diagnoseNeedsIntegrity_ كخلل بيانات).
  const needById = {};
  needs.forEach(row => { needById[String(row['رقم الاحتياج'])] = row; });

  devices.forEach(row => {
    const type = String(row['النوع']);
    if (!summary[type]) return; // نوع خارج القائمة الثلاثة الجديدة — لا يدخل هذا التجميع
    const status = String(row['حالة الجهاز']);
    const linkedToBeneficiary = !!String(row['رقم المستفيد'] || '').trim();
    const linkedNeedId = String(row['رقم الاحتياج'] || '').trim();
    if (status === 'بالمستودع' && !linkedToBeneficiary) {
      summary[type].physicalAvailable++;
    } else if (linkedNeedId && needById[linkedNeedId] && String(needById[linkedNeedId]['حالة القرار']) === 'معتمد'
      && (status === 'مخصص' || status === 'مع المندوب')) {
      summary[type].readyOrAllocated++;
    } else if (!linkedNeedId && linkedToBeneficiary && (status === 'مخصص' || status === 'مع المندوب')) {
      // سجل تاريخي (Phase 2.3 القسم 4): جهاز مخصَّص لمستفيد من قبل النموذج
      // الجديد، بلا رقم احتياج — لا يُحسَب في readyOrAllocated (لا يغطي
      // عجزًا فعليًا حتى يُربط صراحة)، لكنه يُظهَر هنا كعدّاد منفصل حتى لا
      // يحتاج فريق التسوية إلى تخمين عدد هذه السجلات يدويًا من الشيت.
      summary[type].historicalUnlinkedCount++;
    }
    // 'تم التسليم' و'تالف': لا تُحسَب في أي من العدّادين — خرجت من التداول.
  });

  Object.keys(summary).forEach(type => {
    const s = summary[type];
    s.outstandingApproved = Math.max(0, s.approvedTotal - s.deliveredTotal);
    s.shortage = Math.max(0, s.outstandingApproved - s.physicalAvailable - s.readyOrAllocated);
  });
  return summary;
}

/**
 * يربط جهازًا ماديًا محدَّدًا برقم احتياج معتمد محدَّد (Phase 2.2 —
 * القسم 9): نقطة الدخول الخادمية الوحيدة التي تكتب عمود "رقم الاحتياج"
 * الجديد في ورقة "الأجهزة". لا واجهة لها بعد — helper خادمي واختبارات
 * سلامة فقط كما طُلب صراحة؛ التوصيل بلوحة الإدارة يأتي في مرحلة الواجهات.
 *
 * قواعد الربط المفروضة بالترتيب (كلها داخل القفل، تُعاد قراءتها):
 * - الجهاز والاحتياج موجودان.
 * - الاحتياج بحالة قرار "معتمد" فقط (لا معلَّق ولا مرفوض).
 * - نوع الجهاز يطابق نوع الاحتياج حرفيًا.
 * - إن كان الجهاز مرتبطًا بمستفيد آخر مسبقًا، يُرفض (لا "سرقة" ضمنية).
 * - جمعية الجهاز تطابق جمعية الاحتياج.
 * - لا يُربط جهاز بحالة "تم التسليم" أو "تالف" (خرج من التداول).
 * - لا يُربط أكثر من جهاز واحد بنفس رقم الاحتياج (فحص شامل على كل
 *   أجهزة الجمعية، لا الجهاز الحالي فقط).
 * نجاح الربط ينقل حالة تنفيذ الاحتياج من "استحقاق معتمد"/"بانتظار توفر
 * الجهاز" إلى "جهاز جاهز" (إن لم تكن قد تجاوزت هذه المرحلة أصلًا)،
 * ويضبط رقم المستفيد/الجمعية على الجهاز من الاحتياج نفسه (مصدر الحقيقة)
 * ويحوّل حالته من "بالمستودع" إلى "مخصص" عبر assertDeviceTransition_
 * القياسية (لا اختصار يتجاوز StateRules.gs).
 */
function linkDeviceToNeed(token, deviceId, needId) {
  return perfTime_('linkDeviceToNeed', () => {
    const user = requireSession_(token, ['ADMIN']);
    return linkDeviceToNeed_(user, deviceId, needId);
  });
}

function linkDeviceToNeed_(user, deviceId, needId) {
  deviceId = cleanId_(deviceId);
  needId = cleanId_(needId);
  if (!deviceId) throw new Error('رقم جهاز غير صالح');
  if (!needId) throw new Error('رقم احتياج غير صالح');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    invalidateTableCache_(APP.sheets.devices);
    invalidateTableCache_(APP.sheets.beneficiaryNeeds);

    const device = findById_(APP.sheets.devices, 'رقم الجهاز', deviceId);
    if (!device) throw new Error('الجهاز غير موجود');
    const need = findById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', needId);
    if (!need) throw new Error('الاحتياج غير موجود');

    const decisionStatus = String(need['حالة القرار']);
    if (decisionStatus !== 'معتمد') {
      throw new Error('لا يمكن ربط جهاز باستحقاق ' + (decisionStatus === 'مرفوض' ? 'مرفوض' : 'لم يُبتّ فيه بعد'));
    }
    if (String(device['النوع']) !== String(need['نوع الجهاز'])) {
      throw new Error('نوع الجهاز (' + device['النوع'] + ') لا يطابق نوع الاحتياج المعتمد (' + need['نوع الجهاز'] + ')');
    }
    const deviceBeneficiaryId = String(device['رقم المستفيد'] || '');
    if (deviceBeneficiaryId && deviceBeneficiaryId !== String(need['رقم المستفيد'])) {
      throw new Error('الجهاز مرتبط حاليًا بمستفيد آخر — أعده إلى المستودع أولًا');
    }
    if (String(device['رقم الجمعية']) !== String(need['رقم الجمعية'])) {
      throw new Error('جمعية الجهاز لا تطابق جمعية الاحتياج');
    }
    const deviceStatus = String(device['حالة الجهاز']);
    if (['تم التسليم', 'تالف'].indexOf(deviceStatus) !== -1) {
      throw new Error('لا يمكن ربط جهاز بحالة "' + deviceStatus + '" باستحقاق — خرج من التداول التشغيلي');
    }
    const conflictingDevice = readTable_(APP.sheets.devices).rows
      .find(r => String(r['رقم الاحتياج'] || '') === needId && String(r['رقم الجهاز']) !== deviceId);
    if (conflictingDevice) {
      throw new Error('هذا الاحتياج مرتبط بالفعل بجهاز آخر (' + conflictingDevice['رقم الجهاز'] + ') — لا يجوز ربط أكثر من جهاز واحد بنفس الاستحقاق');
    }

    const nextStatus = deviceStatus === 'بالمستودع' ? 'مخصص' : deviceStatus;
    if (nextStatus !== deviceStatus) assertDeviceTransition_(deviceStatus, nextStatus);
    updateById_(APP.sheets.devices, 'رقم الجهاز', deviceId, {
      'رقم المستفيد': String(need['رقم المستفيد']),
      'رقم الجمعية': String(need['رقم الجمعية']),
      'رقم الاحتياج': needId,
      'حالة الجهاز': nextStatus
    });
    // Phase 2.3.1 (القسم 7): يمرّ عبر assertNeedFulfillmentChain_ المركزية
    // (قفزة أو قفزتان معروفتان) بدل كتابة "جهاز جاهز" مباشرة.
    const fulfillmentBeforeLink = String(need['حالة التنفيذ']);
    if (['استحقاق معتمد', 'بانتظار توفر الجهاز'].indexOf(fulfillmentBeforeLink) !== -1) {
      assertNeedFulfillmentChain_(fulfillmentBeforeLink, 'جهاز جاهز');
      updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', needId, {'حالة التنفيذ': 'جهاز جاهز', 'آخر تحديث': now_()});
    }
    clearDashboardCache();
    try {
      audit_(user, 'ربط جهاز باستحقاق', 'الأجهزة', deviceId, 'احتياج: ' + needId);
    } catch (auditError) {
      Logger.log('تحذير: فشل تسجيل العملية بعد نجاح الربط فعليًا — traceId=' + requestMeta_().traceId + ' — ' + auditError.message);
    }
    return {ok: true, deviceId: deviceId, needId: needId, device: normalizeDevice_(findById_(APP.sheets.devices, 'رقم الجهاز', deviceId))};
  } finally {
    lock.releaseLock();
  }
}

/**
 * تشخيص قراءة-فقط لسلامة ورقة "احتياجات المستفيدين" — لا يكتب أو يُصلح
 * أي شيء (مطابق لنمط diagnoseStateIntegrity_/diagnoseReferenceDataIssues_).
 * مُدرَج ضمن preflightRelease_ (ReleaseOps.gs) — يعمل بأمان حتى لو لم
 * تُنشأ ورقة "احتياجات المستفيدين" بعد على الشيت الحي (يعيد تقريرًا
 * فارغًا بدل رمي استثناء، لأن preflightRelease_ نفسها تُستخدَم أساسًا
 * *قبل* إنشاء المخطط الجديد لفحص ما هو ناقص).
 */
function diagnoseNeedsIntegrity_(token) {
  requireMaintenanceAccess_(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(APP.sheets.beneficiaryNeeds)) {
    return {ok: true, sheetExists: false, issueCount: 0, issues: [], message: 'ورقة "احتياجات المستفيدين" غير موجودة بعد — طبيعي قبل تطبيق المخطط الجديد.'};
  }
  const needs = readTable_(APP.sheets.beneficiaryNeeds).rows;
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  const beneficiaryById = {};
  beneficiaries.forEach(row => { beneficiaryById[String(row['رقم المستفيد'])] = row; });

  const issues = [];
  function report(severity, type, message, extra) {
    issues.push(Object.assign({severity: severity, type: type, message: message}, extra || {}));
  }

  const seenByBeneficiaryType = {};
  needs.forEach(row => {
    const needId = String(row['رقم الاحتياج']);
    const beneficiaryId = String(row['رقم المستفيد']);
    const deviceType = String(row['نوع الجهاز']);
    const decisionStatus = String(row['حالة القرار']);
    const fulfillmentStatus = String(row['حالة التنفيذ']);

    if (!/^NED-\d{6}$/.test(needId)) {
      report('warning', 'BAD_ID_FORMAT', 'معرّف احتياج لا يطابق الصيغة الجديدة NED-000000: ' + needId, {needId: needId});
    }

    const dupKey = beneficiaryId + '|' + deviceType;
    if (seenByBeneficiaryType[dupKey]) {
      report('critical', 'DUPLICATE_NEED', 'أكثر من صف احتياج لنفس المستفيد ونفس نوع الجهاز', {beneficiaryId: beneficiaryId, deviceType: deviceType, needIds: [seenByBeneficiaryType[dupKey], needId]});
    } else {
      seenByBeneficiaryType[dupKey] = needId;
    }

    const beneficiary = beneficiaryById[beneficiaryId];
    if (!beneficiary) {
      report('critical', 'ORPHAN_NEED', 'احتياج يشير إلى مستفيد غير موجود', {needId: needId, beneficiaryId: beneficiaryId});
    } else if (String(beneficiary['رقم الجمعية']) !== String(row['رقم الجمعية'])) {
      report('critical', 'ASSOCIATION_MISMATCH', 'رقم جمعية الاحتياج لا يطابق جمعية المستفيد', {needId: needId, needAssociationId: row['رقم الجمعية'], beneficiaryAssociationId: beneficiary['رقم الجمعية']});
    }

    if (NEW_NEED_DEVICE_TYPES.indexOf(deviceType) === -1) {
      report('warning', 'UNKNOWN_DEVICE_TYPE', 'نوع جهاز غير معروف ضمن الأنواع الثلاثة المعتمدة', {needId: needId, deviceType: deviceType});
    }
    if (NEED_DECISION_STATUSES.indexOf(decisionStatus) === -1) {
      report('critical', 'UNKNOWN_DECISION_STATUS', 'حالة قرار غير معروفة', {needId: needId, decisionStatus: decisionStatus});
    }
    if (fulfillmentStatus && NEED_FULFILLMENT_STATUSES.indexOf(fulfillmentStatus) === -1) {
      report('critical', 'UNKNOWN_FULFILLMENT_STATUS', 'حالة تنفيذ غير معروفة', {needId: needId, fulfillmentStatus: fulfillmentStatus});
    }

    if (decisionStatus === 'معتمد' && beneficiary && String(beneficiary['حالة مراجعة المستفيد']) === 'مرفوض') {
      report('critical', 'APPROVED_NEED_FOR_REJECTED_BENEFICIARY', 'احتياج معتمد لمستفيد مرفوض', {needId: needId, beneficiaryId: beneficiaryId});
    }
    if (decisionStatus === 'مرفوض' && !String(row['سبب الرفض'] || '').trim()) {
      report('warning', 'REJECTED_WITHOUT_REASON', 'احتياج مرفوض بلا سبب رفض مسجَّل', {needId: needId});
    }
    if (decisionStatus === 'معتمد' && !fulfillmentStatus) {
      report('critical', 'APPROVED_WITHOUT_FULFILLMENT', 'احتياج معتمد بلا حالة تنفيذ (يجب أن يكون "استحقاق معتمد" على الأقل)', {needId: needId});
    }
    if (decisionStatus !== 'معتمد' && fulfillmentStatus) {
      report('critical', 'FULFILLMENT_WITHOUT_APPROVAL', 'احتياج غير معتمد وله حالة تنفيذ مسجَّلة', {needId: needId, decisionStatus: decisionStatus, fulfillmentStatus: fulfillmentStatus});
    }
  });

  const needsByBeneficiaryId = {};
  needs.forEach(row => {
    const bId = String(row['رقم المستفيد']);
    (needsByBeneficiaryId[bId] = needsByBeneficiaryId[bId] || []).push(row);
  });

  beneficiaries.forEach(row => {
    const beneficiaryId = String(row['رقم المستفيد']);
    const reviewStatus = String(row['حالة مراجعة المستفيد'] || '');
    const ownNeeds = needsByBeneficiaryId[beneficiaryId] || [];

    // Phase 2.3 (القسم 7): أي مستفيد — بصرف النظر عن حالة مراجعته — بلا
    // أي صف احتياج إطلاقًا يعني أنه أُنشئ خارج دورة الاعتماد الجديدة
    // (تجاوز فعلي لم يعد يجب أن يحدث بعد إغلاق كل نقاط الدخول القديمة).
    if (!ownNeeds.length) {
      report('critical', 'BENEFICIARY_WITHOUT_ANY_NEED', 'مستفيد بلا أي صف احتياج في ورقة "احتياجات المستفيدين" — خارج دورة الاعتماد الجديدة (يشمل حالة "تحت المراجعة")', {beneficiaryId: beneficiaryId, reviewStatus: reviewStatus});
      // مؤشر إضافي محدَّد: يتكئ فعليًا على الحقل النصي القديم وحده كمصدر
      // للاحتياج (استيراد قبل Phase 2.3، أو تجاوز آخر خارج هذا النظام).
      if (String(row['الاحتياج'] || '').trim()) {
        report('warning', 'LEGACY_TEXT_NEED_ONLY', 'مستفيد يتكئ على الحقل النصي القديم "الاحتياج" فقط بلا أي صف احتياج منظَّم', {beneficiaryId: beneficiaryId});
      }
    }

    if (reviewStatus === 'معتمد') {
      const hasApprovedNeed = ownNeeds.some(n => String(n['حالة القرار']) === 'معتمد');
      if (!hasApprovedNeed) {
        report('critical', 'APPROVED_BENEFICIARY_WITHOUT_APPROVED_NEED', 'مستفيد معتمد بلا أي احتياج معتمد', {beneficiaryId: beneficiaryId});
      }
    }

    // مندوب مُسنَد فعليًا لمستفيد غير معتمد، أو معتمد لكن احتياجاته غير
    // جاهزة بالكامل — لا يجب أن يحدث بعد تشديد assignDelegate، لكن يبقى
    // فحصًا تشخيصيًا لأي بيانات قديمة/يدوية سابقة على هذا التعديل.
    if (String(row['رقم المندوب'] || '').trim()) {
      if (reviewStatus !== 'معتمد') {
        report('critical', 'DELEGATE_ASSIGNED_UNAPPROVED_BENEFICIARY', 'مندوب مُسنَد لمستفيد غير معتمد', {beneficiaryId: beneficiaryId, reviewStatus: reviewStatus});
      } else {
        const approvedNeeds = ownNeeds.filter(n => String(n['حالة القرار']) === 'معتمد');
        const notReady = approvedNeeds.some(n => ['استحقاق معتمد', 'بانتظار توفر الجهاز'].indexOf(String(n['حالة التنفيذ'])) !== -1);
        if (approvedNeeds.length && notReady) {
          report('critical', 'DELEGATE_ASSIGNED_NEEDS_NOT_READY', 'مندوب مُسنَد لمستفيد لم تُجهَّز جميع احتياجاته المعتمدة بعد', {beneficiaryId: beneficiaryId});
        }
      }
    }
  });

  // ---- Phase 2.2: سلامة ربط الجهاز المادي برقم الاحتياج (عمود "رقم
  // الاحتياج" في ورقة "الأجهزة" — قد لا يكون موجودًا بعد على الشيت الحي،
  // فالفحص هنا يعمل بأمان (يتجاهل الفحوص إن كان العمود غائبًا تمامًا). ----
  const needByIdForDevices = {};
  needs.forEach(row => { needByIdForDevices[String(row['رقم الاحتياج'])] = row; });
  const linkedNeedIdCounts = {};
  let devicesHaveNeedColumn = false;
  const devices = readTable_(APP.sheets.devices).rows;
  if (devices.length && Object.prototype.hasOwnProperty.call(devices[0], 'رقم الاحتياج')) devicesHaveNeedColumn = true;

  if (devicesHaveNeedColumn) {
    devices.forEach(row => {
      const deviceId = String(row['رقم الجهاز']);
      const linkedNeedId = String(row['رقم الاحتياج'] || '').trim();
      const status = String(row['حالة الجهاز']);
      if (!linkedNeedId) {
        if (status === 'مخصص' || status === 'مع المندوب') {
          const hasBeneficiary = !!String(row['رقم المستفيد'] || '').trim();
          if (hasBeneficiary) {
            report('warning', 'ALLOCATED_DEVICE_WITHOUT_NEED_LINK', 'جهاز مخصص أو مع مندوب مرتبط بمستفيد بلا رقم احتياج ضمن النموذج الجديد (قد يكون من المسار القديم قبل هذا التعديل)', {deviceId: deviceId});
          }
        }
        return;
      }
      linkedNeedIdCounts[linkedNeedId] = (linkedNeedIdCounts[linkedNeedId] || 0) + 1;
      const need = needByIdForDevices[linkedNeedId];
      if (!need) {
        report('critical', 'DEVICE_LINKED_TO_MISSING_NEED', 'جهاز يحمل رقم احتياج غير موجود', {deviceId: deviceId, needId: linkedNeedId});
        return;
      }
      if (String(row['النوع']) !== String(need['نوع الجهاز'])) {
        report('critical', 'DEVICE_NEED_TYPE_MISMATCH', 'نوع الجهاز لا يطابق نوع الاحتياج المرتبط به', {deviceId: deviceId, needId: linkedNeedId, deviceType: row['النوع'], needType: need['نوع الجهاز']});
      }
      if (String(row['رقم المستفيد'] || '') !== String(need['رقم المستفيد'])) {
        report('critical', 'DEVICE_NEED_BENEFICIARY_MISMATCH', 'المستفيد المرتبط بالجهاز لا يطابق مستفيد الاحتياج', {deviceId: deviceId, needId: linkedNeedId});
      }
      if (String(row['رقم الجمعية'] || '') !== String(need['رقم الجمعية'])) {
        report('critical', 'DEVICE_NEED_ASSOCIATION_MISMATCH', 'جمعية الجهاز لا تطابق جمعية الاحتياج المرتبط به', {deviceId: deviceId, needId: linkedNeedId});
      }
    });
    Object.keys(linkedNeedIdCounts).forEach(needId => {
      if (linkedNeedIdCounts[needId] > 1) {
        report('critical', 'NEED_LINKED_TO_MULTIPLE_DEVICES', 'أكثر من جهاز واحد مرتبط بنفس رقم الاحتياج', {needId: needId, deviceCount: linkedNeedIdCounts[needId]});
      }
    });
    needs.forEach(row => {
      const fulfillmentStatus = String(row['حالة التنفيذ']);
      const advancedStatuses = ['جهاز جاهز', 'بانتظار تعيين مندوب', 'معيّن للمندوب — بانتظار التنفيذ', 'خرج مع المندوب', 'تم التسليم'];
      if (advancedStatuses.indexOf(fulfillmentStatus) !== -1 && !linkedNeedIdCounts[String(row['رقم الاحتياج'])]) {
        report('critical', 'ADVANCED_FULFILLMENT_WITHOUT_DEVICE_LINK', 'احتياج بحالة تنفيذ متقدمة (' + fulfillmentStatus + ') بلا جهاز مادي مرتبط به', {needId: String(row['رقم الاحتياج'])});
      }
    });
  }

  return {
    ok: true, sheetExists: true, issueCount: issues.length,
    criticalCount: issues.filter(i => i.severity === 'critical').length,
    warningCount: issues.filter(i => i.severity === 'warning').length,
    issues: issues
  };
}
