/**
 * نظام متابعة مشروع توزيع الأجهزة
 * جمعية الزاد بالشراكة مع مؤسسة سليمان أبانمي الأهلية
 * المنطقة الزمنية: Asia/Riyadh
 */

const APP = Object.freeze({
  title: 'نظام متابعة توزيع الأجهزة',
  timezone: 'Asia/Riyadh',
  cacheSeconds: 60,
  sessionSeconds: 21600,
  maxSessionSeconds: 43200,
  schemaVersion: 2,
  proofFolder: 'شواهد تسليم الأجهزة - جمعية الزاد',
  sheets: {
    settings: 'إعدادات المشروع',
    users: 'المستخدمون',
    associations: 'الجمعيات',
    beneficiaries: 'المستفيدون',
    devices: 'الأجهزة',
    delegates: 'المناديب',
    deliveries: 'التسليمات',
    activities: 'إدارة الأنشطة',
    evidence: 'شواهد الأنشطة الرئيسية',
    audit: 'سجل العمليات'
  }
});

const HEADERS = Object.freeze({
  'إعدادات المشروع': ['المفتاح', 'القيمة', 'الوصف'],
  'المستخدمون': ['رقم المستخدم', 'الاسم', 'البريد الإلكتروني', 'كلمة المرور المشفرة', 'الملح', 'الدور', 'رقم الجمعية', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول'],
  'الجمعيات': ['رقم الجمعية', 'اسم الجمعية', 'التصنيف', 'المنطقة', 'المدينة', 'أرقام التواصل', 'البريد الإلكتروني', 'الحالة', 'تاريخ الإنشاء'],
  'المستفيدون': ['رقم المستفيد', 'رقم الجمعية', 'الاسم', 'المنطقة', 'المدينة', 'العنوان', 'رقم الجوال', 'رقم جوال إضافي', 'عدد الأفراد', 'ضمان اجتماعي', 'الحالة الاجتماعية', 'مبلغ الدخل', 'الاحتياج', 'حالة المستفيد', 'حالة التسليم', 'رقم المندوب', 'الملاحظات', 'تاريخ الإنشاء', 'تاريخ التسليم', 'آخر تحديث'],
  'الأجهزة': ['رقم الجهاز', 'اسم الجهاز', 'النوع', 'رقم الجمعية', 'رقم المستفيد', 'حالة الجهاز', 'تاريخ الإضافة', 'تاريخ التسليم', 'ملاحظات'],
  'المناديب': ['رقم المندوب', 'رقم الجمعية', 'اسم المندوب', 'رقم الجوال', 'رمز الدخول المشفر', 'الملح', 'الحالة', 'تاريخ الإنشاء', 'آخر دخول'],
  'التسليمات': ['رقم التسليم', 'رقم المستفيد', 'رقم المندوب', 'أرقام الأجهزة', 'الحالة', 'سبب التعذر', 'الملاحظات', 'رابط الإثبات', 'تاريخ ووقت التسليم', 'تاريخ الإنشاء'],
  'إدارة الأنشطة': ['ترتيب المرحلة', 'اسم المرحلة', 'ترتيب النشاط الرئيسي', 'اسم النشاط الرئيسي', 'اسم النشاط الفرعي', 'المسؤول', 'تاريخ البداية', 'تاريخ النهاية', 'نسبة الإنجاز', 'الحالة', 'رابط الشاهد', 'ملاحظات'],
  'شواهد الأنشطة الرئيسية': ['اسم المرحلة', 'اسم النشاط الرئيسي', 'رابط الشاهد', 'حالة الاعتماد', 'ملاحظات', 'تاريخ الرفع'],
  'سجل العمليات': ['رقم العملية', 'رقم المستخدم', 'اسم المستخدم', 'الدور', 'العملية', 'القسم', 'رقم السجل', 'ملاحظات', 'التاريخ والوقت']
});

const BENEFICIARY_STATUSES = ['جديد', 'تحت المراجعة', 'معتمد', 'بانتظار الأجهزة', 'جاري التسليم', 'تم التسليم', 'ملغي'];
const DEVICE_STATUSES = ['بالمستودع', 'مخصص', 'مع المندوب', 'تم التسليم', 'تالف'];
const DELIVERY_STATUSES = ['لم يبدأ', 'جاري التجهيز', 'خرج مع المندوب', 'تم التسليم', 'تعذر التسليم'];
const FAILED_REASONS = ['لم يتم التواصل', 'لا يرد', 'طلب تأجيل', 'العنوان غير صحيح', 'غير موجود', 'رفض الاستلام'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * ينشئ قاعدة البيانات دون المساس بأي صف موجود.
 * يسجل بيانات دخول المدير المؤقتة في سجل التنفيذ عند أول تشغيل.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(name => ensureSheet_(ss, name, HEADERS[name]));
  seedSettings_();
  const firstAdmin = seedAdmin_();
  applyValidations_();
  PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', String(APP.schemaVersion));
  clearDashboardCache();
  const result = {ok: true, message: 'تم تجهيز قاعدة البيانات بنجاح'};
  if (firstAdmin) {
    result.adminEmail = firstAdmin.email;
    result.temporaryPassword = firstAdmin.password;
    console.log('بيانات المدير المؤقتة: ' + firstAdmin.email + ' / ' + firstAdmin.password);
  }
  return result;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0];
    headers.forEach((header, index) => {
      if (!current[index]) sheet.getRange(1, index + 1).setValue(header);
    });
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#183F3A').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center').setWrap(true);
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function seedSettings_() {
  const sheet = sheet_(APP.sheets.settings);
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, 8, 3).setValues([
    ['اسم المشروع', 'مشروع توزيع الأجهزة الكهربائية', 'يظهر في رأس النظام'],
    ['الجهة المالكة', 'جمعية الزاد', 'الجهة المشرفة'],
    ['الشريك', 'مؤسسة سليمان أبانمي الأهلية', 'شريك المشروع'],
    ['المنطقة الزمنية', APP.timezone, 'تستخدم في جميع السجلات'],
    ['تاريخ البداية', '', 'yyyy/MM/dd'],
    ['تاريخ النهاية', '', 'yyyy/MM/dd'],
    ['تحديث تلقائي بالدقائق', '5', 'الحد الأدنى دقيقة واحدة'],
    ['مجلد شواهد التسليم', '', 'ينشئه النظام عند أول رفع']
  ]);
}

