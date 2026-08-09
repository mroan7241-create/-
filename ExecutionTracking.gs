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
 * حزمة الأنشطة الكاملة (أنشطة + مراحل + شواهد) — لم تعد ضمن Bootstrap
 * الأولي؛ تُجلب فقط عند فتح صفحة "متابعة المشروع". عدد الأنشطة صغير
 * نسبيًا (لا يتناسب مع نمو المستفيدين) فلم تُرقَّم صفحاتها هنا؛ الأولوية
 * كانت لترقيم المستفيدين وسجل العمليات (أكبر مصدرَي نمو فعليَّين).
 */
function getActivitiesBundle(token) {
  return perfTime_('getActivitiesBundle', () => {
    requireSession_(token, ['ADMIN']);
    const activities = getActivitiesData_();
    return {ok: true, activities: activities, stages: getStagesData_(activities), evidence: getMainActivityEvidence_()};
  });
}

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
  const activities = getActivitiesData_();
  const completedActivities = activities.filter(row => safeNumber_(row.progress) >= 100).length;
  return {
    ok: true,
    activities: activities,
    stages: getStagesData_(activities),
    summary: {
      activityRate: activities.length ? Math.round(completedActivities / activities.length * 100) : 0,
      completedActivities: completedActivities,
      totalActivities: activities.length
    }
  };
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
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows.filter(row => String(row['رقم الجمعية']) === user.associationId);
  const devices = readTable_(APP.sheets.devices).rows.filter(row => String(row['رقم الجمعية']) === user.associationId);
  const delegates = readTable_(APP.sheets.delegates).rows.filter(row => String(row['رقم الجمعية']) === user.associationId);
  const association = normalizeAssociation_(findById_(APP.sheets.associations, 'رقم الجمعية', user.associationId), beneficiaries, devices, delegates);
  return {ok: true, association: association};
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
  newPassword = assertPasswordPolicy_(newPassword, record);
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

/**
 * أجهزة في حالة تتعارض منطقيًا مع حالة المستفيد المرتبط بها — تعريف
 * واحد يُعاد استخدامه بين buildAlerts_ ووحدة الأجهزة في لوحة التحكم
 * التنفيذية، بلا أي قراءة إضافية (يُمرَّر له ما سبق تحميله فعلًا).
 */
function deviceConflicts_(devices, beneficiaries) {
  const beneficiaryById = {};
  beneficiaries.forEach(row => { beneficiaryById[String(row['رقم المستفيد'])] = row; });
  return devices.filter(device => {
    if (String(device['حالة الجهاز']) !== 'تم التسليم') return false;
    const beneficiaryId = String(device['رقم المستفيد'] || '');
    if (!beneficiaryId) return true;
    const beneficiary = beneficiaryById[beneficiaryId];
    return !beneficiary || String(beneficiary['حالة التسليم']) !== 'تم التسليم';
  });
}

/**
 * ملخّص ست وحدات لوحة التحكم التنفيذية — يُحسَب بالكامل من المصفوفات
 * المحمَّلة أصلًا في buildAdminPortal_ (مستفيدون/جمعيات/أجهزة/مناديب/
 * أنشطة/طلبات انضمام)، **بلا أي قراءة Sheets إضافية إطلاقًا**. كل رقم
 * هنا له مقام واضح (نسبة من ماذا) بدل رقم مجرَّد، وكل حقل مرتبط بصفحة
 * وفلتر فعليَّين في الواجهة للنقر المباشر.
 */
function buildDashboardModules_(beneficiaries, associations, devices, delegates, activities, evidence, applications) {
  const validBeneficiaries = beneficiaries.filter(row => String(row['حالة المستفيد']) !== 'ملغي');
  const beneficiaryCount = status => countBy_(beneficiaries, 'حالة المستفيد', status);
  const delivered = beneficiaryCount('تم التسليم');
  const stalled = countBy_(beneficiaries, 'حالة التسليم', 'تعذر التسليم');
  // مرحلتان جديدتان في مسار المستفيد/التسليم (مرحلة الموقع الجغرافي):
  // "بانتظار تحديد الموقع" (لا إحداثيات مؤكَّدة بعد) و"جاهز للإحالة"
  // (الموقع مؤكَّد + توجد أجهزة "مخصص" + لم يخرج بعد) — نفس التعريفين
  // المستخدَمين حرفيًا في فلتري listBeneficiaries_ الاصطناعيين، فتُطابق
  // هذه الأرقام دائمًا نتيجة النقر على المؤشر المقابل لها.
  const locationPending = validBeneficiaries.filter(row => !beneficiaryLocationConfirmed_(row)).length;
  const allocatedBeneficiaryIds = new Set(
    devices.filter(device => String(device['حالة الجهاز']) === 'مخصص').map(device => String(device['رقم المستفيد']))
  );
  const readyForReferral = validBeneficiaries.filter(row =>
    beneficiaryLocationConfirmed_(row) && String(row['حالة التسليم']) === 'لم يبدأ' && allocatedBeneficiaryIds.has(String(row['رقم المستفيد']))
  ).length;

  const deviceCount = status => countBy_(devices, 'حالة الجهاز', status);
  const conflicts = deviceConflicts_(devices, beneficiaries).length;

  const activeAssociations = countBy_(associations, 'الحالة', 'نشطة');
  const inactiveAssociations = associations.length - activeAssociations;
  const pendingApplications = applications.filter(x => x.status === 'قيد المراجعة').length;
  const acceptedApplications = applications.filter(x => x.status === 'مقبول').length;
  const rejectedApplications = applications.filter(x => x.status === 'مرفوض').length;
  const associationsNeedingFollowUp = associations.filter(association => {
    const id = String(association['رقم الجمعية']);
    const assigned = devices.filter(device => String(device['رقم الجمعية']) === id).length;
    const associationDelivered = devices.filter(device => String(device['رقم الجمعية']) === id && String(device['حالة الجهاز']) === 'تم التسليم').length;
    return assigned > 0 && associationDelivered === 0;
  }).length;
  const totalAssociationDevices = devices.length;
  const totalAssociationDelivered = deviceCount('تم التسليم');

  const completedActivities = activities.filter(x => x.status === 'مكتمل').length;
  const inProgressActivities = activities.filter(x => x.status === 'جارٍ').length;
  const upcomingActivities = activities.filter(x => x.status === 'لم يبدأ').length;
  const lateActivities = activities.filter(x => x.status === 'متأخر').length;
  const missingEvidence = activities.filter(x => x.progress >= 100 && !x.evidenceUrl).length;
  // "أقرب موعد قادم": بين الأنشطة الجارية أو لم تبدأ فقط (لا المكتملة ولا
  // المتأخرة أصلًا — تلك تُعرَض عبر "متأخر" ومركز التنبيهات، لا كموعد
  // قادم) وبمدة متبقية غير سالبة، فلا يظهر نشاط تجاوز موعده كأنه "قادم".
  const nextActivity = activities
    .filter(x => (x.status === 'جارٍ' || x.status === 'لم يبدأ') && x.endDate && x.remainingDays >= 0)
    .sort((a, b) => a.remainingDays - b.remainingDays)[0];

  return {
    beneficiaries: {
      total: beneficiaries.length,
      new: beneficiaryCount('جديد'), underReview: beneficiaryCount('تحت المراجعة'),
      approved: beneficiaryCount('معتمد'), locationPending: locationPending,
      awaitingDevices: beneficiaryCount('بانتظار الأجهزة'), readyForReferral: readyForReferral,
      delivering: beneficiaryCount('جاري التسليم'), delivered: delivered, stalled: stalled,
      deliveryRate: {value: validBeneficiaries.length ? Math.round(delivered / validBeneficiaries.length * 100) : 0,
        numerator: delivered, denominator: validBeneficiaries.length}
    },
    devices: {
      total: devices.length, warehouse: deviceCount('بالمستودع'), allocated: deviceCount('مخصص'),
      withDelegate: deviceCount('مع المندوب'), delivered: totalAssociationDelivered,
      damaged: deviceCount('تالف'), conflicts: conflicts
    },
    associations: {
      total: associations.length, active: activeAssociations, inactive: inactiveAssociations,
      pendingApplications: pendingApplications, acceptedApplications: acceptedApplications,
      rejectedApplications: rejectedApplications, needsFollowUp: associationsNeedingFollowUp,
      progressRate: {value: totalAssociationDevices ? Math.round(totalAssociationDelivered / totalAssociationDevices * 100) : 0,
        numerator: totalAssociationDelivered, denominator: totalAssociationDevices}
    },
    activities: {
      total: activities.length, completed: completedActivities, inProgress: inProgressActivities,
      upcoming: upcomingActivities, late: lateActivities, missingEvidence: missingEvidence,
      progressRate: {value: activities.length ? Math.round(completedActivities / activities.length * 100) : 0,
        numerator: completedActivities, denominator: activities.length},
      nextDeadline: nextActivity ? {label: nextActivity.subActivity || nextActivity.mainActivity, daysLeft: nextActivity.remainingDays} : null
    }
  };
}

