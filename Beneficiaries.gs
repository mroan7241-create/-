// -------------------- المستفيدون --------------------

function saveBeneficiary(token, payload) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  payload = payload || {};
  const existing = payload.id ? findById_(APP.sheets.beneficiaries, 'رقم المستفيد', cleanId_(payload.id)) : null;
  const associationId = user.role === 'ASSOCIATION' ? user.associationId : cleanId_(payload.associationId);
  if (!associationId || !findById_(APP.sheets.associations, 'رقم الجمعية', associationId)) throw new Error('اختر جمعية صحيحة');
  if (existing && user.role === 'ASSOCIATION') {
    if (String(existing['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية لتعديل هذا المستفيد');
    if (String(existing['حالة التسليم']) === 'تم التسليم') throw new Error('لا يمكن تعديل بيانات مستفيد تم تسليمه');
  }
  const place = validateRegionCity_(payload.region, payload.city);
  const coordinates = optionalCoordinate_(payload.lat, payload.lng);
  const values = {
    'رقم الجمعية': associationId,
    'الاسم': requiredText_(payload.name, 'اسم المستفيد', 120),
    'المنطقة': place.region,
    'المدينة': place.city,
    'العنوان': requiredText_(payload.address, 'العنوان', 250),
    'رقم الجوال': normalizePhone_(payload.phone),
    'رقم جوال إضافي': payload.phone2 ? normalizePhone_(payload.phone2) : '',
    'عدد الأفراد': boundedNumber_(payload.familyCount, 1, 99, 'عدد الأفراد'),
    'ضمان اجتماعي': payload.socialSecurity === true || payload.socialSecurity === 'نعم' ? 'نعم' : 'لا',
    'الحالة الاجتماعية': cleanText_(payload.socialStatus, 80),
    'مبلغ الدخل': boundedNumber_(payload.income || 0, 0, 1000000, 'مبلغ الدخل'),
    'الاحتياج': normalizeNeeds_(payload.needs),
    'حالة المستفيد': existing ? String(existing['حالة المستفيد']) : 'جديد',
    'حالة التسليم': existing ? String(existing['حالة التسليم']) : 'لم يبدأ',
    'رقم المندوب': existing ? String(existing['رقم المندوب'] || '') : '',
    'الملاحظات': cleanText_(payload.notes, 1000),
    'آخر تحديث': now_(),
    'خط العرض': coordinates.lat,
    'خط الطول': coordinates.lng
  };
  let id;
  if (existing) {
    id = String(existing['رقم المستفيد']);
    updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', id, values);
    audit_(user, 'تعديل مستفيد', 'المستفيدون', id, '');
  } else {
    id = nextId_('BEN');
    appendObject_(APP.sheets.beneficiaries, Object.assign({'رقم المستفيد': id, 'تاريخ الإنشاء': now_()}, values));
    audit_(user, 'إضافة مستفيد', 'المستفيدون', id, '');
  }
  clearDashboardCache();
  return {ok: true, id: id, data: getBootstrapData(token, true)};
}

function importBeneficiaries(token, rows, acceptedPledge) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  if (acceptedPledge !== true) throw new Error('يجب الموافقة على التعهد قبل الاستيراد');
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 1000) throw new Error('الملف فارغ أو يتجاوز 1000 سجل');
  const valid = [];
  const errors = [];
  rows.forEach((row, index) => {
    try {
      const associationId = user.role === 'ASSOCIATION' ? user.associationId : cleanId_(row.associationId);
      if (!associationId) throw new Error('رقم الجمعية مطلوب');
      const place = validateRegionCity_(row.region, row.city);
      valid.push({
        'رقم المستفيد': '',
        'رقم الجمعية': associationId,
        'الاسم': requiredText_(row.name, 'الاسم', 120),
        'المنطقة': place.region,
        'المدينة': place.city,
        'العنوان': requiredText_(row.address, 'العنوان', 250),
        'رقم الجوال': normalizePhone_(row.phone),
        'رقم جوال إضافي': row.phone2 ? normalizePhone_(row.phone2) : '',
        'عدد الأفراد': boundedNumber_(row.familyCount, 1, 99, 'عدد الأفراد'),
        'ضمان اجتماعي': row.socialSecurity === true || row.socialSecurity === 'نعم' ? 'نعم' : 'لا',
        'الحالة الاجتماعية': cleanText_(row.socialStatus, 80),
        'مبلغ الدخل': boundedNumber_(row.income || 0, 0, 1000000, 'مبلغ الدخل'),
        'الاحتياج': normalizeNeeds_(row.needs),
        'حالة المستفيد': 'جديد',
        'حالة التسليم': 'لم يبدأ',
        'رقم المندوب': '',
        'الملاحظات': cleanText_(row.notes, 1000),
        'تاريخ الإنشاء': now_(),
        'تاريخ التسليم': '',
        'آخر تحديث': now_()
      });
    } catch (error) {
      errors.push({row: index + 2, message: error.message});
    }
  });
  if (errors.length) return {ok: false, validCount: valid.length, errorCount: errors.length, errors: errors.slice(0, 50)};
  const beneficiaryIds = nextIds_('BEN', valid.length);
  valid.forEach((record, index) => record['رقم المستفيد'] = beneficiaryIds[index]);
  appendObjects_(APP.sheets.beneficiaries, valid);
  audit_(user, 'استيراد مستفيدين', 'المستفيدون', '', 'عدد السجلات: ' + valid.length);
  clearDashboardCache();
  return {ok: true, imported: valid.length, data: getBootstrapData(token, true)};
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
    const expected = ['الاسم', 'المنطقة', 'المدينة', 'العنوان', 'الجوال', 'عدد الأفراد', 'الضمان الاجتماعي', 'الحالة الاجتماعية', 'الدخل', 'الاحتياج', 'الملاحظات'];
    const headers = values[0].map(value => String(value).trim());
    const missing = expected.filter(header => headers.indexOf(header) < 0);
    if (missing.length) throw new Error('أعمدة مفقودة: ' + missing.join('، '));
    const keyMap = {
      'الاسم': 'name', 'المنطقة': 'region', 'المدينة': 'city', 'العنوان': 'address',
      'الجوال': 'phone', 'عدد الأفراد': 'familyCount', 'الضمان الاجتماعي': 'socialSecurity',
      'الحالة الاجتماعية': 'socialStatus', 'الدخل': 'income', 'الاحتياج': 'needs', 'الملاحظات': 'notes'
    };
    const rows = values.slice(1).filter(row => row.some(Boolean)).map(row => {
      const object = {};
      headers.forEach((header, index) => {
        if (keyMap[header]) object[keyMap[header]] = row[index];
      });
      if (user.role === 'ASSOCIATION') object.associationId = user.associationId;
      return object;
    });
    const errors = [];
    rows.forEach((row, index) => {
      try {
        requiredText_(row.name, 'الاسم', 120);
        validateRegionCity_(row.region, row.city);
        requiredText_(row.address, 'العنوان', 250);
        normalizePhone_(row.phone);
        boundedNumber_(row.familyCount, 1, 99, 'عدد الأفراد');
        boundedNumber_(row.income || 0, 0, 1000000, 'مبلغ الدخل');
      } catch (error) {
        errors.push({row: index + 2, message: error.message});
      }
    });
    return {ok: errors.length === 0, rows: rows, validCount: rows.length - errors.length, errorCount: errors.length, errors: errors.slice(0, 50)};
  } finally {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignore) {}
  }
}

function assignDelegate(token, beneficiaryId, delegateId) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  const beneficiary = findById_(APP.sheets.beneficiaries, 'رقم المستفيد', cleanId_(beneficiaryId));
  const delegate = findById_(APP.sheets.delegates, 'رقم المندوب', cleanId_(delegateId));
  if (!beneficiary || !delegate || String(delegate['الحالة']) !== 'نشط') throw new Error('المستفيد أو المندوب غير صالح');
  if (String(beneficiary['رقم الجمعية']) !== String(delegate['رقم الجمعية'])) throw new Error('يجب أن يتبع المندوب والمستفيد الجمعية نفسها');
  if (user.role === 'ASSOCIATION' && String(beneficiary['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
  updateById_(APP.sheets.beneficiaries, 'رقم المستفيد', beneficiaryId, {
    'رقم المندوب': delegateId,
    'حالة المستفيد': 'جاري التسليم',
    'حالة التسليم': 'جاري التجهيز',
    'آخر تحديث': now_()
  });
  audit_(user, 'تعيين مندوب', 'المستفيدون', beneficiaryId, 'المندوب: ' + delegateId);
  clearDashboardCache();
  return {ok: true, data: getBootstrapData(token, true)};
}

