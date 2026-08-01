// -------------------- أدوات قاعدة البيانات --------------------

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('شغّل setupSheets_() أولًا. الورقة المفقودة: ' + name);
  return sheet;
}

/**
 * ذاكرة تخزين مؤقت **محصورة في الطلب الواحد** تمنع قراءة الورقة نفسها
 * أكثر من مرة ضمن الطلب الواحد. مثال حقيقي: buildAssociationPortal_ تقرأ
 * المستفيدين والأجهزة والمناديب، ثم getAuditRows_ المستدعاة بعدها مباشرة
 * تعيد قراءة الأوراق الأربع نفسها بالكامل من جديد لغرض تصفية السجل فقط.
 *
 * ⚠️ خطر warm isolate (صُحّح في هذه المرحلة): Apps Script يُبقي المتغيرات
 * العامة حيّة بين التنفيذات داخل نفس الـisolate الدافئ، وقد يخدم تنفيذات
 * متزامنة من isolates متعددة. الاعتماد السابق على TTL زمني (4 ثوانٍ) كان
 * يعني أن كتابة نفّذها isolate A لا تُبطل نسخة isolate B المخزَّنة، فيمكن
 * لقائمة أن تعود بحالة ما قبل الكتابة. الآن الذاكرة تُمسح صراحةً عند بداية
 * كل طلب (beginRequest_ المستدعاة من requireSession_ ومن نقاط الدخول
 * العامة)، فلا يمكن لأي إدخال أن يعبر حدود الطلب الواحد إطلاقًا — لا اعتماد
 * على وقت ولا على ترتيب isolates.
 */
const _TABLE_CACHE_ = {};

/**
 * حالة الطلب الجاري: معرّف تتبّع قصير (traceId) لا يحمل أي بيانات
 * مستخدم، ولحظة البدء، وعدّادات القراءة/الكتابة الفعلية. تُستخدم لقياس
 * الأداء من الخادم وإرجاعه للعميل ضمن `_meta` — بلا أي كلمة مرور أو رمز
 * أو حقل حساس إطلاقًا (أرقام واسم عملية فقط).
 */
const _REQ_ = {traceId: '', label: '', startedAt: 0, reads: 0, writes: 0};
const _PERF_ = _REQ_;

/**
 * تبدأ طلبًا جديدًا: تمسح ذاكرة الجداول المؤقتة (حدّ صارم لا يعبره أي
 * إدخال بين طلبين)، وتصفّر العدّادات، وتولّد traceId جديدًا.
 *
 * تُستدعى **مرة واحدة بالضبط** لكل نقطة دخول عامة، ولا يوجد أي تداخل:
 * كل endpoint مُجمَّع يستدعي النسخ الداخلية (`listBeneficiaries_`،
 * `getBootstrapDataFor_` …) التي تأخذ المستخدم المُتحقَّق منه ولا تمرّ
 * بـrequireSession_ من جديد. عمدًا بلا عدّاد عمق: عدّاد كهذا يجب أن
 * يُوازَن بدقة في كل مسار (بما فيه مسارات الاستثناءات)، وأي اختلال واحد
 * يُجمّد المسح إلى الأبد داخل warm isolate — وهو بالضبط نوع العطل الذي
 * يفترض هذا التصميم منعه.
 */
function beginRequest_(label) {
  Object.keys(_TABLE_CACHE_).forEach(name => { delete _TABLE_CACHE_[name]; });
  _REQ_.traceId = Utilities.getUuid().slice(0, 8);
  _REQ_.label = String(label || '');
  _REQ_.startedAt = Date.now();
  _REQ_.reads = 0;
  _REQ_.writes = 0;
  return _REQ_.traceId;
}

/**
 * بيانات قياس الطلب الجاري كما تُرفَق بالاستجابة: معرّف التتبّع، زمن
 * الخادم بالمللي ثانية، وعدد قراءات/كتابات الأوراق الفعلية. لا تحتوي أي
 * قيمة مُدخَلة من المستخدم ولا أي حقل من الحقول الحساسة.
 */
function requestMeta_() {
  return {
    traceId: _REQ_.traceId,
    op: _REQ_.label,
    serverMs: _REQ_.startedAt ? Date.now() - _REQ_.startedAt : 0,
    reads: _REQ_.reads,
    writes: _REQ_.writes
  };
}

/** يُرفق `_meta` بأي استجابة كائنية (لا يلمس المصفوفات ولا القيم الأولية). */
function withMeta_(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    result._meta = requestMeta_();
  }
  return result;
}

function perfSnapshot_() {
  return {reads: _REQ_.reads, writes: _REQ_.writes};
}

