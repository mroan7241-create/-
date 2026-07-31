// -------------------- بيانات الواجهة --------------------

/**
 * يُخزَّن ناتج البوابة الكامل مؤقتًا لكل دور/جمعية/مندوب لمدة قصيرة
 * (APP.cacheSeconds)، فلا يعيد كل دخول أو تحديث أو تنقل بين المتصفحات
 * قراءة كل الأوراق من جديد إن كان هناك طلب حديث بالفعل لنفس الفاعل أو
 * نفس نطاقه. كل عملية تعديل (save*) تُحدّث الحالة عبر استجابة جزئية الآن
 * (سجل + ملخص فقط — راجع كل دالة save* لتفاصيلها) بدل استدعاء
 * getBootstrapData(token, true) كما كان سابقًا؛ لذلك كل كتابة تستدعي
 * clearDashboardCache() لإبطال هذه الذاكرة المؤقتة حتى لا يبقى Bootstrap
 * القديم صالحًا لأي طلب لاحق يطلبه (كتحديث الصفحة أو دخول جديد).
 *
 * ⚠️ تغيير مهم في هذه المرحلة: Bootstrap الأولي لم يعد يتضمّن القوائم
 * الثقيلة (المستفيدون، سجل العمليات، الأنشطة وشواهدها، طلبات الانضمام).
 * الواجهة تجلبها بشكل منفصل ومُرقَّم عند فتح الصفحة المعنية فقط
 * (listBeneficiaries/listAuditLog/getActivitiesBundle/listApplications) —
 * راجع RELEASE.md قسم "الأداء" للتفصيل الكامل ولماذا لا يزال حساب
 * summary/alerts يتطلّب قراءة كاملة لبعض الجداول رغم ذلك.
 */
/**
 * جيل واحد مشترك لكل مفاتيح Bootstrap المخزَّنة مؤقتًا — نفس مبدأ
 * actorEpoch_ المُستخدَم لإبطال الجلسات (Auth.gs)، مطبَّق هنا على ذاكرة
 * Bootstrap المؤقتة تحديدًا. clearDashboardCache() كانت تحذف مفتاح
 * 'bootstrap:ADMIN' فقط فعليًا رغم أن كل مسارات الحفظ (بما فيها حفظ
 * مستفيد/جهاز/استيراد جماعي من جمعية) تستدعيها معتقدة أنها تُبطل ذاكرتها
 * الخاصة أيضًا — فتبقى لوحة بيانات الجمعية أو المندوب تعرض أرقامًا قديمة
 * حتى انتهاء APP.cacheSeconds رغم قوائم (listBeneficiaries وغيرها) تعرض
 * البيانات الصحيحة فورًا من نفس اللحظة. رفع الجيل يُبطل كل المفاتيح دفعة
 * واحدة بصرف النظر عن الفاعل أو الجمعية، فتبقى الأرقام المحسوبة في لوحة
 * البيانات مطابقة دائمًا لما تعرضه القوائم الفعلية من المصدر نفسه.
 */
function dashboardCacheGeneration_() {
  return Number(PropertiesService.getScriptProperties().getProperty('DASHBOARD_CACHE_GEN') || 0);
}

