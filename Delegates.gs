// -------------------- المناديب والتسليم --------------------

/**
 * قائمة مناديب مُرقَّمة — عزل الجمعيات مفروض هنا قبل أي بحث أو ترقيم.
 */
function listDelegates(token, options) {
  return perfTime_('listDelegates', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    return withMeta_(listDelegates_(user, options));
  });
}

function listDelegates_(user, options) {
  options = options || {};
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  let rows = readTable_(APP.sheets.delegates).rows;
  if (user.role === 'ASSOCIATION') rows = rows.filter(row => String(row['رقم الجمعية']) === user.associationId);
  else if (options.associationId) rows = rows.filter(row => String(row['رقم الجمعية']) === cleanId_(options.associationId));
  let items = rows.map(row => normalizeDelegate_(row, beneficiaries));
  items = applySearch_(items, options.search, ['name', 'id', 'phone']);
  if (options.filter) items = items.filter(item => item.status === options.filter);
  items = applySort_(items, options.sortBy, options.sortDir);
  return Object.assign({ok: true}, paginate_(items, options));
}

/**
 * إنشاء مندوب جديد يولّد رمز دخول (سرّ يُعرض مرة واحدة) — إعادة محاولة
 * بعد مهلة واجهة يجب ألّا تُنشئ حساب مندوب مكرَّرًا برمز آخر؛ لذلك تُلفّ
 * عملية الإنشاء فقط بـ withIdempotency_ عند توفّر payload.opId. التعديل
 * (existing) لا يُنشئ سرًّا جديدًا فلا حاجة له.
 */
