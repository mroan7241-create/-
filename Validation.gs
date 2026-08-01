// -------------------- أدوات الأمان والتحقق --------------------

function hashSecret_(secret, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + '|' + String(secret) + '|' + ScriptApp.getScriptId(),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes);
}

function constantTimeEquals_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function createAccessCode_(prefix, length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let output = '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random());
  for (let i = 0; i < length; i++) output += alphabet.charAt(Math.abs(bytes[i % bytes.length]) % alphabet.length);
  return prefix + '-' + output;
}

function requiredText_(value, label, max) {
  const text = cleanText_(value, max);
  if (!text) throw new Error(label + ' مطلوب');
  return text;
}

const CONTROL_CHARS_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

function cleanText_(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(CONTROL_CHARS_RE, '')
    .trim().slice(0, max || 1000);
}

function cleanId_(value) {
  const id = String(value || '').trim();
  return /^[A-Z]{3}-\d{6}$/.test(id) ? id : '';
}

/**
 * معاينة آمنة (بلا كتابة) لأرقام الجوال غير المطابقة لصيغة التخزين
 * الموحّدة 05XXXXXXXX في المستفيدين والجمعيات والمناديب. تُشغَّل من
 * محرر Apps Script للمراجعة فقط — لا تغيّر أي بيانات. تتطلب رمز وصول
 * صيانة صالح. دالة خاصة، لا تُستدعى من الواجهة.
 */
function previewPhoneNormalization_(token) {
  requireMaintenanceAccess_(token);
  const targets = [
    [APP.sheets.beneficiaries, 'رقم المستفيد', ['رقم الجوال', 'رقم جوال إضافي']],
    [APP.sheets.associations, 'رقم الجمعية', ['أرقام التواصل']],
    [APP.sheets.delegates, 'رقم المندوب', ['رقم الجوال']]
  ];
  const report = [];
  targets.forEach(([sheetName, idHeader, phoneHeaders]) => {
    readTable_(sheetName).rows.forEach(row => {
      phoneHeaders.forEach(header => {
        const raw = String(row[header] || '').trim();
        if (!raw) return;
        try {
          const normalized = normalizePhone_(raw);
          if (normalized !== raw) {
            report.push({sheet: sheetName, idHeader: idHeader, id: row[idHeader], field: header, current: raw, suggested: normalized});
          }
        } catch (error) {
          report.push({sheet: sheetName, idHeader: idHeader, id: row[idHeader], field: header, current: raw, suggested: null, invalid: true});
        }
      });
    });
  });
  Logger.log('سجلات تحتاج تصحيح صيغة الجوال: ' + report.length);
  report.forEach(item => Logger.log(JSON.stringify(item)));
  return {ok: true, affected: report.length, report: report};
}

/**
 * ⚠️ لم تُستدعَ تلقائيًا من أي مكان. ترحيل كتابة فعلي — راجع تقرير
 * previewPhoneNormalization_() أولًا. يصحّح فقط الصيغة القابلة للتطبيع
 * تلقائيًا (5XXXXXXXX أو 9665XXXXXXXX أو +9665XXXXXXXX)، ولا يغيّر أي
 * رقم غير صالح أصلًا — تلك تُترك للمراجعة اليدوية. يتطلب رمز وصول صيانة
 * صالح. دالة خاصة، لا تُستدعى من الواجهة.
 */
function migratePhoneNumbers_(token) {
  requireMaintenanceAccess_(token);
  const preview = previewPhoneNormalization_(token);
  const fixable = preview.report.filter(item => !item.invalid);
  fixable.forEach(item => updateById_(item.sheet, item.idHeader, item.id, {[item.field]: item.suggested}));
  return {ok: true, fixed: fixable.length, skippedInvalid: preview.report.length - fixable.length};
}

function requiredEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!isEmail_(email)) throw new Error('البريد الإلكتروني غير صحيح');
  return email;
}

function isEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')) && String(value).length <= 180;
}

/**
 * يطبّع أربع صيغ سعودية شائعة (05XXXXXXXX، 5XXXXXXXX، 9665XXXXXXXX،
 * +9665XXXXXXXX) إلى صيغة تخزين موحّدة واحدة: 05XXXXXXXX دائمًا.
 * قبل هذا الإصلاح كانت صيغة "5XXXXXXXX" (بلا صفر بادئ) تُخزَّن كما هي،
 * فتُنتج روابط اتصال وواتساب فاسدة (مثال حقيقي: "550791650" بدل
 * "0550791650" أو "966550791650").
 */
function normalizePhone_(value) {
  const phone = String(value || '').replace(/[^\d+]/g, '');
  if (!/^(?:\+?966|0)?5\d{8}$/.test(phone)) throw new Error('رقم الجوال غير صحيح');
  if (phone.indexOf('+966') === 0) return '0' + phone.slice(4);
  if (phone.indexOf('966') === 0) return '0' + phone.slice(3);
  if (phone.charAt(0) === '5') return '0' + phone;
  return phone;
}

/**
 * شبكة أمان للعرض فقط (لا تكتب شيئًا) لسجلات كُتبت رقم جوالها قبل إصلاح
 * safeCell_ (كان Range.setValues() يحوّل نصًا مثل "0501234567" تلقائيًا
 * إلى Number فيضيع صفره الأول عند التخزين). تُعيد بناء الصفر البادئ عند
 * القراءة فقط إن كانت القيمة المخزَّنة رقمًا سعوديًا صريحًا بلا صفر —
 * لا تفترض شيئًا آخر ولا تلمس البيانات المخزَّنة فعليًا.
 */
function displayPhone_(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.indexOf('966') === 0 && digits.length === 12) return '0' + digits.slice(3);
  if (digits.charAt(0) === '5' && digits.length === 9 && raw.charAt(0) !== '0') return '0' + digits;
  return raw;
}

