/**
 * مشاركة بيانات دخول لمرة واحدة (كلمة مرور مؤقتة لجمعية، أو رمز دخول
 * مندوب) عبر واتساب — يوازي showCredentialShareModal/buildWhatsAppShareUrl/
 * normalizePhoneForShare القديمة (Index.html) حرفيًا. السرّ لا يُخزَّن ولا
 * يُرسَل لأي مكان غير هذا الرابط الذي يفتحه المستخدم بنفسه.
 */

/** يطابق normalizePhoneForShare القديمة تمامًا — يدعم صيغ 05xxxxxxxx/9665xxxxxxxx/5xxxxxxxx محليًا وصيغًا دولية أخرى كما هي. */
export function normalizePhoneForShare(value: string): string | null {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.indexOf('00') === 0) digits = digits.slice(2);
  if (digits.indexOf('966') === 0 && digits.length === 12) return digits;
  if (digits.charAt(0) === '0' && digits.length === 10 && digits.charAt(1) === '5') return '966' + digits.slice(1);
  if (digits.charAt(0) === '5' && digits.length === 9) return '966' + digits;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

/** رابط wa.me برسالة جاهزة مُرمَّزة — null إن كان الرقم غير صالح. */
export function buildWhatsAppShareUrl(phone: string, message: string): string | null {
  const intl = normalizePhoneForShare(phone);
  if (!intl) return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export function delegateWelcomeMessage(name: string, code: string): string {
  return `حياك الله ${name}،\n`
    + `تم تسجيلك مندوبًا في مشروع توزيع الأجهزة بجمعية الزاد.\n`
    + `رابط الدخول: ${window.location.origin}\n`
    + `رمز الدخول: ${code}\n`
    + `يرجى المحافظة على الرمز وعدم مشاركته.`;
}

export function associationAcceptMessage(name: string, email: string, password: string): string {
  return `نبارك لكم قبول ${name} في مشروع توزيع الأجهزة بجمعية الزاد.\n`
    + `رابط الدخول: ${window.location.origin}\n`
    + `البريد الإلكتروني: ${email}\n`
    + `كلمة المرور المؤقتة: ${password}\n`
    + `يرجى تغيير كلمة المرور عند أول دخول.`;
}
