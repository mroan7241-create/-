export function covenantSigningError(input: {
  representativeName: string;
  representativeTitle: string;
  authorized: boolean;
  accepted: boolean;
  completionAcknowledged: boolean;
  signatureReady: boolean;
  password: string;
}): string {
  if (!input.representativeName.trim()) return 'أدخل اسم الممثل المخول.';
  if (!input.representativeTitle.trim()) return 'أدخل صفة الممثل المخول.';
  if (!input.authorized) return 'فعّل إقرار التفويض بتمثيل الجمعية.';
  if (!input.accepted) return 'فعّل إقرار الاطلاع والموافقة على الميثاق.';
  if (!input.completionAcknowledged) return 'فعّل التعهد بإنجاز المهام وتسليم الأجهزة خلال شهرين.';
  if (!input.signatureReady) return 'ارسم توقيعك ثم اضغط «اعتماد التوقيع» أسفل مساحة الرسم.';
  if (!input.password) return 'أدخل كلمة المرور الحالية التي تستخدمها لتسجيل الدخول.';
  return '';
}