/**
 * يُغلّف دالة بقياس زمن التنفيذ وعدد قراءات/كتابات الجداول الفعلية
 * أثناء تشغيلها، ويطبع سطرًا واحدًا منظّمًا (JSON) إلى console.log —
 * يظهر في سجل التنفيذ (Executions) في محرر Apps Script. لا يحتوي أي
 * قيمة مُدخَلة من المستخدم أو أي حقل حساس، فقط اسم العملية والأرقام.
 */
function perfTime_(label, fn) {
  const startedAt = Date.now();
  const before = perfSnapshot_();
  const result = fn();
  const after = perfSnapshot_();
  try {
    console.log(JSON.stringify({
      perf: label, ms: Date.now() - startedAt,
      reads: perfDelta_(before.reads, after.reads),
      writes: perfDelta_(before.writes, after.writes)
    }));
  } catch (ignore) { /* التسجيل تحسين تشخيصي، لا يوقف الطلب أبدًا */ }
  return result;
}

/**
 * فرق العدّادات مع مراعاة أن requireSession_ (داخل الدالة المُقاسة نفسها)
 * تُصفّر عدّادات الطلب عند بدايته. حين يحدث ذلك يصبح "بعد" أصغر من
 * "قبل" فينتج فرق سالب لا معنى له؛ في تلك الحالة الرقم الصحيح هو
 * العدّاد المطلق، لأن هذه الدالة **هي** الطلب كله.
 */
function perfDelta_(before, after) {
  return after >= before ? after - before : after;
}

function readTable_(name) {
  const cached = _TABLE_CACHE_[name];
  if (cached) return cached.value;
  _REQ_.reads++;
  const sheet = sheet_(name);
  const values = sheet.getDataRange().getValues();
  let result;
  if (!values.length) {
    result = {headers: [], rows: []};
  } else {
    const headers = values[0].map(String);
    const rows = values.slice(1).filter(row => row.some(value => value !== '')).map(row => {
      const object = {};
      headers.forEach((header, index) => object[header] = row[index]);
      return object;
    });
    result = {headers: headers, rows: rows};
  }
  _TABLE_CACHE_[name] = {value: result};
  return result;
}

