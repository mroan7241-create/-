import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ApplicationDraftStatus,
  ApplicationInformationItemType,
  ApplicationInformationRequestStatus,
  ApplicationStatus,
  AssociationSelectionList,
  EligibilityStatus,
  FileCategory,
  GeographicUnitType,
  ParticipationStatus,
  ActivationBasis,
  Prisma,
  prisma,
} from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { IdempotencyService } from '../../common/idempotency.service';
import { PublicCodeService } from '../../common/public-code.service';
import { sha256Hex } from '../../common/crypto.util';
import { requiredEmail, requiredText } from '../../common/validation/text.util';
import { normalizeSaudiPhone } from '../../common/validation/phone.util';
import { StorageService } from '../files/storage.service';
import { storageConfig } from '../../config/storage.config';
import { validateReceiptDocumentFile } from '../files/file-validation.util';
import type { AuthContext } from '../auth/auth.types';
import { applicationConfig } from '../../config/application.config';
import { RateLimitService } from '../../common/rate-limit.service';
import { scoreApplication, type EvaluationInput } from './application-evaluation.util';
import type {
  BulkStartProcessingDto,
  CreateInformationRequestDto,
  EvaluationV2Dto,
  SelectionDecisionDto,
  SubmitInformationResponseDto,
} from './dto/application-v2.dto';

const DRAFT_TTL_DAYS = 45;
const ALLOWED_ATTACHMENT_KEYS = new Set([
  'licenseFile', 'previousProjectEvidence', 'spendingPolicyFile', 'strategicPlanFile',
  'operationalPlanFile', 'initialBeneficiaryFile', 'financialStatementsFile',
]);
const REQUIRED_ACKNOWLEDGEMENTS = [
  'dataAccuracy', 'verificationPermission', 'auditConsent', 'coordinatorCommitment',
  'covenantCommitment', 'beneficiaryListPreliminary', 'participationTerms',
] as const;
const FINANCIAL_PRIORITY_THRESHOLD = 10_000_000;

type JsonMap = Record<string, unknown>;

