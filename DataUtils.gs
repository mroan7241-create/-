// -------------------- أدوات قاعدة البيانات --------------------

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('شغّل setupSheets() أولًا. الورقة المفقودة: ' + name);
  return sheet;
}

/**
 * ذاكرة تخزين مؤقت محدودة العمر (أقل من نطاق أي طلب واحد بأمان) تمنع
 * قراءة الورقة نفسها أكثر من مرة ضمن الطلب الواحد. مثال حقيقي كان
 * موجودًا قبل هذا التغيير: buildAssociationPortal_ تقرأ المستفيدين
 * والأجهزة والمناديب، ثم getAuditRows_ المستدعاة بعدها مباشرة تعيد
 * قراءة الأوراق الأربع نفسها بالكامل من جديد لغرض تصفية السجل فقط.
 * أي عملية كتابة (appendObjects_/updateById_) تُبطل ورقتها فورًا، فلا
 * يمكن لهذه الذاكرة أن تُعيد بيانات قديمة بعد أي تعديل.
 */
const _TABLE_CACHE_ = {};
const _TABLE_CACHE_TTL_MS_ = 4000;

/**
 * عدّادات قراءة/كتابة على مستوى تنفيذ الطلب الواحد (لا تُخزَّن بين
 * الطلبات) — تُستخدم فقط لقياس تكلفة كل عملية عبر perfTime_ أدناه، ولا
 * تُسجَّل أي بيانات حساسة معها (عدد فقط، لا محتوى الصفوف). "قراءة" هنا
 * تعني قراءة ورقة كاملة فعليًا من Sheets API (تُستثنى إعادة القراءة من
 * الذاكرة المؤقتة _TABLE_CACHE_ لأنها لا تُكلّف شيئًا فعليًا).
 */
const _PERF_ = {reads: 0, writes: 0};

function perfSnapshot_() {
  return {reads: _PERF_.reads, writes: _PERF_.writes};
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
      reads: after.reads - before.reads, writes: after.writes - before.writes
    }));
  } catch (ignore) { /* التسجيل تحسين تشخيصي، لا يوقف الطلب أبدًا */ }
  return result;
}

function readTable_(name) {
  const cached = _TABLE_CACHE_[name];
  if (cached && (Date.now() - cached.at) < _TABLE_CACHE_TTL_MS_) return cached.value;
  _PERF_.reads++;
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
  _TABLE_CACHE_[name] = {value: result, at: Date.now()};
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
  _PERF_.writes++;
  const sheet = sheet_(sheetName);
  const headers = HEADERS[sheetName];
  const rows = objects.map(object =>
    headers.map(header => safeCell_(object[header] === undefined ? '' : object[header]))
  );
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  invalidateTableCache_(sheetName);
}

function findById_(sheetName, idHeader, id) {
  return readTable_(sheetName).rows.find(row => String(row[idHeader]) === String(id)) || null;
}

function updateById_(sheetName, idHeader, id, changes) {
  _PERF_.writes++;
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const map = {};
  values[0].forEach((header, index) => map[String(header)] = index);
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[map[idHeader]]) === String(id));
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
  _PERF_.writes++;
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
    const current = Number(props.getProperty(key) || 0);
    props.setProperty(key, String(current + count));
    return Array.from({length: count}, (_, index) =>
      prefix + '-' + Utilities.formatString('%06d', current + index + 1)
    );
  } finally {
    lock.releaseLock();
  }
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

