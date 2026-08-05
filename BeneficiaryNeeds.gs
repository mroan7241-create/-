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
 * تسجّل/تُزامن احتياجات مستفيد (نوع جهاز واحد لكل صف). idempotent
 * بطبيعتها: استدعاؤها مرتين بنفس القائمة لا يُنشئ صفوفًا مكرَّرة (تضيف
 * الناقص فقط، ولا تحذف احتياجًا موجودًا وارد ضمن deviceTypes نفسها —
 * لإزالة احتياج معلَّق صراحة استخدم removePendingBeneficiaryNeed أدناه).
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
  const types = Array.isArray(deviceTypes) ? deviceTypes : [];
  const uniqueTypes = [];
  types.forEach(t => {
    const clean = String(t || '').trim();
    if (!clean) return;
    if (NEW_NEED_DEVICE_TYPES.indexOf(clean) === -1) {
      throw new Error('نوع جهاز غير مسموح به في احتياج جديد: «' + clean + '» — الأنواع المتاحة: ' + NEW_NEED_DEVICE_TYPES.join('، '));
    }
    if (uniqueTypes.indexOf(clean) === -1) uniqueTypes.push(clean);
  });
  if (!uniqueTypes.length) throw new Error('اختر احتياجًا واحدًا على الأقل');

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
 */
function removePendingBeneficiaryNeed(token, needId) {
  return perfTime_('removePendingBeneficiaryNeed', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    return removePendingBeneficiaryNeed_(user, needId);
  });
}

function removePendingBeneficiaryNeed_(user, needId) {
  needId = cleanId_(needId);
  if (!needId) throw new Error('رقم احتياج غير صالح');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    invalidateTableCache_(APP.sheets.beneficiaryNeeds);
    const row = findById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', needId);
    if (!row) throw new Error('الاحتياج غير موجود');
    if (user.role === 'ASSOCIATION' && String(row['رقم الجمعية']) !== user.associationId) {
      throw new Error('ليس لديك صلاحية على هذا الاحتياج');
    }
    if (String(row['حالة القرار']) !== 'بانتظار المراجعة') {
      throw new Error('لا يمكن إزالة احتياج سبق البتّ فيه (الحالة الحالية: ' + row['حالة القرار'] + ')');
    }
    const beneficiaryId = String(row['رقم المستفيد']);
    const remainingCount = readTable_(APP.sheets.beneficiaryNeeds).rows
      .filter(r => String(r['رقم المستفيد']) === beneficiaryId && String(r['رقم الاحتياج']) !== needId).length;
    if (!remainingCount) {
      throw new Error('لا يمكن ترك المستفيد بلا أي احتياج — أضف احتياجًا بديلًا أولًا إن أردت إزالة هذا');
    }
    deleteRowById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', needId);
    audit_(user, 'إزالة احتياج قبل المراجعة', 'احتياجات المستفيدين', needId, row['نوع الجهاز'] + ' — للمستفيد ' + beneficiaryId);
    return {ok: true, beneficiaryId: beneficiaryId, needs: beneficiaryNeeds_(beneficiaryId)};
  } finally {
    lock.releaseLock();
  }
}

/**
 * مسار موحَّد: حفظ بيانات المستفيد + تسجيل احتياجاته الجديدة كعملية
 * واحدة مترابطة — بدل استدعاء saveBeneficiary ثم setBeneficiaryNeeds
 * كعمليتين منفصلتين قد تنجح إحداهما وتفشل الأخرى بصمت. payload يحمل كل
 * حقول saveBeneficiary المعتادة + deviceTypes (مصفوفة من NEW_NEED_
 * DEVICE_TYPES). لا تُمرَّر deviceTypes إلى الحقل النصي القديم "الاحتياج"
 * إطلاقًا (انظر توثيق مصدر الحقيقة أعلى الملف).
 *
 * ⚠️ لا حذف فعلي لأي سجل مستفيد إطلاقًا — مبدأ ثابت في هذا النظام (لا
 * حذف صف فعلي يمس ورقة "المستفيدون" في أي مسار؛ راجع الاختبار الأمني
 * المخصص لهذا في tools/security-test.js). لذلك:
 * - أنواع الاحتياج (deviceTypes) تُتحقَّق من صيغتها **قبل** إنشاء أي
 *   سجل مستفيد على الإطلاق — خطأ نوع غير مسموح به (مثال: "مكيف") يُرفض
 *   فورًا دون أن يُكتب أي شيء أصلًا، فلا ينشأ سجل يتيم من الأساس بدل
 *   الاعتماد على حذف تعويضي بعدي لسجل مستفيد حقيقي يحمل بيانات شخصية.
 * - أي فشل آخر يحدث لاحقًا (نادر — مثال: خطأ كتابة فعلي أثناء تسجيل
 *   الاحتياجات) لا يُلغي المستفيد المُنشأ فعليًا: بياناته صحيحة ومحفوظة،
 *   فقط بلا احتياجات مسجَّلة بعد (لا "حالة مراجعة" أيضًا، فيبقى غير داخل
 *   أي دورة اعتماد حتى تُستكمَل الاحتياجات). الخطأ المُعاد **ليس صامتًا**:
 *   يسمّي رقم المستفيد صراحة ويوضح أن استدعاء setBeneficiaryNeeds لاحقًا
 *   بنفس الرقم يكمل العملية بأمان دون إعادة إدخال بيانات المستفيد.
 */
function saveBeneficiaryWithNeeds(token, payload) {
  return perfTime_('saveBeneficiaryWithNeeds', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    return saveBeneficiaryWithNeeds_(user, payload || {});
  });
}