function seedAdmin_() {
  const sheet = sheet_(APP.sheets.users);
  if (sheet.getLastRow() > 1) return null;
  const password = createAccessCode_('ZAD', 10);
  const salt = Utilities.getUuid();
  sheet.appendRow([
    nextId_('USR'), 'مدير النظام', 'admin@alzad.org', hashSecret_(password, salt),
    salt, 'ADMIN', '', 'نشط', now_(), ''
  ]);
  return {email: 'admin@alzad.org', password: password};
}

function applyValidations_() {
  setValidation_(APP.sheets.beneficiaries, 'حالة المستفيد', BENEFICIARY_STATUSES);
  setValidation_(APP.sheets.beneficiaries, 'حالة التسليم', DELIVERY_STATUSES);
  setValidation_(APP.sheets.beneficiaries, 'ضمان اجتماعي', ['نعم', 'لا']);
  setValidation_(APP.sheets.devices, 'حالة الجهاز', DEVICE_STATUSES);
  setValidation_(APP.sheets.delegates, 'الحالة', ['نشط', 'غير نشط']);
  setValidation_(APP.sheets.associations, 'الحالة', ['نشطة', 'غير نشطة']);
}

function setValidation_(sheetName, header, values) {
  const sheet = sheet_(sheetName);
  const map = headerMap_(sheet);
  if (map[header] === undefined) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(2, map[header] + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

// -------------------- المصادقة والصلاحيات --------------------

/**
 * حدّ بسيط للمحاولات المتكررة ضمن إمكانات Apps Script.
 * Apps Script لا يمنح عنوان IP للعميل، لذا يُقيَّد المعرّف المُدخل نفسه.
 */
function throttle_(bucket, limit, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const key = 'rl:' + bucket;
  const count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), windowSeconds);
  if (count > limit) throw new Error('محاولات كثيرة خلال وقت قصير. انتظر بضع دقائق ثم أعد المحاولة');
  return count;
}

function login(payload) {
  payload = payload || {};
  const type = cleanText_(payload.type, 20);
  if (type === 'delegate') return loginDelegate_(payload.code);
  return loginUser_(payload.email, payload.password);
}

function loginUser_(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!isEmail_(email) || !password) throw new Error('بيانات الدخول غير صحيحة');
  throttle_('login:' + hashSecret_(email, 'rate'), 8, 900);
  const table = readTable_(APP.sheets.users);
  const user = table.rows.find(row =>
    String(row['البريد الإلكتروني']).trim().toLowerCase() === email &&
    String(row['الحالة']) === 'نشط'
  );
  if (!user || !constantTimeEquals_(String(user['كلمة المرور المشفرة']), hashSecret_(String(password), String(user['الملح'])))) {
    Utilities.sleep(350);
    throw new Error('بيانات الدخول غير صحيحة');
  }
  assertActorEnabled_(String(user['الدور']), String(user['رقم الجمعية'] || ''));
  const session = createSession_({
    id: String(user['رقم المستخدم']),
    name: String(user['الاسم']),
    role: String(user['الدور']),
    associationId: String(user['رقم الجمعية'] || '')
  });
  updateById_(APP.sheets.users, 'رقم المستخدم', user['رقم المستخدم'], {'آخر دخول': now_()});
  audit_(session.user, 'تسجيل دخول', 'المصادقة', user['رقم المستخدم'], '');
  return {ok: true, token: session.token, user: session.user, bootstrap: getBootstrapData(session.token)};
}

function loginDelegate_(code) {
  code = String(code || '').trim().toUpperCase();
  if (!/^MND-[A-Z0-9]{6,12}$/.test(code)) throw new Error('رمز الدخول غير صحيح');
  throttle_('login:' + hashSecret_(code, 'rate'), 8, 900);
  const table = readTable_(APP.sheets.delegates);
  const delegate = table.rows.find(row =>
    String(row['الحالة']) === 'نشط' &&
    constantTimeEquals_(String(row['رمز الدخول المشفر']), hashSecret_(code, String(row['الملح'])))
  );
  if (!delegate) {
    Utilities.sleep(350);
    throw new Error('رمز الدخول غير صحيح أو المندوب غير نشط');
  }
  assertActorEnabled_('DELEGATE', String(delegate['رقم الجمعية'] || ''));
  const session = createSession_({
    id: String(delegate['رقم المندوب']),
    name: String(delegate['اسم المندوب']),
    role: 'DELEGATE',
    associationId: String(delegate['رقم الجمعية'])
  });
  updateById_(APP.sheets.delegates, 'رقم المندوب', delegate['رقم المندوب'], {'آخر دخول': now_()});
  audit_(session.user, 'تسجيل دخول', 'المصادقة', delegate['رقم المندوب'], '');
  return {ok: true, token: session.token, user: session.user, bootstrap: getBootstrapData(session.token)};
}

