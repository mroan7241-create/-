// -------------------- بيانات الواجهة --------------------

/**
 * يُخزَّن ناتج البوابة الكامل مؤقتًا لكل دور/جمعية/مندوب لمدة قصيرة
 * (APP.cacheSeconds)، فلا يعيد كل دخول أو تحديث أو تنقل بين المتصفحات
 * قراءة كل الأوراق من جديد إن كان هناك طلب حديث بالفعل لنفس الفاعل أو
 * نفس نطاقه. كل عملية تعديل (save*) تمرّر forceFresh=true فتتجاوز
 * الذاكرة المؤقتة وتكتب نتيجة جديدة فورًا، فيرى منفّذ التعديل أثره
 * فورًا دائمًا مهما كانت حالة الذاكرة المؤقتة.
 */
function bootstrapCacheKey_(user) {
  if (user.role === 'ADMIN') return 'bootstrap:ADMIN';
  if (user.role === 'ASSOCIATION') return 'bootstrap:ASSOCIATION:' + user.associationId;
  return 'bootstrap:DELEGATE:' + user.id;
}

function getBootstrapData(token, forceFresh) {
  const user = requireSession_(token);
  assertActorEnabled_(user.role, user.associationId);
  const cache = CacheService.getScriptCache();
  const cacheKey = bootstrapCacheKey_(user);

  if (!forceFresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (ignore) { /* تابع لإعادة الحساب */ }
    }
  }

  const data = user.role === 'DELEGATE' ? buildDelegatePortal_(user)
    : user.role === 'ASSOCIATION' ? buildAssociationPortal_(user)
    : buildAdminPortal_(user);

  try {
    const serialized = JSON.stringify(data);
    // حد CacheService 100 كيلوبايت لكل مفتاح — جمعية أو مندوب ضخم
    // قد يتجاوزه؛ في هذه الحالة نتجاوز التخزين المؤقت بأمان بدل الفشل.
    if (serialized.length < 95000) cache.put(cacheKey, serialized, APP.cacheSeconds);
  } catch (ignore) { /* لا يوقف الطلب — التخزين المؤقت تحسين، ليس شرطًا */ }

  return data;
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
    applications: getAssociationApplications_(),
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

