// -------------------- الأجهزة والجمعيات --------------------

// حالتا "مع المندوب" و"تم التسليم" لا تُضبَطان يدويًا من هذا النموذج
// إطلاقًا — لا تصلان إلا عبر assignDelegate وconfirmDelivery، حتى لا
// ينكسر الترابط بتعديل مستقل من صفحة الأجهزة (راجع StateRules.gs).
const DEVICE_MANUAL_STATUSES_ = Object.freeze(['بالمستودع', 'مخصص', 'تالف']);

/** قائمة أجهزة مُرقَّمة — عزل الجمعيات مفروض قبل أي بحث أو ترقيم. */
function listDevices(token, options) {
  return perfTime_('listDevices', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    return withMeta_(listDevices_(user, options));
  });
}

function listDevices_(user, options) {
  options = options || {};
  let rows = readTable_(APP.sheets.devices).rows;
  if (user.role === 'ASSOCIATION') rows = rows.filter(row => String(row['رقم الجمعية']) === user.associationId);
  else if (options.associationId) rows = rows.filter(row => String(row['رقم الجمعية']) === cleanId_(options.associationId));
  let items = rows.map(normalizeDevice_);
  items = applySearch_(items, options.search, ['name', 'id', 'type', 'beneficiaryId']);
  if (options.filter) items = items.filter(item => item.status === options.filter);
  items = applySort_(items, options.sortBy, options.sortDir);
  return Object.assign({ok: true}, paginate_(items, options));
}

/** قائمة جمعيات مُرقَّمة (ADMIN فقط — الجمعية ترى بياناتها الخاصة فقط عبر association في Bootstrap). */
function listAssociations(token, options) {
  return perfTime_('listAssociations', () => {
    const user = requireSession_(token, ['ADMIN']);
    return withMeta_(listAssociations_(user, options));
  });
}

function listAssociations_(user, options) {
  options = options || {};
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  const devices = readTable_(APP.sheets.devices).rows;
  const delegates = readTable_(APP.sheets.delegates).rows;
  let items = readTable_(APP.sheets.associations).rows.map(row => normalizeAssociation_(row, beneficiaries, devices, delegates));
  items = applySearch_(items, options.search, ['name', 'id', 'email', 'phone', 'region', 'city']);
  if (options.filter) items = items.filter(item => item.status === options.filter);
  items = applySort_(items, options.sortBy, options.sortDir);
  return Object.assign({ok: true}, paginate_(items, options));
}

/**
 * Phase 2.3 (القسم 2) + Phase 2.3.1 (تصليب): saveDevice لم يعد يستطيع
 * ربط جهاز بمستفيد دون المرور بنموذج الاعتماد الجديد. جهاز بلا مستفيد
 * (مستودع) يبقى كما كان بلا أي شرط إضافي — لكن لا يمكنه أبدًا حمل حالة
 * "مخصص"/"مع المندوب"/"تم التسليم" (القسم 4: لا حالات يتيمة). جهاز في
 * عهدة فعلية ("مع المندوب"/"تم التسليم") محمي بالكامل من أي تعديل رابط
 * أو حالة عبر هذا المسار (القسم 5). الربط وفكّ الربط معاملتان مترابطتان
 * (جهاز + احتياج) بلقطة خام وتراجع best-effort (القسم 6)، وكل انتقال
 * لحالة تنفيذ الاحتياج يمرّ عبر assertNeedFulfillmentChain_ المركزية
 * (القسم 7). opId اختياري يمرّ عبر runLockedIdempotent_ (القسم 3).
 */
function saveDevice(token, payload) {
  return perfTime_('saveDevice', () => {
    const user = requireSession_(token, ['ADMIN']);
    payload = payload || {};
    const scopeId = payload.id ? cleanId_(payload.id) : 'new';
    return runLockedIdempotent_('saveDevice:' + scopeId, user.id, payload.opId, () => saveDevice_(user, payload));
  });
}

/**
 * ⚠️ تفترض أن المستدعي يُمسك ScriptLock فعلًا (عبر runLockedIdempotent_
 * في saveDevice أعلاه) — لا تُمسك أي قفل بنفسها ولا تُستدعى مباشرة من
 * أي مسار آخر.
 */
