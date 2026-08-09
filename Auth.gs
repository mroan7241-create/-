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
  // نقطة دخول عامة (لا جلسة بعد) — تبدأ الطلب بنفسها حتى يبقى بناء
  // Bootstrap الذي يليها داخل نطاق الطلب نفسه فيستفيد من ذاكرة الجداول
  // المؤقتة بدل إعادة قراءة الأوراق مرتين في دخول واحد.
  beginRequest_('login:' + (type === 'delegate' ? 'delegate' : 'user'));
  return withMeta_(perfTime_('login:' + (type === 'delegate' ? 'delegate' : 'user'), () =>
    type === 'delegate' ? loginDelegate_(payload.code) : loginUser_(payload.email, payload.password)
  ));
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
  const mustChangePassword = String(user['يجب تغيير كلمة المرور'] || '') === 'نعم';
  const session = createSession_({
    id: String(user['رقم المستخدم']),
    name: String(user['الاسم']),
    role: String(user['الدور']),
    associationId: String(user['رقم الجمعية'] || ''),
    mustChangePassword: mustChangePassword
  });
  updateById_(APP.sheets.users, 'رقم المستخدم', user['رقم المستخدم'], {'آخر دخول': now_()});
  audit_(session.user, 'تسجيل دخول', 'المصادقة', user['رقم المستخدم'], '');
  // حساب مُلزَم بتغيير كلمة مرور مؤقتة لا يحصل على بيانات البوابة إطلاقًا
  // حتى يُغيّرها — لا مجرد إخفاء في الواجهة، بل امتناع فعلي من الخادم.
  if (mustChangePassword) {
    return {ok: true, token: session.token, user: session.user, mustChangePassword: true};
  }
  // النسخة الداخلية عمدًا: استدعاء getBootstrapData العامة هنا كان
  // سيُعيد بدء الطلب (requireSession_ ← beginRequest_) في منتصف الدخول
  // فيمسح ذاكرة الجداول ويُعيد قراءة الأوراق نفسها مرة ثانية بلا داعٍ.
  return {ok: true, token: session.token, user: session.user,
    bootstrap: getBootstrapDataFor_(session.user, false),
    referenceData: getReferenceData()};
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
  // النسخة الداخلية لنفس سبب loginUser_ أعلاه (لا إعادة بدء طلب في منتصف الدخول).
  return {ok: true, token: session.token, user: session.user,
    bootstrap: getBootstrapDataFor_(session.user, false),
    referenceData: getReferenceData()};
}

function logout(token) {
  const user = requireSession_(token, null, {allowMustChangePassword: true});
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
    mustChangePassword: !!user.mustChangePassword,
    epoch: actorEpoch_(user.id), issuedAt: new Date().getTime()
  };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(record), APP.sessionSeconds);
  return {token: token, user: {
    id: user.id, name: user.name, role: user.role, associationId: user.associationId,
    mustChangePassword: !!user.mustChangePassword
  }};
}

/**
 * opts.allowMustChangePassword: يستثني فقط changePassword وlogout من
 * قفل "يجب تغيير كلمة المرور المؤقتة أولًا" — كل دالة أخرى تُرفض من
 * الخادم مباشرة (لا تعتمد على إخفاء الواجهة) طالما الجلسة تحمل هذا
 * الوسم، حتى لو استُدعيت الدالة مباشرة بتجاوز الواجهة.
 */
function requireSession_(token, roles, opts) {
  // بوابة الجلسة هي نقطة الدخول الموحَّدة لكل دالة خادم محروسة، فهي
  // الموضع الطبيعي لبدء "الطلب": مسح ذاكرة الجداول المؤقتة حتى لا يعبر
  // أي إدخال حدود الطلب داخل warm isolate، وتصفير عدّادات القياس، وتوليد
  // traceId. لا تداخل: كل endpoint مُجمَّع يستدعي النسخ الداخلية (_).
  beginRequest_('session');
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
  if (user.mustChangePassword && user.role === 'ASSOCIATION' && !(opts && opts.allowMustChangePassword)) {
    throw new Error('يجب تغيير كلمة المرور المؤقتة أولًا قبل المتابعة');
  }
  if (roles && roles.indexOf(user.role) === -1) throw new Error('ليس لديك صلاحية لتنفيذ هذه العملية');
  return user;
}

function sessionKey_(token) {
  return 'session:' + token;
}

