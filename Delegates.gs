// -------------------- المناديب والتسليم --------------------

function saveDelegate(token, payload) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  payload = payload || {};
  const associationId = user.role === 'ASSOCIATION' ? user.associationId : cleanId_(payload.associationId);
  if (!associationId) throw new Error('رقم الجمعية مطلوب');
  const id = payload.id ? cleanId_(payload.id) : nextId_('MND');
  const existing = payload.id ? findById_(APP.sheets.delegates, 'رقم المندوب', id) : null;
  if (existing && user.role === 'ASSOCIATION' && String(existing['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
  const base = {
    'رقم الجمعية': associationId,
    'اسم المندوب': requiredText_(payload.name, 'اسم المندوب', 120),
    'رقم الجوال': normalizePhone_(payload.phone),
    'الحالة': payload.status === 'غير نشط' ? 'غير نشط' : 'نشط'
  };
  let accessCode = '';
  if (existing) {
    updateById_(APP.sheets.delegates, 'رقم المندوب', id, base);
    audit_(user, 'تعديل مندوب', 'المناديب', id, '');
  } else {
    accessCode = createAccessCode_('MND', 6);
    const salt = Utilities.getUuid();
    appendObject_(APP.sheets.delegates, Object.assign({
      'رقم المندوب': id,
      'رمز الدخول المشفر': hashSecret_(accessCode, salt),
      'الملح': salt,
      'تاريخ الإنشاء': now_(),
      'آخر دخول': ''
    }, base));
    audit_(user, 'إضافة مندوب', 'المناديب', id, '');
  }
  return {ok: true, id: id, accessCode: accessCode, data: getBootstrapData(token, true)};
}

function regenerateDelegateCode(token, delegateId) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  const delegate = findById_(APP.sheets.delegates, 'رقم المندوب', cleanId_(delegateId));
  if (!delegate) throw new Error('المندوب غير موجود');
  if (user.role === 'ASSOCIATION' && String(delegate['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
  const code = createAccessCode_('MND', 6);
  const salt = Utilities.getUuid();
  updateById_(APP.sheets.delegates, 'رقم المندوب', delegateId, {
    'رمز الدخول المشفر': hashSecret_(code, salt), 'الملح': salt
  });
  revokeSessions_(cleanId_(delegateId));
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
  return {ok: true, data: getBootstrapData(token, true)};
}

function updateDeliveryStatus(token, beneficiaryId, reason, notes) {
  const user = requireSession_(token, ['DELEGATE']);
  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', cleanId_(beneficiaryId));
  if (!beneficiary || String(beneficiary['رقم المندوب']) !== user.id) throw new Error('المستفيد غير متاح لك');
  if (FAILED_REASONS.indexOf(String(reason)) === -1) throw new Error('اختر حالة صحيحة');
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
  return {ok: true, data: getBootstrapData(token, true)};
}

function confirmDelivery(token, payload) {
  const user = requireSession_(token, ['DELEGATE']);
  payload = payload || {};
  if (payload.confirmed !== true) throw new Error('يجب تأكيد إتمام التسليم');
  const beneficiaryId = cleanId_(payload.beneficiaryId);
  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
  if (!beneficiary || String(beneficiary['رقم المندوب']) !== user.id) throw new Error('المستفيد غير متاح لك');
  const devices = devicesForBeneficiary_(beneficiaryId);
  if (!devices.length) throw new Error('لا توجد أجهزة مخصصة لهذا المستفيد');
  const proofUrl = saveProofImage_(payload.proofDataUrl, beneficiaryId);
  const deliveredAt = now_();
  const deliveryId = nextId_('DLV');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const latest = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId);
    if (String(latest['حالة التسليم']) === 'تم التسليم') throw new Error('تم تسجيل التسليم مسبقًا');
    updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
      'حالة المستفيد': 'تم التسليم', 'حالة التسليم': 'تم التسليم',
      'تاريخ التسليم': deliveredAt, 'آخر تحديث': deliveredAt
    });
    devices.forEach(device => updateById_(APP.sheets.devices, 'رقم الجهاز', device.id, {
      'حالة الجهاز': 'تم التسليم', 'تاريخ التسليم': deliveredAt
    }));
    appendObject_(APP.sheets.deliveries, {
      'رقم التسليم': deliveryId, 'رقم المستفيد': beneficiaryId, 'رقم المندوب': user.id,
      'أرقام الأجهزة': devices.map(x => x.id).join(', '), 'الحالة': 'تم التسليم',
      'سبب التعذر': '', 'الملاحظات': cleanText_(payload.notes, 500),
      'رابط الإثبات': proofUrl, 'تاريخ ووقت التسليم': deliveredAt, 'تاريخ الإنشاء': deliveredAt
    });
  } finally {
    lock.releaseLock();
  }
  audit_(user, 'تأكيد تسليم', 'التسليمات', beneficiaryId, 'عدد الأجهزة: ' + devices.length);
  clearDashboardCache();
  return {ok: true, data: getBootstrapData(token, true)};
}

function saveProofImage_(dataUrl, beneficiaryId) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('أرفق صورة إثبات بصيغة JPG أو PNG أو WEBP');
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > 6 * 1024 * 1024) throw new Error('حجم الصورة يتجاوز 6 ميجابايت');
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