function saveDevice_(user, payload) {
  invalidateTableCache_(APP.sheets.devices);
  invalidateTableCache_(APP.sheets.beneficiaries);
  invalidateTableCache_(APP.sheets.beneficiaryNeeds);

  const isNew = !payload.id;
  const id = isNew ? nextIdsLocked_('DEV', 1)[0] : cleanId_(payload.id);
  const beneficiaryId = cleanId_(payload.beneficiaryId);

  const existing = isNew ? null : findById_(APP.sheets.devices, 'رقم الجهاز', id);
  if (!isNew && !existing) throw new Error('الجهاز غير موجود');

  const currentStatus = existing ? String(existing['حالة الجهاز']) : '';
  const currentBeneficiaryId = existing ? String(existing['رقم المستفيد'] || '') : '';
  const currentNeedId = existing ? String(existing['رقم الاحتياج'] || '') : '';
  const currentType = existing ? String(existing['النوع'] || '') : '';
  const currentAssociationId = existing ? String(existing['رقم الجمعية'] || '') : '';

  // Phase 2.3.1 (القسم 5): جهاز في عهدة فعلية — لا مسار وصفي هنا يمسّ
  // الربط أو الحالة إطلاقًا، مهما كانت القيم المُرسَلة. فقط اسم/ملاحظات.
  if (existing && ['مع المندوب', 'تم التسليم'].indexOf(currentStatus) !== -1) {
    return saveDeviceDescriptiveOnly_(user, id, existing, payload);
  }

  const type = validateDeviceType_(payload.type, currentType);

  // Phase 2.3.1 (القسم 7): جهاز مرتبط باحتياج تجاوزت حالة تنفيذه مرحلة
  // "جهاز جاهز" (أي عُيِّن له مندوب فعلًا أو أبعد) لا يمكن أن يُغيَّر
  // نوعه — حتى لو كانت حالة الجهاز نفسه ما زالت "مخصص" (assignDelegate
  // لا يُحرِّك حالة الجهاز). التراجع عن هذه المرحلة حصريًا عبر مسار
  // الاستلام/الإرجاع المستقل لاحقًا، لا عبر saveDevice.
  const linkedNeedRow = currentNeedId ? findById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', currentNeedId) : null;
  const linkedNeedFulfillment = linkedNeedRow ? String(linkedNeedRow['حالة التنفيذ']) : '';
  const custodyStarted = ['معيّن للمندوب — بانتظار التنفيذ', 'خرج مع المندوب', 'مؤجل', 'بانتظار تأكيد الإرجاع', 'أعيد للجمعية/المستودع', 'تم التسليم'].indexOf(linkedNeedFulfillment) !== -1;

  if (currentNeedId && type !== currentType) {
    if (custodyStarted) {
      throw new Error('«هذا الاحتياج عُيِّن له مندوب بالفعل؛ لا يمكن تغيير نوع الجهاز المرتبط إلا عبر مسار الاستلام/الإرجاع المستقل.»');
    }
    throw new Error('هذا الجهاز مرتبط باستحقاق من نوع "' + currentType + '"؛ أعده إلى المستودع أولًا (يُفكّ الربط تلقائيًا) قبل تغيير نوعه');
  }

  let associationId = cleanId_(payload.associationId);
  let status;
  let finalBeneficiaryId;
  let finalNeedId;

  if (!beneficiaryId) {
    // ------- بلا مستفيد: جهاز مستودع جديد، أو إرجاع/تحرير جهاز -------
    if (associationId && !findById_(APP.sheets.associations, 'رقم الجمعية', associationId)) {
      throw new Error('اختر جمعية صحيحة');
    }
    if (!associationId) associationId = currentAssociationId; // الحفاظ على الجمعية الحالية افتراضيًا (القسم 4)
    finalBeneficiaryId = '';
    finalNeedId = '';

    if (currentNeedId && custodyStarted) {
      throw new Error('«هذا الاحتياج عُيِّن له مندوب بالفعل؛ لا يمكن فكّ ربط الجهاز المرتبط إلا عبر مسار الاستلام/الإرجاع المستقل.»');
    }

    status = payload.status;
    if (status === currentStatus && ['بالمستودع', 'تالف'].indexOf(currentStatus) !== -1) {
      // لا تغيير فعلي، وحالة سليمة أصلًا (تعديل بيانات وصفية فقط).
    } else {
      if (DEVICE_MANUAL_STATUSES_.indexOf(status) === -1) {
        if (DEVICE_STATUSES.indexOf(status) >= 0) {
          throw new Error('لا يمكن ضبط حالة "' + status + '" يدويًا؛ تُحدَّث فقط عبر تعيين المندوب أو تأكيد التسليم');
        }
        status = 'بالمستودع';
      }
      // Phase 2.3.1 (القسم 4): جهاز بلا مستفيد لا يمكن أن يكون "مخصص" —
      // حالة يتيمة محظورة صراحةً، جديدًا كان الجهاز أو مُحرَّرًا لتوّه.
      if (status === 'مخصص') {
        throw new Error('جهاز بلا مستفيد لا يمكن أن تكون حالته "مخصص" — اختر مستفيدًا لتخصيصه، أو اتركه "بالمستودع"');
      }
      assertDeviceTransition_(currentStatus, status);
    }

    const values = {
      'اسم الجهاز': requiredText_(payload.name, 'اسم الجهاز', 100),
      'النوع': type, 'رقم الجمعية': associationId,
      'رقم المستفيد': finalBeneficiaryId, 'رقم الاحتياج': finalNeedId,
      'حالة الجهاز': status, 'ملاحظات': cleanText_(payload.notes, 500)
    };

    if (currentBeneficiaryId && currentNeedId) {
      // إرجاع جهاز كان مرتبطًا: معاملة مترابطة (جهاز + احتياج) بتراجع
      // مشترك، وإعادة حالة تنفيذ الاحتياج عبر assertNeedFulfillmentChain_
      // (القسم 6+7) — لا كتابة مباشرة لـ"حالة التنفيذ" بعد الآن.
      return commitDeviceWithNeed_(user, {
        id: id, isNew: false, values: values, beneficiaryId: currentBeneficiaryId,
        primaryNeedId: currentNeedId, primaryTargetFulfillment: 'بانتظار توفر الجهاز',
        auditAction: 'تعديل جهاز', auditNotes: 'الحالة: ' + (currentStatus || '—') + ' ← ' + status + ' (إرجاع للمستودع، فكّ ربط الاحتياج ' + currentNeedId + ')'
      });
    }
    return commitDeviceWithNeed_(user, {
      id: id, isNew: isNew, values: values, beneficiaryId: '', primaryNeedId: null, primaryTargetFulfillment: null,
      auditAction: isNew ? 'إضافة جهاز' : 'تعديل جهاز',
      auditNotes: isNew ? 'الحالة الابتدائية: ' + status : 'الحالة: ' + (currentStatus || '—') + ' ← ' + status
    });
  }

  // ------- بمستفيد: تخصيص/ربط عبر نموذج الاحتياج المعتمد -------
  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
  if (!beneficiary) throw new Error('المستفيد المحدَّد غير موجود');
  associationId = String(beneficiary['رقم الجمعية']);

  if (currentBeneficiaryId && currentBeneficiaryId !== beneficiaryId
    && ['مخصص', 'مع المندوب', 'تم التسليم'].indexOf(currentStatus) >= 0) {
    throw new Error('هذا الجهاز مخصَّص لمستفيد آخر حاليًا؛ أعده إلى المستودع أولًا قبل تخصيصه لمستفيد جديد');
  }
  // "مع المندوب"/"تم التسليم" تبقيان محظورتين يدويًا من هذا النموذج
  // بصرف النظر عن مسار الربط — لا تُحدَّثان إلا عبر assignDelegate/confirmDelivery.
  if (payload.status && payload.status !== currentStatus
    && DEVICE_MANUAL_STATUSES_.indexOf(payload.status) === -1 && DEVICE_STATUSES.indexOf(payload.status) >= 0) {
    throw new Error('لا يمكن ضبط حالة "' + payload.status + '" يدويًا؛ تُحدَّث فقط عبر تعيين المندوب أو تأكيد التسليم');
  }

  const sameBeneficiaryHistorical = currentBeneficiaryId === beneficiaryId && currentBeneficiaryId && !currentNeedId;
  if (sameBeneficiaryHistorical) {
    // سجل تاريخي: مرتبط بالفعل بنفس المستفيد بلا رقم احتياج معتمد.
    // تعديل بيانات وصفية بلا تغيير الحالة يبقى مسموحًا لعدم كسر
    // القراءة/العرض؛ أي محاولة تغيير حالة فعلية (إعادة تخصيص/تقدّم)
    // تُرفض حتى يُربط الجهاز بالاستحقاق الصحيح أولًا (لا ربط تلقائي
    // مع وجود لبس محتمل في أي احتياج يُقصَد).
    if (payload.status && payload.status !== currentStatus) {
      throw new Error('«هذا الجهاز مرتبط بسجل تاريخي دون رقم احتياج معتمد. يلزم ربطه بالاستحقاق قبل متابعة التنفيذ.»');
    }
    const values = {
      'اسم الجهاز': requiredText_(payload.name, 'اسم الجهاز', 100),
      'النوع': type, 'رقم الجمعية': associationId,
      'رقم المستفيد': beneficiaryId, 'رقم الاحتياج': '',
      'حالة الجهاز': currentStatus, 'ملاحظات': cleanText_(payload.notes, 500)
    };
    return commitDeviceWithNeed_(user, {
      id: id, isNew: false, values: values, beneficiaryId: '', primaryNeedId: null, primaryTargetFulfillment: null,
      auditAction: 'تعديل جهاز', auditNotes: 'تعديل وصفي فقط (سجل تاريخي بلا رقم احتياج)'
    });
  }

  if (String(beneficiary['حالة مراجعة المستفيد'] || '') !== 'معتمد') {
    throw new Error('المستفيد ما زال تحت المراجعة أو غير معتمد، ولا يمكن تخصيص جهاز له قبل اعتماد الإدارة.');
  }
  const matchingNeed = readTable_(APP.sheets.beneficiaryNeeds).rows.find(row =>
    String(row['رقم المستفيد']) === beneficiaryId && String(row['نوع الجهاز']) === type);
  if (!matchingNeed || String(matchingNeed['حالة القرار']) !== 'معتمد') {
    throw new Error('«لا يملك هذا المستفيد احتياجًا معتمدًا من نوع «' + type + '»، لذلك لا يمكن تخصيص هذا الجهاز له.»');
  }
  const needId = String(matchingNeed['رقم الاحتياج']);
  const conflictingDevice = readTable_(APP.sheets.devices).rows.find(row =>
    String(row['رقم الاحتياج'] || '') === needId && String(row['رقم الجهاز']) !== id);
  if (conflictingDevice) {
    throw new Error('«تم ربط جهاز فعلي سابقًا بهذا الاستحقاق، ولا يمكن ربط جهاز ثانٍ.»');
  }
  if (String(matchingNeed['رقم الجمعية']) !== associationId) {
    throw new Error('جمعية الجهاز لا تطابق جمعية الاحتياج المعتمد');
  }
  finalBeneficiaryId = beneficiaryId;
  finalNeedId = needId;
  status = 'مخصص';
  if (currentStatus !== status) assertDeviceTransition_(currentStatus || 'بالمستودع', status);

  const values = {
    'اسم الجهاز': requiredText_(payload.name, 'اسم الجهاز', 100),
    'النوع': type, 'رقم الجمعية': associationId,
    'رقم المستفيد': finalBeneficiaryId, 'رقم الاحتياج': finalNeedId,
    'حالة الجهاز': status, 'ملاحظات': cleanText_(payload.notes, 500)
  };
  const currentNeedFulfillment = String(matchingNeed['حالة التنفيذ']);
  const targetFulfillment = ['استحقاق معتمد', 'بانتظار توفر الجهاز'].indexOf(currentNeedFulfillment) !== -1 ? 'جهاز جاهز' : null;
  // Phase 2.3.2 (القسم 2): التقدُّم الجماعي إلى "بانتظار تعيين مندوب"
  // جزء من هذه المعاملة نفسها الآن (عبر planNeedTransitionsForDeviceChange_
  // داخل commitDeviceWithNeed_) — لا استدعاء لاحق منفصل بعد نجاح الكتابة.
  return commitDeviceWithNeed_(user, {
    id: id, isNew: isNew, values: values, beneficiaryId: beneficiaryId,
    primaryNeedId: needId, primaryTargetFulfillment: targetFulfillment,
    auditAction: isNew ? 'إضافة جهاز' : 'تعديل جهاز',
    auditNotes: (isNew ? 'الحالة الابتدائية: ' : 'الحالة: ' + (currentStatus || '—') + ' ← ') + status + ' — ربط بالاحتياج ' + needId
  });
}