@Injectable()
export class ApplicationV2Service {
  constructor(
    private readonly codes: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: StorageService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async geography(parentOfficialCode?: string) {
    const where: Prisma.GeographicUnitWhereInput = { active: true };
    if (parentOfficialCode) where.parentOfficialCode = parentOfficialCode;
    else where.unitType = GeographicUnitType.REGION;
    const items = await prisma.geographicUnit.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { officialCode: 'asc' }] });
    return {
      source: items[0]?.source ?? 'المركز الوطني للوثائق والمحفوظات — الدليل الموحد لترميز المناطق والمحافظات والمراكز الإدارية',
      items: items.map((item) => ({
        officialCode: item.officialCode,
        nameAr: item.nameAr,
        unitType: item.unitType,
        parentOfficialCode: item.parentOfficialCode,
        category: item.category,
        projectScopeGroup: item.projectScopeGroup,
        hasChildren: item.unitType !== GeographicUnitType.ADMIN_CENTER,
      })),
    };
  }

  async createDraft(clientRequestIdRaw?: string, honeypot?: string, rateLimitSubject = 'unknown') {
    if (honeypot?.trim()) return { ok: true as const, draftCode: '', resumeToken: '', revision: 0 };
    const clientRequestId = clientRequestIdRaw?.trim() || null;
    if (clientRequestId && !applicationConfig.clientRequestIdPattern.test(clientRequestId)) {
      throw new ApiError('APPLICATION_INVALID_CLIENT_REQUEST_ID', 'تعذّر بدء الطلب — أعد تحميل الصفحة وحاول مجددًا', 400);
    }
    if (clientRequestId) {
      const existing = await prisma.associationApplicationDraft.findUnique({ where: { clientRequestId } });
      if (existing) throw new ApiError('APPLICATION_DRAFT_ALREADY_EXISTS', 'بدأ هذا الطلب مسبقًا؛ استخدم رابط الاستكمال المحفوظ لديك', 409);
    }
    await this.rateLimit.consume('association-application-draft-create', rateLimitSubject, { limit: 12, windowSeconds: 3600 });
    const resumeToken = randomBytes(32).toString('base64url');
    const draft = await prisma.$transaction(async (tx) => tx.associationApplicationDraft.create({ data: {
      publicCode: await this.codes.nextPublicCode(tx, 'DRF'),
      resumeTokenHash: sha256Hex(resumeToken),
      clientRequestId,
      expiresAt: addDays(new Date(), DRAFT_TTL_DAYS),
      payload: {},
    } }));
    return { ok: true as const, draftCode: draft.publicCode, resumeToken, revision: draft.revision, expiresAt: draft.expiresAt };
  }

  async loadDraft(draftCode: string, token: string) {
    const draft = await this.requireDraft(draftCode, token, true);
    return this.draftView(draft);
  }

  async saveDraft(draftCode: string, token: string, revision: number, payload: JsonMap) {
    const draft = await this.requireDraft(draftCode, token, true);
    if (draft.status !== ApplicationDraftStatus.ACTIVE) throw new ApiError('APPLICATION_DRAFT_SUBMITTED', 'سبق إرسال هذا الطلب', 409);
    if (!isPlainObject(payload)) throw new ApiError('APPLICATION_DRAFT_INVALID', 'بيانات المسودة غير صالحة', 400);
    const contactEmail = readOptionalString(pathValue(payload, 'organization.officialEmail'));
    const updated = await prisma.associationApplicationDraft.updateMany({
      where: { id: draft.id, revision },
      data: { payload: payload as Prisma.InputJsonValue, contactEmail: contactEmail || null, revision: { increment: 1 }, expiresAt: addDays(new Date(), DRAFT_TTL_DAYS) },
    });
    if (updated.count !== 1) throw new ApiError('APPLICATION_DRAFT_REVISION_CONFLICT', 'حُفظت نسخة أحدث من الطلب؛ أعد تحميل المسودة قبل المتابعة', 409);
    const current = await prisma.associationApplicationDraft.findUniqueOrThrow({ where: { id: draft.id }, include: { attachments: true } });
    return this.draftView(current);
  }

  async uploadAttachment(draftCode: string, token: string, fieldKeyRaw: string, file: Express.Multer.File) {
    const fieldKey = fieldKeyRaw.trim();
    if (!ALLOWED_ATTACHMENT_KEYS.has(fieldKey)) throw new ApiError('APPLICATION_ATTACHMENT_FIELD_INVALID', 'نوع المرفق غير صالح', 400);
    const draft = await this.requireDraft(draftCode, token, true);
    const validated = validateApplicationAttachment(fieldKey, file);
    const objectKey = `association-applications/${draft.publicCode}/${fieldKey}/${randomUUID()}.${validated.extension}`;
    await this.storage.uploadPrivateObject(objectKey, file.buffer, validated.mimeType);
    let oldObjectKey: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        const owner = draft.submittedApplicationId ? { applicationId: draft.submittedApplicationId, draftId: null } : { applicationId: null, draftId: draft.id };
        const existing = await tx.applicationAttachment.findFirst({ where: draft.submittedApplicationId ? { applicationId: draft.submittedApplicationId, fieldKey } : { draftId: draft.id, fieldKey }, include: { file: true } });
        const created = await tx.fileObject.create({ data: {
          storageProvider: 'S3', bucket: storageConfig.bucket, objectKey,
          originalName: fieldKey, mimeType: validated.mimeType, sizeBytes: BigInt(file.buffer.length),
          sha256: createHash('sha256').update(file.buffer).digest('hex'), category: validated.category,
        } });
        if (existing) {
          oldObjectKey = existing.file.objectKey;
          await tx.applicationAttachment.update({ where: { id: existing.id }, data: { fileId: created.id } });
          await tx.fileObject.delete({ where: { id: existing.fileId } });
        } else {
          await tx.applicationAttachment.create({ data: { ...owner, fieldKey, fileId: created.id } });
        }
      });
    } catch (error) {
      await this.storage.deleteObjectBestEffort(objectKey);
      throw error;
    }
    if (oldObjectKey) await this.storage.deleteObjectBestEffort(oldObjectKey);
    return { ok: true as const, fieldKey, name: fieldKey, size: file.buffer.length };
  }

  async submitDraft(draftCode: string, token: string, revision: number) {
    const draft = await this.requireDraft(draftCode, token, true);
    if (draft.status === ApplicationDraftStatus.SUBMITTED && draft.submittedApplication) {
      return { ok: true as const, id: draft.submittedApplication.publicCode, duplicate: true, message: 'تم استلام طلبكم مسبقًا' };
    }
    if (draft.revision !== revision) throw new ApiError('APPLICATION_DRAFT_REVISION_CONFLICT', 'توجد نسخة أحدث من الطلب؛ أعد تحميله قبل الإرسال', 409);
    const payload = asMap(draft.payload);
    const attachmentKeys = new Set(draft.attachments.map((item) => item.fieldKey));
    const value = await validateV2Payload(payload, attachmentKeys);
    await this.rateLimit.consume('association-application-submit', value.officialEmail, applicationConfig.rateLimitSubmit);

    const existingCredential = await prisma.authCredential.findFirst({ where: { identifier: value.officialEmail } });
    if (existingCredential) throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'هذا البريد الإلكتروني مرتبط بحساب قائم بالفعل', 409);
    const duplicate = await prisma.associationApplication.findFirst({ where: { status: ApplicationStatus.UNDER_REVIEW, OR: [
      { email: value.officialEmail }, { phone: value.officialPhone }, { licenseNumber: value.licenseNumber },
    ] } });
    if (duplicate) throw new ApiError('APPLICATION_DUPLICATE_PENDING', 'يوجد طلب سابق قيد المراجعة بنفس البريد أو الجوال أو رقم الترخيص', 409);

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: ApplicationDraftStatus; revision: number }[]>`
        SELECT id, status, revision FROM association_application_drafts WHERE id=${draft.id}::uuid FOR UPDATE
      `;
      if (!locked[0] || locked[0].status !== ApplicationDraftStatus.ACTIVE || locked[0].revision !== revision) {
        throw new ApiError('APPLICATION_DRAFT_REVISION_CONFLICT', 'تغيّرت المسودة أثناء الإرسال؛ أعد المحاولة', 409);
      }
      const publicCode = await this.codes.nextPublicCode(tx, 'APP');
      const license = draft.attachments.find((item) => item.fieldKey === 'licenseFile');
      const initial = draft.attachments.find((item) => item.fieldKey === 'initialBeneficiaryFile');
      const application = await tx.associationApplication.create({ data: {
        publicCode,
        clientRequestId: draft.clientRequestId,
        schemaVersion: 2,
        name: value.name,
        category: value.category,
        sector: value.sector,
        region: value.regionName,
        city: value.governorateName,
        phone: value.officialPhone,
        email: value.officialEmail,
        contactName: value.coordinatorName,
        address: value.serviceScope,
        serviceScope: value.serviceScope,
        coordinatorPhone: value.coordinatorPhone,
        coordinatorEmail: value.coordinatorEmail,
        coordinatorTitle: value.coordinatorTitle,
        beneficiaryDatabaseUpdatedAt: value.beneficiaryDatabaseUpdatedAt,
        approxBeneficiaryCount: value.registeredFamilies,
        notes: value.notes,
        licenseNumber: value.licenseNumber,
        licenseExpiryDate: value.licenseExpiryDate,
        licenseFileId: license?.fileId,
        initialBeneficiaryFileId: initial?.fileId,
        pledgeAccepted: true,
        pledgeAcceptedAt: new Date(),
        status: ApplicationStatus.UNDER_REVIEW,
        v2Payload: payload as Prisma.InputJsonValue,
        regionOfficialCode: value.regionCode,
        governorateOfficialCode: value.governorateCode,
        centerOfficialCode: value.centerCode,
        locationOtherText: value.locationOtherText,
        locationNeedsVerification: value.locationNeedsVerification,
        revenue: value.revenue,
        expenses: value.expenses,
        currentAssets: value.currentAssets,
        currentLiabilities: value.currentLiabilities,
        financialResult: value.revenue - value.expenses,
        netWorkingCapital: value.currentAssets - value.currentLiabilities,
      } });
      await tx.applicationAttachment.updateMany({ where: { draftId: draft.id }, data: { draftId: null, applicationId: application.id } });
      await tx.associationApplicationDraft.update({ where: { id: draft.id }, data: { status: ApplicationDraftStatus.SUBMITTED, submittedApplicationId: application.id } });
      return application;
    });
    return { ok: true as const, id: result.publicCode, message: 'تم استلام طلب المشاركة بنجاح' };
  }

  async publicStatus(draftCode: string, token: string) {
    const draft = await this.requireDraft(draftCode, token, true);
    const application = draft.submittedApplication;
    if (!application) return { ok: true as const, draft: true as const, draftCode, revision: draft.revision, stage: 'DRAFT', timeline: timeline('DRAFT') };
    const request = await prisma.applicationInformationRequest.findFirst({ where: { applicationId: application.id, status: ApplicationInformationRequestStatus.OPEN }, include: { items: true }, orderBy: { requestedAt: 'desc' } });
    const stage = publicApplicationStage(application, Boolean(request));
    return {
      ok: true as const,
      draft: false as const,
      draftCode: draft.publicCode,
      id: application.publicCode,
      stage,
      submittedAt: application.submittedAt,
      timeline: timeline(stage),
      needsInfo: request ? { id: request.id, note: request.note, deadline: request.deadline, items: request.items.map((item) => ({ type: item.type, key: item.key, reason: item.reason })) } : null,
    };
  }

  async submitInformation(draftCode: string, token: string, requestId: string, dto: SubmitInformationResponseDto) {
    const draft = await this.requireDraft(draftCode, token, true);
    if (!draft.submittedApplicationId) throw new ApiError('APPLICATION_NOT_SUBMITTED', 'لم يُرسل الطلب بعد', 409);
    return prisma.$transaction(async (tx) => {
      const replay = await tx.applicationInformationRequest.findUnique({ where: { responseOpId: dto.opId } });
      if (replay) {
        if (replay.id !== requestId) throw new ApiError('APPLICATION_IDEMPOTENCY_CONFLICT', 'معرّف العملية مستخدم لاستكمال مختلف', 409);
        return { ok: true as const };
      }
      const request = await tx.applicationInformationRequest.findFirst({ where: { id: requestId, applicationId: draft.submittedApplicationId!, status: ApplicationInformationRequestStatus.OPEN }, include: { items: true, application: true } });
      if (!request) throw new ApiError('APPLICATION_INFORMATION_REQUEST_NOT_FOUND', 'طلب الاستكمال غير متاح', 404);
      const allowedFields = new Set(request.items.filter((item) => item.type === ApplicationInformationItemType.FIELD).map((item) => item.key));
      const responseKeys = flattenKeys(dto.payload);
      if (responseKeys.some((key) => !allowedFields.has(key))) throw new ApiError('APPLICATION_INFORMATION_SCOPE_INVALID', 'يمكن تعديل الحقول المطلوبة فقط', 403);
      const requiredFiles = request.items.filter((item) => item.type === ApplicationInformationItemType.ATTACHMENT).map((item) => item.key);
      const existingFiles = await tx.applicationAttachment.findMany({ where: { applicationId: request.applicationId, fieldKey: { in: requiredFiles } } });
      if (existingFiles.length !== requiredFiles.length) throw new ApiError('APPLICATION_INFORMATION_ATTACHMENTS_MISSING', 'أرفق جميع الملفات المطلوبة قبل إرسال الاستكمال', 400);
      const merged = deepMerge(asMap(request.application.v2Payload), dto.payload);
      await tx.associationApplication.update({ where: { id: request.applicationId }, data: { v2Payload: merged as Prisma.InputJsonValue, eligibilityStatus: EligibilityStatus.PENDING, eligibilityNotes: null } });
      await tx.applicationInformationRequest.update({ where: { id: request.id }, data: { status: ApplicationInformationRequestStatus.SUBMITTED, responsePayload: dto.payload as Prisma.InputJsonValue, responseOpId: dto.opId, submittedAt: new Date() } });
      await tx.auditLog.create({ data: { actorAccountId: null, actorRole: null, action: 'APPLICATION_INFORMATION_SUBMITTED', entityType: 'association_applications', entityId: request.applicationId, metadata: { requestId } } });
      const response = { ok: true as const };
      return response;
    });
  }

  async bulkStartProcessing(ctx: AuthContext, dto: BulkStartProcessingDto) {
    const ids = [...new Set(dto.applicationIds)].slice(0, 250);
    if (!ids.length) throw new ApiError('APPLICATION_SELECTION_EMPTY', 'حدد طلبًا واحدًا على الأقل', 400);
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; started: number; alreadyStarted: number }>(tx, ctx.accountId, 'application-start-processing-bulk', dto.opId, { ids: [...ids].sort() });
      if (!claim.claimed) return claim.existingResponse!;
      const found = await tx.associationApplication.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw new ApiError('APPLICATION_NOT_FOUND', 'أحد الطلبات المحددة غير موجود', 404);
      const updated = await tx.associationApplication.updateMany({ where: { id: { in: ids }, processingStartedAt: null }, data: { processingStartedAt: new Date(), processingStartedById: ctx.accountId } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'APPLICATION_PROCESSING_STARTED_BULK', entityType: 'association_applications', metadata: { applicationIds: ids, started: updated.count } } });
      const response = { ok: true as const, started: updated.count, alreadyStarted: ids.length - updated.count };
      await this.idempotency.complete(tx, ctx.accountId, 'application-start-processing-bulk', dto.opId, response);
      return response;
    });
  }

  async requestInformation(ctx: AuthContext, applicationId: string, dto: CreateInformationRequestDto) {
    if (!dto.items.length || dto.items.length > 50) throw new ApiError('APPLICATION_INFORMATION_ITEMS_REQUIRED', 'حدد حقلًا أو مرفقًا واحدًا على الأقل', 400);
    if (dto.items.some((item) => item.type === ApplicationInformationItemType.ATTACHMENT && !ALLOWED_ATTACHMENT_KEYS.has(item.key.trim()))) throw new ApiError('APPLICATION_ATTACHMENT_FIELD_INVALID', 'نوع المرفق المطلوب غير صالح', 400);
    const deadline = dto.deadline ? parseDate(dto.deadline, 'المهلة') : null;
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; requestId: string }>(tx, ctx.accountId, 'application-information-request', dto.opId, { applicationId, items: dto.items, note: dto.note ?? null, deadline });
      if (!claim.claimed) return claim.existingResponse!;
      const application = await tx.associationApplication.findUnique({ where: { id: applicationId } });
      if (!application || application.status !== ApplicationStatus.UNDER_REVIEW) throw new ApiError('APPLICATION_NOT_REVIEWABLE', 'الطلب غير متاح للاستكمال', 409);
      const open = await tx.applicationInformationRequest.findFirst({ where: { applicationId, status: ApplicationInformationRequestStatus.OPEN } });
      if (open) throw new ApiError('APPLICATION_INFORMATION_REQUEST_OPEN', 'يوجد طلب استكمال مفتوح بالفعل', 409);
      const request = await tx.applicationInformationRequest.create({ data: {
        applicationId, requestedById: ctx.accountId, note: dto.note?.trim() || null, deadline,
        items: { create: dto.items.map((item) => ({ type: item.type, key: requiredText(item.key, 'الحقل المطلوب', 120), reason: requiredText(item.reason, 'سبب الاستكمال', 500) })) },
      } });
      await tx.associationApplication.update({ where: { id: applicationId }, data: { eligibilityStatus: EligibilityStatus.NEEDS_INFO, eligibilityNotes: dto.note?.trim() || 'مطلوب استكمال بيانات محددة' } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'APPLICATION_INFORMATION_REQUESTED', entityType: 'association_applications', entityId: applicationId, metadata: { requestId: request.id, items: dto.items.map((item) => ({ type: item.type, key: item.key, reason: item.reason })) } as Prisma.InputJsonValue } });
      const response = { ok: true as const, requestId: request.id };
      await this.idempotency.complete(tx, ctx.accountId, 'application-information-request', dto.opId, response);
      return response;
    });
  }

  async eligibilityEvidence(applicationId: string) {
    const application = await prisma.associationApplication.findUnique({ where: { id: applicationId }, include: { attachments: true, informationRequests: true } });
    if (!application) throw new ApiError('APPLICATION_NOT_FOUND', 'طلب المشاركة غير موجود', 404);
    if (application.schemaVersion === 1) return { schemaVersion: 1, checks: [], summary: 'يتطلب طلب V1 مراجعة بشرية وفق بياناته التاريخية' };
    return buildEligibilityEvidence(asMap(application.v2Payload), new Set(application.attachments.map((item) => item.fieldKey)), application.informationRequests.length);
  }

  async evaluate(ctx: AuthContext, applicationId: string, dto: EvaluationV2Dto) {
    const ratings: EvaluationInput = pickRatings(dto);
    const scored = scoreApplication(ratings);
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; score: number }>(tx, ctx.accountId, 'application-evaluation', dto.opId, { applicationId, ratings, overrideReason: dto.overrideReason ?? null });
      if (!claim.claimed) return claim.existingResponse!;
      const application = await tx.associationApplication.findUnique({ where: { id: applicationId }, include: { attachments: true, informationRequests: true } });
      if (!application || application.eligibilityStatus !== EligibilityStatus.PASSED) throw new ApiError('APPLICATION_NOT_ELIGIBLE', 'لا يمكن تقييم طلب قبل اجتياز الأهلية', 409);
      const evidence = application.schemaVersion === 2 ? buildEvaluationEvidence(asMap(application.v2Payload), new Set(application.attachments.map((item) => item.fieldKey)), application.informationRequests) : { legacy: true };
      await tx.associationApplication.update({ where: { id: applicationId }, data: { evaluationBreakdown: { ...scored.breakdown, overrideReason: dto.overrideReason?.trim() || null }, evaluationEvidence: evidence, evaluationScore: scored.total, evaluatedAt: new Date(), evaluatedById: ctx.accountId } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'APPLICATION_EVALUATED', entityType: 'association_applications', entityId: applicationId, metadata: { ratings, score: scored.total, overrideReason: dto.overrideReason ?? null } } });
      const response = { ok: true as const, score: scored.total };
      await this.idempotency.complete(tx, ctx.accountId, 'application-evaluation', dto.opId, response);
      return response;
    });
  }

  async decideSelection(ctx: AuthContext, applicationId: string, dto: SelectionDecisionDto) {
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; decision: AssociationSelectionList }>(tx, ctx.accountId, 'application-selection-decision', dto.opId, { applicationId, decision: dto.decision, reason: dto.reason ?? null });
      if (!claim.claimed) return claim.existingResponse!;
      const application = await tx.associationApplication.findUnique({ where: { id: applicationId } });
      if (!application || application.eligibilityStatus !== EligibilityStatus.PASSED || application.evaluationScore == null) throw new ApiError('APPLICATION_SELECTION_NOT_READY', 'يجب اجتياز الأهلية وإكمال التقييم أولًا', 409);
      const now = new Date();
      await tx.associationApplication.update({ where: { id: applicationId }, data: { selectionList: dto.decision, selectionReason: dto.reason?.trim() || null, status: ApplicationStatus.ACCEPTED, selectionApprovedAt: now, selectionApprovedById: ctx.accountId } });
      if (dto.decision === AssociationSelectionList.MAIN) {
        await tx.projectParticipation.upsert({ where: { applicationId }, update: {}, create: { applicationId, status: ParticipationStatus.APPROVED_AWAITING_SETUP, activationBasis: ActivationBasis.AGREEMENT_COMPLETED, coordinatorName: application.contactName, coordinatorPhone: application.coordinatorPhone, coordinatorEmail: application.coordinatorEmail, coordinatorTitle: application.coordinatorTitle } });
      }
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'APPLICATION_SELECTION_DECIDED', entityType: 'association_applications', entityId: applicationId, metadata: { decision: dto.decision, reason: dto.reason ?? null } } });
      const response = { ok: true as const, decision: dto.decision };
      await this.idempotency.complete(tx, ctx.accountId, 'application-selection-decision', dto.opId, response);
      return response;
    });
  }

  private async requireDraft(draftCodeRaw: string, tokenRaw: string, includeApplication = false) {
    const draftCode = draftCodeRaw.trim();
    const token = tokenRaw.trim();
    if (!draftCode || token.length < 32) throw new ApiError('APPLICATION_RESUME_INVALID', 'بيانات استكمال الطلب غير صحيحة', 403);
    await this.rateLimit.consume('association-application-resume', sha256Hex(`${draftCode}:${token}`), { limit: 60, windowSeconds: 3600 });
    const draft = await prisma.associationApplicationDraft.findFirst({
      where: { publicCode: draftCode, resumeTokenHash: sha256Hex(token) },
      include: { attachments: true, ...(includeApplication ? { submittedApplication: true } : {}) },
    });
    if (!draft || draft.expiresAt <= new Date()) throw new ApiError('APPLICATION_RESUME_INVALID', 'رابط الاستكمال غير صالح أو انتهت صلاحيته', 403);
    return draft;
  }

  private draftView(draft: { publicCode: string; revision: number; status: ApplicationDraftStatus; payload: Prisma.JsonValue; expiresAt: Date; submittedApplicationId: string | null; attachments: { fieldKey: string }[] }) {
    return { ok: true as const, draftCode: draft.publicCode, revision: draft.revision, status: draft.status, payload: draft.payload, expiresAt: draft.expiresAt, submitted: Boolean(draft.submittedApplicationId), attachments: draft.attachments.map((item) => item.fieldKey) };
  }
}