function buildAlerts_(beneficiaries, associations, devices, activities, evidence) {
  const alerts = [];
  const applications = getAssociationApplications_();
  const pendingApplications = applications.filter(x => x.status === 'قيد المراجعة').length;
  if (pendingApplications) alerts.push({
    level: 'high', title: 'طلبات انضمام بانتظار المراجعة',
    message: pendingApplications + ' طلب جمعية جديدة قيد المراجعة', section: 'طلبات الانضمام',
    page: 'applications', filter: 'قيد المراجعة'
  });
  activities.filter(x => x.status === 'متأخر').forEach(x => alerts.push({
    level: 'critical', title: 'نشاط متأخر', message: x.subActivity || x.mainActivity, section: 'الأنشطة',
    page: 'activities'
  }));
  activities.filter(x => x.progress >= 100 && !x.evidenceUrl).forEach(x => alerts.push({
    level: 'high', title: 'نشاط مكتمل دون شاهد', message: x.subActivity || x.mainActivity, section: 'الشواهد',
    page: 'activities'
  }));
  associations.forEach(association => {
    const id = String(association['رقم الجمعية']);
    const assigned = devices.filter(device => String(device['رقم الجمعية']) === id).length;
    const delivered = devices.filter(device => String(device['رقم الجمعية']) === id && String(device['حالة الجهاز']) === 'تم التسليم').length;
    if (assigned > 0 && delivered === 0) alerts.push({
      level: 'high', title: 'جمعية تحتاج متابعة', message: String(association['اسم الجمعية']), section: 'الجمعيات',
      page: 'associations'
    });
  });
  // موقع غير مؤكَّد يمنع الإحالة خادميًا (assignDelegate) — أولوية عالية
  // لأنه يوقف المسار كله لهذا المستفيد قبل أي خطوة تالية ممكنة.
  const beneficiariesLocationPending = beneficiaries.filter(row =>
    String(row['حالة المستفيد']) !== 'ملغي' && !beneficiaryLocationConfirmed_(row)
  ).length;
  if (beneficiariesLocationPending) alerts.push({
    level: 'high', title: 'مستفيدون بانتظار تحديد الموقع', message: beneficiariesLocationPending + ' مستفيدًا بلا موقع مؤكَّد على الخريطة',
    section: 'المستفيدون', page: 'beneficiaries', filter: 'بانتظار تحديد الموقع'
  });
  const beneficiariesWithoutDelegate = beneficiaries.filter(row =>
    String(row['حالة المستفيد']) !== 'ملغي' && String(row['حالة التسليم']) === 'لم يبدأ' && !String(row['رقم المندوب'])
  ).length;
  if (beneficiariesWithoutDelegate) alerts.push({
    level: 'medium', title: 'مستفيدون بلا مندوب', message: beneficiariesWithoutDelegate + ' مستفيدًا بانتظار تعيين مندوب',
    section: 'المستفيدون', page: 'beneficiaries', filter: 'لم يبدأ'
  });
  // أجهزة خُصصت فعليًا وموقع المستفيد مؤكَّد — كل شرط الإحالة متوفر، لا
  // ينقصه سوى ضغطة "تعيين مندوب" واحدة؛ تنبيه إيجابي قابل للفعل الفوري.
  const beneficiariesReadyForReferral = beneficiaries.filter(row => {
    if (String(row['حالة المستفيد']) === 'ملغي' || String(row['حالة التسليم']) !== 'لم يبدأ') return false;
    if (!beneficiaryLocationConfirmed_(row)) return false;
    return devices.some(device => String(device['رقم المستفيد']) === String(row['رقم المستفيد']) && String(device['حالة الجهاز']) === 'مخصص');
  }).length;
  if (beneficiariesReadyForReferral) alerts.push({
    level: 'medium', title: 'مستفيدون جاهزون للإحالة', message: beneficiariesReadyForReferral + ' مستفيدًا لديهم أجهزة مخصَّصة وموقع مؤكَّد بانتظار تعيين مندوب',
    section: 'المستفيدون', page: 'beneficiaries', filter: 'جاهز للإحالة'
  });
  const beneficiariesAwaitingDevices = countBy_(beneficiaries, 'حالة المستفيد', 'بانتظار الأجهزة');
  if (beneficiariesAwaitingDevices) alerts.push({
    level: 'medium', title: 'مستفيدون بلا أجهزة', message: beneficiariesAwaitingDevices + ' مستفيدًا بانتظار تخصيص جهاز',
    section: 'المستفيدون', page: 'beneficiaries', filter: 'بانتظار الأجهزة'
  });
  const stalledDeliveries = countBy_(beneficiaries, 'حالة التسليم', 'تعذر التسليم');
  if (stalledDeliveries) alerts.push({
    level: 'high', title: 'تسليمات متعثرة', message: stalledDeliveries + ' تسليمًا يحتاج إعادة محاولة',
    section: 'المستفيدون', page: 'beneficiaries', filter: 'تعذر التسليم'
  });
  const invalid = deviceConflicts_(devices, beneficiaries).length;
  if (invalid) alerts.push({
    level: 'critical', title: 'تعارض حالة أجهزة', message: invalid + ' جهازًا بحالة "تم التسليم" لا تطابق حالة المستفيد المرتبط',
    section: 'الأجهزة', page: 'devices', filter: 'تم التسليم'
  });
  const priority = {critical: 0, high: 1, medium: 2, low: 3};
  alerts.sort((a, b) => (priority[a.level] || 9) - (priority[b.level] || 9));
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
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DASHBOARD_CACHE_GEN', String(dashboardCacheGeneration_() + 1));
  CacheService.getScriptCache().remove('dashboard');
  return {ok: true};
}