/** تعديل وصفي فقط (اسم/ملاحظات) لجهاز في عهدة فعلية — كل حقول الربط/الحالة تبقى كما هي حرفيًا (القسم 5). */
function saveDeviceDescriptiveOnly_(user, id, existing, payload) {
  // Phase 2.3.1 (القسم 5): أي محاولة فعلية لتغيير الربط أو الحالة تُرفض
  // صراحةً بخطأ — لا تُهمَل بصمت. فقط اسم/ملاحظات قابلان للتعديل هنا.
  const currentStatus = String(existing['حالة الجهاز']);
  const requestedBeneficiaryId = cleanId_(payload.beneficiaryId);
  const currentBeneficiaryId = String(existing['رقم المستفيد'] || '');
  const requestedType = payload.type ? validateDeviceType_(payload.type, String(existing['النوع'] || '')) : String(existing['النوع'] || '');
  const requestedAssociationId = cleanId_(payload.associationId);
  const attemptsChange = requestedBeneficiaryId !== currentBeneficiaryId
    || requestedType !== String(existing['النوع'] || '')
    || (requestedAssociationId && requestedAssociationId !== String(existing['رقم الجمعية'] || ''))
    || (payload.status && payload.status !== currentStatus);
  if (attemptsChange) {
    throw new Error('«هذا الجهاز في عهدة المندوب حاليًا (' + currentStatus + ')؛ لا يمكن تغيير المستفيد أو النوع أو الجمعية أو الحالة إلا عبر مسار الاستلام/الإرجاع المعتمد.»');
  }
  const values = {
    'اسم الجهاز': requiredText_(payload.name, 'اسم الجهاز', 100),
    'النوع': existing['النوع'], 'رقم الجمعية': existing['رقم الجمعية'],
    'رقم المستفيد': existing['رقم المستفيد'], 'رقم الاحتياج': existing['رقم الاحتياج'],
    'حالة الجهاز': existing['حالة الجهاز'], 'ملاحظات': cleanText_(payload.notes, 500)
  };
  updateById_(APP.sheets.devices, 'رقم الجهاز', id, values);
  clearDashboardCache();
  try {
    audit_(user, 'تعديل جهاز', 'الأجهزة', id, 'تعديل وصفي فقط (الجهاز في عهدة المندوب — لا تغيير حالة/ربط)');
  } catch (auditError) {
    Logger.log('تحذير: فشل تسجيل العملية بعد نجاح التعديل الوصفي فعليًا — traceId=' + requestMeta_().traceId + ' — ' + auditError.message);
  }
  const record = normalizeDevice_(findById_(APP.sheets.devices, 'رقم الجهاز', id));
  const summary = computeCoreSummary_(null);
  return {ok: true, id: id, record: record, summary: summary};
}