function logout(token) {
  const user = requireSession_(token);
  CacheService.getScriptCache().remove(sessionKey_(token));
  audit_(user, 'تسجيل خروج', 'المصادقة', user.id, '');
  return {ok: true};
}

/**
 * ختم إبطال لكل فاعل. رفعه يُبطل فورًا كل جلساته القائمة
 * (تُستخدم عند تغيير كلمة المرور أو تعطيل المندوب أو الجمعية).
 */
function actorEpoch_(actorId) {
  return Number(PropertiesService.getScriptProperties().getProperty('EPOCH_' + actorId) || 0);
}

function revokeSessions_(actorId) {
  PropertiesService.getScriptProperties().setProperty('EPOCH_' + actorId, String(actorEpoch_(actorId) + 1));
}

/** يمنع دخول أو استمرار أي فاعل تابع لجمعية موقوفة. */
function assertActorEnabled_(role, associationId) {
  if (role === 'ADMIN' || !associationId) return;
  const association = findById_(APP.sheets.associations, 'رقم الجمعية', associationId);
  if (!association) throw new Error('تعذر العثور على بيانات الجمعية');
  if (String(association['الحالة']) === 'غير نشطة') {
    throw new Error('حساب الجمعية موقوف حاليًا. تواصل مع إدارة المشروع');
  }
}

function createSession_(user) {
  const raw = Utilities.getUuid() + Utilities.getUuid() + new Date().getTime();
  const token = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw)).replace(/=+$/g, '');
  const record = {
    id: user.id, name: user.name, role: user.role, associationId: user.associationId,
    epoch: actorEpoch_(user.id), issuedAt: new Date().getTime()
  };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(record), APP.sessionSeconds);
  return {token: token, user: {id: user.id, name: user.name, role: user.role, associationId: user.associationId}};
}

function requireSession_(token, roles) {
  token = String(token || '');
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error('انتهت الجلسة. يرجى تسجيل الدخول مجددًا');
  const cache = CacheService.getScriptCache();
  const raw = cache.get(sessionKey_(token));
  if (!raw) throw new Error('انتهت الجلسة. يرجى تسجيل الدخول مجددًا');
  const user = JSON.parse(raw);
  if (Number(user.epoch || 0) !== actorEpoch_(user.id)) {
    cache.remove(sessionKey_(token));
    throw new Error('انتهت الجلسة. يرجى تسجيل الدخول مجددًا');
  }
  // سقف مطلق للعمر حتى لو ظل المستخدم نشطًا
  if (new Date().getTime() - Number(user.issuedAt || 0) > APP.maxSessionSeconds * 1000) {
    cache.remove(sessionKey_(token));
    throw new Error('انتهت الجلسة. يرجى تسجيل الدخول مجددًا');
  }
  cache.put(sessionKey_(token), raw, APP.sessionSeconds);
  if (roles && roles.indexOf(user.role) === -1) throw new Error('ليس لديك صلاحية لتنفيذ هذه العملية');
  return user;
}

function sessionKey_(token) {
  return 'session:' + token;
}

// -------------------- بيانات الواجهة --------------------

function getBootstrapData(token) {
  const user = requireSession_(token);
  assertActorEnabled_(user.role, user.associationId);
  if (user.role === 'DELEGATE') return buildDelegatePortal_(user);
  if (user.role === 'ASSOCIATION') return buildAssociationPortal_(user);
  return buildAdminPortal_(user);
}

function getDashboardData(token) {
  return getBootstrapData(token);
}

function buildAdminPortal_(user) {
  const associations = readTable_(APP.sheets.associations).rows;
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  const devices = readTable_(APP.sheets.devices).rows;
  const delegates = readTable_(APP.sheets.delegates).rows;
  const activities = getActivitiesData_();
  const evidence = getMainActivityEvidence_();
  return {
    ok: true,
    generatedAt: formatDateTime_(new Date()),
    role: user.role,
    user: user,
    settings: getProjectSettings_(),
    summary: buildProjectSummary_(beneficiaries, associations, devices, delegates, activities),
    beneficiaries: beneficiaries.map(normalizeBeneficiary_),
    associations: associations.map(row => normalizeAssociation_(row, beneficiaries, devices, delegates)),
    devices: devices.map(normalizeDevice_),
    delegates: delegates.map(row => normalizeDelegate_(row, beneficiaries)),
    activities: activities,
    stages: getStagesData_(activities),
    evidence: evidence,
    alerts: buildAlerts_(beneficiaries, associations, devices, activities, evidence),
    audit: getAuditRows_(30)
  };
}

