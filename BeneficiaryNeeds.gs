// -------------------- دورة اعتماد المستفيد والاحتياج (Phase 2 — خادميًا فقط) --------------------
//
// هذا الملف يطبّق منطق الخادم لدورة الاعتماد المعتمدة: الجمعية تسجّل
// احتياجات المستفيد (نوع جهاز واحد لكل صف)، ADMIN يقبل أو يرفض المستفيد
// ويقرر كل احتياج على حدة في عملية واحدة مترابطة، والاعتماد ينشئ فورًا
// "استحقاقًا معتمدًا" بلا أي خطوة تخصيص يدوية ثانية.
//
// مصدر الحقيقة بعد هذا الملف:
// - قرار مراجعة المستفيد نفسه: عمود "حالة مراجعة المستفيد" الجديد في
//   ورقة "المستفيدون" (BENEFICIARY_REVIEW_STATUSES من StateRules.gs).
//   العمود القديم "حالة المستفيد" (BENEFICIARY_STATUSES) **يبقى للتوافق
//   التاريخي فقط** — هذا الملف لا يقرأه ولا يكتبه إطلاقًا؛ أي شاشة قديمة
//   تعرضه تستمر بالعمل كما كانت دون أن تتعارض قيمته مع القرار الجديد.
// - قرار/تنفيذ كل احتياج: ورقة "احتياجات المستفيدين" الجديدة بالكامل —
//   لا مصدر حقيقة موازٍ آخر. العمود القديم "الاحتياج" (نص حر مفصول
//   بفواصل، NormalizeNeeds_) **يبقى للقراءة التاريخية فقط** ولا يُكتب
//   من أي دالة هنا؛ لا يوجد أي محاولة لاشتقاق حالة من نصه.
// - لا يوجد أي احتمال لاختلاف الحالة بين الجدولين لأن أحدهما (القديم)
//   لم يعد يُكتب إطلاقًا من مسار الاعتماد الجديد — القراءة فقط تحدث منه،
//   والكتابة الوحيدة لحالة الاعتماد تذهب حصرًا لورقة "احتياجات المستفيدين".
//
// ⚠️ لا شيء في هذا الملف يعمل على أي بيانات حية بعد: ورقة "احتياجات
// المستفيدين" وأعمدة "المستفيدون" الأربعة الجديدة غير موجودة على الشيت
// الحي حتى يُشغَّل applyReleaseSchema_ يدويًا (schemaVersion 5) من
// خارج هذه الجلسة. أي استدعاء لدوال هذا الملف على مشروع لم يُطبَّق عليه
// المخطط الجديد سيفشل بخطأ "الورقة غير موجودة" من sheet_() — وهذا سلوك
// آمن ومتوقَّع، لا عطل صامت.

/**
 * تسجّل/تُزامن احتياجات مستفيد (نوع جهاز واحد لكل صف). تُستدعى من
 * الجمعية عند تسجيل المستفيد أو تعديل احتياجاته **قبل** قرار ADMIN فقط.
 * idempotent بطبيعتها: استدعاؤها مرتين بنفس القائمة لا يُنشئ صفوفًا
 * مكرَّرة (تحدّث الموجود، تضيف الناقص، ولا تحذف احتياجًا موجودًا وارد
 * ضمن deviceTypes نفسها — إن أراد المستخدم إزالة احتياج يُستخدم مسار
 * صريح منفصل لاحقًا، لا حذف صامت هنا).
 */
function setBeneficiaryNeeds(token, beneficiaryId, deviceTypes) {
  return perfTime_('setBeneficiaryNeeds', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    return setBeneficiaryNeeds_(user, beneficiaryId, deviceTypes);
  });
}