/**
 * Phase 2.3.2 (القسم 2-7): يكتب جهازًا (جديدًا أو تعديلًا) وكل احتياجات
 * المستفيد المتأثرة (الاحتياج الأساسي المرتبط + أي تقدُّم جماعي حقيقي
 * إلى "بانتظار تعيين مندوب") **كمعاملة واحدة غير قابلة للتجزئة**:
 *
 * spec = {
 *   id, isNew, values,                    // الجهاز
 *   beneficiaryId,                        // لتخطيط التقدُّم الجماعي (فارغ إن لم يوجد ربط)
 *   primaryNeedId, primaryTargetFulfillment, // الاحتياج المرتبط مباشرة (فارغان إن لا ربط)
 *   auditAction, auditNotes
 * }
 *
 * الترتيب الإلزامي (القسم 7): (1) تخطيط كامل بلا كتابة عبر
 * planNeedTransitionsForDeviceChange_ — يشمل فحص التقدُّم الجماعي ويرمي
 * فورًا عند خلل سلامة بيانات (جهازان لنفس الاحتياج) قبل أي كتابة؛
 * (2) لقطات خام كاملة؛ (3) الاحتياجات المخطَّطة تُكتب أولًا، والجهاز
 * آخر كتابة أساسية (القسم 4 — يمنع الحاجة لحذف جهاز جديد عند فشل ربطه:
 * إن فشلت الاحتياجات لا يُضاف الجهاز أصلًا؛ إن فشل الجهاز بعد نجاح
 * الاحتياجات تُعاد الاحتياجات فقط، ولا "جهاز شبح" لأنه لم يُكتب أصلًا)؛
 * (4) عند أي فشل: تراجع best-effort لكل ما جرت "محاولة" كتابته فعليًا
 * (القسم 1 — يُسجَّل قبل الاستدعاء لا بعده)؛ (5) بعد نجاح كل الكتابات
 * فقط: clearDashboardCache مرة واحدة، ثم audit معزول؛ (6) إثراء
 * الاستجابة (normalizeDevice_/computeCoreSummary_) لا يجوز أن يحوّل
 * نجاحًا فعليًا إلى فشل — فشله يُعيد {ok:true, refreshRequired:true}.
 */
