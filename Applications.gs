// -------------------- بوابة تقديم الجمعيات العامة --------------------
//
// نموذج عام لا يتطلب تسجيل دخول: أي جمعية جديدة تقدّم طلب انضمام،
// والإدارة تراجعه من داخل بوابتها فتقبله (فيُنشأ سجل الجمعية وحساب
// الدخول تلقائيًا بكلمة مرور مؤقتة تُعرض للمراجع مرة واحدة فقط ولا
// تُخزَّن أو تُسجَّل في أي مكان) أو ترفضه مع توضيح السبب لمقدّم الطلب.
//
// ملاحظة أداء وموثوقية (السبب الجذري لبطء التقديم المرصود حيًّا، ~370
// ثانية مع نتيجة غير مؤكَّدة): الإصدار السابق كان يقرأ جدول الطلبات
// مرتين (فحص التكرار قبل nextId_، ثم nextId_ نفسها تقرأه مجددًا عبر
// existingIdsForPrefix_ غير المخزَّنة)، ويجري كل التحقق داخل قفل واحد
// طويل بلا داعٍ، ولا يملك أي آلية لمعرفة العميل ما إذا كان طلبه نجح
// فعليًا بعد انتهاء مهلة الواجهة. الإصلاح هنا: قراءة واحدة فقط لجدول
// الطلبات تُستخدَم لفحص التكرار وfحص idempotency معًا (وnextId_ تعيد
// استخدام نفس القراءة المخزَّنة بفضل إصلاح existingIdsForPrefix_ في
// DataUtils.gs)، ورفع ملف الترخيص إلى Drive قبل أي قفل (لا يحتاج قفلًا
// أصلًا)، والقفل نفسه لا يُحيط إلا بإعادة الفحص المختصرة + الكتابة.
// معرّف الطلب (clientRequestId) يولّده العميل مرة واحدة ويُخزَّن في عمود
// دائم، فأي إعادة إرسال بنفس المعرّف — حتى بعد دقائق، لا خمس دقائق فقط
// كما في withIdempotency_ القائمة على الذاكرة المؤقتة — تُعيد نفس نتيجة
// الطلب الأول دون كتابة سجل ثانٍ أو رفع ملف مكرَّر.

function applicationsSheetReady_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(APP.sheets.applications) : null;
  return !!sheet;
}

/** صيغة معرّف الطلب الذي يولّده العميل: نص عشوائي كافٍ الطول، بلا أي معنى أو بيانات مستخدم بداخله. */
function validClientRequestId_(value) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(value || ''));
}

function submitAssociationApplication(payload) {
  beginRequest_('submitAssociationApplication');
  return withMeta_(perfTime_('submitAssociationApplication', () => submitAssociationApplication_(payload)));
}

