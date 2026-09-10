import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { prisma, AccountRole, AccountStatus, AgreementStatus, AssociationSelectionList, AssociationStatus, AuthCredentialType, CoordinatorChangeStatus, FileCategory, ParticipationStatus, Prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { generateStrongTempPassword, sha256Hex } from '../../common/crypto.util';
import { hashSecret, verifySecret } from '../../common/password.util';
import { requiredEmail, requiredText } from '../../common/validation/text.util';
import { storageConfig } from '../../config/storage.config';
import { StorageService } from '../files/storage.service';
import { validateReceiptEvidenceFile } from '../files/file-validation.util';
import type { AuthContext } from '../auth/auth.types';
import type { AssociationCovenantSignDto, CreateAgreementDto, CoordinatorChangeDto } from './dto/participation.dto';
import { COVENANT_SOURCE_SHA256, COVENANT_VERSION, CovenantDocumentService, PARTY_ONE_NAME, PARTY_ONE_TITLE } from './covenant-document.service';

@Injectable()
export class ParticipationsService {
  constructor(
    private readonly codes: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: StorageService,
    private readonly covenantDocument: CovenantDocumentService,
  ) {}

  list(ctx: AuthContext) {
    const where: Prisma.ProjectParticipationWhereInput = ctx.role === AccountRole.ADMIN ? {} : { associationId: ctx.associationId ?? '__none__' };
    return prisma.projectParticipation.findMany({ where, include: { association: true, application: true, agreements: { orderBy: { version: 'desc' } }, closureReport: true }, orderBy: { createdAt: 'desc' } });
  }

  createAgreement(ctx: AuthContext, participationId: string, dto: CreateAgreementDto) {
    return prisma.$transaction(async (tx) => {
      const participation = await tx.projectParticipation.findUnique({ where: { id: participationId } });
      if (!participation) throw new ApiError('PARTICIPATION_NOT_FOUND', 'المشاركة غير موجودة', 404);
      if (dto.version !== 1 || dto.templateVersion !== COVENANT_VERSION) throw new ApiError('COVENANT_VERSION_INVALID', 'الإصدار المعتمد حاليًا هو ميثاق 1.0 فقط', 400);
      const existing = await tx.participationAgreement.findUnique({ where: { participationId_version: { participationId, version: 1 } } });
      if (existing) throw new ApiError('COVENANT_VERSION_EXISTS', 'سبق إنشاء الإصدار المعتمد من الميثاق لهذه المشاركة', 409);
      const agreement = await tx.participationAgreement.create({ data: {
        participationId,
        version: 1,
        templateVersion: COVENANT_VERSION,
        templateSha256: COVENANT_SOURCE_SHA256,
        fileId: dto.fileId ?? null,
        reference: dto.reference?.trim() || await this.codes.nextPublicCode(tx, 'COV'),
        createdById: ctx.accountId,
      } });
      await audit(tx, ctx, 'AGREEMENT_DRAFT_CREATED', 'participation_agreements', agreement.id, { participationId, version: dto.version }); return agreement;
    });
  }

  transitionAgreement(ctx: AuthContext, agreementId: string, status: AgreementStatus, _signerName: string | undefined, opId: string) {
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; status: AgreementStatus }>(tx, ctx.accountId, 'agreement-transition', opId, { agreementId, status });
      if (!claim.claimed) return claim.existingResponse!;
      await tx.$queryRaw`SELECT id FROM participation_agreements WHERE id=${agreementId}::uuid FOR UPDATE`;
      const current = await tx.participationAgreement.findUnique({ where: { id: agreementId } });
      if (!current) throw new ApiError('AGREEMENT_NOT_FOUND', 'الاتفاقية غير موجودة', 404);
      const allowed: Partial<Record<AgreementStatus, AgreementStatus[]>> = {
        [AgreementStatus.DRAFT]: [AgreementStatus.SENT, AgreementStatus.CANCELLED],
        [AgreementStatus.SENT]: [AgreementStatus.CANCELLED],
      };
      if (!allowed[current.status]?.includes(status)) throw new ApiError('AGREEMENT_TRANSITION_INVALID', 'انتقال حالة الاتفاقية غير مسموح', 409);
      const now = new Date();
      await tx.participationAgreement.update({ where: { id: agreementId }, data: { status, ...(status === AgreementStatus.SENT ? { sentAt: now } : {}) } });
      await audit(tx, ctx, status === AgreementStatus.SENT ? 'AGREEMENT_SENT' : 'AGREEMENT_CANCELLED', 'participation_agreements', agreementId, { status });
      const response = { ok: true as const, status }; await this.idempotency.complete(tx, ctx.accountId, 'agreement-transition', opId, response); return response;
    });
  }

  async prepareSigningAccount(ctx: AuthContext, participationId: string, opId: string) {
    const scope = 'covenant-signing-account';
    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ associationId: string; accountId: string }>(tx, ctx.accountId, scope, opId, { participationId });
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };
      await tx.$queryRaw`SELECT id FROM project_participations WHERE id=${participationId}::uuid FOR UPDATE`;
      const participation = await tx.projectParticipation.findUnique({ where: { id: participationId }, include: { application: true, agreements: { orderBy: { version: 'desc' }, take: 1 } } });
      const agreement = participation?.agreements[0];
      if (!participation?.application || !agreement) throw new ApiError('COVENANT_SIGNING_ACCOUNT_INVALID', 'المشاركة أو الميثاق غير متاح', 409);
      if (participation.status !== ParticipationStatus.APPROVED_AWAITING_SETUP || !participation.setupCompletedAt) throw new ApiError('PARTICIPATION_SETUP_INCOMPLETE', 'متطلبات التجهيز غير مكتملة', 409);
      if (participation.application.selectionList !== AssociationSelectionList.MAIN) throw new ApiError('PARTICIPATION_NOT_MAIN', 'لا يمكن تجهيز حساب توقيع لطلب غير موجود في القائمة الأساسية', 409);
      if (agreement.status !== AgreementStatus.SENT || agreement.templateVersion !== COVENANT_VERSION || agreement.templateSha256 !== COVENANT_SOURCE_SHA256) throw new ApiError('COVENANT_NOT_READY', 'الميثاق المعتمد غير جاهز لتوقيع الجمعية', 409);
      if (participation.associationId) throw new ApiError('COVENANT_SIGNING_ACCOUNT_EXISTS', 'سبق إنشاء حساب التوقيع لهذه المشاركة', 409);
      const email = requiredEmail(participation.application.email);
      if (await tx.authCredential.findUnique({ where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } } })) throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر الآن', 409);
      const association = await tx.association.create({ data: { publicCode: await this.codes.nextPublicCode(tx, 'ASC'), name: participation.application.name, category: participation.application.category ?? '', region: participation.application.region, city: participation.application.city, phones: [participation.application.phone], email, status: AssociationStatus.ACTIVE } });
      const account = await tx.account.create({ data: { publicCode: await this.codes.nextPublicCode(tx, 'USR'), name: participation.application.name, email, role: AccountRole.ASSOCIATION, associationId: association.id, status: AccountStatus.ACTIVE, mustChangePassword: true } });
      const temporaryPassword = generateStrongTempPassword();
      await tx.authCredential.create({ data: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash: await hashSecret(temporaryPassword) } });
      await tx.projectParticipation.update({ where: { id: participationId }, data: { associationId: association.id } });
      await tx.associationApplication.update({ where: { id: participation.application.id }, data: { resultingAssociationId: association.id, reviewedAt: new Date(), reviewedById: ctx.accountId } });
      await tx.participationAgreement.update({ where: { id: agreement.id }, data: { associationAccountId: account.id } });
      await audit(tx, ctx, 'COVENANT_RESTRICTED_ACCOUNT_CREATED', 'participation_agreements', agreement.id, { associationId: association.id, accountId: account.id });
      const response = { associationId: association.id, accountId: account.id };
      await this.idempotency.complete(tx, ctx.accountId, scope, opId, response);
      return { replayed: false as const, response, temporaryPassword };
    });
    return { ok: true as const, ...outcome.response, temporaryPassword: outcome.replayed ? null : outcome.temporaryPassword, temporaryPasswordPreviouslyIssued: outcome.replayed };
  }

  async getOwnCovenant(ctx: AuthContext) {
    if (ctx.role !== AccountRole.ASSOCIATION || !ctx.associationId) throw new ApiError('COVENANT_NOT_FOUND', 'الميثاق غير متاح', 404);
    const participation = await prisma.projectParticipation.findUnique({ where: { associationId: ctx.associationId }, include: { association: true, agreements: { orderBy: { version: 'desc' }, take: 1 } } });
    const agreement = participation?.agreements[0];
    if (!participation || !agreement) throw new ApiError('COVENANT_NOT_FOUND', 'الميثاق غير متاح', 404);
    return covenantView(participation, agreement);
  }

  covenantTemplate() { return this.covenantDocument.templateBytes(); }

  async signAssociation(ctx: AuthContext, dto: AssociationCovenantSignDto, signature: { buffer: Buffer; declaredMimeType?: string }) {
    if (ctx.role !== AccountRole.ASSOCIATION || !ctx.associationId) throw new ApiError('COVENANT_NOT_FOUND', 'الميثاق غير متاح', 404);
    if (dto.authorizedAcknowledgement !== 'true') throw new ApiError('COVENANT_AUTHORIZATION_REQUIRED', 'إقرار التفويض بتمثيل الجمعية مطلوب', 400);
    if (dto.acceptanceAcknowledgement !== 'true') throw new ApiError('COVENANT_ACCEPTANCE_REQUIRED', 'إقرار الاطلاع والموافقة على الميثاق مطلوب', 400);
    const validated = validateCovenantSignature(signature);
    const credential = await prisma.authCredential.findFirst({ where: { accountId: ctx.accountId, type: AuthCredentialType.EMAIL_PASSWORD } });
    if (!credential || !(await verifySecret(credential.secretHash, String(dto.currentPassword || '')))) throw new ApiError('COVENANT_PASSWORD_INVALID', 'كلمة المرور الحالية غير صحيحة', 400);
    const objectKey = `covenants/signatures/association/${randomUUID()}.${validated.mime === 'image/png' ? 'png' : 'jpg'}`;
    let uploaded = false;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const claim = await this.idempotency.claim<{ ok: true; status: AgreementStatus }>(tx, ctx.accountId, 'covenant-association-sign', dto.opId, { representativeName: dto.representativeName, representativeTitle: dto.representativeTitle });
        if (!claim.claimed) return claim.existingResponse!;
        const participation = await tx.projectParticipation.findUnique({ where: { associationId: ctx.associationId! }, include: { agreements: { orderBy: { version: 'desc' }, take: 1 } } });
        const agreement = participation?.agreements[0];
        if (!agreement || agreement.associationAccountId !== ctx.accountId || agreement.status !== AgreementStatus.SENT) throw new ApiError('COVENANT_ALREADY_SIGNED_OR_INVALID', 'الميثاق غير قابل للتوقيع أو سبق توقيعه', 409);
        await this.storage.uploadPrivateObject(objectKey, signature.buffer, validated.mime); uploaded = true;
        const file = await tx.fileObject.create({ data: { storageProvider: 's3', bucket: storageConfig.bucket, objectKey, originalName: 'association-covenant-signature', mimeType: validated.mime, sizeBytes: BigInt(signature.buffer.length), sha256: bufferSha256(signature.buffer), category: FileCategory.PARTICIPATION_AGREEMENT, uploadedById: ctx.accountId } });
        const now = new Date();
        await tx.participationAgreement.update({ where: { id: agreement.id }, data: { status: AgreementStatus.SIGNED_BY_ORG, orgSignerName: requiredText(dto.representativeName, 'اسم الممثل المخول', 200), orgSignerTitle: requiredText(dto.representativeTitle, 'صفة الممثل', 120), orgSignatureFileId: file.id, associationAccountId: ctx.accountId, signedByOrgAt: now } });
        await audit(tx, ctx, 'COVENANT_ASSOCIATION_SIGNED', 'participation_agreements', agreement.id, { version: COVENANT_VERSION, templateSha256: COVENANT_SOURCE_SHA256 });
        const response = { ok: true as const, status: AgreementStatus.SIGNED_BY_ORG };
        await this.idempotency.complete(tx, ctx.accountId, 'covenant-association-sign', dto.opId, response);
        return response;
      });
      return result;
    } catch (error) {
      if (uploaded) await this.storage.deleteObjectBestEffort(objectKey);
      throw error;
    }
  }

  async issuePartyOneSigningSession(ctx: AuthContext, agreementId: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM participation_agreements WHERE id=${agreementId}::uuid FOR UPDATE`;
      const agreement = await tx.participationAgreement.findUnique({ where: { id: agreementId } });
      if (!agreement || agreement.status !== AgreementStatus.SIGNED_BY_ORG || !agreement.orgSignatureFileId) throw new ApiError('COVENANT_PARTY_ONE_SESSION_INVALID', 'الميثاق ليس بانتظار توقيع الطرف الأول', 409);
      await tx.participationAgreement.update({ where: { id: agreementId }, data: { partyOneSigningTokenHash: sha256Hex(token), partyOneSigningExpiresAt: expiresAt, partyOneSigningConsumedAt: null, partyOneSigningIssuedById: ctx.accountId } });
      await audit(tx, ctx, 'COVENANT_PARTY_ONE_SIGNING_SESSION_ISSUED', 'participation_agreements', agreementId, { expiresAt: expiresAt.toISOString() });
    });
    return { token, path: `/covenant/party-one/${encodeURIComponent(token)}`, expiresAt };
  }

  async getPartyOneSigningView(token: string) {
    const agreement = await this.validPartyOneAgreement(token);
    return {
      reference: agreement.reference,
      version: agreement.templateVersion,
      status: agreement.status,
      associationName: agreement.participation.association?.name ?? agreement.participation.application?.name,
      associationRepresentative: agreement.orgSignerName,
      associationRepresentativeTitle: agreement.orgSignerTitle,
      associationSignedAt: agreement.signedByOrgAt,
      partyOneRepresentative: PARTY_ONE_NAME,
      partyOneTitle: PARTY_ONE_TITLE,
    };
  }

  async getPartyOneAssociationSignatureUrl(token: string) {
    const agreement = await this.validPartyOneAgreement(token);
    if (!agreement.orgSignatureFile) throw new ApiError('COVENANT_SIGNATURE_NOT_FOUND', 'توقيع الجمعية غير متاح', 404);
    return { url: await this.storage.getSignedGetUrl(agreement.orgSignatureFile.objectKey, storageConfig.licenseSignedUrlSeconds) };
  }

  async signPartyOne(token: string, opId: string, signature: { buffer: Buffer; declaredMimeType?: string }) {
    const validated = validateCovenantSignature(signature);
    const agreement = await this.validPartyOneAgreement(token);
    if (!agreement.orgSignatureFile || !agreement.signedByOrgAt || !agreement.orgSignerName || !agreement.orgSignerTitle) throw new ApiError('COVENANT_ASSOCIATION_SIGNATURE_INCOMPLETE', 'توقيع الجمعية غير مكتمل', 409);
    const associationName = agreement.participation.association?.name ?? agreement.participation.application?.name;
    if (!associationName) throw new ApiError('COVENANT_ASSOCIATION_MISSING', 'بيانات الجمعية غير مكتملة', 409);
    const now = new Date();
    const orgSignature = await this.storage.getPrivateObject(agreement.orgSignatureFile.objectKey);
    const finalBytes = await this.covenantDocument.generateFinal({
      associationName,
      associationRepresentative: agreement.orgSignerName,
      associationRepresentativeTitle: agreement.orgSignerTitle,
      associationSignature: orgSignature,
      associationSignatureMime: agreement.orgSignatureFile.mimeType,
      associationSignedAt: agreement.signedByOrgAt,
      partyOneSignature: signature.buffer,
      partyOneSignatureMime: validated.mime,
      partyOneSignedAt: now,
      reference: agreement.reference ?? `COV-${agreement.id.slice(0, 8)}`,
    });
    const partyKey = `covenants/signatures/party-one/${randomUUID()}.${validated.mime === 'image/png' ? 'png' : 'jpg'}`;
    // A unique object key ensures a losing concurrent request can only clean up
    // its own upload and can never delete the immutable object committed by the winner.
    const finalKey = `covenants/final/${agreement.id}/${randomUUID()}.pdf`;
    const uploaded: string[] = [];
    try {
      await this.storage.uploadPrivateObject(partyKey, signature.buffer, validated.mime); uploaded.push(partyKey);
      await this.storage.uploadPrivateObject(finalKey, finalBytes, 'application/pdf'); uploaded.push(finalKey);
      const outcome = await prisma.$transaction(async (tx) => {
        const claim = await this.idempotency.claim<{ ok: true; status: AgreementStatus; finalSha256: string }>(tx, agreement.createdById, 'covenant-party-one-sign', opId, { agreementId: agreement.id });
        if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };
        await tx.$queryRaw`SELECT id FROM participation_agreements WHERE id=${agreement.id}::uuid FOR UPDATE`;
        const current = await tx.participationAgreement.findUnique({ where: { id: agreement.id }, include: { participation: true } });
        if (!current || current.status !== AgreementStatus.SIGNED_BY_ORG || current.partyOneSigningTokenHash !== sha256Hex(token) || current.partyOneSigningConsumedAt || !current.partyOneSigningExpiresAt || current.partyOneSigningExpiresAt <= new Date()) throw new ApiError('COVENANT_PARTY_ONE_TOKEN_INVALID', 'رابط التوقيع غير صالح أو استُخدم أو انتهت صلاحيته', 403);
        const partyFile = await tx.fileObject.create({ data: { storageProvider: 's3', bucket: storageConfig.bucket, objectKey: partyKey, originalName: 'party-one-covenant-signature', mimeType: validated.mime, sizeBytes: BigInt(signature.buffer.length), sha256: bufferSha256(signature.buffer), category: FileCategory.PARTICIPATION_AGREEMENT } });
        const finalSha256 = bufferSha256(finalBytes);
        const finalFile = await tx.fileObject.create({ data: { storageProvider: 's3', bucket: storageConfig.bucket, objectKey: finalKey, originalName: `covenant-${current.reference ?? current.id}.pdf`, mimeType: 'application/pdf', sizeBytes: BigInt(finalBytes.length), sha256: finalSha256, category: FileCategory.PARTICIPATION_AGREEMENT } });
        await tx.participationAgreement.update({ where: { id: current.id }, data: { status: AgreementStatus.SIGNED, zaadSignerName: PARTY_ONE_NAME, partyOneSignatureFileId: partyFile.id, signedByZaadAt: now, fullyExecutedAt: now, partyOneSigningConsumedAt: now, finalFileId: finalFile.id, finalSha256 } });
        await tx.projectParticipation.update({ where: { id: current.participationId }, data: { status: ParticipationStatus.ACTIVE, activatedAt: now } });
        await tx.auditLog.createMany({ data: [
          { actorAccountId: null, actorRole: null, associationId: current.participation.associationId, action: 'COVENANT_PARTY_ONE_SIGNED', entityType: 'participation_agreements', entityId: current.id, metadata: { representative: PARTY_ONE_NAME, signingSessionIssuedById: current.partyOneSigningIssuedById } },
          { actorAccountId: null, actorRole: null, associationId: current.participation.associationId, action: 'COVENANT_FULLY_EXECUTED', entityType: 'participation_agreements', entityId: current.id, metadata: { version: COVENANT_VERSION, finalSha256, signingSessionIssuedById: current.partyOneSigningIssuedById } },
        ] });
        const response = { ok: true as const, status: AgreementStatus.SIGNED, finalSha256 };
        await this.idempotency.complete(tx, agreement.createdById, 'covenant-party-one-sign', opId, response);
        return { replayed: false as const, response };
      });
      if (outcome.replayed) {
        for (const key of uploaded) await this.storage.deleteObjectBestEffort(key);
      }
      return outcome.response;
    } catch (error) {
      for (const key of uploaded) await this.storage.deleteObjectBestEffort(key);
      throw error;
    }
  }

  async getFinalCovenantUrl(ctx: AuthContext, agreementId?: string) {
    const agreement = ctx.role === AccountRole.ADMIN && agreementId
      ? await prisma.participationAgreement.findUnique({ where: { id: agreementId }, include: { finalFile: true } })
      : ctx.role === AccountRole.ASSOCIATION && ctx.associationId
        ? await prisma.participationAgreement.findFirst({ where: { participation: { associationId: ctx.associationId } }, include: { finalFile: true }, orderBy: { version: 'desc' } })
        : null;
    if (!agreement?.finalFile || agreement.status !== AgreementStatus.SIGNED) throw new ApiError('COVENANT_FINAL_NOT_FOUND', 'النسخة النهائية للميثاق غير متاحة', 404);
    return { url: await this.storage.getSignedGetUrl(agreement.finalFile.objectKey, storageConfig.licenseSignedUrlSeconds), sha256: agreement.finalSha256 };
  }

  private async validPartyOneAgreement(token: string) {
    if (!token || token.length < 40) throw new ApiError('COVENANT_PARTY_ONE_TOKEN_INVALID', 'رابط التوقيع غير صالح أو منتهي الصلاحية', 403);
    const agreement = await prisma.participationAgreement.findUnique({ where: { partyOneSigningTokenHash: sha256Hex(token) }, include: { orgSignatureFile: true, participation: { include: { association: true, application: true } } } });
    if (!agreement || agreement.status !== AgreementStatus.SIGNED_BY_ORG || agreement.partyOneSigningConsumedAt || !agreement.partyOneSigningExpiresAt || agreement.partyOneSigningExpiresAt <= new Date()) throw new ApiError('COVENANT_PARTY_ONE_TOKEN_INVALID', 'رابط التوقيع غير صالح أو منتهي الصلاحية', 403);
    return agreement;
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

function covenantView(
  participation: { id: string; status: ParticipationStatus; association: { name: string } | null },
  agreement: {
    id: string; status: AgreementStatus; reference: string | null; templateVersion: string; templateSha256: string | null;
    orgSignerName: string | null; orgSignerTitle: string | null; signedByOrgAt: Date | null; signedByZaadAt: Date | null;
    fullyExecutedAt: Date | null; finalSha256: string | null; finalFileId: string | null;
  },
) {
  return {
    id: agreement.id,
    participationId: participation.id,
    participationStatus: participation.status,
    associationName: participation.association?.name,
    status: agreement.status,
    reference: agreement.reference,
    version: agreement.templateVersion,
    sourceSha256: agreement.templateSha256,
    representativeName: agreement.orgSignerName,
    representativeTitle: agreement.orgSignerTitle,
    associationSignedAt: agreement.signedByOrgAt,
    partyOneSignedAt: agreement.signedByZaadAt,
    fullyExecutedAt: agreement.fullyExecutedAt,
    finalSha256: agreement.finalSha256,
    finalDocumentAvailable: Boolean(agreement.finalFileId),
    partyOneRepresentative: PARTY_ONE_NAME,
    partyOneTitle: PARTY_ONE_TITLE,
  };
}

function validateCovenantSignature(signature: { buffer: Buffer; declaredMimeType?: string }) {
  if (!signature.buffer.length) throw new ApiError('COVENANT_SIGNATURE_REQUIRED', 'التوقيع اليدوي مطلوب', 400);
  const validated = validateReceiptEvidenceFile(signature.buffer, signature.declaredMimeType);
  if (!validated.valid || !validated.detectedMimeType || validated.detectedMimeType === 'image/webp') throw new ApiError('COVENANT_SIGNATURE_INVALID', 'صورة التوقيع غير صالحة؛ استخدم PNG أو JPEG', 400);
  if (signature.buffer.length < 700) throw new ApiError('COVENANT_SIGNATURE_TOO_SIMPLE', 'التوقيع فارغ أو قصير جدًا؛ يرجى إعادة التوقيع', 400);
  const dimensions = signatureImageDimensions(signature.buffer, validated.detectedMimeType);
  if (!dimensions || dimensions.width < 200 || dimensions.height < 80) throw new ApiError('COVENANT_SIGNATURE_DIMENSIONS_INVALID', 'مساحة التوقيع غير كافية', 400);
  return { mime: validated.detectedMimeType };
}

function signatureImageDimensions(buffer: Buffer, mime: 'image/png' | 'image/jpeg') {
  if (mime === 'image/png') return buffer.length >= 24 ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) } : null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame && segmentLength >= 7) return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    offset += segmentLength;
  }
  return null;
}

function bufferSha256(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }
