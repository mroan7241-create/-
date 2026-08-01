// -------------------- بوابة تقديم الجمعيات العامة --------------------
//
// نموذج عام لا يتطلب تسجيل دخول: أي جمعية جديدة تقدّم طلب انضمام،
// والإدارة تراجعه من داخل بوابتها فتقبله (فيُنشأ سجل الجمعية وحساب
// الدخول تلقائيًا بكلمة مرور مؤقتة تُعرض للمراجع مرة واحدة فقط ولا
// تُخزَّن أو تُسجَّل في أي مكان) أو ترفضه مع توضيح السبب لمقدّم الطلب.

function applicationsSheetReady_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(APP.sheets.applications) : null;
  return !!sheet;
}

function submitAssociationApplication(payload) {
  beginRequest_('submitAssociationApplication');
  return withMeta_(submitAssociationApplication_(payload));
}

function submitAssociationApplication_(payload) {
  payload = payload || {};
  if (!applicationsSheetReady_()) {
    throw new Error('استقبال طلبات الانضمام غير مفعّل حاليًا. يرجى التواصل مع إدارة المشروع');
  }
  const email = requiredEmail_(payload.email);
  const phone = normalizePhone_(payload.phone);
  throttle_('apply:' + hashSecret_(email, 'rate'), 5, 3600);

  const place = validateRegionCity_(payload.region, payload.city);
  const values = {
    'اسم الجمعية': requiredText_(payload.name, 'اسم الجمعية', 150),
    'التصنيف': validateAssociationCategory_(payload.category),
    'المنطقة': place.region,
    'المدينة': place.city,
    'أرقام التواصل': phone,
    'البريد الإلكتروني': email,
    'اسم المسؤول': requiredText_(payload.contactName, 'اسم المسؤول', 100),
    'ملاحظات مقدّم الطلب': cleanText_(payload.notes, 500),
    'الحالة': 'قيد المراجعة',
    'سبب الرفض': '', 'رقم الجمعية الناتجة': '',
    'تاريخ التقديم': now_(), 'تاريخ المراجعة': '', 'المراجع': ''
  };

  if (findUserByEmail_(email)) {
    throw new Error('هذا البريد الإلكتروني مرتبط بحساب قائم بالفعل');
  }
  const duplicate = readTable_(APP.sheets.applications).rows.find(row =>
    String(row['الحالة']) === 'قيد المراجعة' &&
    (String(row['البريد الإلكتروني']).trim().toLowerCase() === email ||
     String(row['أرقام التواصل']) === phone)
  );
  if (duplicate) {
    throw new Error('يوجد طلب سابق قيد المراجعة بنفس البريد الإلكتروني أو رقم الجوال');
  }

  const id = nextId_('APP');
  appendObject_(APP.sheets.applications, Object.assign({'رقم الطلب': id}, values));
  clearDashboardCache();
  return {ok: true, id: id, message: 'تم استلام طلب الانضمام وسيتم التواصل معكم بعد المراجعة'};
}

/**
 * تاريخا التقديم والمراجعة كانا يُعادان كنص خام (String(row[...])) دون
 * المرور بـ parseDate_/formatDateTime_ — Google Sheets يحوّل نصًا شبيهًا
 * بتاريخ (كالمُخزَّن عبر now_()) إلى خلية Date فعليًا أحيانًا، فكانت
 * القراءة التالية تُعيد كائن JS Date خامًا وString() عليه ينتج صيغة
 * إنجليزية تقنية مثل "Thu Jan 01 2026 00:00:00 GMT+0300" بدل تاريخ عربي
 * منسَّق — هذا هو عطل "تواريخ JavaScript غير المنسَّقة" المرصود حيًّا.
 */
function normalizeApplication_(row) {
  return {
    id: String(row['رقم الطلب']), name: String(row['اسم الجمعية']),
    category: String(row['التصنيف'] || ''), region: String(row['المنطقة']), city: String(row['المدينة']),
    phone: displayPhone_(row['أرقام التواصل']), email: String(row['البريد الإلكتروني']),
    contactName: String(row['اسم المسؤول'] || ''), notes: String(row['ملاحظات مقدّم الطلب'] || ''),
    status: String(row['الحالة']), rejectionReason: String(row['سبب الرفض'] || ''),
    resultingAssociationId: String(row['رقم الجمعية الناتجة'] || ''),
    submittedAt: formatDateTime_(parseDate_(row['تاريخ التقديم'])),
    reviewedAt: formatDateTime_(parseDate_(row['تاريخ المراجعة'])),
    reviewer: String(row['المراجع'] || '')
  };
}

function getAssociationApplications_() {
  if (!applicationsSheetReady_()) return [];
  return readTable_(APP.sheets.applications).rows
    .map(normalizeApplication_)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
}

/**
 * طلبات الانضمام — عدد الطلبات صغير طبيعيًا (لا يتناسب مع نمو المستفيدين)
 * لكنها تبقى ضمن الأقسام "الثقيلة" التي لا تُحمَّل إلا عند فتح الصفحة،
 * لا ضمن Bootstrap الأولي — لذلك مُرقَّمة بنفس النمط العام للاتساق.
 */
function listApplications(token, options) {
  return perfTime_('listApplications', () => {
    const user = requireSession_(token, ['ADMIN']);
    return withMeta_(listApplications_(user, options));
  });
}

function listApplications_(user, options) {
  options = options || {};
  let items = getAssociationApplications_();
  items = applySearch_(items, options.search, ['name', 'id', 'email', 'contactName']);
  if (options.filter) items = items.filter(item => item.status === options.filter);
  return Object.assign({ok: true}, paginate_(items, options));
}