function submitAssociationApplication_(payload) {
  payload = payload || {};
  if (!applicationsSheetReady_()) {
    throw new Error('استقبال طلبات الانضمام غير مفعّل حاليًا. يرجى التواصل مع إدارة المشروع');
  }

  // فخ العناكب الآلية (honeypot): حقل مخفي في الواجهة لا يملؤه إنسان
  // أبدًا. أي قيمة فيه تعني برنامجًا آليًا — نرد نجاحًا صوريًا فورًا بلا
  // أي قراءة أو كتابة فعلية، حتى لا يميّز الفارس الآلي طلبه المرفوض عن
  // طلب حقيقي فيعاود المحاولة بصيغ مختلفة.
  if (cleanText_(payload.website, 200)) {
    return {ok: true, id: '', message: 'تم استلام طلب الانضمام وسيتم التواصل معكم بعد المراجعة'};
  }

  const clientRequestId = String(payload.clientRequestId || '').trim();
  if (!validClientRequestId_(clientRequestId)) {
    throw new Error('تعذّر التحقق من الطلب — يرجى إعادة تحميل الصفحة والمحاولة مجددًا');
  }

  // تحقق رخيص لا يمسّ الأوراق إطلاقًا (البيانات المرجعية مخزَّنة مؤقتًا
  // عبر CacheService) — يُنفَّذ قبل أي قراءة لجدول الطلبات حتى لا نتحمّل
  // كلفة القراءة على طلبات ستُرفض أصلًا لخطأ إدخال بسيط.
  const email = requiredEmail_(payload.email);
  const phone = normalizePhone_(payload.phone);
  const place = validateRegionCity_(payload.region, payload.city);
  const category = validateAssociationCategory_(payload.category);
  const sector = validateAssociationSector_(payload.sector);
  const licenseNumber = requiredText_(payload.licenseNumber, 'رقم الترخيص', 60);
  const licenseExpiry = requiredDate_(payload.licenseExpiryDate, 'تاريخ انتهاء الترخيص');
  const answers = {};
  APPLICATION_QUESTIONS.forEach(question => {
    answers[question.key] = requiredYesNo_((payload.answers || {})[question.key], question.label);
  });
  // تضارب منطقي واضح: لا يجوز الإقرار بأن الترخيص ساري وتاريخ انتهائه
  // في الماضي فعلًا — الواجهة تُنبّه لهذا مبكرًا، لكن الخادم يفرضه دائمًا
  // لأنه لا يثق بأي تحقق تم على جهاز العميل فقط.
  if (answers['الترخيص ساري'] === 'نعم') {
    const expiry = parseDate_(licenseExpiry);
    if (expiry && stripTime_(expiry) < stripTime_(new Date())) {
      throw new Error('تاريخ انتهاء الترخيص المُدخَل في الماضي، بينما أجبتم بأن الترخيص ساري — يرجى مراجعة التاريخ أو الإجابة');
    }
  }
  if (payload.pledgeAccepted !== true) {
    throw new Error('يجب الموافقة على نص الإقرار قبل إرسال الطلب');
  }

  // قراءة واحدة فقط لجدول الطلبات، تُستخدَم لثلاثة أغراض معًا: إعادة
  // إرسال بنفس clientRequestId، فحص التكرار بالبريد/الجوال/رقم الترخيص،
  // وتزويد nextId_('APP') لاحقًا (existingIdsForPrefix_ تعيد استخدام نفس
  // القراءة المخزَّنة في _TABLE_CACHE_ بدل قراءة ثانية للورقة نفسها).
  const table = readTable_(APP.sheets.applications);
  const existingByClientId = table.rows.find(row => String(row['معرف طلب العميل']) === clientRequestId);
  if (existingByClientId) {
    return {
      ok: true, id: String(existingByClientId['رقم الطلب']),
      message: 'تم استلام طلبكم مسبقًا وهو قيد المراجعة الآن',
      duplicate: true
    };
  }

  if (findUserByEmail_(email)) {
    throw new Error('هذا البريد الإلكتروني مرتبط بحساب قائم بالفعل');
  }
  const pendingDuplicate = table.rows.find(row =>
    String(row['الحالة']) === 'قيد المراجعة' &&
    (String(row['البريد الإلكتروني']).trim().toLowerCase() === email ||
     String(row['أرقام التواصل']) === phone ||
     (licenseNumber && String(row['رقم الترخيص']).trim() === licenseNumber))
  );
  if (pendingDuplicate) {
    throw new Error('يوجد طلب سابق قيد المراجعة بنفس البريد الإلكتروني أو رقم الجوال أو رقم الترخيص');
  }

  // حدّ معدّل بسيط بعد كل التحقق الرخيص لتفادي استهلاكه على طلبات
  // مرفوضة أصلًا لخطأ إدخال، وقبل أي عملية مكلفة (رفع ملف، كتابة).
  throttle_('apply:' + hashSecret_(email, 'rate'), 5, 3600);

  // رفع ملف الترخيص خارج أي قفل تمامًا (Drive لا يحتاج قفل Sheets، وهذه
  // العملية هي الأبطأ فعليًا في كل التسلسل) — إن فشل التحقق من الملف لا
  // شيء كُتب بعد في أي مكان.
  const licenseFile = saveLicenseFile_(payload.licenseFileDataUrl);

  let id;
  try {
    id = nextId_('APP');
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      // إعادة الفحص هذه فقط داخل القفل — مختصرة عمدًا لتقليل نطاق
      // الحجب: لا تكرر فحص البيانات المرجعية أو صيغة الحقول (تمّت أعلاه
      // بلا أي كلفة قفل)، بل تتحقق فقط من عدم دخول طلب مطابق أثناء
      // الانتظار على القفل نفسه.
      invalidateTableCache_(APP.sheets.applications);
      const raceByClientId = readTable_(APP.sheets.applications).rows.find(row => String(row['معرف طلب العميل']) === clientRequestId);
      if (raceByClientId) {
        // طلب مطابق كُتب فعلًا (من تنفيذ متزامن آخر) بينما كنا ننتظر
        // القفل — ملف الترخيص الذي رفعناه للتو لن يُستخدَم أبدًا، فيجب
        // حذفه هنا صراحة بدل تركه يتيمًا (لا نصل إلى catch الخارجي لأننا
        // نُعيد نتيجة ناجحة لا نرمي خطأ).
        try { DriveApp.getFileById(licenseFile.fileId).setTrashed(true); } catch (ignore) {}
        return {ok: true, id: String(raceByClientId['رقم الطلب']), message: 'تم استلام طلبكم مسبقًا وهو قيد المراجعة الآن', duplicate: true};
      }
      const raceDuplicate = readTable_(APP.sheets.applications).rows.find(row =>
        String(row['الحالة']) === 'قيد المراجعة' &&
        (String(row['البريد الإلكتروني']).trim().toLowerCase() === email ||
         String(row['أرقام التواصل']) === phone ||
         (licenseNumber && String(row['رقم الترخيص']).trim() === licenseNumber))
      );
      if (raceDuplicate) {
        throw new Error('يوجد طلب سابق قيد المراجعة بنفس البريد الإلكتروني أو رقم الجوال أو رقم الترخيص');
      }
      appendObject_(APP.sheets.applications, {
        'رقم الطلب': id,
        'اسم الجمعية': requiredText_(payload.name, 'اسم الجمعية', 150),
        'التصنيف': category, 'المنطقة': place.region, 'المدينة': place.city,
        'أرقام التواصل': phone, 'البريد الإلكتروني': email,
        'اسم المسؤول': requiredText_(payload.contactName, 'اسم المسؤول', 100),
        'ملاحظات مقدّم الطلب': cleanText_(payload.notes, 500),
        'الحالة': 'قيد المراجعة', 'سبب الرفض': '', 'رقم الجمعية الناتجة': '',
        'تاريخ التقديم': now_(), 'تاريخ المراجعة': '', 'المراجع': '',
        'معرف طلب العميل': clientRequestId, 'رقم الترخيص': licenseNumber,
        'تاريخ انتهاء الترخيص': licenseExpiry, 'مجال عمل الجمعية': sector,
        'الترخيص ساري': answers['الترخيص ساري'],
        'المشروع ضمن نطاق الجمعية': answers['المشروع ضمن نطاق الجمعية'],
        'قاعدة بيانات محدثة': answers['قاعدة بيانات محدثة'],
        'نظام إلكتروني للمستفيدين': answers['نظام إلكتروني للمستفيدين'],
        'خبرة مشاريع مشابهة': answers['خبرة مشاريع مشابهة'],
        'القدرة على الاستلام والتسليم والتوثيق': answers['القدرة على الاستلام والتسليم والتوثيق'],
        'الالتزام بالجدول والنماذج وحماية البيانات': answers['الالتزام بالجدول والنماذج وحماية البيانات'],
        'الالتزام بالاتفاقية وتعيين منسق': answers['الالتزام بالاتفاقية وتعيين منسق'],
        'معرف ملف الترخيص': licenseFile.fileId, 'اسم ملف الترخيص': licenseFile.fileName,
        'نوع ملف الترخيص': licenseFile.fileType, 'حجم ملف الترخيص': licenseFile.fileSize,
        'الموافقة على الإقرار': 'نعم', 'تاريخ الإقرار': now_()
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    // لا يجوز أن يبقى ملف ترخيص يتيمًا في Drive دون أي سجل طلب يشير
    // إليه — أي فشل بعد الرفع (بما فيه رفض داخل القفل) يحذف الملف فورًا.
    try { DriveApp.getFileById(licenseFile.fileId).setTrashed(true); } catch (ignore) { /* لا نُخفي الخطأ الأصلي بخطأ تنظيف */ }
    throw error;
  }
  clearDashboardCache();
  return {ok: true, id: id, message: 'تم استلام طلب الانضمام وسيتم التواصل معكم بعد المراجعة'};
}

/**
 * يتحقق من التوقيع الفعلي (magic bytes) — نفس مبدأ verifyImageMagicBytes_
 * المُستخدَم في إثبات التسليم (Delegates.gs)، بلا تكرار للمنطق: الدالة
 * نفسها تُستدعى من هنا مباشرة. لا يُستدعى getUrl() ولا setSharing() على
 * الملف الناتج إطلاقًا — يبقى خاصًا بمالك المشروع فقط، ولا يُعاد أي رابط
 * للعميل. اسم الملف عشوائي بالكامل (UUID) فلا يحمل أي بيانات مستخدم.
 */
function saveLicenseFile_(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('أرفق صورة الترخيص بصيغة JPG أو PNG أو WEBP');
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('حجم ملف الترخيص يتجاوز 8 ميجابايت');
  if (!verifyImageMagicBytes_(bytes, match[1])) {
    throw new Error('محتوى ملف الترخيص الفعلي لا يطابق الصيغة المُعلَنة — أرفق صورة حقيقية بصيغة JPG أو PNG أو WEBP');
  }
  const mime = 'image/' + match[1];
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const filename = Utilities.getUuid() + '.' + ext;
  const folder = licenseFolder_();
  const file = folder.createFile(Utilities.newBlob(bytes, mime, filename));
  return {fileId: file.getId(), fileName: filename, fileType: mime, fileSize: bytes.length};
}

function licenseFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('LICENSE_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (ignore) {}
  }
  const folder = DriveApp.createFolder(APP.licenseFolder);
  props.setProperty('LICENSE_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * فحص حالة آمن بعد مهلة انتظار في الواجهة — لا يتطلب جلسة (النموذج
 * عام بلا تسجيل دخول)، ويُعيد الحد الأدنى فقط: هل وُجد الطلب، حالته،
 * وقت تقديمه، وسبب الرفض إن رُفض. لا يُعيد أي بيانات شخصية (بريد، جوال،
 * اسم) حتى لمن يملك المعرّف، تقليلًا لأثر أي تخمين أو تسريب لهذا
 * المعرّف العشوائي.
 */
function getApplicationStatus(clientRequestId) {
  beginRequest_('getApplicationStatus');
  return withMeta_(getApplicationStatus_(clientRequestId));
}

function getApplicationStatus_(clientRequestId) {
  clientRequestId = String(clientRequestId || '').trim();
  if (!validClientRequestId_(clientRequestId)) throw new Error('معرف الطلب غير صالح');
  throttle_('appstatus:' + hashSecret_(clientRequestId, 'rate'), 20, 3600);
  if (!applicationsSheetReady_()) return {ok: true, found: false};
  const row = readTable_(APP.sheets.applications).rows.find(r => String(r['معرف طلب العميل']) === clientRequestId);
  if (!row) return {ok: true, found: false};
  return {
    ok: true, found: true, id: String(row['رقم الطلب']), status: String(row['الحالة']),
    submittedAt: formatDateTime_(parseDate_(row['تاريخ التقديم'])),
    rejectionReason: String(row['الحالة']) === 'مرفوض' ? String(row['سبب الرفض'] || '') : ''
  };
}

/**
 * عرض ملف الترخيص — للإدارة فقط، ولا يُغيّر مشاركة الملف في Drive
 * إطلاقًا (يبقى خاصًا). يقرأ محتوى الملف من الخادم ويعيده كـdata URL
 * ضمن استجابة RPC موثَّقة بالجلسة، فلا يمر أي رابط Drive عام على
 * الإطلاق. كل عرض يُسجَّل في سجل العمليات.
 */
function getApplicationLicenseFile(token, applicationId) {
  const user = requireSession_(token, ['ADMIN']);
  return withMeta_(perfTime_('getApplicationLicenseFile', () => {
    applicationId = cleanId_(applicationId);
    const application = findById_(APP.sheets.applications, 'رقم الطلب', applicationId);
    if (!application) throw new Error('طلب الانضمام غير موجود');
    const fileId = String(application['معرف ملف الترخيص'] || '');
    if (!fileId) throw new Error('لا يوجد ملف ترخيص مرفق بهذا الطلب');
    let file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (error) {
      throw new Error('تعذّر الوصول إلى ملف الترخيص — قد يكون محذوفًا');
    }
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    audit_(user, 'عرض ملف ترخيص طلب انضمام', 'طلبات الانضمام', applicationId, '');
    return {
      ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + base64,
      fileName: String(application['اسم ملف الترخيص'] || ''), fileType: String(application['نوع ملف الترخيص'] || '')
    };
  }));
}

/**
 * تاريخا التقديم والمراجعة كانا يُعادان كنص خام (String(row[...])) دون
 * المرور بـ parseDate_/formatDateTime_ — Google Sheets يحوّل نصًا شبيهًا
 * بتاريخ (كالمُخزَّن عبر now_()) إلى خلية Date فعليًا أحيانًا، فكانت
 * القراءة التالية تُعيد كائن JS Date خامًا وString() عليه ينتج صيغة
 * إنجليزية تقنية مثل "Thu Jan 01 2026 00:00:00 GMT+0300" بدل تاريخ عربي
 * منسَّق — هذا هو عطل "تواريخ JavaScript غير المنسَّقة" المرصود حيًّا.
 *
 * الحقول الـ18 الجديدة كلها اختيارية القراءة: صف قديم لا يحملها يُعيد
 * كل واحد منها سلسلة فارغة (أو 0/8 في النتيجة) بلا أي خطأ — لا حاجة لأي
 * ترحيل بيانات لعرض الطلبات القديمة بشكل صحيح.
 */
function normalizeApplication_(row) {
  const answers = APPLICATION_QUESTIONS.map(question => ({
    key: question.key, label: question.label, value: String(row[question.key] || '')
  }));
  const yesCount = answers.filter(a => a.value === 'نعم').length;
  return {
    id: String(row['رقم الطلب']), name: String(row['اسم الجمعية']),
    category: String(row['التصنيف'] || ''), region: String(row['المنطقة']), city: String(row['المدينة']),
    phone: displayPhone_(row['أرقام التواصل']), email: String(row['البريد الإلكتروني']),
    contactName: String(row['اسم المسؤول'] || ''), notes: String(row['ملاحظات مقدّم الطلب'] || ''),
    status: String(row['الحالة']), rejectionReason: String(row['سبب الرفض'] || ''),
    resultingAssociationId: String(row['رقم الجمعية الناتجة'] || ''),
    submittedAt: formatDateTime_(parseDate_(row['تاريخ التقديم'])),
    reviewedAt: formatDateTime_(parseDate_(row['تاريخ المراجعة'])),
    reviewer: String(row['المراجع'] || ''),
    licenseNumber: String(row['رقم الترخيص'] || ''),
    licenseExpiry: String(row['تاريخ انتهاء الترخيص'] || ''),
    sector: String(row['مجال عمل الجمعية'] || ''),
    answers: answers, score: scoreLabel_(yesCount, answers.length),
    hasLicenseFile: !!String(row['معرف ملف الترخيص'] || ''),
    licenseFileName: String(row['اسم ملف الترخيص'] || ''),
    licenseFileSize: Number(row['حجم ملف الترخيص'] || 0) || 0,
    pledgeAccepted: String(row['الموافقة على الإقرار']) === 'نعم',
    pledgedAt: formatDateTime_(parseDate_(row['تاريخ الإقرار']))
  };
}

function scoreLabel_(yesCount, total) {
  return total ? (yesCount + '/' + total) : '';
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
  items = applySearch_(items, options.search, ['name', 'id', 'email', 'contactName', 'licenseNumber']);
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
 * يجب ألّا تُنشئ جمعيتين مكرَّرتين؛ لذلك يُلفّ فرع القبول بـwithIdempotency_.
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
