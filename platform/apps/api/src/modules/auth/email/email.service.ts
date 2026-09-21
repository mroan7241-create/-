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

export interface ApplicationAccessEmailItem {
  label: string;
  code: string;
  url: string;
}

export interface ApplicationAccessEmailParams {
  to: string;
  name: string;
  subject: string;
  intro: string;
  items: ApplicationAccessEmailItem[];
}

export interface OperationalDigestEmailParams {
  to: string;
  subject: string;
  text: string;
}

export abstract class EmailService {
  abstract sendPasswordResetCode(params: PasswordResetEmailParams): Promise<void>;
  abstract sendSecurityAlert(params: SecurityAlertEmailParams): Promise<void>;
  abstract sendApplicationAccess(params: ApplicationAccessEmailParams): Promise<void>;
  abstract sendOperationalDigest(params: OperationalDigestEmailParams): Promise<void>;
}