function buildAssociationPortal_(user) {
  const associationId = user.associationId;
  const association = findById_(APP.sheets.associations, 'رقم الجمعية', associationId);
  if (!association) throw new Error('تعذر العثور على بيانات الجمعية');
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows.filter(row => String(row['رقم الجمعية']) === associationId);
  const devices = readTable_(APP.sheets.devices).rows.filter(row => String(row['رقم الجمعية']) === associationId);
  const delegates = readTable_(APP.sheets.delegates).rows.filter(row => String(row['رقم الجمعية']) === associationId);
  return {
    ok: true,
    generatedAt: formatDateTime_(new Date()),
    role: user.role,
    user: user,
    association: normalizeAssociation_(association, beneficiaries, devices, delegates),
    summary: buildProjectSummary_(beneficiaries, [association], devices, delegates, []),
    beneficiaries: beneficiaries.map(normalizeBeneficiary_),
    devices: devices.map(normalizeDevice_),
    delegates: delegates.map(row => normalizeDelegate_(row, beneficiaries)),
    audit: getAuditRows_(20, associationId)
  };
}

function buildDelegatePortal_(user) {
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows
    .filter(row => String(row['رقم المندوب']) === user.id);
  const active = beneficiaries.filter(row => String(row['حالة التسليم']) !== 'تم التسليم' && String(row['حالة المستفيد']) !== 'ملغي');
  const today = formatDate_(new Date());
  const deliveredToday = beneficiaries.filter(row =>
    String(row['حالة التسليم']) === 'تم التسليم' &&
    formatDate_(parseDate_(row['تاريخ التسليم'])) === today
  );
  return {
    ok: true,
    generatedAt: formatDateTime_(new Date()),
    role: user.role,
    user: user,
    delegate: normalizeDelegate_(findById_(APP.sheets.delegates, 'رقم المندوب', user.id), beneficiaries),
    summary: {remaining: active.length, deliveredToday: deliveredToday.length},
    beneficiaries: active.map(row => {
      const item = normalizeBeneficiary_(row);
      item.devices = devicesForBeneficiary_(row['رقم المستفيد']);
      return item;
    }),
    history: getDeliveryHistory_(user.id)
  };
}

function buildProjectSummary_(beneficiaries, associations, devices, delegates, activities) {
  const deliveredBeneficiaries = beneficiaries.filter(row => String(row['حالة التسليم']) === 'تم التسليم').length;
  const validBeneficiaries = beneficiaries.filter(row => String(row['حالة المستفيد']) !== 'ملغي').length;
  const completedActivities = activities.filter(row => safeNumber_(row.progress) >= 100).length;
  return {
    beneficiaries: beneficiaries.length,
    associations: associations.length,
    delegates: delegates.filter(row => String(row['الحالة']) !== 'غير نشط').length,
    devices: devices.length,
    devicesWarehouse: countBy_(devices, 'حالة الجهاز', 'بالمستودع'),
    devicesAllocated: devices.filter(row => ['مخصص', 'مع المندوب'].indexOf(String(row['حالة الجهاز'])) >= 0).length,
    devicesDelivered: countBy_(devices, 'حالة الجهاز', 'تم التسليم'),
    deliveryRate: validBeneficiaries ? Math.round(deliveredBeneficiaries / validBeneficiaries * 100) : 0,
    activityRate: activities.length ? Math.round(completedActivities / activities.length * 100) : 0,
    completedActivities: completedActivities,
    totalActivities: activities.length
  };
}

// -------------------- المستفيدون --------------------