function saveBeneficiaryWithNeeds_(user, payload) {
  const deviceTypes = Array.isArray(payload.deviceTypes) ? payload.deviceTypes : [];
  const uniqueTypes = [];
  deviceTypes.forEach(t => {
    const clean = String(t || '').trim();
    if (!clean) return;
    if (NEW_NEED_DEVICE_TYPES.indexOf(clean) === -1) {
      throw new Error('نوع جهاز غير مسموح به في احتياج جديد: «' + clean + '» — الأنواع المتاحة: ' + NEW_NEED_DEVICE_TYPES.join('، '));
    }
    if (uniqueTypes.indexOf(clean) === -1) uniqueTypes.push(clean);
  });

  const beneficiaryPayload = Object.assign({}, payload, {needs: []});
  const beneficiaryResult = saveBeneficiary_(user, beneficiaryPayload);
  if (!uniqueTypes.length) return Object.assign({needs: []}, beneficiaryResult);

  try {
    const needsResult = setBeneficiaryNeeds_(user, beneficiaryResult.id, uniqueTypes);
    return Object.assign({}, beneficiaryResult, {needs: needsResult.needs});
  } catch (error) {
    throw new Error('حُفظت بيانات المستفيد (رقم ' + beneficiaryResult.id + ') بنجاح، لكن تعذّر تسجيل احتياجاته: ' + error.message
      + ' — أعد استدعاء تسجيل الاحتياجات لهذا الرقم لإكمال العملية؛ لا حاجة لإعادة إدخال بيانات المستفيد.');
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
    return runLockedIdempotent_(user.id, payload.opId, () => reviewBeneficiaryNeeds_(user, beneficiaryId, payload));
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
  const beneficiarySnapshot = {
    'حالة مراجعة المستفيد': String(beneficiary['حالة مراجعة المستفيد'] || ''),
    'سبب رفض المستفيد': String(beneficiary['سبب رفض المستفيد'] || ''),
    'مراجع اعتماد المستفيد': String(beneficiary['مراجع اعتماد المستفيد'] || ''),
    'تاريخ مراجعة المستفيد': String(beneficiary['تاريخ مراجعة المستفيد'] || '')
  };
  const needSnapshots = {};
  resolvedDecisions.forEach(item => {
    const id = String(item.row['رقم الاحتياج']);
    needSnapshots[id] = {
      'حالة القرار': String(item.row['حالة القرار'] || ''),
      'سبب الرفض': String(item.row['سبب الرفض'] || ''),
      'المراجع': String(item.row['المراجع'] || ''),
      'تاريخ القرار': String(item.row['تاريخ القرار'] || ''),
      'حالة التنفيذ': String(item.row['حالة التنفيذ'] || ''),
      'آخر تحديث': String(item.row['آخر تحديث'] || '')
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
    let rollbackOk = true;
    try {
      if (written.indexOf('beneficiary') !== -1) {
        updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, beneficiarySnapshot);
      }
      written.forEach(id => {
        if (id === 'beneficiary') return;
        updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', id, needSnapshots[id]);
      });
    } catch (rollbackError) {
      Logger.log('حرج جدًا: فشل التراجع التعويضي بعد خطأ كتابة في reviewBeneficiaryNeeds_ — traceId=' + requestMeta_().traceId
        + ' beneficiaryId=' + beneficiaryId + ' — خطأ الكتابة الأصلي: ' + writeError.message + ' — خطأ التراجع: ' + rollbackError.message);
      rollbackOk = false;
    }
    clearDashboardCache();
    throw new Error('تعذّر إتمام قرار المراجعة (traceId: ' + requestMeta_().traceId + ')'
      + (rollbackOk ? ' — أُعيدت كل السجلات المتأثرة لحالتها السابقة تلقائيًا.' : ' — تعذّر التراجع التلقائي أيضًا، يتطلب مراجعة يدوية فورية لسجل المستفيد ' + beneficiaryId + '.'));
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
function needsSummaryByDeviceType_(associationId) {
  const needs = readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(row => !associationId || String(row['رقم الجمعية']) === associationId);
  const devices = readTable_(APP.sheets.devices).rows
    .filter(row => !associationId || String(row['رقم الجمعية']) === associationId);

  function blankBucket() {
    return {
      requestedTotal: 0, approvedTotal: 0, rejectedTotal: 0, deliveredTotal: 0,
      outstandingApproved: 0, physicalAvailable: 0, readyOrAllocated: 0, shortage: 0
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

  devices.forEach(row => {
    const type = String(row['النوع']);
    if (!summary[type]) return; // نوع خارج القائمة الثلاثة الجديدة — لا يدخل هذا التجميع
    const status = String(row['حالة الجهاز']);
    const linkedToBeneficiary = !!String(row['رقم المستفيد'] || '').trim();
    if (status === 'بالمستودع' && !linkedToBeneficiary) {
      summary[type].physicalAvailable++;
    } else if (linkedToBeneficiary && (status === 'مخصص' || status === 'مع المندوب')) {
      summary[type].readyOrAllocated++;
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

  beneficiaries.forEach(row => {
    if (String(row['حالة مراجعة المستفيد']) !== 'معتمد') return;
    const beneficiaryId = String(row['رقم المستفيد']);
    const hasApprovedNeed = needs.some(n => String(n['رقم المستفيد']) === beneficiaryId && String(n['حالة القرار']) === 'معتمد');
    if (!hasApprovedNeed) {
      report('critical', 'APPROVED_BENEFICIARY_WITHOUT_APPROVED_NEED', 'مستفيد معتمد بلا أي احتياج معتمد', {beneficiaryId: beneficiaryId});
    }
  });

  return {
    ok: true, sheetExists: true, issueCount: issues.length,
    criticalCount: issues.filter(i => i.severity === 'critical').length,
    warningCount: issues.filter(i => i.severity === 'warning').length,
    issues: issues
  };
}
