// -------------------- الأجهزة والجمعيات --------------------

function saveDevice(token, payload) {
  const user = requireSession_(token, ['ADMIN']);
  payload = payload || {};
  const status = DEVICE_STATUSES.indexOf(payload.status) >= 0 ? payload.status : 'بالمستودع';
  const id = payload.id ? cleanId_(payload.id) : nextId_('DEV');
  const values = {
    'اسم الجهاز': requiredText_(payload.name, 'اسم الجهاز', 100),
    'النوع': requiredText_(payload.type, 'نوع الجهاز', 80),
    'رقم الجمعية': cleanId_(payload.associationId),
    'رقم المستفيد': cleanId_(payload.beneficiaryId),
    'حالة الجهاز': status,
    'ملاحظات': cleanText_(payload.notes, 500)
  };
  if (payload.id) updateById_(APP.sheets.devices, 'رقم الجهاز', id, values);
  else appendObject_(APP.sheets.devices, Object.assign({'رقم الجهاز': id, 'تاريخ الإضافة': now_(), 'تاريخ التسليم': ''}, values));
  audit_(user, payload.id ? 'تعديل جهاز' : 'إضافة جهاز', 'الأجهزة', id, '');
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