function commitDeviceWithNeed_(user, spec) {
  // -------- (1) تخطيط كامل بلا أي كتابة --------
  const plannedDeviceRow = spec.isNew
    ? Object.assign({'رقم الجهاز': spec.id}, spec.values)
    : Object.assign({}, findById_(APP.sheets.devices, 'رقم الجهاز', spec.id), spec.values);
  const needPlans = planNeedTransitionsForDeviceChange_(spec.beneficiaryId || '', spec.primaryNeedId || null, spec.primaryTargetFulfillment || null, plannedDeviceRow);
  needPlans.forEach(plan => assertNeedFulfillmentChain_(plan.fromStatus, plan.toStatus));

  // -------- (2) لقطات خام كاملة --------
  const deviceSnapshot = spec.isNew ? null : Object.assign({}, findById_(APP.sheets.devices, 'رقم الجهاز', spec.id));
  const needSnapshots = {};
  needPlans.forEach(plan => {
    const row = findById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', plan.needId);
    needSnapshots[plan.needId] = {'حالة التنفيذ': row['حالة التنفيذ'], 'آخر تحديث': row['آخر تحديث']};
  });

  // -------- (3) الكتابة: الاحتياجات كلها أولًا، الجهاز آخر كتابة أساسية --------
  const needsWritten = []; // Phase 2.3.2 القسم 1: يُسجَّل قبل الاستدعاء لا بعده
  let deviceAttempted = false;
  try {
    needPlans.forEach(plan => {
      needsWritten.push(plan.needId);
      updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', plan.needId, {'حالة التنفيذ': plan.toStatus, 'آخر تحديث': now_()});
    });
    deviceAttempted = true;
    if (spec.isNew) {
      appendObject_(APP.sheets.devices, Object.assign({'رقم الجهاز': spec.id, 'تاريخ الإضافة': now_(), 'تاريخ التسليم': ''}, spec.values));
    } else {
      updateById_(APP.sheets.devices, 'رقم الجهاز', spec.id, spec.values);
    }
  } catch (writeError) {
    const restored = [];
    const failedToRestore = [];
    // القسم 4: جهاز جديد فشلت كتابته لم يُنشَأ فعليًا في هذا الترتيب
    // (آخر كتابة أساسية) — لا "جهاز شبح" يحتاج تنظيفًا أو حذفًا إطلاقًا.
    if (deviceAttempted && !spec.isNew && deviceSnapshot) {
      try {
        updateById_(APP.sheets.devices, 'رقم الجهاز', spec.id, deviceSnapshot);
        restored.push('device:' + spec.id);
      } catch (rollbackError) {
        failedToRestore.push('device:' + spec.id + ' (' + rollbackError.message + ')');
      }
    }
    needsWritten.forEach(needId => {
      try {
        updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', needId, needSnapshots[needId]);
        restored.push('need:' + needId);
      } catch (rollbackError) {
        failedToRestore.push('need:' + needId + ' (' + rollbackError.message + ')');
      }
    });
    const traceId = requestMeta_().traceId;
    if (failedToRestore.length) {
      Logger.log('حرج جدًا: فشل تراجع جزئي في معاملة جهاز/احتياجات — traceId=' + traceId
        + ' — أُعيدت: [' + restored.join('، ') + '] — تعذّر إعادة: [' + failedToRestore.join('، ') + '] — خطأ الكتابة الأصلي: ' + writeError.message);
      throw new Error('تعذّر إتمام حفظ الجهاز (traceId: ' + traceId + ') — تعذّر التراجع الكامل، يتطلب مراجعة يدوية فورية للسجلات: ' + failedToRestore.map(s => s.split(' (')[0]).join('، '));
    }
    throw new Error('تعذّر إتمام حفظ الجهاز (traceId: ' + traceId + ') — أُعيدت كل السجلات المتأثرة لحالتها السابقة تلقائيًا.');
  }

  // -------- (5) نجاح كل الكتابات: cache مرة واحدة ثم audit معزول --------
  clearDashboardCache();
  try {
    audit_(user, spec.auditAction, 'الأجهزة', spec.id, spec.auditNotes);
  } catch (auditError) {
    Logger.log('تحذير: فشل تسجيل العملية بعد نجاح حفظ الجهاز فعليًا — traceId=' + requestMeta_().traceId + ' deviceId=' + spec.id + ' — ' + auditError.message);
  }

  // -------- (6) القسم 6: إثراء الاستجابة لا يحوّل نجاحًا فعليًا إلى فشل --------
  try {
    const record = normalizeDevice_(findById_(APP.sheets.devices, 'رقم الجهاز', spec.id));
    const summary = computeCoreSummary_(null);
    return {ok: true, id: spec.id, record: record, summary: summary};
  } catch (enrichError) {
    Logger.log('تحذير: نجحت كتابة الجهاز فعليًا لكن فشل بناء استجابة مُثراة — traceId=' + requestMeta_().traceId + ' deviceId=' + spec.id + ' — ' + enrichError.message);
    return {ok: true, id: spec.id, refreshRequired: true};
  }
}