function setBeneficiaryNeeds_(user, beneficiaryId, deviceTypes) {
  beneficiaryId = cleanId_(beneficiaryId);
  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
  if (!beneficiary) throw new Error('المستفيد غير موجود');
  if (user.role === 'ASSOCIATION' && String(beneficiary['رقم الجمعية']) !== user.associationId) {
    throw new Error('ليس لديك صلاحية على هذا المستفيد');
  }
  const reviewStatus = String(beneficiary['حالة مراجعة المستفيد'] || '');
  if (reviewStatus === 'معتمد' || reviewStatus === 'مرفوض') {
    throw new Error('تم اتخاذ قرار مراجعة نهائي لهذا المستفيد، ولا يمكن تعديل احتياجاته بعد ذلك');
  }
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
    invalidateTableCache_(APP.sheets.beneficiaryNeeds);
    const existingNeeds = readTable_(APP.sheets.beneficiaryNeeds).rows
      .filter(row => String(row['رقم المستفيد']) === beneficiaryId);
    const existingByType = {};
    existingNeeds.forEach(row => { existingByType[String(row['نوع الجهاز'])] = row; });

    const toCreate = uniqueTypes.filter(t => !existingByType[t]);
    if (toCreate.length) {
      const ids = nextIds_('NEED', toCreate.length);
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
        'تاريخ الإنشاء': now_(),
        'آخر تحديث': now_()
      }));
      appendObjects_(APP.sheets.beneficiaryNeeds, rows);
    }
    // إن كانت حالة المراجعة "معتمد"/"مرفوض" اكتُشف أعلاه ورُفض الاستدعاء
    // كله قبل الوصول هنا؛ أي مستفيد وصل لهذه النقطة إما بلا قرار سابق
    // (فارغ) أو "تحت المراجعة" — نضمن أنه "تحت المراجعة" الآن بوجود
    // احتياج واحد على الأقل مسجَّل.
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

/** كل صفوف احتياج مستفيد معيّن، مطبَّعة لعرض الواجهة لاحقًا. */
function beneficiaryNeeds_(beneficiaryId) {
  beneficiaryId = cleanId_(beneficiaryId);
  return readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(row => String(row['رقم المستفيد']) === beneficiaryId)
    .map(normalizeNeedRow_);
}

function normalizeNeedRow_(row) {
  return {
    id: String(row['رقم الاحتياج']),
    beneficiaryId: String(row['رقم المستفيد']),
    associationId: String(row['رقم الجمعية']),
    deviceType: String(row['نوع الجهاز']),
    decisionStatus: String(row['حالة القرار'] || ''),
    rejectReason: String(row['سبب الرفض'] || ''),
    reviewedBy: String(row['المراجع'] || ''),
    decidedAt: String(row['تاريخ القرار'] || ''),
    fulfillmentStatus: String(row['حالة التنفيذ'] || ''),
    createdAt: String(row['تاريخ الإنشاء'] || ''),
    updatedAt: String(row['آخر تحديث'] || '')
  };
}

/**
 * قرار ADMIN المترابط: مراجعة المستفيد نفسه + قرار كل احتياج معًا في
 * عملية واحدة (كل شيء أو لا شيء) — التوصيف الدقيق:
 *
 * payload = {
 *   beneficiaryDecision: 'معتمد' | 'مرفوض',
 *   beneficiaryRejectReason: نص (إلزامي إذا كان القرار "مرفوض"),
 *   needDecisions: [{needId, decision: 'معتمد'|'مرفوض', rejectReason}],
 *   opId: نص اختياري لمنع التنفيذ المزدوج (idempotency)
 * }
 *
 * قواعد صارمة مطبَّقة هنا:
 * - لا يصبح المستفيد معتمدًا إذا فشلت كتابة أي احتياج (العملية كلها
 *   تُحسب/تُتحقَّق أولًا، ثم تُكتب معًا داخل نفس القفل — لا كتابة جزئية).
 * - رفض المستفيد يرفض تلقائيًا كل احتياجاته المعلَّقة (لا يمكن أن ينشأ
 *   احتياج معتمد لمستفيد مرفوض) — أي قرار "معتمد" وارد في needDecisions
 *   حين يكون قرار المستفيد "مرفوض" يُستبدَل قسرًا بـ"مرفوض".
 * - قبول المستفيد نهائيًا يتطلب احتياجًا معتمدًا واحدًا على الأقل ضمن
 *   needDecisions المُرسَلة بهذا الاستدعاء (لا ضمن احتياجات سابقة معتمدة
 *   من استدعاء آخر — القرار النهائي لمرة واحدة فقط لكل مستفيد أصلًا).
 * - كل احتياج مرفوض يتطلّب سبب رفض غير فارغ.
 * - كل احتياج مذكور في needDecisions يجب أن يخص هذا المستفيد بالذات
 *   وأن تكون حالته الحالية "بانتظار المراجعة" فعلًا (لا إعادة قرار).
 * - اعتماد الاحتياج ينقله فورًا لحالة تنفيذ "استحقاق معتمد" — هذه هي
 *   نقطة "التسجيل التلقائي للاستحقاق"، لا خطوة منفصلة بعدها.
 */