function saveBeneficiary(token, payload) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  payload = payload || {};
  const existing = payload.id ? findById_(APP.sheets.beneficiaries, 'رقم المستفيد', payload.id) : null;
  const associationId = user.role === 'ASSOCIATION' ? user.associationId : cleanId_(payload.associationId);
  if (!associationId || !findById_(APP.sheets.associations, 'رقم الجمعية', associationId)) throw new Error('اختر جمعية صحيحة');
  if (existing && user.role === 'ASSOCIATION') {
    if (String(existing['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية لتعديل هذا المستفيد');
    if (String(existing['حالة التسليم']) === 'تم التسليم') throw new Error('لا يمكن تعديل بيانات مستفيد تم تسليمه');
  }
  const values = {
    'رقم الجمعية': associationId,
    'الاسم': requiredText_(payload.name, 'اسم المستفيد', 120),
    'المنطقة': requiredText_(payload.region, 'المنطقة', 80),
    'المدينة': requiredText_(payload.city, 'المدينة', 80),
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
    'آخر تحديث': now_()
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
  return {ok: true, id: id, data: getBootstrapData(token)};
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
      valid.push({
        'رقم المستفيد': '',
        'رقم الجمعية': associationId,
        'الاسم': requiredText_(row.name, 'الاسم', 120),
        'المنطقة': requiredText_(row.region, 'المنطقة', 80),
        'المدينة': requiredText_(row.city, 'المدينة', 80),
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
  return {ok: true, imported: valid.length, data: getBootstrapData(token)};
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
        requiredText_(row.region, 'المنطقة', 80);
        requiredText_(row.city, 'المدينة', 80);
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
  return {ok: true, data: getBootstrapData(token)};
}

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
  return {ok: true, id: id, accessCode: accessCode, data: getBootstrapData(token)};
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
  return {ok: true, data: getBootstrapData(token)};
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
  return {ok: true, data: getBootstrapData(token)};
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
  return {ok: true, data: getBootstrapData(token)};
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
  return {ok: true, id: id, data: getBootstrapData(token)};
}

function saveAssociation(token, payload) {
  const user = requireSession_(token, ['ADMIN']);
  payload = payload || {};
  const id = payload.id ? cleanId_(payload.id) : nextId_('ASC');
  const values = {
    'اسم الجمعية': requiredText_(payload.name, 'اسم الجمعية', 150),
    'التصنيف': cleanText_(payload.category, 80),
    'المنطقة': requiredText_(payload.region, 'المنطقة', 80),
    'المدينة': requiredText_(payload.city, 'المدينة', 80),
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
  return {ok: true, id: id, data: getBootstrapData(token)};
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

// -------------------- المتابعة التنفيذية الأصلية --------------------

function getProjectSettings_() {
  const rows = readTable_(APP.sheets.settings).rows;
  const result = {};
  rows.forEach(row => result[String(row['المفتاح'])] = serializeValue_(row['القيمة']));
  return result;
}

function getActivitiesData_() {
  return readTable_(APP.sheets.activities).rows.map(row => {
    const start = parseDate_(row['تاريخ البداية']);
    const end = parseDate_(row['تاريخ النهاية']);
    const progress = Math.max(0, Math.min(100, safeNumber_(row['نسبة الإنجاز'])));
    const today = stripTime_(new Date());
    let computedStatus = cleanText_(row['الحالة'], 50);
    if (!computedStatus) {
      if (progress >= 100) computedStatus = 'مكتمل';
      else if (end && end < today) computedStatus = 'متأخر';
      else if (start && start <= today) computedStatus = 'جارٍ';
      else computedStatus = 'لم يبدأ';
    }
    return {
      stageOrder: safeNumber_(row['ترتيب المرحلة']),
      stage: cleanText_(row['اسم المرحلة'], 150),
      mainOrder: safeNumber_(row['ترتيب النشاط الرئيسي']),
      mainActivity: cleanText_(row['اسم النشاط الرئيسي'], 180),
      subActivity: cleanText_(row['اسم النشاط الفرعي'], 180),
      owner: cleanText_(row['المسؤول'], 120),
      startDate: formatDate_(start),
      endDate: formatDate_(end),
      progress: progress,
      status: computedStatus,
      evidenceUrl: safeUrl_(row['رابط الشاهد']),
      notes: cleanText_(row['ملاحظات'], 1000),
      delayDays: end && end < today && progress < 100 ? daysBetween_(end, today) : 0,
      remainingDays: end && end >= today ? daysBetween_(today, end) : 0
    };
  });
}

function getMainActivities_(activities) {
  const groups = {};
  (activities || getActivitiesData_()).forEach(item => {
    const key = item.stage + '|' + item.mainActivity;
    if (!groups[key]) groups[key] = {stage: item.stage, name: item.mainActivity, items: [], progress: 0};
    groups[key].items.push(item);
  });
  return Object.keys(groups).map(key => {
    const group = groups[key];
    group.progress = group.items.length ? Math.round(group.items.reduce((sum, x) => sum + x.progress, 0) / group.items.length) : 0;
    return group;
  });
}

function getStagesData_(activities) {
  const groups = {};
  (activities || getActivitiesData_()).forEach(item => {
    if (!groups[item.stage]) groups[item.stage] = {name: item.stage, order: item.stageOrder, items: []};
    groups[item.stage].items.push(item);
  });
  return Object.keys(groups).map(key => {
    const group = groups[key];
    group.progress = group.items.length ? Math.round(group.items.reduce((sum, x) => sum + x.progress, 0) / group.items.length) : 0;
    group.status = group.progress >= 100 ? 'مكتملة' : group.items.some(x => x.status === 'متأخر') ? 'متأخرة' : 'قيد التنفيذ';
    return group;
  }).sort((a, b) => a.order - b.order);
}

function getMainActivityEvidence_() {
  return readTable_(APP.sheets.evidence).rows.map(row => ({
    stage: cleanText_(row['اسم المرحلة'], 150),
    activity: cleanText_(row['اسم النشاط الرئيسي'], 180),
    url: safeUrl_(row['رابط الشاهد']),
    status: cleanText_(row['حالة الاعتماد'], 50),
    notes: cleanText_(row['ملاحظات'], 500),
    uploadedAt: formatDate_(parseDate_(row['تاريخ الرفع']))
  }));
}

function getAssociationsData_() {
  return readTable_(APP.sheets.associations).rows.map(row => normalizeAssociation_(row));
}

function updateAssociationSettings(token, payload) {
  const user = requireSession_(token, ['ASSOCIATION']);
  payload = payload || {};
  const values = {
    'أرقام التواصل': normalizePhone_(payload.phone),
    'البريد الإلكتروني': requiredEmail_(payload.email)
  };
  const duplicate = readTable_(APP.sheets.users).rows.find(row =>
    String(row['رقم المستخدم']) !== user.id &&
    String(row['البريد الإلكتروني']).toLowerCase() === values['البريد الإلكتروني']
  );
  if (duplicate) throw new Error('البريد الإلكتروني مستخدم في حساب آخر');
  updateById_(APP.sheets.associations, 'رقم الجمعية', user.associationId, values);
  updateById_(APP.sheets.users, 'رقم المستخدم', user.id, {'البريد الإلكتروني': values['البريد الإلكتروني']});
  audit_(user, 'تحديث إعدادات الجمعية', 'الإعدادات', user.associationId, '');
  clearDashboardCache();
  return {ok: true, data: getBootstrapData(token)};
}

function changePassword(token, currentPassword, newPassword) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  const record = findById_(APP.sheets.users, 'رقم المستخدم', user.id);
  if (!record || !constantTimeEquals_(String(record['كلمة المرور المشفرة']), hashSecret_(String(currentPassword || ''), String(record['الملح'])))) {
    throw new Error('كلمة المرور الحالية غير صحيحة');
  }
  newPassword = String(newPassword || '');
  if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    throw new Error('كلمة المرور الجديدة يجب أن تكون 10 خانات على الأقل وتضم حروفًا وأرقامًا');
  }
  const salt = Utilities.getUuid();
  updateById_(APP.sheets.users, 'رقم المستخدم', user.id, {
    'كلمة المرور المشفرة': hashSecret_(newPassword, salt),
    'الملح': salt
  });
  audit_(user, 'تغيير كلمة المرور', 'الإعدادات', user.id, '');
  // تغيير كلمة المرور يُبطل بقية الجلسات على الأجهزة الأخرى.
  revokeSessions_(user.id);
  return {ok: true};
}

function buildAlerts_(beneficiaries, associations, devices, activities, evidence) {
  const alerts = [];
  activities.filter(x => x.status === 'متأخر').forEach(x => alerts.push({
    level: 'critical', title: 'نشاط متأخر', message: x.subActivity || x.mainActivity, section: 'الأنشطة'
  }));
  activities.filter(x => x.progress >= 100 && !x.evidenceUrl).forEach(x => alerts.push({
    level: 'high', title: 'نشاط مكتمل دون شاهد', message: x.subActivity || x.mainActivity, section: 'الشواهد'
  }));
  associations.forEach(association => {
    const id = String(association['رقم الجمعية']);
    const assigned = devices.filter(device => String(device['رقم الجمعية']) === id).length;
    const delivered = devices.filter(device => String(device['رقم الجمعية']) === id && String(device['حالة الجهاز']) === 'تم التسليم').length;
    if (assigned > 0 && delivered === 0) alerts.push({
      level: 'high', title: 'جمعية تحتاج متابعة', message: String(association['اسم الجمعية']), section: 'الجمعيات'
    });
  });
  const invalid = devices.filter(device =>
    String(device['حالة الجهاز']) === 'تم التسليم' && !String(device['رقم المستفيد'])
  ).length;
  if (invalid) alerts.push({level: 'critical', title: 'بيانات أجهزة غير منطقية', message: invalid + ' جهازًا مسلّمًا بلا مستفيد', section: 'الأجهزة'});
  return alerts.slice(0, 20);
}

function clearDashboardCache() {
  CacheService.getScriptCache().remove('dashboard');
  return {ok: true};
}

// -------------------- التطبيع والتجميع --------------------

function normalizeBeneficiary_(row) {
  return {
    id: String(row['رقم المستفيد'] || ''),
    associationId: String(row['رقم الجمعية'] || ''),
    name: String(row['الاسم'] || ''),
    region: String(row['المنطقة'] || ''),
    city: String(row['المدينة'] || ''),
    address: String(row['العنوان'] || ''),
    phone: String(row['رقم الجوال'] || ''),
    phone2: String(row['رقم جوال إضافي'] || ''),
    familyCount: safeNumber_(row['عدد الأفراد']),
    socialSecurity: String(row['ضمان اجتماعي']) === 'نعم',
    socialStatus: String(row['الحالة الاجتماعية'] || ''),
    income: safeNumber_(row['مبلغ الدخل']),
    needs: splitList_(row['الاحتياج']),
    status: String(row['حالة المستفيد'] || 'جديد'),
    deliveryStatus: String(row['حالة التسليم'] || 'لم يبدأ'),
    delegateId: String(row['رقم المندوب'] || ''),
    notes: String(row['الملاحظات'] || ''),
    createdAt: formatDate_(parseDate_(row['تاريخ الإنشاء'])),
    deliveredAt: formatDateTime_(parseDate_(row['تاريخ التسليم'])),
    updatedAt: formatDateTime_(parseDate_(row['آخر تحديث']))
  };
}

function normalizeAssociation_(row, beneficiaries, devices, delegates) {
  row = row || {};
  const id = String(row['رقم الجمعية'] || '');
  beneficiaries = beneficiaries || [];
  devices = devices || [];
  delegates = delegates || [];
  const ownDevices = devices.filter(x => !id || String(x['رقم الجمعية']) === id);
  const delivered = ownDevices.filter(x => String(x['حالة الجهاز']) === 'تم التسليم').length;
  return {
    id: id, name: String(row['اسم الجمعية'] || ''), category: String(row['التصنيف'] || ''),
    region: String(row['المنطقة'] || ''), city: String(row['المدينة'] || ''),
    phone: String(row['أرقام التواصل'] || ''), email: String(row['البريد الإلكتروني'] || ''),
    status: String(row['الحالة'] || ''), beneficiaries: beneficiaries.filter(x => !id || String(x['رقم الجمعية']) === id).length,
    approvedDevices: ownDevices.length, receivedDevices: ownDevices.filter(x => String(x['حالة الجهاز']) !== 'بالمستودع').length,
    deliveredDevices: delivered, delegates: delegates.filter(x => !id || String(x['رقم الجمعية']) === id).length,
    progress: ownDevices.length ? Math.round(delivered / ownDevices.length * 100) : 0
  };
}

function normalizeDevice_(row) {
  return {
    id: String(row['رقم الجهاز'] || ''), name: String(row['اسم الجهاز'] || ''),
    type: String(row['النوع'] || ''), associationId: String(row['رقم الجمعية'] || ''),
    beneficiaryId: String(row['رقم المستفيد'] || ''), status: String(row['حالة الجهاز'] || ''),
    createdAt: formatDate_(parseDate_(row['تاريخ الإضافة'])),
    deliveredAt: formatDateTime_(parseDate_(row['تاريخ التسليم'])),
    notes: String(row['ملاحظات'] || '')
  };
}

function normalizeDelegate_(row, beneficiaries) {
  row = row || {};
  beneficiaries = beneficiaries || [];
  const id = String(row['رقم المندوب'] || '');
  const served = beneficiaries.filter(x => String(x['رقم المندوب']) === id && String(x['حالة التسليم']) === 'تم التسليم').length;
  const assigned = beneficiaries.filter(x => String(x['رقم المندوب']) === id && String(x['حالة التسليم']) !== 'تم التسليم').length;
  return {
    id: id, associationId: String(row['رقم الجمعية'] || ''), name: String(row['اسم المندوب'] || ''),
    phone: String(row['رقم الجوال'] || ''), status: String(row['الحالة'] || ''),
    served: served, assigned: assigned, lastLogin: formatDateTime_(parseDate_(row['آخر دخول']))
  };
}

function devicesForBeneficiary_(beneficiaryId) {
  return readTable_(APP.sheets.devices).rows
    .filter(row => String(row['رقم المستفيد']) === String(beneficiaryId))
    .map(normalizeDevice_);
}

function getDeliveryHistory_(delegateId) {
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  return readTable_(APP.sheets.deliveries).rows
    .filter(row => String(row['رقم المندوب']) === String(delegateId) && String(row['الحالة']) === 'تم التسليم')
    .map(row => {
      const beneficiary = beneficiaries.find(x => String(x['رقم المستفيد']) === String(row['رقم المستفيد']));
      return {
        beneficiaryName: beneficiary ? String(beneficiary['الاسم']) : String(row['رقم المستفيد']),
        deliveredAt: formatDateTime_(parseDate_(row['تاريخ ووقت التسليم'])),
        devices: splitList_(row['أرقام الأجهزة'])
      };
    }).reverse();
}

function getAuditRows_(limit, associationId) {
  const rows = readTable_(APP.sheets.audit).rows;
  let actorIds = null;
  let recordIds = null;
  if (associationId) {
    const associationKey = String(associationId);
    actorIds = new Set(
      readTable_(APP.sheets.users).rows
        .filter(row => String(row['رقم الجمعية']) === associationKey)
        .map(row => String(row['رقم المستخدم']))
    );
    recordIds = new Set([associationKey]);
    [
      [APP.sheets.beneficiaries, 'رقم الجمعية', 'رقم المستفيد'],
      [APP.sheets.devices, 'رقم الجمعية', 'رقم الجهاز'],
      [APP.sheets.delegates, 'رقم الجمعية', 'رقم المندوب']
    ].forEach(definition => {
      readTable_(definition[0]).rows
        .filter(row => String(row[definition[1]]) === associationKey)
        .forEach(row => recordIds.add(String(row[definition[2]])));
    });
    readTable_(APP.sheets.delegates).rows
      .filter(row => String(row['رقم الجمعية']) === associationKey)
      .forEach(row => actorIds.add(String(row['رقم المندوب'])));
  }
  return rows.filter(row => {
    if (!associationId) return true;
    const record = String(row['رقم السجل'] || '');
    return actorIds.has(String(row['رقم المستخدم'])) || recordIds.has(record);
  }).slice(-limit).reverse().map(row => ({
    user: String(row['اسم المستخدم'] || ''), action: String(row['العملية'] || ''),
    section: String(row['القسم'] || ''), recordId: String(row['رقم السجل'] || ''),
    notes: String(row['ملاحظات'] || ''), at: formatDateTime_(parseDate_(row['التاريخ والوقت']))
  }));
}

// -------------------- أدوات قاعدة البيانات --------------------

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('شغّل setupSheets() أولًا. الورقة المفقودة: ' + name);
  return sheet;
}

function readTable_(name) {
  const sheet = sheet_(name);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return {headers: [], rows: []};
  const headers = values[0].map(String);
  const rows = values.slice(1).filter(row => row.some(value => value !== '')).map(row => {
    const object = {};
    headers.forEach((header, index) => object[header] = row[index]);
    return object;
  });
  return {headers: headers, rows: rows};
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = {};
  headers.forEach((header, index) => map[String(header).trim()] = index);
  return map;
}

function appendObject_(sheetName, object) {
  appendObjects_(sheetName, [object]);
}

/**
 * يمنع Formula Injection: أي نص يبدأ بمحرف تفعيل صيغة في Sheets
 * يُسبق بعلامة اقتباس مفردة، وهي علامة "نص صريح" لا تظهر للمستخدم
 * ولا تعود ضمن القيمة عند القراءة.
 */
function safeCell_(value) {
  if (typeof value !== 'string' || !value) return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function appendObjects_(sheetName, objects) {
  if (!objects.length) return;
  const sheet = sheet_(sheetName);
  const headers = HEADERS[sheetName];
  const rows = objects.map(object =>
    headers.map(header => safeCell_(object[header] === undefined ? '' : object[header]))
  );
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function findById_(sheetName, idHeader, id) {
  return readTable_(sheetName).rows.find(row => String(row[idHeader]) === String(id)) || null;
}

function updateById_(sheetName, idHeader, id, changes) {
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const map = {};
  values[0].forEach((header, index) => map[String(header)] = index);
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[map[idHeader]]) === String(id));
  if (rowIndex < 1) throw new Error('السجل غير موجود: ' + id);
  Object.keys(changes).forEach(header => {
    if (map[header] !== undefined) sheet.getRange(rowIndex + 1, map[header] + 1).setValue(safeCell_(changes[header]));
  });
}

function nextId_(prefix) {
  return nextIds_(prefix, 1)[0];
}

function nextIds_(prefix, count) {
  count = Math.max(0, Math.floor(Number(count) || 0));
  if (!count) return [];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'SEQ_' + prefix;
    const current = Number(props.getProperty(key) || 0);
    props.setProperty(key, String(current + count));
    return Array.from({length: count}, (_, index) =>
      prefix + '-' + Utilities.formatString('%06d', current + index + 1)
    );
  } finally {
    lock.releaseLock();
  }
}

function audit_(user, action, section, recordId, notes) {
  appendObject_(APP.sheets.audit, {
    'رقم العملية': Utilities.getUuid(), 'رقم المستخدم': user.id, 'اسم المستخدم': user.name,
    'الدور': user.role, 'العملية': action, 'القسم': section, 'رقم السجل': recordId || '',
    'ملاحظات': cleanText_(notes, 1000), 'التاريخ والوقت': now_()
  });
}

function updateSetting_(key, value) {
  const sheet = sheet_(APP.sheets.settings);
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[0]) === key);
  if (rowIndex > 0) sheet.getRange(rowIndex + 1, 2).setValue(value);
}

