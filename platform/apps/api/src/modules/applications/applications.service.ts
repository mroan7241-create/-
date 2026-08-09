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
  ) {}

  // ================================================================
  // PUBLIC SUBMISSION
  // ================================================================
  async submitApplication(
    input: SubmitApplicationInput,
    licenseFileBuffer: Buffer,
    declaredMimeType: string | undefined,
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

    await this.storage.uploadPrivateObject(objectKey, licenseFileBuffer, detectedMime);

    try {
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
    if (decision === 'accept') return this.acceptApplication(ctx, id, opId);
    return this.rejectApplication(ctx, id, reason, opId);
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

function parseRequiredDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!value || Number.isNaN(date.getTime())) {
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