/* -------------------- استعادة كلمة مرور الإدارة/الجمعية عبر البريد --------------------
 * مسار منفصل تمامًا عن رمز دخول المندوب (الذي لا بريد له أصلًا ولا يمرّ
 * بهذا المسار إطلاقًا — "نسيت رمز الدخول؟" في تبويب المندوب يوجّه
 * للتواصل مع الجمعية التي تستخدم regenerateDelegateCode الموجودة). */

const PASSWORD_RESET_TTL_SECONDS = 900; // 15 دقيقة — أعلى حد ضمن النطاق المطلوب (10–15)
const PASSWORD_RESET_MAX_ATTEMPTS = 6;
const PASSWORD_RESET_GENERIC_MESSAGE = 'إذا كان البريد الإلكتروني مسجلًا في النظام فستصلك تعليمات استعادة كلمة المرور خلال دقائق.';
const PASSWORD_RESET_INVALID_MESSAGE = 'رمز الاستعادة غير صحيح أو منتهي الصلاحية أو استُخدم بالفعل. اطلب رمزًا جديدًا';

function passwordResetCacheKey_(email) {
  return 'pwreset:' + hashSecret_(email, 'pwreset-idx');
}

/**
 * يبدأ طلب استعادة كلمة مرور. لا يكشف مطلقًا هل البريد مسجَّل أم لا —
 * نفس الرد النصي العام في كل الحالات (بريد غير موجود، دور غير مؤهَّل،
 * حساب/جمعية موقوفة، فشل إرسال البريد، أو نجاح فعلي). طلب جديد لنفس
 * البريد يُلغي أي رمز سابق تلقائيًا لأنه يُخزَّن بنفس مفتاح الذاكرة
 * المؤقتة فيُستبدَل (لا حاجة لإبطال صريح منفصل).
 */
function requestPasswordReset(email) {
  beginRequest_('requestPasswordReset');
  const cleanEmail = String(email || '').trim().toLowerCase();
  const generic = {ok: true, message: PASSWORD_RESET_GENERIC_MESSAGE};
  if (!isEmail_(cleanEmail)) return generic;

  // تحديد صارم للطلبات لكل بريد على حدة — يمنع التخمين والإزعاج دون
  // الاعتماد على عنوان IP (غير متاح في Apps Script من جهة العميل).
  throttle_('pwreset-req:' + hashSecret_(cleanEmail, 'rate'), 5, 900);

  const table = readTable_(APP.sheets.users);
  const user = table.rows.find(row =>
    String(row['البريد الإلكتروني']).trim().toLowerCase() === cleanEmail &&
    String(row['الحالة']) === 'نشط' &&
    ['ADMIN', 'ASSOCIATION'].indexOf(String(row['الدور'])) !== -1
  );

  // حساب جمعية موقوف (الجمعية نفسها "غير نشطة" لا حساب المستخدم) لا
  // يجوز أن يستعيد وصولًا كان يُمنع منه أصلًا — دون كشف ذلك للعميل.
  let eligible = !!user;
  if (eligible && String(user['الدور']) === 'ASSOCIATION' && user['رقم الجمعية']) {
    const association = findById_(APP.sheets.associations, 'رقم الجمعية', user['رقم الجمعية']);
    eligible = !!association && String(association['الحالة']) !== 'غير نشطة';
  }

  if (!eligible) {
    Utilities.sleep(350); // تقريب زمن الاستجابة من مسار الإرسال الفعلي — تخفيف بصمة توقيت
    return generic;
  }

  const code = createAccessCode_('RST', 8);
  const salt = Utilities.getUuid();
  const payload = {
    tokenHash: hashSecret_(code, salt), salt: salt,
    userId: String(user['رقم المستخدم']), attempts: 0, expiresAt: Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000
  };

  try {
    MailApp.sendEmail({
      to: cleanEmail,
      subject: 'استعادة كلمة المرور — ' + APP.title,
      body: passwordResetEmailBody_(user['الاسم'], code)
    });
  } catch (mailError) {
    // فشل الإرسال لا يُفصح عنه للعميل، والرمز لا يُخزَّن أصلًا — لا فائدة
    // من رمز لن يصل صاحبه، وتخزينه كان سيُربك محاولات تحقق لاحقة بلا داعٍ.
    return generic;
  }

  CacheService.getScriptCache().put(passwordResetCacheKey_(cleanEmail), JSON.stringify(payload), PASSWORD_RESET_TTL_SECONDS);
  // السجل لا يحمل البريد كاملًا ولا الرمز — رقم المستخدم الداخلي فقط.
  audit_({id: user['رقم المستخدم'], name: user['الاسم'], role: user['الدور']},
    'طلب استعادة كلمة مرور', 'المصادقة', user['رقم المستخدم'], '');
  return generic;
}