function invalidateTableCache_(name) {
  delete _TABLE_CACHE_[name];
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
 *
 * يحمي أيضًا من عطل حقيقي كان يفقد الصفر البادئ لأرقام الجوال:
 * Range.setValues() في Apps Script يحوّل أي نص "يبدو رقمًا" (مثل
 * "0501234567") تلقائيًا إلى Number عند الكتابة، فيضيع الصفر الأول —
 * نفس علامة الاقتباس المُستخدَمة لمنع الحقن تفرض تخزينه نصًا صريحًا دائمًا.
 */
function safeCell_(value) {
  if (typeof value !== 'string' || !value) return value;
  if (/^[=+\-@\t\r]/.test(value) || /^0\d+$/.test(value)) return "'" + value;
  return value;
}

function appendObjects_(sheetName, objects) {
  if (!objects.length) return;
  _REQ_.writes++;
  const sheet = sheet_(sheetName);
  const headers = HEADERS[sheetName];
  const rows = objects.map(object =>
    headers.map(header => safeCell_(object[header] === undefined ? '' : object[header]))
  );
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  invalidateTableCache_(sheetName);
}

/**
 * بحث بالمعرّف **يرفض الغموض صراحةً**: إن وُجد أكثر من صف يحمل المعرّف
 * نفسه (بيانات تاريخية نتجت عن إعادة ضبط عدّادات Script Properties بعد
 * نسخ المشروع — راجع nextIds_/diagnoseIdSequences_ أدناه) لا يختار الصف
 * الأول بصمت كما كان يفعل سابقًا، بل يوقف العملية بتقرير عربي واضح يسمّي
 * الورقة والمعرّف وعدد الصفوف المتطابقة.
 *
 * لماذا الرفض لا الاختيار الصامت: العطل الحيّ المرصود بتاريخ 2026/08/01
 * كان طلبَي انضمام يحملان APP-000001 (أحدهما "مقبول" والآخر "قيد
 * المراجعة")، فكانت reviewAssociationApplication تعثر على الصف المقبول
 * أولًا وتردّ "سبق البتّ في هذا الطلب" — رسالة صحيحة شكلًا ومضلِّلة
 * تمامًا في السياق. الرفض الصريح يجعل سبب المشكلة ظاهرًا بدل إخفائه.
 */
function findById_(sheetName, idHeader, id) {
  const matches = findAllById_(sheetName, idHeader, id);
  if (matches.length > 1) throw new Error(duplicateIdMessage_(sheetName, idHeader, id, matches.length));
  return matches[0] || null;
}

/** كل الصفوف المطابقة للمعرّف (بلا رفض) — للتشخيص ولمن يحتاج معالجة التكرار بنفسه. */
function findAllById_(sheetName, idHeader, id) {
  return readTable_(sheetName).rows.filter(row => String(row[idHeader]) === String(id));
}

function duplicateIdMessage_(sheetName, idHeader, id, count) {
  return 'تعذّر إتمام العملية: المعرّف «' + id + '» مكرَّر في ورقة «' + sheetName + '» (' + count +
    ' صفوف تحمل نفس «' + idHeader + '»). هذا خلل في سلامة البيانات يجب تصحيحه يدويًا قبل المتابعة — ' +
    'شغّل diagnoseIdSequences_ من محرر Apps Script لتقرير كامل بالمعرّفات المكرَّرة.';
}

function updateById_(sheetName, idHeader, id, changes) {
  _REQ_.writes++;
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const map = {};
  values[0].forEach((header, index) => map[String(header)] = index);
  const matchingRows = [];
  values.forEach((row, index) => {
    if (index > 0 && String(row[map[idHeader]]) === String(id)) matchingRows.push(index);
  });
  // الكتابة على معرّف مكرَّر أخطر من القراءة منه: قد تُعدّل صفًا وتترك
  // توأمه بحالة مخالفة. تُرفض دائمًا بنفس تقرير findById_ الواضح.
  if (matchingRows.length > 1) throw new Error(duplicateIdMessage_(sheetName, idHeader, id, matchingRows.length));
  const rowIndex = matchingRows.length ? matchingRows[0] : -1;
  if (rowIndex < 1) throw new Error('السجل غير موجود: ' + id);
  Object.keys(changes).forEach(header => {
    if (map[header] !== undefined) sheet.getRange(rowIndex + 1, map[header] + 1).setValue(safeCell_(changes[header]));
  });
  invalidateTableCache_(sheetName);
}

/**
 * تحديث صف بمطابقة أكثر من عمود معًا (بدل معرّف واحد)، للأوراق التي لا
 * تملك عمود رقم تسلسلي مستقل — مثل "إدارة الأنشطة" التي يُعرَّف صفها
 * بثلاثية (المرحلة، النشاط الرئيسي، النشاط الفرعي) لا برقم منفصل.
 */
function updateRowByMatch_(sheetName, matchHeaders, changes) {
  _REQ_.writes++;
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const map = {};
  values[0].forEach((header, index) => map[String(header)] = index);
  const rowIndex = values.findIndex((row, index) => index > 0 &&
    Object.keys(matchHeaders).every(header => String(row[map[header]]) === String(matchHeaders[header]))
  );
  if (rowIndex < 1) return false;
  Object.keys(changes).forEach(header => {
    if (map[header] !== undefined) sheet.getRange(rowIndex + 1, map[header] + 1).setValue(safeCell_(changes[header]));
  });
  invalidateTableCache_(sheetName);
  return true;
}

/**
 * مصدر كل بادئة معرّف: الورقة والعمود اللذان يحملان المعرّفات الفعلية
 * المُصدَرة بهذه البادئة. يُستخدم لحساب "أعلى رقم مستخدم فعليًا" في
 * nextIds_ وdiagnoseIdSequences_ — بدل الثقة العمياء بعدّاد Script
 * Properties وحده، الذي يُعاد للصفر عند نسخ المشروع (Make a copy) بينما
 * تحتفظ الأوراق نفسها ببياناتها القديمة كاملة، فينتج تكرار معرّفات خطير.
 */
const ID_PREFIX_SOURCES_ = Object.freeze({
  APP: {sheet: 'طلبات انضمام الجمعيات', column: 'رقم الطلب'},
  ASC: {sheet: 'الجمعيات', column: 'رقم الجمعية'},
  BEN: {sheet: 'المستفيدون', column: 'رقم المستفيد'},
  DEV: {sheet: 'الأجهزة', column: 'رقم الجهاز'},
  MND: {sheet: 'المناديب', column: 'رقم المندوب'},
  DLV: {sheet: 'التسليمات', column: 'رقم التسليم'},
  USR: {sheet: 'المستخدمون', column: 'رقم المستخدم'},
  REF: {sheet: 'البيانات المرجعية', column: 'المعرف'}
});

/** يعيد كل قيم عمود المعرّف الفعلية (نصًا، غير فارغة) لبادئة معيّنة من ورقتها المصدر، أو [] إن كانت البادئة/الورقة/العمود غير موجودة. */
function existingIdsForPrefix_(prefix) {
  const source = ID_PREFIX_SOURCES_[prefix];
  if (!source) return [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(source.sheet) : null;
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  const colIndex = headers.indexOf(source.column);
  if (colIndex === -1) return [];
  return values.slice(1).map(row => String(row[colIndex] || '').trim()).filter(Boolean);
}

/** أعلى رقم تسلسلي فعليًا موجود في ورقة المصدر لهذه البادئة (0 إن لم يوجد أي معرّف مطابق للنمط). */
function highestExistingSeq_(prefix) {
  const re = new RegExp('^' + prefix + '-(\\d{6,})$');
  let max = 0;
  existingIdsForPrefix_(prefix).forEach(id => {
    const match = re.exec(id);
    if (match) {
      const n = Number(match[1]);
      if (n > max) max = n;
    }
  });
  return max;
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
    const storedSeq = Number(props.getProperty(key) || 0);
    // لا نثق بعدّاد Script Properties وحده: عند نسخ المشروع (Make a copy)
    // يُعاد هذا العدّاد للصفر بينما تحتفظ الأوراق ببياناتها القديمة كاملة،
    // فقد يعيد استخدام معرّف موجود فعليًا. نأخذ الأكبر بين العدّاد وأعلى
    // رقم فعلي موجود في الورقة نفسها، دائمًا داخل القفل نفسه لمنع التزامن.
    const actualMax = highestExistingSeq_(prefix);
    const current = Math.max(storedSeq, actualMax);
    props.setProperty(key, String(current + count));
    return Array.from({length: count}, (_, index) =>
      prefix + '-' + Utilities.formatString('%06d', current + index + 1)
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * تشخيص قراءة فقط (لا يكتب أي شيء) لحالة كل عدّاد معرّفات: القيمة
 * المخزَّنة في Script Properties، أعلى رقم فعلي في ورقة المصدر، عدد
 * المعرّفات المكررة فعليًا إن وُجدت، والقيمة الآمنة التالية لكل بادئة.
 * محمية برمز وصول الصيانة مثل بقية دوال diagnose*_ في المشروع.
 */
function diagnoseIdSequences_(token) {
  requireMaintenanceAccess_(token);
  const props = PropertiesService.getScriptProperties();
  const prefixes = Object.keys(ID_PREFIX_SOURCES_).map(prefix => {
    const source = ID_PREFIX_SOURCES_[prefix];
    const storedSeq = Number(props.getProperty('SEQ_' + prefix) || 0);
    const ids = existingIdsForPrefix_(prefix);
    const counts = {};
    ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    const duplicateIds = Object.keys(counts).filter(id => counts[id] > 1);
    const highestExisting = highestExistingSeq_(prefix);
    const safeNext = Math.max(storedSeq, highestExisting) + 1;
    return {
      prefix: prefix,
      sheet: source.sheet,
      column: source.column,
      storedSeq: storedSeq,
      highestExisting: highestExisting,
      nextSafeValue: prefix + '-' + Utilities.formatString('%06d', safeNext),
      duplicateCount: duplicateIds.length,
      duplicateIds: duplicateIds
    };
  });
  return {ok: true, generatedAt: formatDateTime_(new Date()), prefixes: prefixes};
}

/**
 * تُنفَّذ العملية مرة واحدة فقط لكل (فاعل + opId) خلال خمس دقائق، وتُعاد
 * نفس النتيجة الأصلية عند أي تكرار بنفس opId (لا تُعاد كتابة البيانات).
 * تُستخدم للعمليات التي يخطر تكرارها فعليًا عند إعادة محاولة بعد انتهاء
 * مهلة الواجهة رغم أن الطلب الأول قد يكون نجح فعليًا على الخادم (راجع
 * confirmDelivery وsaveDelegate/saveAssociation عند الإنشاء). opId يُنشئه
 * العميل مرة واحدة لكل محاولة منطقية ويُعاد استخدامه فقط عند "إعادة
 * المحاولة" الصريحة لنفس تلك المحاولة — وليس عند عملية جديدة تمامًا.
 */
function withIdempotency_(actorId, opId, fn) {
  if (!opId) return fn();
  const cache = CacheService.getScriptCache();
  const key = 'opid:' + actorId + ':' + String(opId).slice(0, 80);
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const result = fn();
  try { cache.put(key, JSON.stringify(result), 300); } catch (ignore) { /* تحسين، لا يوقف الاستجابة */ }
  return result;
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
  invalidateTableCache_(APP.sheets.settings);
}