async function validateV2Payload(payload: JsonMap, attachments: Set<string>) {
  const name = requiredPathText(payload, 'organization.name', 'اسم الجمعية', 150);
  const licenseNumber = requiredPathText(payload, 'organization.licenseNumber', 'رقم الترخيص', 60);
  const licenseExpiryDate = parseDate(requiredPathText(payload, 'organization.licenseExpiryDate', 'تاريخ انتهاء الترخيص', 10), 'تاريخ انتهاء الترخيص');
  if (licenseExpiryDate < todayRiyadh()) throw new ApiError('APPLICATION_LICENSE_EXPIRED', 'ترخيص الجمعية منتهٍ', 400);
  const category = requiredPathText(payload, 'organization.category', 'تصنيف الجمعية', 120);
  const sector = requiredPathText(payload, 'organization.sector', 'مجال عمل الجمعية', 120);
  const officialEmail = requiredEmail(requiredPathText(payload, 'organization.officialEmail', 'البريد الرسمي', 254));
  const officialPhone = normalizeSaudiPhone(requiredPathText(payload, 'organization.officialPhone', 'رقم التواصل الرسمي', 30));
  const coordinatorName = requiredPathText(payload, 'coordinator.name', 'اسم منسق المشروع', 150);
  const coordinatorTitle = requiredPathText(payload, 'coordinator.title', 'المسمى الوظيفي للمنسق', 120);
  const coordinatorPhone = normalizeSaudiPhone(requiredPathText(payload, 'coordinator.phone', 'جوال المنسق', 30));
  const coordinatorEmail = requiredEmail(requiredPathText(payload, 'coordinator.email', 'بريد المنسق', 254));
  requiredPathText(payload, 'covenantRepresentative.name', 'اسم ممثل الجمعية في الميثاق', 150);
  requiredPathText(payload, 'covenantRepresentative.title', 'صفة ممثل الجمعية في الميثاق', 120);
  requiredPathText(payload, 'executive.name', 'اسم المدير التنفيذي', 150);
  normalizeSaudiPhone(requiredPathText(payload, 'executive.phone', 'جوال المدير التنفيذي', 30));
  requiredPathText(payload, 'executive.education', 'المؤهل العلمي للمدير التنفيذي', 120);
  requiredInteger(payload, 'executive.experienceYears', 'سنوات خبرة المدير التنفيذي', 0, 80);
  ['fullTime','partTime','activeVolunteers','nonSaudis','universityOrHigher'].forEach((key) => requiredInteger(payload, `team.${key}`, 'بيانات فريق الجمعية', 0, 1_000_000));
  requiredBoolean(payload, 'socialResearcher.exists', 'وجود باحث اجتماعي');
  if (pathValue(payload, 'socialResearcher.exists') === true) { requiredPathText(payload, 'socialResearcher.name', 'اسم الباحث الاجتماعي', 150); normalizeSaudiPhone(requiredPathText(payload, 'socialResearcher.phone', 'جوال الباحث الاجتماعي', 30)); }
  requiredInteger(payload, 'readiness.fieldTeamCount', 'عدد أفراد الفريق الميداني', 0, 1_000_000);
  requiredInteger(payload, 'readiness.weeklyDeliveryCapacity', 'القدرة الأسبوعية للتسليم', 0, 10_000_000);
  requiredBoolean(payload, 'readiness.hasReceiptStorage', 'توفر موقع أو آلية للاستلام والحفظ');
  if (pathValue(payload, 'readiness.hasReceiptStorage') === true) requiredPathText(payload, 'readiness.receiptStorageDescription', 'وصف موقع أو آلية الاستلام والحفظ', 1000);
  requiredBoolean(payload, 'readiness.canDocumentDigitally', 'القدرة على التوثيق الإلكتروني');
  const registeredFamilies = requiredInteger(payload, 'beneficiaries.registeredFamilies', 'عدد الأسر المسجلة', 0, 10_000_000);
  const beneficiaryDatabaseUpdatedAt = parseDate(requiredPathText(payload, 'beneficiaries.databaseUpdatedAt', 'تاريخ تحديث قاعدة المستفيدين', 10), 'تاريخ تحديث قاعدة المستفيدين');
  requiredBoolean(payload, 'beneficiaries.hasSystem', 'استخدام نظام إلكتروني للمستفيدين');
  if (pathValue(payload, 'beneficiaries.hasSystem') === true) {
    requiredPathText(payload, 'beneficiaries.systemName', 'اسم نظام المستفيدين', 150);
    ['search','update','reports','organizedCases'].forEach((key) => requiredBoolean(payload, `beneficiaries.capabilities.${key}`, 'إمكانات نظام المستفيدين'));
  }
  requiredBoolean(payload, 'beneficiaries.classifiesNeed', 'تصنيف الحالات حسب الحاجة');
  if (pathValue(payload, 'beneficiaries.classifiesNeed') === true) requiredPathText(payload, 'beneficiaries.classifications', 'تصنيفات الحاجة', 1000);
  requiredBoolean(payload, 'beneficiaries.hasCaseStudyMechanism', 'آلية دراسة الحالات');
  if (pathValue(payload, 'beneficiaries.hasCaseStudyMechanism') === true) requiredPathText(payload, 'beneficiaries.caseStudyDescription', 'وصف آلية دراسة الحالات', 1000);
  requiredBoolean(payload, 'experience.hasRecentInKindProject', 'خبرة مشروع دعم عيني');
  if (pathValue(payload, 'experience.hasRecentInKindProject') === true) {
    requiredPathText(payload, 'experience.projectName', 'اسم المشروع السابق', 200);
    requiredInteger(payload, 'experience.projectYear', 'سنة المشروع السابق', 2000, new Date().getUTCFullYear());
    requiredPathText(payload, 'experience.supportType', 'نوع الدعم السابق', 200);
    requiredInteger(payload, 'experience.projectBeneficiaries', 'عدد مستفيدي المشروع السابق', 0, 10_000_000);
    if (!attachments.has('previousProjectEvidence')) throw new ApiError('APPLICATION_ATTACHMENT_REQUIRED', 'شاهد تنفيذ المشروع السابق مطلوب', 400);
  }
  requiredInteger(payload, 'experience.recentProjectsCount', 'عدد مشاريع الدعم العيني', 0, 1_000_000);
  requiredInteger(payload, 'experience.recentBeneficiariesCount', 'إجمالي مستفيدي المشاريع السابقة', 0, 10_000_000);
  const ehsanCount = requiredInteger(payload, 'experience.ehsanSupportCount2025', 'عدد مرات الاستفادة من إحسان خلال 2025', 0, 1_000_000);
  if (ehsanCount > 0) requiredPathText(payload, 'experience.ehsanSupportTypes', 'أنواع دعم إحسان', 1000);
  requiredBoolean(payload, 'experience.hasPreviousSimilarSupport', 'الدعم المشابه السابق');
  if (pathValue(payload, 'experience.hasPreviousSimilarSupport') === true) {
    requiredPathText(payload, 'experience.previousSupportDescription', 'وصف الدعم السابق', 1000);
    requiredPathText(payload, 'experience.previousSupporter', 'الداعم السابق', 200);
    requiredInteger(payload, 'experience.previousSupportYear', 'سنة الدعم السابق', 2000, new Date().getUTCFullYear());
  }
  requiredBoolean(payload, 'finance.hasAccountingSystem', 'استخدام نظام محاسبي');
  if (pathValue(payload, 'finance.hasAccountingSystem') === true) requiredPathText(payload, 'finance.accountingSystemName', 'اسم النظام المحاسبي', 150);
  requiredBoolean(payload, 'finance.hasSpendingPolicy', 'وجود لائحة صرف');
  if (pathValue(payload, 'finance.hasSpendingPolicy') === true && !attachments.has('spendingPolicyFile')) throw new ApiError('APPLICATION_ATTACHMENT_REQUIRED', 'لائحة الصرف المعتمدة مطلوبة', 400);
  const revenue = requiredMoney(payload, 'finance.revenue', 'الإيرادات');
  const expenses = requiredMoney(payload, 'finance.expenses', 'المصروفات');
  const currentAssets = requiredMoney(payload, 'finance.currentAssets', 'الأصول المتداولة');
  const currentLiabilities = requiredMoney(payload, 'finance.currentLiabilities', 'الخصوم المتداولة');
  requiredBoolean(payload, 'planning.hasStrategicPlan', 'الخطة الاستراتيجية');
  if (pathValue(payload, 'planning.hasStrategicPlan') === true && !attachments.has('strategicPlanFile')) throw new ApiError('APPLICATION_ATTACHMENT_REQUIRED', 'الخطة الاستراتيجية مطلوبة', 400);
  requiredBoolean(payload, 'planning.hasOperationalPlan', 'الخطة التشغيلية');
  if (pathValue(payload, 'planning.hasOperationalPlan') === true && !attachments.has('operationalPlanFile')) throw new ApiError('APPLICATION_ATTACHMENT_REQUIRED', 'الخطة التشغيلية مطلوبة', 400);
  requiredBoolean(payload, 'planning.hasPostAidFollowUp', 'متابعة الأسر بعد المساعدة');
  if (pathValue(payload, 'planning.hasPostAidFollowUp') === true) requiredPathText(payload, 'planning.postAidFollowUpDescription', 'آلية متابعة الأسر', 1000);
  requiredBoolean(payload, 'planning.measuresSatisfaction', 'قياس رضا المستفيدين');
  if (pathValue(payload, 'planning.measuresSatisfaction') === true) requiredPathText(payload, 'planning.satisfactionTool', 'أداة قياس الرضا', 120);
  requiredInteger(payload, 'planning.lastYearProgramsCount', 'عدد برامج السنة الماضية', 0, 1_000_000);
  requiredInteger(payload, 'planning.lastYearBeneficiariesCount', 'عدد مستفيدي السنة الماضية', 0, 10_000_000);
  for (const key of REQUIRED_ACKNOWLEDGEMENTS) if (pathValue(payload, `acknowledgements.${key}`) !== true) throw new ApiError('APPLICATION_ACKNOWLEDGEMENT_REQUIRED', 'جميع الإقرارات مطلوبة قبل الإرسال', 400);
  if (!attachments.has('licenseFile')) throw new ApiError('APPLICATION_ATTACHMENT_REQUIRED', 'ملف الترخيص مطلوب', 400);

  const regionCode = requiredPathText(payload, 'location.regionCode', 'المنطقة الإدارية', 10);
  const governorateCode = requiredPathText(payload, 'location.governorateCode', 'المحافظة أو مقر الإمارة', 10);
  const centerCode = readOptionalString(pathValue(payload, 'location.centerCode')) || null;
  const [region, governorate, center] = await Promise.all([
    prisma.geographicUnit.findFirst({ where: { officialCode: regionCode, unitType: GeographicUnitType.REGION, active: true } }),
    prisma.geographicUnit.findFirst({ where: { officialCode: governorateCode, parentOfficialCode: regionCode, unitType: { in: [GeographicUnitType.EMIRATE_SEAT, GeographicUnitType.GOVERNORATE] }, active: true } }),
    centerCode ? prisma.geographicUnit.findFirst({ where: { officialCode: centerCode, parentOfficialCode: governorateCode, unitType: GeographicUnitType.ADMIN_CENTER, active: true } }) : Promise.resolve(null),
  ]);
  if (!region || !governorate || (centerCode && !center)) throw new ApiError('APPLICATION_LOCATION_INVALID', 'الموقع الإداري المختار غير صالح أو خارج نطاق المشروع', 400);
  const locationOtherText = readOptionalString(pathValue(payload, 'location.otherText')) || null;
  if (pathValue(payload, 'location.useOther') === true && !locationOtherText) throw new ApiError('APPLICATION_LOCATION_OTHER_REQUIRED', 'اكتب الموقع غير الموجود ليتم التحقق منه إداريًا', 400);
  const locationNeedsVerification = Boolean(locationOtherText);
  const serviceScope = requiredPathText(payload, 'location.serviceScope', 'نطاق خدمة الجمعية', 1000);
  return { name, licenseNumber, licenseExpiryDate, category, sector, officialEmail, officialPhone, coordinatorName, coordinatorTitle, coordinatorPhone, coordinatorEmail, registeredFamilies, beneficiaryDatabaseUpdatedAt, revenue, expenses, currentAssets, currentLiabilities, regionCode, governorateCode, centerCode, regionName: region.nameAr.replace(/^منطقة\s+/, ''), governorateName: governorate.nameAr.replace(/^(مدينة|محافظة)\s+/, ''), locationOtherText, locationNeedsVerification, serviceScope, notes: readOptionalString(pathValue(payload, 'organization.notes')) || null };
}