function reviewBeneficiaryNeeds(token, beneficiaryId, payload) {
  return perfTime_('reviewBeneficiaryNeeds', () => {
    const user = requireSession_(token, ['ADMIN']);
    payload = payload || {};
    return withIdempotency_(user.id, payload.opId, () => reviewBeneficiaryNeeds_(user, beneficiaryId, payload));
  });
}

function reviewBeneficiaryNeeds_(user, beneficiaryId, payload) {
  beneficiaryId = cleanId_(beneficiaryId);
  const beneficiaryDecision = String(payload.beneficiaryDecision || '');
  if (['معتمد', 'مرفوض'].indexOf(beneficiaryDecision) === -1) {
    throw new Error('قرار المستفيد يجب أن يكون "معتمد" أو "مرفوض"');
  }
  const beneficiaryRejectReason = requiredIfRejected_(beneficiaryDecision, payload.beneficiaryRejectReason, 'سبب رفض المستفيد');
  const requestedDecisions = Array.isArray(payload.needDecisions) ? payload.needDecisions : [];

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
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

    // تُبنى قائمة القرارات الفعلية أولًا بالكامل (تحقق تام) قبل أي كتابة —
    // "كل شيء أو لا شيء" حرفيًا: أول خطأ يوقف العملية دون تعديل أي صف.
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
      // رفض المستفيد يفرض رفض كل احتياجاته المعلَّقة، بصرف النظر عمّا
      // أُرسل — لا يمكن أن ينشأ احتياج معتمد لمستفيد مرفوض إطلاقًا.
      let decision = beneficiaryDecision === 'مرفوض' ? 'مرفوض' : String((entry && entry.decision) || '');
      if (['معتمد', 'مرفوض'].indexOf(decision) === -1) {
        throw new Error('قرار الاحتياج (' + row['نوع الجهاز'] + ') يجب أن يكون "معتمد" أو "مرفوض"');
      }
      assertNeedDecisionTransition_(String(row['حالة القرار']), decision);
      const rejectReason = requiredIfRejected_(decision, entry && entry.rejectReason, 'سبب رفض الاحتياج (' + row['نوع الجهاز'] + ')');
      resolvedDecisions.push({row: row, decision: decision, rejectReason: rejectReason});
    });

    // أي احتياج معلَّق لم يُذكر في الطلب: إن رُفض المستفيد يُرفض تلقائيًا
    // معه (لا يبقى معلَّقًا لمستفيد محسوم أمره)؛ إن اعتُمد المستفيد يجب أن
    // يُذكر كل احتياج معلَّق صراحة — طلب ناقص يُرفض بوضوح بدل تجاهل صامت.
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

    // الكتابة الفعلية — كل شيء تحقَّق أعلاه قبل الوصول هنا.
    const nowStamp = now_();
    updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
      'حالة مراجعة المستفيد': beneficiaryDecision,
      'سبب رفض المستفيد': beneficiaryRejectReason,
      'مراجع اعتماد المستفيد': user.name,
      'تاريخ مراجعة المستفيد': nowStamp
    });
    resolvedDecisions.forEach(item => {
      updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', String(item.row['رقم الاحتياج']), {
        'حالة القرار': item.decision,
        'سبب الرفض': item.rejectReason,
        'المراجع': user.name,
        'تاريخ القرار': nowStamp,
        'حالة التنفيذ': item.decision === 'معتمد' ? 'استحقاق معتمد' : '',
        'آخر تحديث': nowStamp
      });
    });

    clearDashboardCache();
    const approvedCount = resolvedDecisions.filter(d => d.decision === 'معتمد').length;
    const rejectedCount = resolvedDecisions.length - approvedCount;
    audit_(user, 'مراجعة مستفيد واحتياجاته', 'المستفيدون', beneficiaryId,
      'قرار المستفيد: ' + beneficiaryDecision + ' — احتياجات معتمدة: ' + approvedCount + '، مرفوضة: ' + rejectedCount);

    return {
      ok: true,
      beneficiaryId: beneficiaryId,
      beneficiaryDecision: beneficiaryDecision,
      approvedCount: approvedCount,
      rejectedCount: rejectedCount,
      needs: beneficiaryNeeds_(beneficiaryId)
    };
  } finally {
    lock.releaseLock();
  }
}

