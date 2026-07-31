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
 * محرر Apps Script للمراجعة فقط — لا تغيّر أي بيانات.
 */
function previewPhoneNormalization() {
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
 * previewPhoneNormalization() أولًا. يصحّح فقط الصيغة القابلة للتطبيع
 * تلقائيًا (5XXXXXXXX أو 9665XXXXXXXX أو +9665XXXXXXXX)، ولا يغيّر أي
 * رقم غير صالح أصلًا — تلك تُترك للمراجعة اليدوية.
 */
function migratePhoneNumbers() {
  const preview = previewPhoneNormalization();
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
 * عند إدخالها تُحصر ضمن مربع إحداثيات المملكة تقريبًا لرفض أخطاء
 * إدخال واضحة (مثل عكس خط العرض والطول) دون فرض دقة كاملة.
 */
function optionalCoordinate_(lat, lng) {
  if (lat === '' || lat === null || lat === undefined || lng === '' || lng === null || lng === undefined) {
    return {lat: '', lng: ''};
  }
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!isFinite(latNum) || !isFinite(lngNum) || latNum < 15 || latNum > 33 || lngNum < 33 || lngNum > 56) {
    throw new Error('الإحداثيات خارج نطاق المملكة المتوقع — تحقق من خط العرض والطول');
  }
  return {lat: latNum, lng: lngNum};
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