function buildEligibilityEvidence(payload: JsonMap, attachments: Set<string>, needsInfoRounds: number) {
  const today = todayRiyadh();
  const license = safeDate(pathValue(payload, 'organization.licenseExpiryDate'));
  const database = safeDate(pathValue(payload, 'beneficiaries.databaseUpdatedAt'));
  const monthsOld = database ? monthDifference(database, today) : null;
  const checks = [
    check('licenseValid', 'الترخيص ساري', license ? license >= today : null, license ? `ينتهي في ${dateOnly(license)}` : 'تاريخ الانتهاء مفقود'),
    check('locationInScope', 'النطاق الجغرافي ضمن المشروع', Boolean(pathValue(payload, 'location.regionCode')), 'الموقع مرتبط بمرجع NCAR الرسمي'),
    check('beneficiaryDatabaseCurrentYear', 'قاعدة المستفيدين محدثة خلال السنة الميلادية الحالية', database ? database.getUTCFullYear() === today.getUTCFullYear() : null, database ? dateOnly(database) : 'التاريخ مفقود'),
    check('beneficiaryDatabaseWithinEightMonths', 'لم يمض على تحديث قاعدة المستفيدين أكثر من 8 أشهر', monthsOld == null ? null : monthsOld <= 8, monthsOld == null ? 'التاريخ مفقود' : `العمر التقريبي ${monthsOld} شهرًا`),
    check('beneficiarySystem', 'نظام إلكتروني للمستفيدين', pathValue(payload, 'beneficiaries.hasSystem') === true, readOptionalString(pathValue(payload, 'beneficiaries.systemName')) || 'غير محدد'),
    check('systemSearch', 'النظام يدعم البحث', pathValue(payload, 'beneficiaries.capabilities.search') === true, ''),
    check('systemUpdate', 'النظام يدعم التحديث', pathValue(payload, 'beneficiaries.capabilities.update') === true, ''),
    check('systemReports', 'النظام يدعم التقارير', pathValue(payload, 'beneficiaries.capabilities.reports') === true, ''),
    check('fieldTeam', 'فريق ميداني موجود', Number(pathValue(payload, 'readiness.fieldTeamCount')) > 0, String(pathValue(payload, 'readiness.fieldTeamCount') ?? '—')),
    check('digitalDocumentation', 'توثيق الاستلام والتسليم إلكترونيًا', pathValue(payload, 'readiness.canDocumentDigitally') === true, ''),
    check('recentExperience', 'خبرة دعم عيني خلال سنتين', pathValue(payload, 'experience.hasRecentInKindProject') === true, ''),
    check('recentExperienceEvidence', 'شاهد المشروع السابق موجود', attachments.has('previousProjectEvidence'), ''),
    check('coordinator', 'منسق المشروع مكتمل', Boolean(pathValue(payload, 'coordinator.name') && pathValue(payload, 'coordinator.phone')), ''),
    check('acknowledgements', 'الإقرارات مكتملة', REQUIRED_ACKNOWLEDGEMENTS.every((key) => pathValue(payload, `acknowledgements.${key}`) === true), ''),
  ];
  return { checks, counts: { pass: checks.filter((item) => item.result === 'PASS').length, fail: checks.filter((item) => item.result === 'FAIL').length, needsReview: checks.filter((item) => item.result === 'NEEDS_REVIEW').length }, needsInfoRounds };
}