function requiredIfRejected_(decision, reason, label) {
  const clean = cleanText_(reason, 500);
  if (decision === 'مرفوض' && !clean) throw new Error(label + ' إلزامي عند الرفض');
  return clean;
}

/**
 * تجميع الكميات حسب نوع الجهاز: المطلوب (كل الاحتياجات المسجَّلة بصرف
 * النظر عن قرارها)، المعتمد (قرار "معتمد" بصرف النظر عن حالة تنفيذه)،
 * المتوفر فعليًا (من ورقة "الأجهزة" — بالمستودع أو مخصص أو مع المندوب
 * أو تم التسليم، أي جهاز فعلي موجود من هذا النوع بصرف النظر عن ربطه)،
 * والعجز (المعتمد ناقص المتوفر، لا يقل عن صفر). associationId اختياري
 * لتضييق النطاق لجمعية واحدة (عزل الجمعيات) — بلا تمرير قيمة يُحسب على
 * مستوى المشروع كله (لاستخدام ADMIN فقط، لا تُستدعى بلا هذا القيد من
 * أي مسار يخص الجمعية).
 */
function needsSummaryByDeviceType_(associationId) {
  const needs = readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(row => !associationId || String(row['رقم الجمعية']) === associationId);
  const devices = readTable_(APP.sheets.devices).rows
    .filter(row => !associationId || String(row['رقم الجمعية']) === associationId);

  const summary = {};
  NEW_NEED_DEVICE_TYPES.forEach(type => {
    summary[type] = {requested: 0, approved: 0, rejected: 0, available: 0, shortage: 0};
  });
  needs.forEach(row => {
    const type = String(row['نوع الجهاز']);
    if (!summary[type]) summary[type] = {requested: 0, approved: 0, rejected: 0, available: 0, shortage: 0};
    summary[type].requested++;
    if (String(row['حالة القرار']) === 'معتمد') summary[type].approved++;
    else if (String(row['حالة القرار']) === 'مرفوض') summary[type].rejected++;
  });
  devices.forEach(row => {
    const type = String(row['النوع']);
    if (!summary[type]) return; // نوع جهاز خارج القائمة الثلاثة الجديدة — لا يدخل تجميع الاحتياجات الجديدة
    summary[type].available++;
  });
  Object.keys(summary).forEach(type => {
    summary[type].shortage = Math.max(0, summary[type].approved - summary[type].available);
  });
  return summary;
}
