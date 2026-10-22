import type { Prisma } from '@alzad/db';
import { isEmail } from 'class-validator';

export const NONSELECTION_CAMPAIGN = '20261022';
export const NONSELECTION_SUBJECT = 'نتيجة طلب المشاركة — مشروع الأجهزة الكهربائية';
export const NONSELECTION_BODY = 'نشكر لكم اهتمامكم وتقديمكم للمشاركة في مشروع الأجهزة الكهربائية بالشراكة مع مؤسسة سليمان أبانمي الأهلية.\n\nنعتذر عن عدم اختيار جمعيتكم للمشاركة في هذه المرحلة، بعد استكمال دراسة الطلبات واعتماد الجمعيات المشاركة.\n\nنثمّن جهودكم، ونتطلع إلى فرص تعاون قادمة بإذن الله.';
export const NONSELECTION_PROTECTED_CODES = ['272','010','150','102','061','195','155','132','097','014','183','162','153','261','319','241','125','253','308','163','204','030','184','139','328'].map(code => `APP-000${code}`);
export const nonselectionMarker = (applicationId: string) => `NONSELECTION_NOTICE:${NONSELECTION_CAMPAIGN}:${applicationId}`;

// Both the producer and SMTP worker recheck the same protections. Notifications
// do not change eligibility, selection, participation, or account status.
export async function nonselectionExclusion(tx: Prisma.TransactionClient, app: { id: string; publicCode: string; name: string; email: string | null; resultingAssociationId: string | null }) {
  if (NONSELECTION_PROTECTED_CODES.includes(app.publicCode) || app.resultingAssociationId) return 'PROTECTED_ASSOCIATION';
  if (/تجرب|اختبار|\btest\b/i.test(app.name)) return 'TEST_APPLICATION';
  const email = app.email?.trim().toLowerCase();
  if (!email || !isEmail(email)) return 'INVALID_EMAIL';
  if (await tx.projectParticipation.count({ where: { applicationId: app.id, agreements: { some: { status: { not: 'CANCELLED' } } } } })) return 'PROTECTED_COVENANT';
  if (await tx.associationApplication.count({ where: { id: { not: app.id }, email: { equals: email, mode: 'insensitive' } } })) return 'SHARED_EMAIL';
  if (await tx.auditLog.findFirst({ where: { entityId: app.id, action: 'APPLICATION_REJECTION_EMAIL_SENT' }, select: { id: true } })) return 'PREVIOUS_REJECTION';
  return null;
}