/**
 * تفاصيل جهاز واحد كاملة: بيانات الجهاز، الجمعية/المستفيد/المندوب
 * المرتبطون به حاليًا، وتواريخه (الإضافة والتسليم مخزَّنان مباشرة في
 * جدول الأجهزة؛ التخصيص والخروج مع المندوب يُستنتَجان من سجل العمليات
 * الخاص بهذا الجهاز تحديدًا — لا حاجة لأي عمود جديد أو ترحيل مخطط بيانات).
 */
function getDeviceDetail(token, deviceId) {
  return perfTime_('getDeviceDetail', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    deviceId = cleanId_(deviceId);
    const row = findById_(APP.sheets.devices, 'رقم الجهاز', deviceId);
    if (!row) throw new Error('الجهاز غير موجود');
    if (user.role === 'ASSOCIATION' && String(row['رقم الجمعية']) !== user.associationId) {
      throw new Error('ليس لديك صلاحية لعرض هذا الجهاز');
    }
    const device = normalizeDevice_(row);
    const association = findById_(APP.sheets.associations, 'رقم الجمعية', device.associationId);
    const beneficiary = device.beneficiaryId ? findById_(APP.sheets.beneficiaries, 'رقم المستفيد', device.beneficiaryId) : null;
    const delegateId = beneficiary ? String(beneficiary['رقم المندوب'] || '') : '';
    const delegate = delegateId ? findById_(APP.sheets.delegates, 'رقم المندوب', delegateId) : null;
    const log = auditRowsFiltered_(user.role === 'ASSOCIATION' ? user.associationId : null)
      .filter(item => item.section === 'الأجهزة' && item.recordId === deviceId);
    // log مرتَّب من الأحدث للأقدم أصلًا (auditRowsFiltered_) — أول تطابق
    // هو آخر مرة حدث فيها هذا الانتقال تحديدًا.
    const assignedAt = (log.find(item => /← مخصص|الابتدائية: مخصص/.test(item.notes)) || {}).at || '';
    const dispatchedAt = (log.find(item => /← مع المندوب/.test(item.notes)) || {}).at || '';
    return {
      ok: true,
      device: device,
      associationName: association ? String(association['اسم الجمعية']) : '',
      beneficiaryName: beneficiary ? String(beneficiary['الاسم']) : '',
      delegateId: delegateId,
      delegateName: delegate ? String(delegate['اسم المندوب']) : '',
      assignedAt: assignedAt,
      dispatchedAt: dispatchedAt,
      log: log
    };
  });
}

