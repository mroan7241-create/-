export type ParticipationStageInput = {
  status: unknown;
  selectionList: unknown;
  agreementStatus: unknown;
  setupCompletedAt: unknown;
  associationId: unknown;
};

export function canCompleteParticipationSetup(input: ParticipationStageInput): boolean {
  return input.status === 'APPROVED_AWAITING_SETUP' && input.selectionList === 'MAIN'
    && input.agreementStatus === 'SENT' && !input.setupCompletedAt;
}

export function canCreateCovenantSigningAccount(input: ParticipationStageInput): boolean {
  return input.status === 'APPROVED_AWAITING_SETUP' && input.selectionList === 'MAIN'
    && input.agreementStatus === 'SENT' && Boolean(input.setupCompletedAt) && !input.associationId;
}

export function participationStageLabel(input: ParticipationStageInput): string {
  if (input.status === 'ACTIVE' && input.agreementStatus === 'SIGNED') return 'مفعّلة — الميثاق مكتمل';
  if (input.selectionList !== 'MAIN') return 'بانتظار الإدراج في القائمة الأساسية';
  if (!input.agreementStatus) return 'إنشاء الميثاق';
  if (input.agreementStatus === 'DRAFT') return 'إرسال الميثاق';
  if (!input.setupCompletedAt) return 'إكمال التجهيز';
  if (input.agreementStatus === 'SENT') return input.associationId ? 'بانتظار توقيع ممثل الجمعية' : 'إنشاء حساب توقيع الجمعية';
  if (input.agreementStatus === 'SIGNED_BY_ORG') return 'بانتظار توقيع الطرف الأول';
  return 'تحتاج الحالة إلى مراجعة';
}