// -------------------- أدوات الأمان والتحقق --------------------

function hashSecret_(secret, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + '|' + String(secret) + '|' + ScriptApp.getScriptId(),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes);
}

function constantTimeEquals_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function createAccessCode_(prefix, length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let output = '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random());
  for (let i = 0; i < length; i++) output += alphabet.charAt(Math.abs(bytes[i % bytes.length]) % alphabet.length);
  return prefix + '-' + output;
}

function requiredText_(value, label, max) {
  const text = cleanText_(value, max);
  if (!text) throw new Error(label + ' مطلوب');
  return text;
}

const CONTROL_CHARS_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

function cleanText_(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(CONTROL_CHARS_RE, '')
    .trim().slice(0, max || 1000);
}

function cleanId_(value) {
  const id = String(value || '').trim();
  return /^[A-Z]{3}-\d{6}$/.test(id) ? id : '';
}

function requiredEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!isEmail_(email)) throw new Error('البريد الإلكتروني غير صحيح');
  return email;
}

function isEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')) && String(value).length <= 180;
}

function normalizePhone_(value) {
  const phone = String(value || '').replace(/[^\d+]/g, '');
  if (!/^(?:\+?966|0)?5\d{8}$/.test(phone)) throw new Error('رقم الجوال غير صحيح');
  return phone.indexOf('+966') === 0 ? '0' + phone.slice(4) : phone.indexOf('966') === 0 ? '0' + phone.slice(3) : phone;
}

