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
    'التصنيف': cleanText_(payload.category, 80),
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

function normalizeApplication_(row) {
  return {
    id: String(row['رقم الطلب']), name: String(row['اسم الجمعية']),
    category: String(row['التصنيف'] || ''), region: String(row['المنطقة']), city: String(row['المدينة']),
    phone: String(row['أرقام التواصل']), email: String(row['البريد الإلكتروني']),
    contactName: String(row['اسم المسؤول'] || ''), notes: String(row['ملاحظات مقدّم الطلب'] || ''),
    status: String(row['الحالة']), rejectionReason: String(row['سبب الرفض'] || ''),
    resultingAssociationId: String(row['رقم الجمعية الناتجة'] || ''),
    submittedAt: String(row['تاريخ التقديم'] || ''), reviewedAt: String(row['تاريخ المراجعة'] || ''),
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
    requireSession_(token, ['ADMIN']);
    options = options || {};
    let items = getAssociationApplications_();
    items = applySearch_(items, options.search, ['name', 'id', 'email', 'contactName']);
    if (options.filter) items = items.filter(item => item.status === options.filter);
    return Object.assign({ok: true}, paginate_(items, options));
  });
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
    return withIdempotency_(user.id, opId, () => {
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
    });
  }

  if (decision === 'reject') {
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
  }

  throw new Error('قرار غير معروف');
}