/**
 * إنشاء جمعية جديدة يُنشئ أيضًا حساب دخولها بكلمة مرور — إعادة محاولة
 * بعد مهلة واجهة يجب ألّا تُنشئ جمعيتين وحسابين مكرَّرين؛ لذلك تُلفّ
 * عملية الإنشاء فقط بـ withIdempotency_ عند توفّر payload.opId.
 */
function saveAssociation(token, payload) {
  const user = requireSession_(token, ['ADMIN']);
  payload = payload || {};
  // القيم المخزَّنة حاليًا لهذه الجمعية بالذات (عند التعديل فقط) — تمرير
  // القيم التاريخية حتى لا يمنع تصنيف/منطقة قديمة تعديلَ حقل آخر.
  const existingAssociation = payload.id ? findById_(APP.sheets.associations, 'رقم الجمعية', cleanId_(payload.id)) : null;
  const previousPlace = existingAssociation
    ? {region: String(existingAssociation['المنطقة'] || ''), city: String(existingAssociation['المدينة'] || '')} : null;
  const place = validateRegionCity_(payload.region, payload.city, previousPlace);
  const values = {
    'اسم الجمعية': requiredText_(payload.name, 'اسم الجمعية', 150),
    'التصنيف': validateAssociationCategory_(payload.category, existingAssociation ? String(existingAssociation['التصنيف'] || '') : ''),
    'المنطقة': place.region,
    'المدينة': place.city,
    'أرقام التواصل': normalizePhone_(payload.phone),
    'البريد الإلكتروني': requiredEmail_(payload.email),
    'الحالة': payload.status === 'غير نشطة' ? 'غير نشطة' : 'نشطة'
  };
  if (payload.id) {
    const id = cleanId_(payload.id);
    const before = existingAssociation;
    if (!before) throw new Error('الجمعية غير موجودة');
    updateById_(APP.sheets.associations, 'رقم الجمعية', id, values);
    // إيقاف الجمعية يقطع جلسات حسابها ومناديبها فورًا.
    if (values['الحالة'] === 'غير نشطة' && String(before['الحالة']) !== 'غير نشطة') {
      revokeAssociationSessions_(id);
    }
    audit_(user, 'تعديل جمعية', 'الجمعيات', id, '');
    clearDashboardCache();
    const record = normalizeAssociation_(findById_(APP.sheets.associations, 'رقم الجمعية', id),
      readTable_(APP.sheets.beneficiaries).rows, readTable_(APP.sheets.devices).rows, readTable_(APP.sheets.delegates).rows);
    return {ok: true, id: id, record: record};
  }

  if (!payload.password) throw new Error('كلمة مرور حساب الجمعية مطلوبة');
  assertStrongPassword_(payload.password);
  // فحص تكرار البريد داخل الكتلة المُغلَّفة بـ withIdempotency_ عمدًا:
  // لو كان خارجها، إعادة محاولة بنفس opId بعد نجاح فعلي أول ستجد البريد
  // مستخدَمًا (لأن الحساب أُنشئ فعلًا) وترمي خطأً مربكًا بدل إعادة نتيجة
  // النجاح الأصلية المُخزَّنة.
  return withIdempotency_(user.id, payload.opId, () => {
    if (findUserByEmail_(values['البريد الإلكتروني'])) throw new Error('البريد الإلكتروني مستخدم في حساب آخر');
    const id = nextId_('ASC');
    appendObject_(APP.sheets.associations, Object.assign({'رقم الجمعية': id, 'تاريخ الإنشاء': now_()}, values));
    createAssociationUser_(id, values['اسم الجمعية'], values['البريد الإلكتروني'], payload.password);
    audit_(user, 'إضافة جمعية', 'الجمعيات', id, '');
    clearDashboardCache();
    const record = normalizeAssociation_(findById_(APP.sheets.associations, 'رقم الجمعية', id), [], [], []);
    const summary = {associations: computeAssociationsCount_()};
    return {ok: true, id: id, record: record, summary: summary};
  });
}

function assertStrongPassword_(password) {
  password = String(password || '');
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('كلمة المرور يجب أن تكون 10 خانات على الأقل وتضم حروفًا وأرقامًا');
  }
  return password;
}

/**
 * يولّد كلمة مرور مؤقتة عشوائية تجتاز assertStrongPassword_ دائمًا
 * (طول كافٍ + حرف ورقم معًا) — يُعاد المحاولة نظريًا فقط في الاحتمال
 * الضئيل جدًا ألا تحقق العينة الأولى الشرط؛ احتياط أخير غير عشوائي
 * بالكامل لن يُستخدم عمليًا لضمان عدم فشل الدالة أبدًا.
 */
