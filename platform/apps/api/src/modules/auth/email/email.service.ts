/**
 * واجهة إرسال بريد مجرَّدة — لا ربط بمزوّد Production فعلي في NODE-1
 * إطلاقًا (ممنوع صراحة). AuthService يعتمد فقط على هذه الواجهة، فلا
 * تغيير مطلوب فيه عند ربط مزوّد حقيقي لاحقًا — فقط استبدال الـprovider
 * في AuthModule.
 */
export interface PasswordResetEmailParams {
  to: string;
  name: string;
  code: string;
}

export interface SecurityAlertEmailParams {
  to: string;
  name: string;
  subject: string;
  body: string;
}

export abstract class EmailService {
  abstract sendPasswordResetCode(params: PasswordResetEmailParams): Promise<void>;
  abstract sendSecurityAlert(params: SecurityAlertEmailParams): Promise<void>;
}
