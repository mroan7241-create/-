// -------------------- الأجهزة والجمعيات --------------------

// حالتا "مع المندوب" و"تم التسليم" لا تُضبَطان يدويًا من هذا النموذج
// إطلاقًا — لا تصلان إلا عبر assignDelegate وconfirmDelivery، حتى لا
// ينكسر الترابط بتعديل مستقل من صفحة الأجهزة (راجع StateRules.gs).
const DEVICE_MANUAL_STATUSES_ = Object.freeze(['بالمستودع', 'مخصص', 'تالف']);

/** قائمة أجهزة مُرقَّمة — عزل الجمعيات مفروض قبل أي بحث أو ترقيم. */
function listDevices(token, options) {
  return perfTime_('listDevices', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    options = options || {};
    let rows = readTable_(APP.sheets.devices).rows;
    if (user.role === 'ASSOCIATION') rows = rows.filter(row => String(row['رقم الجمعية']) === user.associationId);
    else if (options.associationId) rows = rows.filter(row => String(row['رقم الجمعية']) === cleanId_(options.associationId));
    let items = rows.map(normalizeDevice_);
    items = applySearch_(items, options.search, ['name', 'id', 'type', 'beneficiaryId']);
    if (options.filter) items = items.filter(item => item.status === options.filter);
    items = applySort_(items, options.sortBy, options.sortDir);
    return Object.assign({ok: true}, paginate_(items, options));
  });
}

/** قائمة جمعيات مُرقَّمة (ADMIN فقط — الجمعية ترى بياناتها الخاصة فقط عبر association في Bootstrap). */
function listAssociations(token, options) {
  return perfTime_('listAssociations', () => {
    requireSession_(token, ['ADMIN']);
    options = options || {};
    const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
    const devices = readTable_(APP.sheets.devices).rows;
    const delegates = readTable_(APP.sheets.delegates).rows;
    let items = readTable_(APP.sheets.associations).rows.map(row => normalizeAssociation_(row, beneficiaries, devices, delegates));
    items = applySearch_(items, options.search, ['name', 'id', 'email', 'phone']);
    if (options.filter) items = items.filter(item => item.status === options.filter);
    items = applySort_(items, options.sortBy, options.sortDir);
    return Object.assign({ok: true}, paginate_(items, options));
  });
}

