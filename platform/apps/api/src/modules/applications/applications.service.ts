import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  prisma,
  Prisma,
  AccountRole,
  AccountStatus,
  ApplicationStatus,
  AssociationStatus,
  AuthCredentialType,
  FileCategory,
  EligibilityStatus,
  AssociationSelectionList,
  ParticipationStatus,
  ActivationBasis,
} from '@alzad/db';
import { LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';
import { ApiError } from '../../common/api-error';
import { RateLimitService } from '../../common/rate-limit.service';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../../common/password.util';
import { generateStrongTempPassword } from '../../common/crypto.util';
import { requiredEmail, requiredText } from '../../common/validation/text.util';
import { normalizeSaudiPhone } from '../../common/validation/phone.util';
import { validateAssociationCategory, validateAssociationSector, validateRegionCity } from './application-reference.util';
import { validateLicenseFile } from '../files/file-validation.util';
import { StorageService } from '../files/storage.service';
import { storageConfig } from '../../config/storage.config';
import { applicationConfig } from '../../config/application.config';
import type { AuthContext } from '../auth/auth.types';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import { SettingsService } from '../settings/settings.service';
import { rankApplications, scoreApplication, type EvaluationInput } from './application-evaluation.util';

const QUESTION_KEYS = LEGACY_APPLICATION_QUESTIONS.map((q) => q.key);

export interface SubmitApplicationInput {
  clientRequestId: string;
  name: string;
  category?: string;
  sector: string;
  region: string;
  city: string;
  phone: string;
  email: string;
  contactName: string;
  address?: string;
  serviceScope?: string;
  coordinatorPhone?: string;
  coordinatorEmail?: string;
  coordinatorTitle?: string;
  beneficiaryDatabaseUpdatedAt?: string;
  approxBeneficiaryCount?: string;
  approxNeedCount?: string;
  notes?: string;
  licenseNumber: string;
  licenseExpiryDate: string;
  answers: Record<string, boolean>;
  pledgeAccepted: boolean;
  website?: string;
}

const FAKE_HONEYPOT_SUCCESS = { ok: true as const, id: '', message: 'تم استلام طلب الانضمام وسيتم التواصل معكم بعد المراجعة' };

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly publicCode: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  // ================================================================
  // PUBLIC SUBMISSION
  // ================================================================
  async submitApplication(
    input: SubmitApplicationInput,
    licenseFileBuffer: Buffer,
    declaredMimeType: string | undefined,
    initialBeneficiaryFile?: Express.Multer.File,
  ): Promise<{ ok: true; id: string; message: string; duplicate?: boolean }> {
    // 1) Honeypot — لا قراءة/كتابة/rate-limit/audit إطلاقًا، رد نجاح وهمي فوري.
    if (input.website && input.website.trim().length > 0) {
      return FAKE_HONEYPOT_SUCCESS;
    }

    // 2) clientRequestId
    const clientRequestId = String(input.clientRequestId ?? '').trim();
    if (!applicationConfig.clientRequestIdPattern.test(clientRequestId)) {
      throw new ApiError('APPLICATION_INVALID_CLIENT_REQUEST_ID', 'تعذّر التحقق من الطلب — يرجى إعادة تحميل الصفحة والمحاولة مجددًا', 400);
    }

    // 3) تحقق رخيص (بلا I/O باهظ) — نفس ترتيب Applications.gs
    const email = requiredEmail(input.email);
    const phone = normalizeSaudiPhone(input.phone);
    const { region, city } = await validateRegionCity(input.region, input.city);
    const category = await validateAssociationCategory(input.category);
    const sector = await validateAssociationSector(input.sector);
    const name = requiredText(input.name, 'اسم الجمعية', applicationConfig.nameMaxLength);
    const contactName = requiredText(input.contactName, 'اسم المسؤول', applicationConfig.contactNameMaxLength);
    const address = input.address ? requiredText(input.address, 'العنوان', 500) : undefined;
    const serviceScope = input.serviceScope ? requiredText(input.serviceScope, 'نطاق الخدمة', 1000) : undefined;
    const coordinatorPhone = input.coordinatorPhone ? normalizeSaudiPhone(input.coordinatorPhone) : undefined;
    const coordinatorEmail = input.coordinatorEmail ? requiredEmail(input.coordinatorEmail) : undefined;
    const coordinatorTitle = input.coordinatorTitle ? requiredText(input.coordinatorTitle, 'صفة المنسق', 120) : undefined;
    const beneficiaryDatabaseUpdatedAt = input.beneficiaryDatabaseUpdatedAt ? parseRequiredDate(input.beneficiaryDatabaseUpdatedAt) : undefined;
    const approxBeneficiaryCount = optionalNonNegativeInteger(input.approxBeneficiaryCount, 'العدد التقريبي للمستفيدين');
    const approxNeedCount = optionalNonNegativeInteger(input.approxNeedCount, 'العدد التقريبي للاحتياجات');
    const notes = input.notes ? requiredText(input.notes, 'ملاحظات', applicationConfig.notesMaxLength) : undefined;
    const licenseNumber = requiredText(input.licenseNumber, 'رقم الترخيص', applicationConfig.licenseNumberMaxLength);
    const licenseExpiryDate = parseRequiredDate(input.licenseExpiryDate);
    const answers = validateAnswers(input.answers);

    if (answers[LICENSE_VALID_QUESTION_KEY] === true && licenseExpiryDate < todayInRiyadh()) {
      throw new ApiError(
        'APPLICATION_LICENSE_EXPIRY_CONTRADICTION',
        'تاريخ انتهاء الترخيص المُدخَل في الماضي، بينما أجبتم بأن الترخيص ساري — يرجى مراجعة التاريخ أو الإجابة',
        400,
      );
    }
    if (input.pledgeAccepted !== true) {
      throw new ApiError('APPLICATION_PLEDGE_REQUIRED', 'يجب الموافقة على نص الإقرار قبل إرسال الطلب', 400);
    }

    // 4) قراءة مسبقة (best-effort — الدفاع الحقيقي هو قيود DB أدناه):
    const existingByClientId = await prisma.associationApplication.findUnique({ where: { clientRequestId } });
    if (existingByClientId) {
      return { ok: true, id: existingByClientId.publicCode, message: 'تم استلام طلبكم مسبقًا وهو قيد المراجعة الآن', duplicate: true };
    }
    const existingCredential = await prisma.authCredential.findUnique({
      where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
    });
    if (existingCredential) {
      throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'هذا البريد الإلكتروني مرتبط بحساب قائم بالفعل', 409);
    }
    const pendingDuplicate = await prisma.associationApplication.findFirst({
      where: {
        status: ApplicationStatus.UNDER_REVIEW,
        OR: [{ email }, { phone }, { licenseNumber }],
      },
    });
    if (pendingDuplicate) {
      throw new ApiError('APPLICATION_DUPLICATE_PENDING', 'يوجد طلب سابق قيد المراجعة بنفس البريد الإلكتروني أو رقم الجوال أو رقم الترخيص', 409);
    }

    // 5) rate limit — بعد كل التحقق الرخيص، قبل رفع الملف.
    await this.rateLimit.consume('association-application-submit', email, applicationConfig.rateLimitSubmit);

    // 6) الملف — تحقق ثم رفع (خارج معاملة DB، Object Storage ليست جزءًا من transaction).
    const fileValidation = validateLicenseFile(licenseFileBuffer, declaredMimeType);
    if (!fileValidation.valid) {
      if (fileValidation.reason === 'TOO_LARGE') {
        throw new ApiError('APPLICATION_LICENSE_TOO_LARGE', 'حجم ملف الترخيص يتجاوز 8 ميجابايت', 400);
      }
      throw new ApiError('APPLICATION_LICENSE_INVALID', 'أرفق صورة الترخيص بصيغة JPG أو PNG أو WEBP', 400);
    }
    const detectedMime = fileValidation.detectedMimeType!;
    const extension = detectedMime === 'image/jpeg' ? 'jpg' : detectedMime === 'image/png' ? 'png' : 'webp';
    const objectKey = `association-licenses/${randomUUID()}.${extension}`;
    const initialUpload = initialBeneficiaryFile ? validateInitialBeneficiaryEvidence(initialBeneficiaryFile) : null;
    const initialObjectKey = initialUpload ? `application-initial-beneficiaries/${randomUUID()}.xlsx` : null;

    try {
      await this.storage.uploadPrivateObject(objectKey, licenseFileBuffer, detectedMime);
      if (initialUpload && initialObjectKey) await this.storage.uploadPrivateObject(initialObjectKey, initialBeneficiaryFile!.buffer, initialUpload.mimeType);
      const result = await prisma.$transaction(async (tx) => {
        const fileObject = await tx.fileObject.create({
          data: {
            storageProvider: 'S3',
            bucket: storageConfig.bucket,
            objectKey,
            originalName: 'license', // NODE-2: لا نحتفظ باسم الملف الأصلي من العميل عمدًا — قد يحمل PII بلا ضرورة.
            mimeType: detectedMime,
            sizeBytes: BigInt(licenseFileBuffer.length),
            sha256: null,
            category: FileCategory.ASSOCIATION_LICENSE,
          },
        });

        const publicCode = await this.publicCode.nextPublicCode(tx, 'APP');
        const initialFileObject = initialUpload && initialObjectKey ? await tx.fileObject.create({ data: {
          storageProvider: 'S3', bucket: storageConfig.bucket, objectKey: initialObjectKey,
          originalName: 'initial-beneficiaries.xlsx', mimeType: initialUpload.mimeType,
          sizeBytes: BigInt(initialBeneficiaryFile!.buffer.length), category: FileCategory.APPLICATION_INITIAL_BENEFICIARIES,
        } }) : null;
        const application = await tx.associationApplication.create({
          data: {
            publicCode,
            clientRequestId,
            name,
            category: category ?? null,
            sector,
            region,
            city,
            phone,
            email,
            contactName,
            address: address ?? null,
            serviceScope: serviceScope ?? null,
            coordinatorPhone: coordinatorPhone ?? null,
            coordinatorEmail: coordinatorEmail ?? null,
            coordinatorTitle: coordinatorTitle ?? null,
            beneficiaryDatabaseUpdatedAt: beneficiaryDatabaseUpdatedAt ?? null,
            approxBeneficiaryCount: approxBeneficiaryCount ?? null,
            approxNeedCount: approxNeedCount ?? null,
            initialBeneficiaryFileId: initialFileObject?.id ?? null,
            notes: notes ?? null,
            licenseNumber,
            licenseExpiryDate,
            licenseFileId: fileObject.id,
            pledgeAccepted: true,
            pledgeAcceptedAt: new Date(),
            status: ApplicationStatus.UNDER_REVIEW,
          },
        });

        await tx.applicationAnswer.createMany({
          data: QUESTION_KEYS.map((key) => ({ applicationId: application.id, questionKey: key, answer: answers[key] })),
        });

        return application;
      });

      return { ok: true, id: result.publicCode, message: 'تم استلام طلب الانضمام وسيتم التواصل معكم بعد المراجعة' };
    } catch (error) {
      // فشل بعد رفع ناجح للملف — حذف best-effort لتجنّب كائن يتيم.
      await this.storage.deleteObjectBestEffort(objectKey);
      if (initialObjectKey) await this.storage.deleteObjectBestEffort(initialObjectKey);

      if (isUniqueConstraintError(error, ...UNIQUE_CLIENT_REQUEST_ID)) {
        // سباق: طلب متزامن آخر بنفس clientRequestId فاز — نتيجة idempotent، وليست خطأ.
        const raced = await prisma.associationApplication.findUnique({ where: { clientRequestId } });
        if (raced) {
          return { ok: true, id: raced.publicCode, message: 'تم استلام طلبكم مسبقًا وهو قيد المراجعة الآن', duplicate: true };
        }
      }
      if (isUniqueConstraintError(error, ...UNIQUE_PENDING_DUPLICATE)) {
        throw new ApiError('APPLICATION_DUPLICATE_PENDING', 'يوجد طلب سابق قيد المراجعة بنفس البريد الإلكتروني أو رقم الجوال أو رقم الترخيص', 409);
      }
      throw error;
    }
  }

  // ================================================================
  // PUBLIC STATUS
  // ================================================================
  async getApplicationStatus(clientRequestIdRaw: string) {
    const clientRequestId = String(clientRequestIdRaw ?? '').trim();
    if (!applicationConfig.clientRequestIdPattern.test(clientRequestId)) {
      throw new ApiError('APPLICATION_INVALID_CLIENT_REQUEST_ID', 'معرف الطلب غير صالح', 400);
    }
    await this.rateLimit.consume('association-application-status', clientRequestId, applicationConfig.rateLimitStatus);

    const application = await prisma.associationApplication.findUnique({ where: { clientRequestId } });
    if (!application) return { ok: true as const, found: false as const };

    return {
      ok: true as const,
      found: true as const,
      id: application.publicCode,
      status: application.status,
      submittedAt: application.submittedAt,
      rejectionReason: application.status === ApplicationStatus.REJECTED ? application.rejectReason ?? '' : '',
    };
  }

  // ================================================================
  // ADMIN LIST
  // ================================================================
  async listApplications(params: PaginationParams & { search?: string; status?: ApplicationStatus }): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);
    const where: Prisma.AssociationApplicationWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.search) {
      const q = params.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { publicCode: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { contactName: { contains: q, mode: 'insensitive' } },
        { licenseNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.associationApplication.findMany({
        where,
        include: { answers: true, reviewedBy: true, licenseFile: true },
        orderBy: { submittedAt: 'desc' },
        skip,
        take,
      }),
      prisma.associationApplication.count({ where }),
    ]);

    return toPaginatedResult(rows.map(mapApplicationSummary), total, page, pageSize);
  }

  // ================================================================
  // ADMIN DETAIL
  // ================================================================
  async getApplicationDetail(id: string) {
    const application = await prisma.associationApplication.findUnique({
      where: { id },
      include: { answers: true, reviewedBy: true, licenseFile: true },
    });
    if (!application) throw new ApiError('APPLICATION_NOT_FOUND', 'طلب الانضمام غير موجود', 404);
    return mapApplicationSummary(application);
  }

  // ================================================================
  // ADMIN LICENSE FILE — signed URL قصير العمر
  // ================================================================
  async getLicenseSignedUrl(ctx: AuthContext, id: string): Promise<{ url: string }> {
    const application = await prisma.associationApplication.findUnique({ where: { id }, include: { licenseFile: true } });
    if (!application) throw new ApiError('APPLICATION_NOT_FOUND', 'طلب الانضمام غير موجود', 404);
    if (!application.licenseFile || application.licenseFile.category !== FileCategory.ASSOCIATION_LICENSE) {
      throw new ApiError('APPLICATION_LICENSE_INVALID', 'لا يوجد ملف ترخيص مرفق بهذا الطلب', 404);
    }

    const url = await this.storage.getSignedGetUrl(application.licenseFile.objectKey, storageConfig.licenseSignedUrlSeconds);
    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'APPLICATION_LICENSE_VIEWED', 'association_applications', id);
    return { url };
  }

  // ================================================================
  // REVIEW — accept/reject
  // ================================================================
  async reviewApplication(ctx: AuthContext, id: string, decision: 'accept' | 'reject', reason: string | undefined, opId: string) {
    if (decision === 'accept') return this.decideEligibility(ctx, id, EligibilityStatus.PASSED, reason, opId);
    return this.rejectApplication(ctx, id, reason, opId);
  }

  async decideEligibility(ctx: AuthContext, id: string, decision: EligibilityStatus, notes: string | undefined, opId: string) {
    if (decision === EligibilityStatus.PENDING) throw new ApiError('ELIGIBILITY_DECISION_INVALID', 'قرار الأهلية غير صالح', 400);
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true }>(tx, ctx.accountId, 'application-eligibility', opId, { id, decision, notes: notes ?? null });
      if (!claim.claimed) return claim.existingResponse!;
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM association_applications WHERE id=${id}::uuid FOR UPDATE`;
      if (!locked[0]) throw new ApiError('APPLICATION_NOT_FOUND', 'طلب الانضمام غير موجود', 404);
      const application = await tx.associationApplication.findUniqueOrThrow({ where: { id }, include: { answers: true } });
      if (application.status !== ApplicationStatus.UNDER_REVIEW) throw new ApiError('APPLICATION_ALREADY_REVIEWED', 'سبق البتّ في هذا الطلب', 409);
      if (application.answers.length !== QUESTION_KEYS.length) throw new ApiError('ELIGIBILITY_ANSWERS_INCOMPLETE', 'إجابات بوابة الأهلية غير مكتملة', 409);
      await tx.associationApplication.update({ where: { id }, data: { eligibilityStatus: decision, eligibilityNotes: notes?.trim() || null, eligibilityReviewedAt: new Date(), eligibilityReviewedById: ctx.accountId, ...(decision !== EligibilityStatus.PASSED ? { evaluationBreakdown: Prisma.DbNull, evaluationScore: null, evaluationRank: null, selectionList: AssociationSelectionList.NONE } : {}) } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'APPLICATION_ELIGIBILITY_DECIDED', entityType: 'association_applications', entityId: id, metadata: { decision, notes: notes ?? null } } });
      const response = { ok: true as const }; await this.idempotency.complete(tx, ctx.accountId, 'application-eligibility', opId, response); return response;
    });
  }

  async evaluate(ctx: AuthContext, id: string, input: EvaluationInput, opId: string) {
    let scored: ReturnType<typeof scoreApplication>;
    try { scored = scoreApplication(input); } catch { throw new ApiError('APPLICATION_EVALUATION_INVALID', 'قيم التقييم يجب أن تكون بين 0 و100', 400); }
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; score: number }>(tx, ctx.accountId, 'application-evaluation', opId, { id, input });
      if (!claim.claimed) return claim.existingResponse!;
      await tx.$queryRaw`SELECT id FROM association_applications WHERE id=${id}::uuid FOR UPDATE`;
      const application = await tx.associationApplication.findUnique({ where: { id } });
      if (!application) throw new ApiError('APPLICATION_NOT_FOUND', 'طلب الانضمام غير موجود', 404);
      if (application.eligibilityStatus !== EligibilityStatus.PASSED) throw new ApiError('APPLICATION_NOT_ELIGIBLE', 'لا يمكن تقييم طلب قبل اجتياز بوابة الأهلية', 409);
      await tx.associationApplication.update({ where: { id }, data: { evaluationBreakdown: scored.breakdown, evaluationScore: scored.total, geographicNeedScore: null, evaluatedAt: new Date(), evaluatedById: ctx.accountId } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'APPLICATION_EVALUATED', entityType: 'association_applications', entityId: id, metadata: { score: scored.total, breakdown: scored.breakdown } } });
      const response = { ok: true as const, score: scored.total }; await this.idempotency.complete(tx, ctx.accountId, 'application-evaluation', opId, response); return response;
    });
  }

  async previewSelection() {
    const threshold = await this.settings.requireNumber('selection.passThreshold');
    const rows = await prisma.associationApplication.findMany({ where: { eligibilityStatus: EligibilityStatus.PASSED, evaluationScore: { not: null }, selectionList: AssociationSelectionList.NONE }, select: { id: true, publicCode: true, name: true, evaluationScore: true, evaluationBreakdown: true } });
    const ranked = rankApplications(rows.map((row) => ({ ...row, score: Number(row.evaluationScore) })));
    return { threshold, items: ranked.map((item, index) => ({ ...item, rank: index + 1, passesThreshold: item.score >= threshold })) };
  }

  async commitSelection(ctx: AuthContext, mainTargetCount: number, opId: string) {
    const threshold = await this.settings.requireNumber('selection.passThreshold');
    const configuredMainTargetCount = await this.settings.requireNumber('selection.mainTargetCount');
    if (!Number.isInteger(mainTargetCount) || mainTargetCount < 1) throw new ApiError('SELECTION_TARGET_INVALID', 'عدد القائمة الأساسية غير صالح', 400);
    if (mainTargetCount !== configuredMainTargetCount) throw new ApiError('SELECTION_TARGET_MISMATCH', 'عدد القائمة الأساسية لا يطابق السعة المعتمدة في إعدادات الاختيار', 409);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('association-selection:electrical-appliances'))`;
      const claim = await this.idempotency.claim<{ ok: true; main: number; reserve: number; rejected: number }>(tx, ctx.accountId, 'application-selection', opId, { mainTargetCount, threshold });
      if (!claim.claimed) return claim.existingResponse!;
      const rows = await tx.associationApplication.findMany({ where: { status: ApplicationStatus.UNDER_REVIEW, eligibilityStatus: EligibilityStatus.PASSED, evaluationScore: { not: null }, selectionList: AssociationSelectionList.NONE }, select: { id: true, evaluationScore: true, contactName: true, coordinatorPhone: true, coordinatorEmail: true, coordinatorTitle: true } });
      const ranked = rankApplications(rows.map((row) => ({ ...row, score: Number(row.evaluationScore) })));
      const passing = ranked.filter((row) => row.score >= threshold); const main = passing.slice(0, mainTargetCount); const reserve = passing.slice(mainTargetCount); const rejected = ranked.filter((row) => row.score < threshold); const now = new Date();
      for (let i = 0; i < ranked.length; i += 1) await tx.associationApplication.update({ where: { id: ranked[i].id }, data: { evaluationRank: i + 1 } });
      if (main.length) await tx.associationApplication.updateMany({ where: { id: { in: main.map((r) => r.id) } }, data: { selectionList: AssociationSelectionList.MAIN, status: ApplicationStatus.ACCEPTED, selectionApprovedAt: now, selectionApprovedById: ctx.accountId } });
      if (reserve.length) await tx.associationApplication.updateMany({ where: { id: { in: reserve.map((r) => r.id) } }, data: { selectionList: AssociationSelectionList.RESERVE, status: ApplicationStatus.ACCEPTED, selectionApprovedAt: now, selectionApprovedById: ctx.accountId } });
      if (rejected.length) await tx.associationApplication.updateMany({ where: { id: { in: rejected.map((r) => r.id) } }, data: { status: ApplicationStatus.REJECTED, rejectReason: 'لم يحقق حد الاجتياز المعتمد', reviewedAt: now, reviewedById: ctx.accountId } });
      for (const row of main) await tx.projectParticipation.create({ data: { applicationId: row.id, status: ParticipationStatus.APPROVED_AWAITING_SETUP, activationBasis: ActivationBasis.AGREEMENT_COMPLETED, coordinatorName: row.contactName, coordinatorPhone: row.coordinatorPhone, coordinatorEmail: row.coordinatorEmail, coordinatorTitle: row.coordinatorTitle } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'APPLICATION_SELECTION_COMMITTED', entityType: 'association_applications', metadata: { mainIds: main.map((r) => r.id), reserveIds: reserve.map((r) => r.id), rejectedIds: rejected.map((r) => r.id), threshold } } });
      const response = { ok: true as const, main: main.length, reserve: reserve.length, rejected: rejected.length }; await this.idempotency.complete(tx, ctx.accountId, 'application-selection', opId, response); return response;
    });
  }

  private async acceptApplication(ctx: AuthContext, id: string, opId: string) {
    const scope = 'application-accept';
    const payload = { id };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<AcceptResponse>(tx, ctx.accountId, scope, opId, payload);
      if (!claim.claimed) {
        return { replayed: true as const, response: claim.existingResponse! };
      }

      const rows = await tx.$queryRaw<{ id: string; status: string; email: string; name: string }[]>`
        SELECT id, status, email, name FROM association_applications WHERE id = ${id}::uuid FOR UPDATE
      `;
      const application = rows[0];
      if (!application) throw new ApiError('APPLICATION_NOT_FOUND', 'طلب الانضمام غير موجود', 404);
      if (application.status !== ApplicationStatus.UNDER_REVIEW) {
        throw new ApiError('APPLICATION_ALREADY_REVIEWED', 'سبق البتّ في هذا الطلب', 409);
      }

      const email = application.email;
      const existingCredential = await tx.authCredential.findUnique({
        where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
      });
      if (existingCredential) throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر الآن', 409);

      const fullApplication = await tx.associationApplication.findUniqueOrThrow({ where: { id } });

      const associationCode = await this.publicCode.nextPublicCode(tx, 'ASC');
      const association = await tx.association.create({
        data: {
          publicCode: associationCode,
          name: fullApplication.name,
          category: fullApplication.category ?? '',
          region: fullApplication.region,
          city: fullApplication.city,
          phones: [fullApplication.phone],
          email,
          status: AssociationStatus.ACTIVE,
        },
      });

      const userCode = await this.publicCode.nextPublicCode(tx, 'USR');
      const account = await tx.account.create({
        data: {
          publicCode: userCode,
          name: fullApplication.name,
          email,
          role: AccountRole.ASSOCIATION,
          associationId: association.id,
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
        },
      });

      const temporaryPassword = generateStrongTempPassword();
      const secretHash = await hashSecret(temporaryPassword);
      await tx.authCredential.create({
        data: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash },
      });

      await tx.associationApplication.update({
        where: { id },
        data: {
          status: ApplicationStatus.ACCEPTED,
          resultingAssociationId: association.id,
          reviewedAt: new Date(),
          reviewedById: ctx.accountId,
        },
      });

      // temporaryPassword عمدًا خارج ما يُخزَّن في idempotency response — راجع ASSOCIATION_APPLICATIONS.md.
      const storedResponse: AcceptResponse = {
        associationId: association.id,
        associationPublicCode: association.publicCode,
        accountId: account.id,
        temporaryPasswordPreviouslyIssued: true,
      };
      await this.idempotency.complete(tx, ctx.accountId, scope, opId, storedResponse);

      return {
        replayed: false as const,
        response: storedResponse,
        temporaryPassword,
        applicationName: fullApplication.name,
      };
    });

    if (outcome.replayed) {
      return {
        ok: true as const,
        alreadyProcessed: true as const,
        associationId: outcome.response.associationId,
        associationPublicCode: outcome.response.associationPublicCode,
        temporaryPassword: null,
        temporaryPasswordPreviouslyIssued: true as const,
      };
    }

    await this.audit.log(
      { id: ctx.accountId, role: ctx.role, associationId: ctx.associationId },
      'APPLICATION_ACCEPTED',
      'association_applications',
      id,
      { associationId: outcome.response.associationId, associationName: outcome.applicationName },
    );

    return {
      ok: true as const,
      alreadyProcessed: false as const,
      associationId: outcome.response.associationId,
      associationPublicCode: outcome.response.associationPublicCode,
      temporaryPassword: outcome.temporaryPassword,
      temporaryPasswordPreviouslyIssued: false as const,
    };
  }

  private async rejectApplication(ctx: AuthContext, id: string, reasonRaw: string | undefined, opId: string) {
    const reason = requiredText(reasonRaw, 'سبب الرفض', applicationConfig.rejectReasonMaxLength);
    const scope = 'application-reject';
    const payload = { id, reason };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true }>(tx, ctx.accountId, scope, opId, payload);
      if (!claim.claimed) return { replayed: true as const };

      const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM association_applications WHERE id = ${id}::uuid FOR UPDATE
      `;
      const application = rows[0];
      if (!application) throw new ApiError('APPLICATION_NOT_FOUND', 'طلب الانضمام غير موجود', 404);
      if (application.status !== ApplicationStatus.UNDER_REVIEW) {
        throw new ApiError('APPLICATION_ALREADY_REVIEWED', 'سبق البتّ في هذا الطلب', 409);
      }

      await tx.associationApplication.update({
        where: { id },
        data: { status: ApplicationStatus.REJECTED, rejectReason: reason, reviewedAt: new Date(), reviewedById: ctx.accountId },
      });

      await this.idempotency.complete(tx, ctx.accountId, scope, opId, { ok: true });
      return { replayed: false as const };
    });

    if (!outcome.replayed) {
      await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'APPLICATION_REJECTED', 'association_applications', id, {
        reason,
      });
    }

    return { ok: true as const };
  }
}

interface AcceptResponse {
  associationId: string;
  associationPublicCode: string;
  accountId: string;
  temporaryPasswordPreviouslyIssued: true;
}

const LICENSE_VALID_QUESTION_KEY = 'الترخيص ساري';

function validateAnswers(answersRaw: Record<string, boolean> | undefined): Record<string, boolean> {
  const answers = answersRaw ?? {};
  const result: Record<string, boolean> = {};
  for (const question of LEGACY_APPLICATION_QUESTIONS) {
    const value = answers[question.key];
    if (typeof value !== 'boolean') {
      throw new ApiError('APPLICATION_ANSWER_REQUIRED', `${question.label}: أجب بنعم أو لا`, 400);
    }
    result[question.key] = value;
  }
  return result;
}

/** صيغة YYYY-MM-DD حصرًا — لا صيغ Date التساهلية ولا طوابع زمنية كاملة. */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * NODE-2.1 — تحقق صارم من تاريخ انتهاء الترخيص.
 *
 * الخلل المُصحَّح: `new Date('2026-02-31T00:00:00.000Z')` لا يرمي في
 * JavaScript، بل **يتدحرج** بصمت إلى 2026-03-03، و`2026-13-01` تصبح
 * 2027-01-01. النتيجة أن تاريخًا مستحيلًا كان يُقبَل ويُخزَّن كتاريخ
 * مختلف تمامًا عمّا كتبه المتقدِّم — ثم تُقارَن قاعدة التناقض
 * (todayInRiyadh) بتاريخ لم يُدخِله أحد أصلًا.
 *
 * التصحيح: تُستخرج الأجزاء الثلاثة كأعداد صحيحة من صيغة YYYY-MM-DD
 * المضبوطة، ثم يُعاد بناء التاريخ بـDate.UTC ويُقارَن ما استقر عليه فعلًا
 * (getUTCFullYear/getUTCMonth+1/getUTCDate) بما طُلب — أي انزياح يعني
 * تدحرجًا فيُرفَض. قاعدة "الترخيص ساري + تاريخ منتهٍ" في المستدعي تبقى
 * كما هي حرفيًا؛ هذا البند يشدّ فحص الصيغة السابق لها فقط.
 */
function parseRequiredDate(value: string): Date {
  const raw = String(value ?? '').trim();
  const match = DATE_ONLY_PATTERN.exec(raw);
  if (!match) {
    throw new ApiError('APPLICATION_VALIDATION_FAILED', 'تاريخ انتهاء الترخيص غير صالح', 400);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  const rolledOver =
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day;
  if (rolledOver) {
    throw new ApiError('APPLICATION_VALIDATION_FAILED', 'تاريخ انتهاء الترخيص غير صالح', 400);
  }

  return date;
}

function todayInRiyadh(): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: applicationConfig.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

function mapApplicationSummary(row: {
  id: string;
  publicCode: string;
  name: string;
  category: string | null;
  sector: string | null;
  region: string;
  city: string;
  phone: string;
  email: string | null;
  contactName: string;
  notes: string | null;
  licenseNumber: string | null;
  licenseExpiryDate: Date | null;
  status: string;
  rejectReason: string | null;
  resultingAssociationId: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewedBy?: { name: string } | null;
  pledgeAccepted: boolean;
  pledgeAcceptedAt: Date | null;
  answers?: { questionKey: string; answer: boolean }[];
  licenseFile?: { id: string } | null;
  eligibilityStatus?: EligibilityStatus;
  eligibilityNotes?: string | null;
  evaluationScore?: Prisma.Decimal | number | null;
  evaluationRank?: number | null;
  selectionList?: AssociationSelectionList;
}) {
  const answersList = LEGACY_APPLICATION_QUESTIONS.map((q) => {
    const found = row.answers?.find((a) => a.questionKey === q.key);
    return { key: q.key, label: q.label, value: found?.answer ?? null };
  });
  const yesCount = answersList.filter((a) => a.value === true).length;
  const total = answersList.length;

  return {
    id: row.id,
    publicCode: row.publicCode,
    name: row.name,
    category: row.category,
    sector: row.sector,
    region: row.region,
    city: row.city,
    phone: row.phone,
    email: row.email,
    contactName: row.contactName,
    notes: row.notes,
    licenseNumber: row.licenseNumber,
    licenseExpiryDate: row.licenseExpiryDate,
    status: row.status,
    rejectReason: row.rejectReason,
    resultingAssociationId: row.resultingAssociationId,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewer: row.reviewedBy?.name ?? null,
    answers: answersList,
    yesCount,
    totalQuestions: total,
    scoreLabel: total ? `${yesCount}/${total}` : '',
    hasLicenseFile: !!row.licenseFile,
    pledgeAccepted: row.pledgeAccepted,
    pledgedAt: row.pledgeAcceptedAt,
    eligibilityStatus: row.eligibilityStatus ?? EligibilityStatus.PENDING,
    eligibilityNotes: row.eligibilityNotes ?? null,
    evaluationScore: row.evaluationScore == null ? null : Number(row.evaluationScore),
    evaluationRank: row.evaluationRank ?? null,
    selectionList: row.selectionList ?? AssociationSelectionList.NONE,
  };
}

/**
 * أسماء نتوقّعها في P2002. Prisma لا يضمن أيّ صيغة يُعيدها في
 * `meta.target`: لقيد فرادة معروف في schema.prisma يُعيد **أسماء
 * الأعمدة** (`client_request_id`)، ولفهرس أُنشئ في raw SQL خارج المخطط
 * (الفهارس الجزئية ux_pending_*) يُعيد **اسم الفهرس** نفسه. لذلك نطابق
 * الاثنين معًا — الاعتماد على اسم القيد وحده كان يجعل مسار التعويض
 * (رد idempotent عند سباق clientRequestId) لا يُفعَّل أبدًا فيتحوّل
 * السباق الطبيعي إلى 500. راجع ASSOCIATION_APPLICATIONS.md.
 */
const UNIQUE_CLIENT_REQUEST_ID = ['association_applications_client_request_id_key', 'client_request_id'];
const UNIQUE_PENDING_DUPLICATE = [
  'ux_pending_application_email',
  'ux_pending_application_phone',
  'ux_pending_application_license',
  'email',
  'phone',
  'license_number',
];

function isUniqueConstraintError(error: unknown, ...constraintNames: string[]): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = (error.meta?.target as string[] | string | undefined) ?? '';
    const targetStr = Array.isArray(target) ? target.join(',') : String(target);
    if (constraintNames.some((name) => targetStr.split(',').includes(name) || targetStr.includes(name))) return true;
  }
  if (error instanceof Error && /duplicate key value violates unique constraint/i.test(error.message)) {
    return constraintNames.some((name) => error.message.includes(name));
  }
  return false;
}

function optionalNonNegativeInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000_000) throw new ApiError('APPLICATION_VALIDATION_FAILED', `${label} غير صالح`, 400);
  return parsed;
}

function validateInitialBeneficiaryEvidence(file: Express.Multer.File): { mimeType: string } {
  const max = 8 * 1024 * 1024;
  const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (file.buffer.length === 0 || file.buffer.length > max || file.mimetype !== xlsxMime || file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
    throw new ApiError('APPLICATION_INITIAL_FILE_INVALID', 'ملف المستفيدين الأولي يجب أن يكون XLSX صالحًا وبحجم لا يتجاوز 8 ميجابايت', 400);
  }
  return { mimeType: xlsxMime };
}