/** يُبقى للتوافق الخلفي إن استُدعي من أي مكان قديم — يعيد كل الطلبات بلا ترقيم. */
function listAssociationApplications(token) {
  requireSession_(token, ['ADMIN']);
  return {ok: true, applications: getAssociationApplications_()};
}

/**
 * يجب أن تضمن حرفًا لاتينيًا ورقمًا معًا دائمًا بالبناء لا بالاحتمال
 * (شرط assertStrongPassword_ يفحص A-Za-z ورقمًا تحديدًا، ولا يكفيه
 * الاعتماد على عشوائية UUID وحدها التي قد تُنتج مقطعًا بلا أي رقم).
 */
function generateTempPassword_() {
  const randomPart = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  const digitPart = String(new Date().getTime()).slice(-4);
  return 'Zad-' + randomPart + '-' + digitPart;
}

/**
 * القبول يُنشئ جمعية وحسابًا بكلمة مرور — إعادة محاولة بعد مهلة واجهة
 * يجب ألّا تُنشئ جمعيتين مكرَّرتين؛ لذلك يُلفّ فرع القبول بـ withIdempotency_.
 */
function reviewAssociationApplication(token, id, decision, reason, opId) {
  const user = requireSession_(token, ['ADMIN']);
  id = cleanId_(id);

  if (decision === 'accept') {
    return withIdempotency_(user.id, opId, () => withApplicationDecisionLock_(id, () => {
      // كل شيء داخل القفل: إعادة قراءة الطلب والتحقق من حالته ثم الكتابة.
      // بدون هذا، نقرتان متزامنتان (أو نقرة + إعادة محاولة بعد انقطاع
      // اتصال بـopId مختلف) تجتازان فحص "قيد المراجعة" كلتاهما فتُنشئان
      // جمعيتين وحسابَي دخول لنفس الطلب. القفل يجعل القرار ذرّيًا فعليًا،
      // وwithIdempotency_ يجعل إعادة المحاولة بنفس opId تُعيد النتيجة
      // الأصلية بدل تنفيذ ثانٍ — الطبقتان مكمّلتان لا بديلتان.
      invalidateTableCache_(APP.sheets.applications);
      const application = findById_(APP.sheets.applications, 'رقم الطلب', id);
      if (!application) throw new Error('طلب الانضمام غير موجود');
      if (String(application['الحالة']) !== 'قيد المراجعة') throw new Error('سبق البتّ في هذا الطلب');
      const email = String(application['البريد الإلكتروني']);
      if (findUserByEmail_(email)) throw new Error('البريد الإلكتروني مستخدم في حساب آخر الآن');
      const associationId = nextId_('ASC');
      const tempPassword = generateTempPassword_();
      appendObject_(APP.sheets.associations, {
        'رقم الجمعية': associationId, 'اسم الجمعية': String(application['اسم الجمعية']),
        'التصنيف': String(application['التصنيف'] || ''), 'المنطقة': String(application['المنطقة']),
        'المدينة': String(application['المدينة']), 'أرقام التواصل': String(application['أرقام التواصل']),
        'البريد الإلكتروني': email, 'الحالة': 'نشطة', 'تاريخ الإنشاء': now_()
      });
      createAssociationUser_(associationId, String(application['اسم الجمعية']), email, tempPassword);
      updateById_(APP.sheets.applications, 'رقم الطلب', id, {
        'الحالة': 'مقبول', 'رقم الجمعية الناتجة': associationId,
        'تاريخ المراجعة': now_(), 'المراجع': user.name
      });
      audit_(user, 'قبول طلب انضمام جمعية', 'طلبات الانضمام', id, 'الجمعية الناتجة: ' + associationId);
      clearDashboardCache();
      const record = normalizeApplication_(findById_(APP.sheets.applications, 'رقم الطلب', id));
      return {ok: true, associationId: associationId, temporaryPassword: tempPassword, record: record,
        summary: {associations: computeAssociationsCount_()}};
    }));
  }

  if (decision === 'reject') {
    // الرفض أيضًا قرار نهائي لا يجوز تنفيذه مرتين: نفس القفل ونفس
    // الحماية من التكرار (كان بلا أي منهما قبل هذه المرحلة).
    return withIdempotency_(user.id, opId, () => withApplicationDecisionLock_(id, () => {
      invalidateTableCache_(APP.sheets.applications);
      const application = findById_(APP.sheets.applications, 'رقم الطلب', id);
      if (!application) throw new Error('طلب الانضمام غير موجود');
      if (String(application['الحالة']) !== 'قيد المراجعة') throw new Error('سبق البتّ في هذا الطلب');
      const rejectionReason = requiredText_(reason, 'سبب الرفض', 300);
      updateById_(APP.sheets.applications, 'رقم الطلب', id, {
        'الحالة': 'مرفوض', 'سبب الرفض': rejectionReason,
        'تاريخ المراجعة': now_(), 'المراجع': user.name
      });
      audit_(user, 'رفض طلب انضمام جمعية', 'طلبات الانضمام', id, rejectionReason);
      clearDashboardCache();
      return {ok: true, record: normalizeApplication_(findById_(APP.sheets.applications, 'رقم الطلب', id))};
    }));
  }

  throw new Error('قرار غير معروف');
}

/** قفل موحّد لكل قرار على طلب انضمام (قبول أو رفض) — يضمن ذرّية القرار الواحد. */
function withApplicationDecisionLock_(id, fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