function boundedNumber_(value, min, max, label) {
  const number = Number(value);
  if (!isFinite(number) || number < min || number > max) throw new Error(label + ' غير صحيح');
  return number;
}

function normalizeNeeds_(needs) {
  const list = Array.isArray(needs) ? needs : splitList_(needs);
  return list.map(item => cleanText_(item, 80)).filter(Boolean).slice(0, 20).join('، ');
}

function safeUrl_(value) {
  const url = String(value || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : '';
}

function mergeNote_(oldNote, newNote) {
  const stamp = '[' + formatDateTime_(new Date()) + '] ';
  return cleanText_((oldNote ? oldNote + '\n' : '') + stamp + newNote, 2000);
}

function splitList_(value) {
  return String(value || '').split(/[،,]\s*/).map(x => x.trim()).filter(Boolean);
}

function countBy_(rows, key, value) {
  return rows.filter(row => String(row[key]) === value).length;
}

function safeNumber_(value) {
  if (typeof value === 'string') value = value.replace('%', '').replace(',', '.').trim();
  const number = Number(value);
  return isFinite(number) ? number : 0;
}

function parseDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value;
  const match = String(value).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  return isNaN(date.getTime()) ? null : date;
}

function formatDate_(date) {
  return date && !isNaN(date.getTime()) ? Utilities.formatDate(date, APP.timezone, 'yyyy/MM/dd') : '';
}

function formatDateTime_(date) {
  return date && !isNaN(date.getTime()) ? Utilities.formatDate(date, APP.timezone, 'yyyy/MM/dd HH:mm') : '';
}

function now_() {
  return formatDateTime_(new Date());
}

function stripTime_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween_(from, to) {
  return Math.max(0, Math.ceil((stripTime_(to) - stripTime_(from)) / 86400000));
}

function serializeValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDate_(value);
  return value === undefined || value === null ? '' : String(value);
}
