// -------------------- الأجهزة والجمعيات --------------------

// حالتا "مع المندوب" و"تم التسليم" لا تُضبَطان يدويًا من هذا النموذج
// إطلاقًا — لا تصلان إلا عبر assignDelegate وconfirmDelivery، حتى لا
// ينكسر الترابط بتعديل مستقل من صفحة الأجهزة (راجع StateRules.gs).
const DEVICE_MANUAL_STATUSES_ = Object.freeze(['بالمستودع', 'مخصص', 'تالف']);

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
  return {ok: true, id: id, data: getBootstrapData(token, true)};
}

function saveAssociation(token, payload) {
  const user = requireSession_(token, ['ADMIN']);
  payload = payload || {};
  const id = payload.id ? cleanId_(payload.id) : nextId_('ASC');
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
    const before = findById_(APP.sheets.associations, 'رقم الجمعية', id);
    if (!before) throw new Error('الجمعية غير موجودة');
    updateById_(APP.sheets.associations, 'رقم الجمعية', id, values);
    // إيقاف الجمعية يقطع جلسات حسابها ومناديبها فورًا.
    if (values['الحالة'] === 'غير نشطة' && String(before['الحالة']) !== 'غير نشطة') {
      revokeAssociationSessions_(id);
    }
  } else {
    if (!payload.password) throw new Error('كلمة مرور حساب الجمعية مطلوبة');
    assertStrongPassword_(payload.password);
    if (findUserByEmail_(values['البريد الإلكتروني'])) throw new Error('البريد الإلكتروني مستخدم في حساب آخر');
    appendObject_(APP.sheets.associations, Object.assign({'رقم الجمعية': id, 'تاريخ الإنشاء': now_()}, values));
    createAssociationUser_(id, values['اسم الجمعية'], values['البريد الإلكتروني'], payload.password);
  }
  audit_(user, payload.id ? 'تعديل جمعية' : 'إضافة جمعية', 'الجمعيات', id, '');
  clearDashboardCache();
  return {ok: true, id: id, data: getBootstrapData(token, true)};
}

function assertStrongPassword_(password) {
  password = String(password || '');
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('كلمة المرور يجب أن تكون 10 خانات على الأقل وتضم حروفًا وأرقامًا');
  }
  return password;
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