function generateStrongTempPassword_() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = createAccessCode_('T', 12).replace(/^T-/, '');
    if (candidate.length >= 10 && /[A-Za-z]/.test(candidate) && /\d/.test(candidate)) return candidate;
  }
  return 'Az9' + createAccessCode_('T', 9).replace(/^T-/, '');
}

function findAssociationUser_(associationId) {
  return readTable_(APP.sheets.users).rows.find(row =>
    String(row['رقم الجمعية']) === String(associationId) && String(row['الدور']) === 'ASSOCIATION'
  ) || null;
}

/**
 * إعادة تعيين كلمة مرور حساب جمعية — للإدارة فقط. تُنشئ كلمة مرور
 * مؤقتة قوية جديدة، تُبطل كل جلسات الجمعية القائمة فورًا، وتُجبر
 * الجمعية على تغييرها عند أول دخول تالٍ. لا تكشف هذه الدالة أي تجزئة
 * أو ملح أو كلمة مرور قديمة — فقط كلمة المرور المؤقتة الجديدة، مرة
 * واحدة، في استجابة هذا الاستدعاء فقط (لا تُسجَّل ولا تُخزَّن نصًا صريحًا
 * في أي مكان آخر).
 */
function resetAssociationPassword(token, associationId) {
  const user = requireSession_(token, ['ADMIN']);
  associationId = cleanId_(associationId);
  if (!associationId) throw new Error('رقم الجمعية غير صحيح');
  const association = findById_(APP.sheets.associations, 'رقم الجمعية', associationId);
  if (!association) throw new Error('الجمعية غير موجودة');
  // تحديد معدل: يمنع سلسلة إعادة تعيينات متتالية غير مقصودة (نقر مزدوج،
  // تكرار طلب) من إبقاء أكثر من كلمة مرور صالحة فعليًا في وقت قصير.
  throttle_('reset-assoc-pwd:' + associationId, 5, 900);

  let newPassword;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const record = findAssociationUser_(associationId);
    if (!record) throw new Error('تعذر العثور على حساب دخول لهذه الجمعية');
    newPassword = generateStrongTempPassword_();
    const salt = Utilities.getUuid();
    updateById_(APP.sheets.users, 'رقم المستخدم', record['رقم المستخدم'], {
      'كلمة مرور سابقة مشفرة': record['كلمة المرور المشفرة'],
      'ملح سابق': record['الملح'],
      'كلمة المرور المشفرة': hashSecret_(newPassword, salt),
      'الملح': salt,
      'يجب تغيير كلمة المرور': 'نعم'
    });
    // يُبطل جلسة حساب الجمعية نفسه فقط — لا يمسّ جلسات مناديبها، فكلمة
    // مرور الجمعية لا علاقة لها برموز دخول المناديب المستقلة عنها.
    revokeSessions_(record['رقم المستخدم']);
  } finally {
    lock.releaseLock();
  }

  audit_(user, 'إعادة تعيين كلمة مرور جمعية', 'الجمعيات', associationId, 'الحساب: ' + association['اسم الجمعية']);
  return {ok: true, temporaryPassword: newPassword};
}

function findUserByEmail_(email) {
  const target = String(email || '').trim().toLowerCase();
  return readTable_(APP.sheets.users).rows.find(row =>
    String(row['البريد الإلكتروني']).trim().toLowerCase() === target
  ) || null;
}

function revokeAssociationSessions_(associationId) {
  readTable_(APP.sheets.users).rows
    .filter(row => String(row['رقم الجمعية']) === String(associationId))
    .forEach(row => revokeSessions_(String(row['رقم المستخدم'])));
  readTable_(APP.sheets.delegates).rows
    .filter(row => String(row['رقم الجمعية']) === String(associationId))
    .forEach(row => revokeSessions_(String(row['رقم المندوب'])));
}

/**
 * "يجب تغيير كلمة المرور": 'نعم' دائمًا — سواء كانت مؤقتة مُولَّدة تلقائيًا
 * (قبول طلب انضمام) أو اختارها المدير يدويًا (إضافة جمعية مباشرة)، فكلتاهما
 * كلمة مرور تصل الجمعية من خارجها لا من اختيارها هي، فتُفرض إعادة تعيينها
 * عند أول دخول بنفس آلية resetAssociationPassword المُطبَّقة مسبقًا —
 * requireSession_ يرفض أي دالة أخرى لهذا الحساب حتى يُغيّرها فعليًا.
 */
function createAssociationUser_(associationId, name, email, password) {
  const salt = Utilities.getUuid();
  appendObject_(APP.sheets.users, {
    'رقم المستخدم': nextId_('USR'), 'الاسم': name, 'البريد الإلكتروني': email,
    'كلمة المرور المشفرة': hashSecret_(String(password), salt), 'الملح': salt,
    'الدور': 'ASSOCIATION', 'رقم الجمعية': associationId, 'الحالة': 'نشط',
    'تاريخ الإنشاء': now_(), 'آخر دخول': '', 'يجب تغيير كلمة المرور': 'نعم'
  });
}

