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

