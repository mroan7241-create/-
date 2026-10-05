import { AccountRole, AgreementStatus } from '@alzad/db';
import type { AdminPermission } from '@alzad/shared';

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
  adminFullAccess?: boolean;
  adminPermissions?: AdminPermission[];
  /** بيانات سبق أن تحقق منها حارس الجلسة في الطلب نفسه؛ لا تُخزَّن بين الطلبات. */
  meSnapshot?: {
    publicCode: string;
    name: string;
    covenantRequired: boolean;
    covenantStatus: AgreementStatus | null;
  };
}