function bootstrapCacheKey_(user) {
  const suffix = ':g' + dashboardCacheGeneration_();
  if (user.role === 'ADMIN') return 'bootstrap:ADMIN' + suffix;
  if (user.role === 'ASSOCIATION') return 'bootstrap:ASSOCIATION:' + user.associationId + suffix;
  return 'bootstrap:DELEGATE:' + user.id + suffix;
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

  const data = perfTime_('getBootstrapData:' + user.role, () =>
    user.role === 'DELEGATE' ? buildDelegatePortal_(user)
      : user.role === 'ASSOCIATION' ? buildAssociationPortal_(user)
      : buildAdminPortal_(user)
  );

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

/**
 * لوحة الإدارة — الآن بلا: الأنشطة/المراحل/الشواهد (من getActivitiesBundle)،
 * طلبات الانضمام (من listApplications)، سجل العمليات (من listAuditLog) —
 * الثلاثة الأكثر ثقلًا نسبةً لتكرار استخدامها (تُفتح غالبًا مرة كل جلسة،
 * لا في كل تنقّل). المستفيدون/الجمعيات/الأجهزة/المناديب **بقيت في
 * Bootstrap لهذه المرحلة عمدًا**: عشرات المواضع في الواجهة (نماذج تخصيص
 * الأجهزة، تعيين المندوب، البحث الفوري، عدّادات لوحة البيانات القابلة
 * للنقر) تفترض وجودها كمصفوفة كاملة محليًا؛ فصلها الكامل إلى تحميل
 * مُرقَّم يتطلّب إعادة كتابة تلك المواضع كافة والتحقق منها في متصفح حي —
 * غير متاح داخل بيئة هذه الجلسة (لا وصول لـ Apps Script حي). الخادم
 * يوفّر الآن listBeneficiaries/listDevices/listAssociations/listDelegates
 * مُرقَّمة وجاهزة ومختبَرة لدمج الواجهة بها لاحقًا — راجع HANDOFF.md/
 * RELEASE.md لتفاصيل هذا القرار وأثره على حجم الحمولة عند نمو البيانات.
 */
function buildAdminPortal_(user) {
  const associations = readTable_(APP.sheets.associations).rows;
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  const devices = readTable_(APP.sheets.devices).rows;
  const delegates = readTable_(APP.sheets.delegates).rows;
  // summary/alerts تحتاج فعليًا قراءة كاملة لجدولي الأنشطة/الشواهد حتى
  // لو لم يصلا للعميل ضمن الحمولة — هذه تكلفة قراءة لا يمكن تفاديها في
  // بنية Sheets الحالية دون فهرس مُجمَّع مستقل (راجع RELEASE.md).
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
    alerts: buildAlerts_(beneficiaries, associations, devices, activities, evidence),
    pendingApplicationsCount: countBy_(readTable_(APP.sheets.applications).rows, 'الحالة', 'قيد المراجعة'),
    // معاينة صغيرة فقط (لوحة البيانات تعرض ٧ سطور كحد أقصى) — التصفّح
    // الكامل المُرقَّم لسجل العمليات عبر listAuditLog عند فتح صفحته.
    audit: getAuditRows_(10, null)
  };
}

/** بوابة الجمعية — معاينة صغيرة لسجل العمليات فقط؛ التصفّح الكامل عبر listAuditLog. المستفيدون بقوا لنفس سبب لوحة الإدارة أعلاه. */
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
    audit: getAuditRows_(10, associationId)
  };
}

/**
 * بوابة المندوب لم تتغيّر — قائمة مستفيديه محدودة بطبيعتها (فقط من
 * عُيِّن له)، وليست مصدر النمو الذي يستهدفه الترقيم في هذه المرحلة.
 */
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

/**
 * ملخّص "سريع" لاستجابات الحفظ الجزئية — بلا الأنشطة (لا تتأثر بحفظ
 * مستفيد/جهاز/مندوب)، ومُقيَّد بجمعية واحدة عند تمرير associationId
 * (يطابق نطاق ما تملكه الجمعية أصلًا في state.data.summary لديها).
 * العميل يدمج هذا الكائن جزئيًا (Object.assign) فوق الملخص المحفوظ لديه
 * بدل استبداله بالكامل، فتبقى حقول لم تتأثر (كنِسَب الأنشطة) كما كانت.
 */
function computeCoreSummary_(associationId) {
  let beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  let devices = readTable_(APP.sheets.devices).rows;
  let delegates = readTable_(APP.sheets.delegates).rows;
  if (associationId) {
    beneficiaries = beneficiaries.filter(row => String(row['رقم الجمعية']) === associationId);
    devices = devices.filter(row => String(row['رقم الجمعية']) === associationId);
    delegates = delegates.filter(row => String(row['رقم الجمعية']) === associationId);
  }
  const deliveredBeneficiaries = beneficiaries.filter(row => String(row['حالة التسليم']) === 'تم التسليم').length;
  const validBeneficiaries = beneficiaries.filter(row => String(row['حالة المستفيد']) !== 'ملغي').length;
  return {
    beneficiaries: beneficiaries.length,
    delegates: delegates.filter(row => String(row['الحالة']) !== 'غير نشط').length,
    devices: devices.length,
    devicesWarehouse: countBy_(devices, 'حالة الجهاز', 'بالمستودع'),
    devicesAllocated: devices.filter(row => ['مخصص', 'مع المندوب'].indexOf(String(row['حالة الجهاز'])) >= 0).length,
    devicesDelivered: countBy_(devices, 'حالة الجهاز', 'تم التسليم'),
    deliveryRate: validBeneficiaries ? Math.round(deliveredBeneficiaries / validBeneficiaries * 100) : 0
  };
}

/** يُستخدم في استجابة saveAssociation الجزئية — يضيف عدد الجمعيات (لا يتغيّر من عمليات أخرى). */
function computeAssociationsCount_() {
  return readTable_(APP.sheets.associations).rows.length;
}