function saveDevice(token, payload) {
  const user = requireSession_(token, ['ADMIN']);
  payload = payload || {};
  const id = payload.id ? cleanId_(payload.id) : nextId_('DEV');
  const existing = payload.id ? findById_(APP.sheets.devices, 'رقم الجهاز', id) : null;
  if (payload.id && !existing) throw new Error('الجهاز غير موجود');

  const beneficiaryId = cleanId_(payload.beneficiaryId);
  const associationId = cleanId_(payload.associationId);
  const beneficiary = beneficiaryId ? findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId) : null;
  if (beneficiaryId && !beneficiary) throw new Error('المستفيد المحدَّد غير موجود');
  if (beneficiaryId && associationId && String(beneficiary['رقم الجمعية']) !== associationId) {
    throw new Error('يجب أن ينتمي المستفيد لجمعية الجهاز نفسها');
  }

  const currentStatus = existing ? String(existing['حالة الجهاز']) : '';
  const currentBeneficiaryId = existing ? String(existing['رقم المستفيد'] || '') : '';

  // منع تخصيص جهاز نشط لدى مستفيد لمستفيد آخر مباشرة — يجب إرجاعه
  // للمستودع أولًا. هذا يمنع "سرقة" جهاز من مستفيد بصورة ضمنية.
  if (currentBeneficiaryId && beneficiaryId && currentBeneficiaryId !== beneficiaryId
    && ['مخصص', 'مع المندوب', 'تم التسليم'].indexOf(currentStatus) >= 0) {
    throw new Error('هذا الجهاز مخصَّص لمستفيد آخر حاليًا؛ أعده إلى المستودع أولًا قبل تخصيصه لمستفيد جديد');
  }

  let status = payload.status;
  if (status === currentStatus) {
    // لا تغيير فعلي في الحالة (تعديل حقول أخرى كالاسم/الملاحظات فقط) —
    // مسموح دائمًا حتى لو كانت الحالة نهائية (تم التسليم)، فهذا ليس
    // إعادة تنفيذ للعملية بل مجرد تصحيح بيانات وصفية لا يمسّ الحالة.
  } else {
    if (DEVICE_MANUAL_STATUSES_.indexOf(status) === -1) {
      if (DEVICE_STATUSES.indexOf(status) >= 0) {
        throw new Error('لا يمكن ضبط حالة "' + status + '" يدويًا؛ تُحدَّث فقط عبر تعيين المندوب أو تأكيد التسليم');
      }
      // لم يُرسَل حقل حالة صالح: اشتقاق تلقائي من وجود مستفيد أو غيابه.
      status = beneficiaryId ? 'مخصص' : 'بالمستودع';
    }
    assertDeviceTransition_(currentStatus, status);
  }

  const values = {
    'اسم الجهاز': requiredText_(payload.name, 'اسم الجهاز', 100),
    'النوع': requiredText_(payload.type, 'نوع الجهاز', 80),
    'رقم الجمعية': associationId,
    'رقم المستفيد': beneficiaryId,
    'حالة الجهاز': status,
    'ملاحظات': cleanText_(payload.notes, 500)
  };
  if (existing) {
    updateById_(APP.sheets.devices, 'رقم الجهاز', id, values);
    audit_(user, 'تعديل جهاز', 'الأجهزة', id, 'الحالة: ' + (currentStatus || '—') + ' ← ' + status);
  } else {
    appendObject_(APP.sheets.devices, Object.assign({'رقم الجهاز': id, 'تاريخ الإضافة': now_(), 'تاريخ التسليم': ''}, values));
    audit_(user, 'إضافة جهاز', 'الأجهزة', id, 'الحالة الابتدائية: ' + status);
  }
  clearDashboardCache();
  const record = normalizeDevice_(findById_(APP.sheets.devices, 'رقم الجهاز', id));
  // saveDevice للإدارة فقط — الملخّص دائمًا غير مُقيَّد بجمعية (يطابق لوحة الإدارة).
  const summary = computeCoreSummary_(null);
  return {ok: true, id: id, record: record, summary: summary};
}

/**
 * إنشاء جمعية جديدة يُنشئ أيضًا حساب دخولها بكلمة مرور — إعادة محاولة
 * بعد مهلة واجهة يجب ألّا تُنشئ جمعيتين وحسابين مكرَّرين؛ لذلك تُلفّ
 * عملية الإنشاء فقط بـ withIdempotency_ عند توفّر payload.opId.
 */
function saveAssociation(token, payload) {
  const user = requireSession_(token, ['ADMIN']);
  payload = payload || {};
  const place = validateRegionCity_(payload.region, payload.city);
  const values = {
    'اسم الجمعية': requiredText_(payload.name, 'اسم الجمعية', 150),
    'التصنيف': cleanText_(payload.category, 80),
    'المنطقة': place.region,
    'المدينة': place.city,
    'أرقام التواصل': normalizePhone_(payload.phone),
    'البريد الإلكتروني': requiredEmail_(payload.email),
    'الحالة': payload.status === 'غير نشطة' ? 'غير نشطة' : 'نشطة'
  };
  if (payload.id) {
    const id = cleanId_(payload.id);
    const before = findById_(APP.sheets.associations, 'رقم الجمعية', id);
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

function createAssociationUser_(associationId, name, email, password) {
  const salt = Utilities.getUuid();
  appendObject_(APP.sheets.users, {
    'رقم المستخدم': nextId_('USR'), 'الاسم': name, 'البريد الإلكتروني': email,
    'كلمة المرور المشفرة': hashSecret_(String(password), salt), 'الملح': salt,
    'الدور': 'ASSOCIATION', 'رقم الجمعية': associationId, 'الحالة': 'نشط',
    'تاريخ الإنشاء': now_(), 'آخر دخول': ''
  });
}