function boundedNumber_(value, min, max, label) {
  const number = Number(value);
  if (!isFinite(number) || number < min || number > max) throw new Error(label + ' غير صحيح');
  return number;
}

/**
 * إحداثيات اختيارية بالكامل (تُترك فارغة كما كانت دائمًا إن لم تُدخَل).
 * تُعامَل كأرقام حقيقية دائمًا في الخادم، لا كنص غير متحقَّق:
 * - يجب وجود القيمتين معًا أو غيابهما معًا — قيمة واحدة فقط تُرفض صراحة
 *   بدل إسقاطها بصمت (كان السلوك السابق يُسقط أي طرف ناقص دون تنبيه).
 * - يُرفض NaN وInfinity وأي قيمة غير رقمية عبر isFinite (يرفض كليهما معًا).
 * - نطاق عالمي قياسي: خط العرض بين -90 و90، خط الطول بين -180 و180 —
 *   لا يُحصر بمربع السعودية تحديدًا (تعديل مقصود في هذه المرحلة يوسّع
 *   النطاق المقبول بدل النطاق الأضيق الخاص بالمملكة فقط الذي كان مطبَّقًا
 *   سابقًا؛ التحقق الجغرافي الأدق يبقى مسؤولية المستخدم عبر الخريطة).
 */
function optionalCoordinate_(lat, lng) {
  const latEmpty = lat === '' || lat === null || lat === undefined;
  const lngEmpty = lng === '' || lng === null || lng === undefined;
  if (latEmpty && lngEmpty) return {lat: '', lng: ''};
  if (latEmpty !== lngEmpty) {
    throw new Error('أدخل خط العرض وخط الطول معًا، أو اترك الحقلين فارغين معًا');
  }
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!isFinite(latNum) || !isFinite(lngNum)) {
    throw new Error('الإحداثيات يجب أن تكون أرقامًا صحيحة');
  }
  if (latNum < -90 || latNum > 90) throw new Error('خط العرض يجب أن يكون بين -90 و90');
  if (lngNum < -180 || lngNum > 180) throw new Error('خط الطول يجب أن يكون بين -180 و180');
  return {lat: latNum, lng: lngNum};
}

/**
 * مصدر الموقع (خريطة/الموقع الحالي/استيراد/يدوي) — وصفي بحت، لا يؤثر في
 * صحة الإحداثيات. فارغ دائمًا إن لم تُوجد إحداثيات (لا معنى لمصدر بلا
 * موقع). قيمة غير معروفة تُصحَّح إلى "يدوي" بدل الرفض — حقل تشخيصي مساعد
 * لا حرج أمني أو منطقي في تساهله، بخلاف حقول التحقق الإلزامية الأخرى.
 */
function validateLocationSource_(value, hasCoordinates) {
  if (!hasCoordinates) return '';
  const cleaned = cleanText_(value, 30);
  return LOCATION_SOURCES.indexOf(cleaned) >= 0 ? cleaned : 'يدوي';
}

function normalizeNeeds_(needs) {
  const list = Array.isArray(needs) ? needs : splitList_(needs);
  return list.map(item => cleanText_(item, 80)).filter(Boolean).slice(0, 20).join('، ');
}

function safeUrl_(value) {
  const url = String(value || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : '';
}

function mergeNote_(oldNote, newNote) {
  const stamp = '[' + formatDateTime_(new Date()) + '] ';
  return cleanText_((oldNote ? oldNote + '\n' : '') + stamp + newNote, 2000);
}

function splitList_(value) {
  return String(value || '').split(/[،,]\s*/).map(x => x.trim()).filter(Boolean);
}

function countBy_(rows, key, value) {
  return rows.filter(row => String(row[key]) === value).length;
}

function safeNumber_(value) {
  if (typeof value === 'string') value = value.replace('%', '').replace(',', '.').trim();
  const number = Number(value);
  return isFinite(number) ? number : 0;
}

/**
 * إجابة نعم/لا مطلوبة (تُقبل true/false أو 'نعم'/'لا' من العميل) —
 * تُخزَّن دائمًا كنص عربي موحَّد 'نعم'/'لا'، متسقة مع بقية أعمدة النظام
 * من نفس النوع (مثل "ضمان اجتماعي" و"يجب تغيير كلمة المرور").
 */
function requiredYesNo_(value, label) {
  if (value === true || value === 'نعم' || value === 'yes' || value === 'on') return 'نعم';
  if (value === false || value === 'لا' || value === 'no') return 'لا';
  throw new Error(label + ': أجب بنعم أو لا');
}

/** تاريخ مطلوب بصيغة صحيحة (yyyy-mm-dd أو yyyy/mm/dd) — يعيده منسَّقًا عربيًا موحَّدًا. */
function requiredDate_(value, label) {
  const parsed = parseDate_(value);
  if (!parsed) throw new Error(label + ' غير صحيح — استخدم صيغة تاريخ صالحة');
  return formatDate_(parsed);
}

function parseDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value;
  const match = String(value).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  return isNaN(date.getTime()) ? null : date;
}

function formatDate_(date) {
  return date && !isNaN(date.getTime()) ? Utilities.formatDate(date, APP.timezone, 'yyyy/MM/dd') : '';
}

function formatDateTime_(date) {
  return date && !isNaN(date.getTime()) ? Utilities.formatDate(date, APP.timezone, 'yyyy/MM/dd HH:mm') : '';
}

function now_() {
  return formatDateTime_(new Date());
}

function stripTime_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween_(from, to) {
  return Math.max(0, Math.ceil((stripTime_(to) - stripTime_(from)) / 86400000));
}

function serializeValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDate_(value);
  return value === undefined || value === null ? '' : String(value);
}