function buildEvaluationEvidence(payload: JsonMap, attachments: Set<string>, requests: { requestedAt: Date; submittedAt: Date | null }[]) {
  const financialResult = Number(pathValue(payload, 'finance.revenue') ?? 0) - Number(pathValue(payload, 'finance.expenses') ?? 0);
  const currentAssets = Number(pathValue(payload, 'finance.currentAssets') ?? 0);
  const axes = {
    operationalReadiness: evidence([
      ['الفريق الميداني', pathValue(payload, 'readiness.fieldTeamCount')], ['الباحث الاجتماعي', pathValue(payload, 'socialResearcher.exists')], ['القدرة الأسبوعية', pathValue(payload, 'readiness.weeklyDeliveryCapacity')], ['الاستلام والحفظ', pathValue(payload, 'readiness.hasReceiptStorage')], ['التوثيق الإلكتروني', pathValue(payload, 'readiness.canDocumentDigitally')],
    ]),
    technicalCapability: evidence([
      ['تاريخ تحديث قاعدة المستفيدين', pathValue(payload, 'beneficiaries.databaseUpdatedAt')], ['اسم النظام', pathValue(payload, 'beneficiaries.systemName')], ['البحث', pathValue(payload, 'beneficiaries.capabilities.search')], ['التحديث', pathValue(payload, 'beneficiaries.capabilities.update')], ['التقارير', pathValue(payload, 'beneficiaries.capabilities.reports')], ['تصنيف الحاجة', pathValue(payload, 'beneficiaries.classifiesNeed')], ['آلية دراسة الحالات', pathValue(payload, 'beneficiaries.hasCaseStudyMechanism')],
    ]),
    previousExperience: evidence([
      ['مشروع عيني سابق', pathValue(payload, 'experience.hasRecentInKindProject')], ['عدد المشاريع', pathValue(payload, 'experience.recentProjectsCount')], ['المستفيدون', pathValue(payload, 'experience.recentBeneficiariesCount')], ['الشاهد', attachments.has('previousProjectEvidence')], ['دعم إحسان 2025', pathValue(payload, 'experience.ehsanSupportCount2025')],
    ]),
    integrityTransparency: { ...evidence([['النظام المحاسبي', pathValue(payload, 'finance.hasAccountingSystem')], ['لائحة الصرف', pathValue(payload, 'finance.hasSpendingPolicy')], ['اكتمال الملفات', attachments.size]]), flags: financialResult < 0 ? [{ level: 'ATTENTION', reason: 'تظهر البيانات المالية عجزًا ويجب مراجعته.' }] : [{ level: 'GOOD', reason: 'لا يظهر عجز مالي من الأرقام المقدمة.' }] },
    participationCommitment: { ...evidence([['عدد جولات الاستكمال', requests.length], ['الجولات المستجابة', requests.filter((item) => item.submittedAt).length]]), flags: [] },
    sustainabilityImpact: evidence([['الخطة الاستراتيجية', pathValue(payload, 'planning.hasStrategicPlan')], ['الخطة التشغيلية', pathValue(payload, 'planning.hasOperationalPlan')], ['متابعة الأسر', pathValue(payload, 'planning.hasPostAidFollowUp')], ['قياس الرضا', pathValue(payload, 'planning.measuresSatisfaction')], ['عدد البرامج', pathValue(payload, 'planning.lastYearProgramsCount')]]),
  };
  return { axes, financialPriority: { threshold: FINANCIAL_PRIORITY_THRESHOLD, currentAssets, band: currentAssets > FINANCIAL_PRIORITY_THRESHOLD ? 'HIGHER_CAPACITY_LOWER_AID_PRIORITY' : 'STANDARD_PRIORITY_REVIEW', affectsEligibility: false, affectsScore: false } };
}

