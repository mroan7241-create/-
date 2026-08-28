import { Injectable } from '@nestjs/common';
import { prisma, AccountRole, AccountStatus, AgreementStatus, AssociationSelectionList, AssociationStatus, AuthCredentialType, CoordinatorChangeStatus, ParticipationStatus, Prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { generateStrongTempPassword } from '../../common/crypto.util';
import { hashSecret } from '../../common/password.util';
import { requiredEmail, requiredText } from '../../common/validation/text.util';
import type { AuthContext } from '../auth/auth.types';
import type { CreateAgreementDto, CoordinatorChangeDto } from './dto/participation.dto';

@Injectable()
export class ParticipationsService {
  constructor(private readonly codes: PublicCodeService, private readonly idempotency: IdempotencyService) {}

  list(ctx: AuthContext) {
    const where: Prisma.ProjectParticipationWhereInput = ctx.role === AccountRole.ADMIN ? {} : { associationId: ctx.associationId ?? '__none__' };
    return prisma.projectParticipation.findMany({ where, include: { association: true, application: true, agreements: { orderBy: { version: 'desc' } }, closureReport: true }, orderBy: { createdAt: 'desc' } });
  }

  createAgreement(ctx: AuthContext, participationId: string, dto: CreateAgreementDto) {
    return prisma.$transaction(async (tx) => {
      const participation = await tx.projectParticipation.findUnique({ where: { id: participationId } });
      if (!participation) throw new ApiError('PARTICIPATION_NOT_FOUND', 'المشاركة غير موجودة', 404);
      const agreement = await tx.participationAgreement.create({ data: { participationId, version: dto.version, templateVersion: requiredText(dto.templateVersion, 'نسخة القالب', 80), fileId: dto.fileId ?? null, reference: dto.reference?.trim() || null, createdById: ctx.accountId } });
      await audit(tx, ctx, 'AGREEMENT_DRAFT_CREATED', 'participation_agreements', agreement.id, { participationId, version: dto.version }); return agreement;
    });
  }

  transitionAgreement(ctx: AuthContext, agreementId: string, status: AgreementStatus, signerName: string | undefined, opId: string) {
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; status: AgreementStatus }>(tx, ctx.accountId, 'agreement-transition', opId, { agreementId, status, signerName: signerName ?? null });
      if (!claim.claimed) return claim.existingResponse!;
      await tx.$queryRaw`SELECT id FROM participation_agreements WHERE id=${agreementId}::uuid FOR UPDATE`;
      const current = await tx.participationAgreement.findUnique({ where: { id: agreementId } });
      if (!current) throw new ApiError('AGREEMENT_NOT_FOUND', 'الاتفاقية غير موجودة', 404);
      const allowed: Partial<Record<AgreementStatus, AgreementStatus[]>> = {
        [AgreementStatus.DRAFT]: [AgreementStatus.SENT, AgreementStatus.CANCELLED],
        [AgreementStatus.SENT]: [AgreementStatus.SIGNED_BY_ORG, AgreementStatus.CANCELLED],
        [AgreementStatus.SIGNED_BY_ORG]: [AgreementStatus.SIGNED, AgreementStatus.CANCELLED],
      };
      if (!allowed[current.status]?.includes(status)) throw new ApiError('AGREEMENT_TRANSITION_INVALID', 'انتقال حالة الاتفاقية غير مسموح', 409);
      if ((status === AgreementStatus.SIGNED_BY_ORG || status === AgreementStatus.SIGNED) && !signerName?.trim()) throw new ApiError('AGREEMENT_SIGNER_REQUIRED', 'اسم الموقّع مطلوب', 400);
      const now = new Date();
      await tx.participationAgreement.update({ where: { id: agreementId }, data: { status, ...(status === AgreementStatus.SENT ? { sentAt: now } : {}), ...(status === AgreementStatus.SIGNED_BY_ORG ? { signedByOrgAt: now, orgSignerName: signerName!.trim() } : {}), ...(status === AgreementStatus.SIGNED ? { signedByZaadAt: now, zaadSignerName: signerName!.trim() } : {}) } });
      await audit(tx, ctx, status === AgreementStatus.SENT ? 'AGREEMENT_SENT' : status === AgreementStatus.SIGNED_BY_ORG ? 'AGREEMENT_ORG_SIGNED' : status === AgreementStatus.SIGNED ? 'AGREEMENT_SIGNED' : 'AGREEMENT_CANCELLED', 'participation_agreements', agreementId, { status });
      const response = { ok: true as const, status }; await this.idempotency.complete(tx, ctx.accountId, 'agreement-transition', opId, response); return response;
    });
  }

  completeSetup(ctx: AuthContext, id: string, opId: string) {
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true }>(tx, ctx.accountId, 'participation-setup', opId, { id }); if (!claim.claimed) return claim.existingResponse!;
      const result = await tx.projectParticipation.updateMany({ where: { id, status: ParticipationStatus.APPROVED_AWAITING_SETUP }, data: { setupCompletedAt: new Date(), setupCompletedById: ctx.accountId } });
      if (!result.count) throw new ApiError('PARTICIPATION_SETUP_INVALID', 'المشاركة غير موجودة أو ليست بانتظار التجهيز', 409);
      await audit(tx, ctx, 'PARTICIPATION_SETUP_COMPLETED', 'project_participations', id); const response = { ok: true as const }; await this.idempotency.complete(tx, ctx.accountId, 'participation-setup', opId, response); return response;
    });
  }

  async activate(ctx: AuthContext, id: string, opId: string) {
    const scope = 'participation-activate';
    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ associationId: string; accountId: string }>(tx, ctx.accountId, scope, opId, { id });
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };
      await tx.$queryRaw`SELECT id FROM project_participations WHERE id=${id}::uuid FOR UPDATE`;
      const participation = await tx.projectParticipation.findUnique({ where: { id }, include: { application: true, agreements: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!participation?.application) throw new ApiError('PARTICIPATION_NOT_ACTIVATABLE', 'المشاركة لا ترتبط بطلب جديد قابل للتفعيل', 409);
      if (participation.status !== ParticipationStatus.APPROVED_AWAITING_SETUP || !participation.setupCompletedAt) throw new ApiError('PARTICIPATION_SETUP_INCOMPLETE', 'متطلبات التجهيز غير مكتملة', 409);
      if (participation.application.selectionList !== AssociationSelectionList.MAIN) throw new ApiError('PARTICIPATION_NOT_MAIN', 'لا يمكن تفعيل طلب غير موجود في القائمة الأساسية', 409);
      if (participation.agreements[0]?.status !== AgreementStatus.SIGNED) throw new ApiError('AGREEMENT_NOT_SIGNED', 'لا يمكن التفعيل قبل اكتمال توقيع الاتفاقية', 409);
      const email = requiredEmail(participation.application.email);
      if (await tx.authCredential.findUnique({ where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } } })) throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر الآن', 409);
      const association = await tx.association.create({ data: { publicCode: await this.codes.nextPublicCode(tx, 'ASC'), name: participation.application.name, category: participation.application.category ?? '', region: participation.application.region, city: participation.application.city, phones: [participation.application.phone], email, status: AssociationStatus.ACTIVE } });
      const account = await tx.account.create({ data: { publicCode: await this.codes.nextPublicCode(tx, 'USR'), name: participation.application.name, email, role: AccountRole.ASSOCIATION, associationId: association.id, status: AccountStatus.ACTIVE, mustChangePassword: true } });
      const temporaryPassword = generateStrongTempPassword();
      await tx.authCredential.create({ data: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash: await hashSecret(temporaryPassword) } });
      await tx.associationApplication.update({ where: { id: participation.application.id }, data: { resultingAssociationId: association.id, reviewedAt: new Date(), reviewedById: ctx.accountId } });
      await tx.projectParticipation.update({ where: { id }, data: { associationId: association.id, status: ParticipationStatus.ACTIVE, activatedAt: new Date() } });
      await audit(tx, ctx, 'ASSOCIATION_ACTIVATED', 'project_participations', id, { associationId: association.id, accountId: account.id });
      const response = { associationId: association.id, accountId: account.id }; await this.idempotency.complete(tx, ctx.accountId, scope, opId, response); return { replayed: false as const, response, temporaryPassword };
    });
    return { ok: true as const, ...outcome.response, temporaryPassword: outcome.replayed ? null : outcome.temporaryPassword, temporaryPasswordPreviouslyIssued: outcome.replayed };
  }

  requestCoordinatorChange(ctx: AuthContext, participationId: string, dto: CoordinatorChangeDto) {
    return prisma.$transaction(async (tx) => {
      const p = await tx.projectParticipation.findUnique({ where: { id: participationId } });
      if (!p || (ctx.role !== AccountRole.ADMIN && p.associationId !== ctx.associationId)) throw new ApiError('PARTICIPATION_NOT_FOUND', 'المشاركة غير موجودة', 404);
      const request = await tx.coordinatorChangeRequest.create({ data: { participationId, proposedName: requiredText(dto.proposedName, 'اسم المنسق', 200), proposedPhone: requiredText(dto.proposedPhone, 'جوال المنسق', 30), proposedEmail: dto.proposedEmail?.trim() || null, proposedTitle: dto.proposedTitle?.trim() || null, reason: requiredText(dto.reason, 'سبب التغيير', 1000), requestedById: ctx.accountId } });
      await audit(tx, ctx, 'COORDINATOR_CHANGE_REQUESTED', 'coordinator_change_requests', request.id); return request;
    });
  }

  decideCoordinatorChange(ctx: AuthContext, requestId: string, decision: CoordinatorChangeStatus, notes: string | undefined) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.coordinatorChangeRequest.findUnique({ where: { id: requestId } });
      if (!request || request.status !== CoordinatorChangeStatus.PENDING) throw new ApiError('COORDINATOR_CHANGE_INVALID', 'طلب التغيير غير موجود أو سبق البت فيه', 409);
      if (decision === CoordinatorChangeStatus.APPROVED) await tx.projectParticipation.update({ where: { id: request.participationId }, data: { coordinatorName: request.proposedName, coordinatorPhone: request.proposedPhone, coordinatorEmail: request.proposedEmail, coordinatorTitle: request.proposedTitle } });
      await tx.coordinatorChangeRequest.update({ where: { id: requestId }, data: { status: decision, decidedById: ctx.accountId, decidedAt: new Date(), decisionNotes: notes?.trim() || null } });
      await audit(tx, ctx, decision === CoordinatorChangeStatus.APPROVED ? 'COORDINATOR_CHANGE_APPROVED' : 'COORDINATOR_CHANGE_REJECTED', 'coordinator_change_requests', requestId); return { ok: true };
    });
  }
}

async function audit(tx: Prisma.TransactionClient, ctx: AuthContext, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonObject) {
  await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: ctx.associationId ?? null, action, entityType, entityId, metadata } });
}