function passwordResetEmailBody_(name, code) {
  let link = '';
  try { link = ScriptApp.getService().getUrl(); } catch (ignore) { /* بيئة لا تدعم getUrl (مثل الاختبار المحلي) */ }
  return 'مرحبًا ' + name + '،\n\n' +
    'وصلنا طلب استعادة كلمة المرور لحسابك في ' + APP.title + '.\n' +
    'رمز الاستعادة: ' + code + '\n' +
    (link ? 'رابط الدخول: ' + link + '\n' : '') +
    'صلاحية الرمز 15 دقيقة من الآن، ويُستخدم مرة واحدة فقط.\n\n' +
    'إن لم تطلب هذا بنفسك فتجاهل هذه الرسالة — لن يتغيّر شيء دون إدخال الرمز.';
}

/**
 * يُتِمّ الاستعادة: البريد نفسه هو مفتاح البحث عن الرمز المخزَّن (لا
 * فهرس عكسي رمز→مستخدم منفصل)، تمامًا كما يُدخله المستخدم في نفس
 * الشاشة. يعيّن كلمة مرور جديدة بنفس ضوابط القوة ومنع إعادة الاستخدام
 * المطبَّقة على changePassword تحديدًا (assertPasswordPolicy_ نفسها، لا
 * ضوابط موازية). رسالة الخطأ عند فشل التحقق **واحدة موحَّدة** لكل
 * الأسباب (رمز خطأ، منتهٍ، تجاوز عدد المحاولات، أو لا طلب أصلًا) — لا
 * تمايز بينها لمنع أي تسريب. مقفلة (LockService) لمنع تزامن طلبين
 * يستهلكان نفس الرمز أو يتلاعبان بعدّاد المحاولات معًا.
 */
function resetPasswordWithCode(email, code, newPassword) {
  beginRequest_('resetPasswordWithCode');
  const cleanEmail = String(email || '').trim().toLowerCase();
  throttle_('pwreset-verify:' + hashSecret_(cleanEmail, 'rate'), 10, 900);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const key = passwordResetCacheKey_(cleanEmail);
    const raw = cache.get(key);
    if (!raw) throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
    const data = JSON.parse(raw);
    if (Date.now() > data.expiresAt) {
      cache.remove(key);
      throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
    }
    if (data.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      cache.remove(key);
      throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
    }
    const providedHash = hashSecret_(String(code || '').trim().toUpperCase(), data.salt);
    if (!constantTimeEquals_(providedHash, data.tokenHash)) {
      data.attempts++;
      const remainingTtl = Math.max(1, Math.floor((data.expiresAt - Date.now()) / 1000));
      cache.put(key, JSON.stringify(data), remainingTtl);
      throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
    }

    const record = findById_(APP.sheets.users, 'رقم المستخدم', data.userId);
    if (!record || String(record['الحالة']) !== 'نشط') {
      cache.remove(key);
      throw new Error(PASSWORD_RESET_INVALID_MESSAGE);
    }
    const finalPassword = assertPasswordPolicy_(String(newPassword || ''), record);

    const salt2 = Utilities.getUuid();
    updateById_(APP.sheets.users, 'رقم المستخدم', data.userId, {
      'كلمة مرور سابقة مشفرة': record['كلمة المرور المشفرة'],
      'ملح سابق': record['الملح'],
      'كلمة المرور المشفرة': hashSecret_(finalPassword, salt2),
      'الملح': salt2,
      'يجب تغيير كلمة المرور': 'لا'
    });
    revokeSessions_(data.userId);
    cache.remove(key); // لمرة واحدة — يُبطَل فورًا بعد النجاح أيضًا

    audit_({id: record['رقم المستخدم'], name: record['الاسم'], role: record['الدور']},
      'إعادة تعيين كلمة المرور عبر البريد', 'المصادقة', data.userId, '');

    try {
      MailApp.sendEmail({
        to: cleanEmail,
        subject: 'تنبيه أمني: تغيّرت كلمة مرور حسابك — ' + APP.title,
        body: 'مرحبًا ' + record['الاسم'] + '،\n\nتم تغيير كلمة مرور حسابك في ' + APP.title + ' للتو. ' +
          'إن لم يكن هذا أنت فتواصل فورًا مع إدارة المشروع.'
      });
    } catch (ignore) { /* إشعار تحسيني بعد نجاح العملية الفعلية — لا يُفشل الاستجابة */ }

    return {ok: true};
  } finally {
    lock.releaseLock();
  }
}