function check(key: string, label: string, outcome: boolean | null, reason: string) { return { key, label, result: outcome === null ? 'NEEDS_REVIEW' : outcome ? 'PASS' : 'FAIL', reason }; }
function evidence(entries: Array<[string, unknown]>) { return { evidence: entries.map(([label, value]) => ({ label, value: value ?? '—' })), flags: entries.some(([, value]) => value === null || value === undefined || value === '') ? [{ level: 'MISSING', reason: 'توجد بيانات ناقصة وتحتاج مراجعة.' }] : [] }; }
function pickRatings(dto: EvaluationV2Dto): EvaluationInput { return { operationalReadiness: dto.operationalReadiness, technicalCapability: dto.technicalCapability, previousExperience: dto.previousExperience, integrityTransparency: dto.integrityTransparency, participationCommitment: dto.participationCommitment, sustainabilityImpact: dto.sustainabilityImpact }; }
function publicApplicationStage(application: { status: ApplicationStatus; processingStartedAt: Date | null; eligibilityStatus: EligibilityStatus; selectionList: AssociationSelectionList }, needsInfo: boolean) { if (needsInfo || application.eligibilityStatus === EligibilityStatus.NEEDS_INFO) return 'NEEDS_INFO'; if (application.selectionList === AssociationSelectionList.MAIN) return 'MAIN'; if (application.selectionList === AssociationSelectionList.RESERVE) return 'RESERVE'; if (application.eligibilityStatus === EligibilityStatus.FAILED || application.status === ApplicationStatus.REJECTED) return 'INELIGIBLE'; if (application.eligibilityStatus === EligibilityStatus.PASSED) return 'EVALUATION'; if (application.processingStartedAt) return 'PROCESSING'; return 'RECEIVED'; }
function timeline(stage: string) { const order = ['DRAFT','RECEIVED','PROCESSING','NEEDS_INFO','EVALUATION','MAIN','RESERVE','INELIGIBLE']; const labels: Record<string,string> = { DRAFT:'مسودة محفوظة',RECEIVED:'تم استلام الطلب',PROCESSING:'جاري المعالجة',NEEDS_INFO:'مطلوب استكمال',EVALUATION:'قيد التقييم والمفاضلة',MAIN:'تم اعتماد المشاركة',RESERVE:'قائمة احتياطية',INELIGIBLE:'غير مستوفٍ' }; const current = order.indexOf(stage); return order.filter((item) => !['MAIN','RESERVE','INELIGIBLE'].includes(item) || item === stage).map((item,index) => ({ key:item,label:labels[item],state:index<current?'COMPLETED':index===current?'CURRENT':'UPCOMING' })); }
function asMap(value: Prisma.JsonValue | null): JsonMap { return isPlainObject(value) ? value : {}; }
function isPlainObject(value: unknown): value is JsonMap { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function pathValue(root: JsonMap, path: string): unknown { let value: unknown = root; for (const key of path.split('.')) { if (!isPlainObject(value)) return undefined; value = value[key]; } return value; }
function requiredPathText(root: JsonMap, path: string, label: string, max: number): string { return requiredText(readOptionalString(pathValue(root, path)), label, max); }
function readOptionalString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function requiredBoolean(root: JsonMap, path: string, label: string): boolean { const value = pathValue(root,path); if (typeof value !== 'boolean') throw new ApiError('APPLICATION_VALIDATION_FAILED', `${label}: اختر نعم أو لا`, 400); return value; }
function requiredInteger(root: JsonMap, path: string, label: string, min: number, max: number): number { const value=Number(pathValue(root,path)); if (!Number.isInteger(value)||value<min||value>max) throw new ApiError('APPLICATION_VALIDATION_FAILED', `${label}: أدخل رقمًا صحيحًا صالحًا`, 400); return value; }
function requiredMoney(root: JsonMap, path: string, label: string): number { const raw=pathValue(root,path); const value=typeof raw==='string'?Number(raw.replace(/,/g,'')):Number(raw); if(!Number.isFinite(value)||value<0||value>999_999_999_999_999) throw new ApiError('APPLICATION_VALIDATION_FAILED', `${label}: أدخل مبلغًا صالحًا غير سالب`,400); return Math.round(value*100)/100; }
function parseDate(raw: string, label: string): Date { const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw); if(!match) throw new ApiError('APPLICATION_VALIDATION_FAILED', `${label} غير صالح`,400); const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))); if(date.getUTCFullYear()!==Number(match[1])||date.getUTCMonth()+1!==Number(match[2])||date.getUTCDate()!==Number(match[3])) throw new ApiError('APPLICATION_VALIDATION_FAILED',`${label} غير صالح`,400); return date; }
function safeDate(value: unknown): Date | null { try { return typeof value==='string'?parseDate(value,'التاريخ'):null; } catch { return null; } }
function todayRiyadh(): Date { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); const get=(type:string)=>parts.find((part)=>part.type===type)!.value; return new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00.000Z`); }
function dateOnly(value: Date): string { return value.toISOString().slice(0,10); }
function monthDifference(from: Date,to: Date): number { return (to.getUTCFullYear()-from.getUTCFullYear())*12+to.getUTCMonth()-from.getUTCMonth()-(to.getUTCDate()<from.getUTCDate()?1:0); }
function addDays(date: Date,days:number):Date { return new Date(date.getTime()+days*86_400_000); }
function flattenKeys(value: JsonMap,prefix=''):string[]{ const keys:string[]=[]; for(const [key,item] of Object.entries(value)){if(isUnsafeObjectKey(key)) throw new ApiError('APPLICATION_INFORMATION_SCOPE_INVALID','اسم الحقل المطلوب غير صالح',400); const path=prefix?`${prefix}.${key}`:key; if(isPlainObject(item)) keys.push(...flattenKeys(item,path)); else keys.push(path);} return keys; }
function deepMerge(base:JsonMap,patch:JsonMap):JsonMap { const out={...base}; for(const [key,value] of Object.entries(patch)){if(isUnsafeObjectKey(key)) throw new ApiError('APPLICATION_INFORMATION_SCOPE_INVALID','اسم الحقل المطلوب غير صالح',400); out[key]=isPlainObject(value)&&isPlainObject(out[key])?deepMerge(out[key] as JsonMap,value):value;} return out; }
function isUnsafeObjectKey(key:string){return key==='__proto__'||key==='prototype'||key==='constructor';}
function validateApplicationAttachment(fieldKey:string,file:Express.Multer.File){ if(!file?.buffer?.length) throw new ApiError('APPLICATION_ATTACHMENT_REQUIRED','الملف مطلوب',400); const max=8*1024*1024; if(file.buffer.length>max) throw new ApiError('APPLICATION_ATTACHMENT_TOO_LARGE','حجم الملف يتجاوز 8 ميجابايت',400); if(fieldKey==='initialBeneficiaryFile'){const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; if(file.mimetype!==mime||file.buffer[0]!==0x50||file.buffer[1]!==0x4b) throw new ApiError('APPLICATION_ATTACHMENT_INVALID','قائمة المستفيدين يجب أن تكون XLSX صالحة',400); return {mimeType:mime,extension:'xlsx',category:FileCategory.APPLICATION_INITIAL_BENEFICIARIES};} const result=validateReceiptDocumentFile(file.buffer,file.mimetype); if(!result.valid||!result.detectedMimeType) throw new ApiError('APPLICATION_ATTACHMENT_INVALID','المرفق يجب أن يكون PDF أو صورة JPG/PNG/WEBP صالحة',400); const extension=result.detectedMimeType==='application/pdf'?'pdf':result.detectedMimeType==='image/png'?'png':result.detectedMimeType==='image/webp'?'webp':'jpg'; return {mimeType:result.detectedMimeType,extension,category:fieldKey==='licenseFile'?FileCategory.ASSOCIATION_LICENSE:FileCategory.APPLICATION_SUPPORTING_DOCUMENT}; }
