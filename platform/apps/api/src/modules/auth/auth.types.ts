import { AccountRole } from '@alzad/db';

/**
 * سياق المصادقة الموحَّد المُرفَق على كل طلب موثَّق (request.authContext)
 * — المصدر الوحيد المعتمد لهوية الفاعل خلال الطلب. لا controller أو
 * service يقرأ association_id من body/query لتحديد tenant الفاعل نفسه؛
 * فقط من هنا (راجع platform/docs/AUTHENTICATION.md، قسم Tenant Context).
 */
export interface AuthContext {
  accountId: string;
  role: AccountRole;
  associationId: string | null;
  sessionId: string;
  mustChangePassword: boolean;
}
