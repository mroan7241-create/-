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

const ACTIVITY_STATUSES = ['لم يبدأ', 'جارٍ', 'متأخر', 'مكتمل'];

/**
 * إضافة نشاط رئيسي/فرعي جديد أو تعديل نشاط قائم. لا يوجد عمود رقم
 * تسلسلي مستقل في ورقة "إدارة الأنشطة" (تصميم قائم منذ البداية)، لذا
 * تُطابَق الأنشطة القائمة بثلاثية (المرحلة، النشاط الرئيسي، النشاط
 * الفرعي) الأصلية قبل التعديل — وهي نفس المفتاح المركّب الذي تستخدمه
 * getMainActivities_ وgetStagesData_ للتجميع أصلًا.
 */
function saveActivity(token, payload) {
  const user = requireSession_(token, ['ADMIN']);
  payload = payload || {};
  const status = cleanText_(payload.status, 50);
  if (status && ACTIVITY_STATUSES.indexOf(status) === -1) throw new Error('حالة النشاط غير معروفة');
  const values = {
    'ترتيب المرحلة': boundedNumber_(payload.stageOrder, 0, 999, 'ترتيب المرحلة'),
    'اسم المرحلة': requiredText_(payload.stage, 'اسم المرحلة', 150),
    'ترتيب النشاط الرئيسي': boundedNumber_(payload.mainOrder, 0, 999, 'ترتيب النشاط الرئيسي'),
    'اسم النشاط الرئيسي': requiredText_(payload.mainActivity, 'اسم النشاط الرئيسي', 180),
    'اسم النشاط الفرعي': requiredText_(payload.subActivity, 'اسم النشاط الفرعي', 180),
    'المسؤول': cleanText_(payload.owner, 120),
    'تاريخ البداية': payload.startDate || '',
    'تاريخ النهاية': payload.endDate || '',
    'نسبة الإنجاز': boundedNumber_(payload.progress, 0, 100, 'نسبة الإنجاز'),
    'الحالة': status,
    'رابط الشاهد': safeUrl_(payload.evidenceUrl),
    'ملاحظات': cleanText_(payload.notes, 1000)
  };

  const hasOriginal = payload.originalStage && payload.originalMainActivity && payload.originalSubActivity;
  if (hasOriginal) {
    const matched = updateRowByMatch_(APP.sheets.activities, {
      'اسم المرحلة': cleanText_(payload.originalStage, 150),
      'اسم النشاط الرئيسي': cleanText_(payload.originalMainActivity, 180),
      'اسم النشاط الفرعي': cleanText_(payload.originalSubActivity, 180)
    }, values);
    if (!matched) throw new Error('النشاط الأصلي غير موجود — رُبما عُدِّل أو حُذف من مكان آخر');
    audit_(user, 'تعديل نشاط', 'الأنشطة', values['اسم النشاط الفرعي'], values['اسم المرحلة'] + ' / ' + values['اسم النشاط الرئيسي']);
  } else {
    appendObject_(APP.sheets.activities, values);
    audit_(user, 'إضافة نشاط', 'الأنشطة', values['اسم النشاط الفرعي'], values['اسم المرحلة'] + ' / ' + values['اسم النشاط الرئيسي']);
  }
  clearDashboardCache();
  return {ok: true, data: getBootstrapData(token, true)};
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
  return {ok: true, data: getBootstrapData(token, true)};
}

/**
 * متاحة أيضًا لحساب "يجب تغيير كلمة المرور" (allowMustChangePassword)
 * كي يتمكن من كسر القفل بتغييرها فعليًا — بقية دوال الخادم تبقى مرفوضة
 * له طالما لم يُنجز هذا التغيير.
 */
function changePassword(token, currentPassword, newPassword) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION'], {allowMustChangePassword: true});
  const record = findById_(APP.sheets.users, 'رقم المستخدم', user.id);
  if (!record || !constantTimeEquals_(String(record['كلمة المرور المشفرة']), hashSecret_(String(currentPassword || ''), String(record['الملح'])))) {
    throw new Error('كلمة المرور الحالية غير صحيحة');
  }
  newPassword = String(newPassword || '');
  if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    throw new Error('كلمة المرور الجديدة يجب أن تكون 10 خانات على الأقل وتضم حروفًا وأرقامًا');
  }
  if (constantTimeEquals_(hashSecret_(newPassword, String(record['الملح'])), String(record['كلمة المرور المشفرة']))) {
    throw new Error('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
  }
  // منع إعادة استخدام كلمة المرور السابقة مباشرة (طبقة حماية واحدة ضمن
  // البنية الحالية — لا يُحفظ سجل كامل لكل كلمات المرور القديمة، فقط
  // آخر واحدة سبقت الحالية).
  const previousSalt = String(record['ملح سابق'] || '');
  const previousHash = String(record['كلمة مرور سابقة مشفرة'] || '');
  if (previousSalt && previousHash && constantTimeEquals_(hashSecret_(newPassword, previousSalt), previousHash)) {
    throw new Error('لا يمكن استخدام كلمة المرور السابقة نفسها. اختر كلمة مرور مختلفة');
  }
  const salt = Utilities.getUuid();
  updateById_(APP.sheets.users, 'رقم المستخدم', user.id, {
    'كلمة مرور سابقة مشفرة': record['كلمة المرور المشفرة'],
    'ملح سابق': record['الملح'],
    'كلمة المرور المشفرة': hashSecret_(newPassword, salt),
    'الملح': salt,
    'يجب تغيير كلمة المرور': 'لا'
  });
  audit_(user, 'تغيير كلمة المرور', 'الإعدادات', user.id, '');
  // تغيير كلمة المرور يُبطل بقية الجلسات على الأجهزة الأخرى (وهذه الجلسة
  // نفسها أيضًا — يجب تسجيل الدخول من جديد بكلمة المرور الجديدة).
  revokeSessions_(user.id);
  return {ok: true};
}

function buildAlerts_(beneficiaries, associations, devices, activities, evidence) {
  const alerts = [];
  const pendingApplications = getAssociationApplications_().filter(x => x.status === 'قيد المراجعة').length;
  if (pendingApplications) alerts.push({
    level: 'high', title: 'طلبات انضمام بانتظار المراجعة',
    message: pendingApplications + ' طلب جمعية جديدة قيد المراجعة', section: 'طلبات الانضمام'
  });
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

/**
 * تُستدعى بعد أي تعديل. الفاعل الذي نفّذ التعديل يرى أثره فورًا دائمًا
 * (getBootstrapData(token, true) في كل دالة تعديل يتجاوز الذاكرة
 * المؤقتة). هذه الدالة إضافيًا تُبطل عرض الإدارة الكلي كي لا يبقى
 * المدير على صورة قديمة حتى انتهاء صلاحية الذاكرة المؤقتة (حتى 60
 * ثانية) بعد تعديل تُجريه جمعية أو مندوب.
 */
function clearDashboardCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('dashboard');
  cache.remove('bootstrap:ADMIN');
  return {ok: true};
}