function saveDelegate(token, payload) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  payload = payload || {};
  const associationId = user.role === 'ASSOCIATION' ? user.associationId : cleanId_(payload.associationId);
  if (!associationId) throw new Error('رقم الجمعية مطلوب');
  const existing = payload.id ? findById_(APP.sheets.delegates, 'رقم المندوب', cleanId_(payload.id)) : null;
  if (existing && user.role === 'ASSOCIATION' && String(existing['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
  const base = {
    'رقم الجمعية': associationId,
    'اسم المندوب': requiredText_(payload.name, 'اسم المندوب', 120),
    'رقم الجوال': normalizePhone_(payload.phone),
    'الحالة': payload.status === 'غير نشط' ? 'غير نشط' : 'نشط'
  };
  if (existing) {
    const id = String(existing['رقم المندوب']);
    updateById_(APP.sheets.delegates, 'رقم المندوب', id, base);
    audit_(user, 'تعديل مندوب', 'المناديب', id, '');
    return {ok: true, id: id, accessCode: '', record: normalizeDelegate_(findById_(APP.sheets.delegates, 'رقم المندوب', id), readTable_(APP.sheets.beneficiaries).rows)};
  }
  return withIdempotency_(user.id, payload.opId, () => {
    const id = nextId_('MND');
    const accessCode = createAccessCode_('MND', 6);
    const salt = Utilities.getUuid();
    appendObject_(APP.sheets.delegates, Object.assign({
      'رقم المندوب': id,
      'رمز الدخول المشفر': hashSecret_(accessCode, salt),
      'الملح': salt,
      'تاريخ الإنشاء': now_(),
      'آخر دخول': ''
    }, base));
    audit_(user, 'إضافة مندوب', 'المناديب', id, '');
    const record = normalizeDelegate_(findById_(APP.sheets.delegates, 'رقم المندوب', id), readTable_(APP.sheets.beneficiaries).rows);
    const summary = computeCoreSummary_(user.role === 'ASSOCIATION' ? user.associationId : null);
    return {ok: true, id: id, accessCode: accessCode, record: record, summary: summary};
  });
}

/**
 * تُبطل الرمز السابق فورًا (الاستبدال الكامل للتجزئة والملح يجعل أي
 * تحقق بالرمز القديم يفشل من اللحظة نفسها) وتُبطل أي جلسة مندوب قائمة
 * بالرمز القديم. قفل + تحديد معدل يمنعان أن يبقى أكثر من رمز صالح واحد
 * حتى مع طلبات متكررة أو متزامنة على نفس المندوب.
 */
function regenerateDelegateCode(token, delegateId) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  delegateId = cleanId_(delegateId);
  const delegate = findById_(APP.sheets.delegates, 'رقم المندوب', delegateId);
  if (!delegate) throw new Error('المندوب غير موجود');
  if (user.role === 'ASSOCIATION' && String(delegate['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
  throttle_('regen-delegate-code:' + delegateId, 8, 900);

  let code;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    code = createAccessCode_('MND', 6);
    const salt = Utilities.getUuid();
    updateById_(APP.sheets.delegates, 'رقم المندوب', delegateId, {
      'رمز الدخول المشفر': hashSecret_(code, salt), 'الملح': salt
    });
    revokeSessions_(delegateId);
  } finally {
    lock.releaseLock();
  }
  audit_(user, 'إعادة إنشاء رمز الدخول', 'المناديب', delegateId, '');
  return {ok: true, accessCode: code};
}

function setDelegateStatus(token, delegateId, status) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  if (['نشط', 'غير نشط'].indexOf(status) === -1) throw new Error('الحالة غير صالحة');
  const delegate = findById_(APP.sheets.delegates, 'رقم المندوب', cleanId_(delegateId));
  if (!delegate) throw new Error('المندوب غير موجود');
  if (user.role === 'ASSOCIATION' && String(delegate['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
  updateById_(APP.sheets.delegates, 'رقم المندوب', delegateId, {'الحالة': status});
  // التعطيل يقطع جلسات المندوب القائمة فورًا، لا عند انتهاء المهلة فقط.
  if (status !== 'نشط') revokeSessions_(cleanId_(delegateId));
  audit_(user, status === 'نشط' ? 'تفعيل مندوب' : 'تعطيل مندوب', 'المناديب', delegateId, '');
  const record = normalizeDelegate_(findById_(APP.sheets.delegates, 'رقم المندوب', delegateId), readTable_(APP.sheets.beneficiaries).rows);
  const summary = computeCoreSummary_(user.role === 'ASSOCIATION' ? user.associationId : null);
  return {ok: true, record: record, summary: summary};
}

/**
 * يبني حمولة المهمة الكاملة لمستفيد واحد كما تحتاجها بطاقة المندوب:
 * السجل المُطبَّع + أجهزته + سجل محاولاته السابقة. **كل استجابة تُعدِّل
 * مستفيدًا في بوابة المندوب يجب أن تُعيد هذا الشكل** لا `record` وحده.
 *
 * العطل الحيّ الذي يعالجه (2026/08/01): updateDeliveryStatus كانت تُعيد
 * `record` فقط، والعميل يستبدل به عنصر القائمة كاملًا — فيفقد الحقل
 * `devices` الذي لا يُضاف إلا في buildDelegatePortal_. النتيجة: بعد
 * تسجيل "تعذّر التسليم" تختفي الأجهزة من البطاقة وتظهر "لا توجد أجهزة
 * مخصصة" ويتعطّل زر تأكيد التسليم، رغم أن الأجهزة ما زالت مرتبطة
 * بالمستفيد وحالتها "مع المندوب" في الجدول دون أي تغيير.
 */
function delegateTaskPayload_(beneficiaryId) {
  const row = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
  if (!row) return null;
  const item = normalizeBeneficiary_(row);
  item.devices = devicesForBeneficiary_(beneficiaryId);
  item.attempts = deliveryAttemptsFor_(beneficiaryId);
  return item;
}

/**
 * سجل محاولات التسليم لمستفيد واحد، الأحدث أولًا — مبني من ورقة
 * "التسليمات" التي تُلحَق بصف مستقل لكل محاولة (ناجحة أو متعذّرة).
 * الحالة الواحدة في صف المستفيد تُمحى بكل محاولة جديدة؛ هذا السجل هو
 * التاريخ الذي لا يُمحى، وهو ما تعرضه بطاقة المندوب وصفحة التفاصيل.
 */
function deliveryAttemptsFor_(beneficiaryId) {
  return readTable_(APP.sheets.deliveries).rows
    .filter(row => String(row['رقم المستفيد']) === String(beneficiaryId))
    .map(row => ({
      id: String(row['رقم التسليم']),
      status: String(row['الحالة']),
      reason: String(row['سبب التعذر'] || ''),
      notes: String(row['الملاحظات'] || ''),
      devices: String(row['أرقام الأجهزة'] || '').split(',').map(x => x.trim()).filter(Boolean),
      hasProof: !!String(row['رابط الإثبات'] || ''),
      at: formatDateTime_(parseDate_(row['تاريخ ووقت التسليم'] || row['تاريخ الإنشاء']))
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

function updateDeliveryStatus(token, beneficiaryId, reason, notes, opId) {
  const user = requireSession_(token, ['DELEGATE']);
  beneficiaryId = cleanId_(beneficiaryId);
  return withMeta_(withIdempotency_(user.id, opId, () => {
    const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
    if (!beneficiary || String(beneficiary['رقم المندوب']) !== user.id) throw new Error('المستفيد غير متاح لك');
    if (FAILED_REASONS.indexOf(String(reason)) === -1) throw new Error('اختر حالة صحيحة');
    // "تعذر التسليم" لا يُقبل إلا من "خرج مع المندوب" (أو تكرار محاولة
    // سابقة فاشلة) — لا يمكن تسجيل تعذّر لمستفيد لم تخرج أجهزته أصلًا.
    // الأجهزة نفسها لا تُلمَس هنا إطلاقًا: تبقى "مع المندوب" كما هي.
    assertDeliveryTransition_(String(beneficiary['حالة التسليم'] || 'لم يبدأ'), 'تعذر التسليم');
    updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
      'حالة التسليم': 'تعذر التسليم',
      'الملاحظات': mergeNote_(beneficiary['الملاحظات'], reason + (notes ? ': ' + cleanText_(notes, 500) : '')),
      'آخر تحديث': now_()
    });
    appendObject_(APP.sheets.deliveries, {
      'رقم التسليم': nextId_('DLV'), 'رقم المستفيد': beneficiaryId, 'رقم المندوب': user.id,
      'أرقام الأجهزة': devicesForBeneficiary_(beneficiaryId).map(x => x.id).join(', '),
      'الحالة': 'تعذر التسليم', 'سبب التعذر': reason, 'الملاحظات': cleanText_(notes, 500),
      'رابط الإثبات': '', 'تاريخ ووقت التسليم': '', 'تاريخ الإنشاء': now_()
    });
    audit_(user, 'تعذر التسليم', 'التسليمات', beneficiaryId, reason);
    clearDashboardCache();
    return {ok: true, record: delegateTaskPayload_(beneficiaryId)};
  }));
}

/**
 * «إعادة المحاولة» بعد تعذّر التسليم — إجراء صريح بضغطة واحدة، بدل
 * المسار الالتفافي الذي كان الحل الوحيد عمليًا (دخول الجمعية إلى «تغيير
 * المندوب» ثم إعادة حفظ المندوب نفسه). يُعيد حالة التسليم إلى «خرج مع
 * المندوب» فقط، ولا يلمس:
 *   - الأجهزة (تبقى «مع المندوب» بأرقامها وتواريخها كما هي)،
 *   - المندوب المُعيَّن (نفسه، بلا إعادة تعيين)،
 *   - سبب التعذّر ولا أي محاولة سابقة (سجل المحاولات تراكمي لا يُمحى).
 *
 * مسموح للمندوب نفسه (صاحب المهمة) وللإدارة/الجمعية المالكة — الصلاحية
 * مفروضة في الخادم لا بإخفاء الزر.
 */
function retryDelivery(token, beneficiaryId, opId) {
  const user = requireSession_(token, ['DELEGATE', 'ADMIN', 'ASSOCIATION']);
  beneficiaryId = cleanId_(beneficiaryId);
  return withMeta_(withIdempotency_(user.id, opId, () => {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      invalidateTableCache_(APP.sheets.beneficiaries);
      const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
      if (!beneficiary) throw new Error('المستفيد غير موجود');
      if (user.role === 'DELEGATE' && String(beneficiary['رقم المندوب']) !== user.id) throw new Error('المستفيد غير متاح لك');
      if (user.role === 'ASSOCIATION' && String(beneficiary['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
      const current = String(beneficiary['حالة التسليم'] || '');
      if (current !== 'تعذر التسليم') {
        throw new Error('إعادة المحاولة متاحة فقط بعد تسجيل «تعذر التسليم» — الحالة الحالية: «' + (current || 'غير محددة') + '»');
      }
      if (!String(beneficiary['رقم المندوب'] || '')) throw new Error('لا يوجد مندوب معيَّن لهذا المستفيد — عيِّن مندوبًا أولًا');
      // الأجهزة يجب أن تكون ما زالت مع المندوب فعليًا؛ إن رجعت للمستودع
      // فالمسار الصحيح هو تخصيص وتعيين من جديد لا "إعادة محاولة".
      const dispatched = dispatchedDevicesForBeneficiary_(beneficiaryId);
      if (!dispatched.length) {
        throw new Error('لا توجد أجهزة «مع المندوب» لهذا المستفيد الآن — أعد التخصيص وتعيين المندوب بدل إعادة المحاولة');
      }
      assertDeliveryTransition_(current, 'خرج مع المندوب');
      updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
        'حالة التسليم': 'خرج مع المندوب',
        'حالة المستفيد': 'جاري التسليم',
        'آخر تحديث': now_()
      });
    } finally {
      lock.releaseLock();
    }
    audit_(user, 'إعادة محاولة تسليم', 'التسليمات', beneficiaryId, 'أُعيدت الحالة إلى «خرج مع المندوب» بلا تغيير الأجهزة أو المندوب');
    clearDashboardCache();
    return {ok: true, record: delegateTaskPayload_(beneficiaryId)};
  }));
}

/**
 * إعادة محاولة بعد مهلة واجهة قد تصادف أن التأكيد الأول نجح فعليًا على
 * الخادم (الحالة النهائية "تم التسليم" لا تحمل حلقة ذاتية عمدًا —
 * StateRules.gs — فتُرفض إعادة المحاولة العادية برسالة مربكة توحي بالفشل
 * رغم النجاح الفعلي الأول). withIdempotency_ بـ payload.opId يكسر هذا
 * اللبس: نفس opId يُعيد نتيجة التأكيد الأصلية الناجحة حرفيًا بدل تشغيل
 * منطق التحقق من جديد.
 */
function confirmDelivery(token, payload) {
  return perfTime_('confirmDelivery', () => {
    const user = requireSession_(token, ['DELEGATE']);
    payload = payload || {};
    if (payload.confirmed !== true) throw new Error('يجب تأكيد إتمام التسليم');
    const beneficiaryId = cleanId_(payload.beneficiaryId);
    return withMeta_(withIdempotency_(user.id, payload.opId, () => confirmDelivery_(user, beneficiaryId, payload)));
  });
}

function confirmDelivery_(user, beneficiaryId, payload) {
  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
  if (!beneficiary || String(beneficiary['رقم المندوب']) !== user.id) throw new Error('المستفيد غير متاح لك');
  // تأكيد التسليم يشمل فقط الأجهزة التي خرجت فعليًا مع المندوب — لا
  // يقبل جهازًا لا يزال "بالمستودع" أو "مخصص" ولم يخرج بعد.
  const devices = dispatchedDevicesForBeneficiary_(beneficiaryId);
  if (!devices.length) throw new Error('لا توجد أجهزة "خرجت مع المندوب" لهذا المستفيد بعد؛ تحقق من تعيين المندوب أولًا');
  const proofUrl = saveProofImage_(payload.proofDataUrl, beneficiaryId);
  const deliveredAt = now_();
  const deliveryId = nextId_('DLV');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // إعادة القراءة والتحقق من الانتقال داخل القفل يمنع أي سباق تزامني
    // (مثل نقرتين متتاليتين سريعتين) من كتابة حالة غير متّسقة جزئيًا.
    // إبطال الذاكرة أولًا: بدونه ستُعاد نفس اللقطة المأخوذة قبل الانتظار
    // على القفل، فيفوّت التحقق أي تعديل كتبه تنفيذ آخر أثناء الانتظار.
    invalidateTableCache_(APP.sheets.beneficiaries);
    invalidateTableCache_(APP.sheets.devices);
    const latest = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
    assertDeliveryTransition_(String(latest['حالة التسليم'] || ''), 'تم التسليم');
    const latestDevices = dispatchedDevicesForBeneficiary_(beneficiaryId);
    if (!latestDevices.length) throw new Error('لا توجد أجهزة "خرجت مع المندوب" لهذا المستفيد الآن');
    latestDevices.forEach(device => assertDeviceTransition_(device.status, 'تم التسليم'));

    updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
      'حالة المستفيد': 'تم التسليم', 'حالة التسليم': 'تم التسليم',
      'تاريخ التسليم': deliveredAt, 'آخر تحديث': deliveredAt
    });
    latestDevices.forEach(device => updateById_(APP.sheets.devices, 'رقم الجهاز', device.id, {
      'حالة الجهاز': 'تم التسليم', 'تاريخ التسليم': deliveredAt
    }));
    appendObject_(APP.sheets.deliveries, {
      'رقم التسليم': deliveryId, 'رقم المستفيد': beneficiaryId, 'رقم المندوب': user.id,
      'أرقام الأجهزة': latestDevices.map(x => x.id).join(', '), 'الحالة': 'تم التسليم',
      'سبب التعذر': '', 'الملاحظات': cleanText_(payload.notes, 500),
      'رابط الإثبات': proofUrl, 'تاريخ ووقت التسليم': deliveredAt, 'تاريخ الإنشاء': deliveredAt
    });
  } finally {
    lock.releaseLock();
  }
  audit_(user, 'تأكيد تسليم', 'التسليمات', beneficiaryId, 'عدد الأجهزة: ' + devices.length);
  clearDashboardCache();
  // نفس شكل الاستجابة الموحَّد لكل تعديل في بوابة المندوب: السجل +
  // أجهزته + سجل محاولاته كاملًا (المحاولة الناجحة الأخيرة مضافة إليه).
  return {ok: true, record: delegateTaskPayload_(beneficiaryId)};
}

/**
 * يتحقق من التوقيع الفعلي (magic bytes) لأول بايتات الصورة المفكوكة —
 * لا يكتفي بتصديق نوع MIME الذي يدّعيه العميل في بادئة data: (يمكن
 * لأي عميل كتابة "data:image/jpeg;base64,..." أمام أي محتوى إطلاقًا).
 * يرفض أي محتوى لا يطابق التوقيع الحقيقي لنوعه المُعلَن.
 */
function verifyImageMagicBytes_(bytes, kind) {
  const b = bytes;
  if (kind === 'jpeg') return b.length > 3 && (b[0] & 0xFF) === 0xFF && (b[1] & 0xFF) === 0xD8 && (b[2] & 0xFF) === 0xFF;
  if (kind === 'png') {
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    return b.length > sig.length && sig.every((byte, index) => (b[index] & 0xFF) === byte);
  }
  if (kind === 'webp') {
    const isRiff = b.length > 11 && [0x52, 0x49, 0x46, 0x46].every((byte, index) => (b[index] & 0xFF) === byte);
    const isWebp = isRiff && [0x57, 0x45, 0x42, 0x50].every((byte, index) => (b[index + 8] & 0xFF) === byte);
    return isWebp;
  }
  return false;
}

function saveProofImage_(dataUrl, beneficiaryId) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('أرفق صورة إثبات بصيغة JPG أو PNG أو WEBP');
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > 6 * 1024 * 1024) throw new Error('حجم الصورة يتجاوز 6 ميجابايت');
  if (!verifyImageMagicBytes_(bytes, match[1])) {
    throw new Error('محتوى الملف الفعلي لا يطابق صيغة الصورة المُعلَنة — أرفق صورة JPG أو PNG أو WEBP حقيقية');
  }
  const mime = 'image/' + match[1];
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const folder = proofFolder_();
  const filename = beneficiaryId + '-' + Utilities.formatDate(new Date(), APP.timezone, 'yyyyMMdd-HHmmss') + '.' + ext;
  return folder.createFile(Utilities.newBlob(bytes, mime, filename)).getUrl();
}

function proofFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('PROOF_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (ignore) {}
  }
  const folder = DriveApp.createFolder(APP.proofFolder);
  props.setProperty('PROOF_FOLDER_ID', folder.getId());
  updateSetting_('مجلد شواهد التسليم', folder.getUrl());
  return folder;
}

