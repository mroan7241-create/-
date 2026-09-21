import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ApplicationAccessTokenPurpose,
  ApplicationDraftStatus,
  ApplicationInformationRequestStatus,
  prisma,
} from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { sha256Hex } from '../../common/crypto.util';
import { RateLimitService } from '../../common/rate-limit.service';
import { EmailService } from '../auth/email/email.service';

export const APPLICANT_SESSION_COOKIE = 'alzad_applicant_session';
export const APPLICANT_SESSION_TTL_SECONDS = 30 * 60;
const ACCESS_TOKEN_TTL_MINUTES = 20;
const GENERIC_MESSAGE = 'إذا وجد طلب مرتبط بهذا البريد فسيتم إرسال رابط المتابعة.';

@Injectable()
export class ApplicationAccessService {
  private readonly logger = new Logger(ApplicationAccessService.name);

  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  async requestAccess(emailRaw: string, ipAddress: string) {
    const email = normalizeEmail(emailRaw);
    const generic = { ok: true as const, message: GENERIC_MESSAGE };
    if (!email) return generic;
    await this.rateLimit.consume('application-access-request-email', email, { limit: 5, windowSeconds: 3600 });
    await this.rateLimit.consume('application-access-request-ip', ipAddress, { limit: 20, windowSeconds: 3600 });

    const drafts = await prisma.associationApplicationDraft.findMany({
      where: {
        expiresAt: { gt: new Date() },
        status: { in: [ApplicationDraftStatus.ACTIVE, ApplicationDraftStatus.SUBMITTED] },
        OR: [
          { contactEmail: { equals: email, mode: 'insensitive' } },
          { submittedApplication: { email: { equals: email, mode: 'insensitive' } } },
        ],
      },
      include: {
        submittedApplication: {
          include: { informationRequests: { where: { status: ApplicationInformationRequestStatus.OPEN }, take: 1 } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    if (!drafts.length) return generic;

    try {
      await this.issueAndSend(email, drafts.map((draft) => ({
        id: draft.id,
        publicCode: draft.publicCode,
        status: draft.status,
        name: readName(draft.payload, draft.submittedApplication?.name),
        needsInfo: Boolean(draft.submittedApplication?.informationRequests.length),
      })), 'متابعة طلب المشاركة — مشروع الأجهزة الكهربائية', 'استخدم الرابط الآمن المناسب لمتابعة طلبك.');
    } catch {
      this.logger.warn(`Application access email delivery failed for ${drafts.length} record(s); no address or token was logged.`);
    }
    return generic;
  }

  async exchange(rawToken: string) {
    const token = rawToken.trim();
    if (token.length < 40) throw invalidAccess();
    const tokenHash = sha256Hex(token);
    await this.rateLimit.consume('application-access-exchange', tokenHash, { limit: 10, windowSeconds: 3600 });
    const now = new Date();
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + APPLICANT_SESSION_TTL_SECONDS * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const access = await tx.applicationAccessToken.findUnique({
        where: { tokenHash },
        include: { draft: { include: { submittedApplication: true } } },
      });
      if (!access || access.consumedAt || access.expiresAt <= now || access.draft.expiresAt <= now) return null;
      const consumed = await tx.applicationAccessToken.updateMany({
        where: { id: access.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      await tx.applicationApplicantSession.create({
        data: { draftId: access.draftId, tokenHash: sha256Hex(sessionToken), expiresAt },
      });
      return {
        draftCode: access.draft.publicCode,
        destination: access.draft.status === ApplicationDraftStatus.ACTIVE ? '/apply' : '/apply/status',
      };
    });
    if (!result) throw invalidAccess();
    return { ok: true as const, ...result, sessionToken, expiresAt };
  }

  async requireSessionDraft(draftCode: string, rawSession: string, includeApplication = false) {
    const sessionToken = rawSession.trim();
    if (!draftCode.trim() || sessionToken.length < 40) throw invalidAccess();
    const now = new Date();
    await this.rateLimit.consume('application-applicant-session', sha256Hex(sessionToken), { limit: 180, windowSeconds: 3600 });
    const session = await prisma.applicationApplicantSession.findFirst({
      where: {
        tokenHash: sha256Hex(sessionToken),
        revokedAt: null,
        expiresAt: { gt: now },
        draft: { publicCode: draftCode.trim(), expiresAt: { gt: now } },
      },
      include: { draft: { include: { attachments: true, submittedApplication: includeApplication } } },
    });
    if (!session) throw invalidAccess();
    await prisma.applicationApplicantSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    return session.draft;
  }

  async sendSubmitted(draftId: string): Promise<void> {
    const draft = await prisma.associationApplicationDraft.findUnique({ where: { id: draftId }, include: { submittedApplication: true } });
    const email = normalizeEmail(draft?.submittedApplication?.email ?? draft?.contactEmail ?? '');
    if (!draft || !email) return;
    await this.issueAndSend(email, [{ id: draft.id, publicCode: draft.publicCode, displayCode: draft.submittedApplication?.publicCode, status: draft.status, name: draft.submittedApplication?.name ?? 'الجمعية', needsInfo: false }],
      'متابعة طلب المشاركة — مشروع الأجهزة الكهربائية', 'تم استلام طلبك. استخدم الرابط الآمن لمتابعة حالته.');
  }

  async sendSelectionDecision(applicationId: string): Promise<void> {
    const application = await prisma.associationApplication.findUnique({
      where: { id: applicationId }, include: { sourceDraft: true },
    });
    const draft = application?.sourceDraft;
    const email = normalizeEmail(application?.email ?? '');
    if (!application || !draft || !email) throw new ApiError('APPLICATION_EMAIL_UNAVAILABLE', 'تعذر إرسال قرار الاختيار لعدم وجود بريد أو مسودة مرتبطة', 409);
    const intro = application.selectionList === 'MAIN'
      ? 'تم اختيار جمعيتكم في القائمة الأساسية. يمكنكم متابعة متطلبات التهيئة عبر رابط الطلب الآمن.'
      : 'تم اختيار جمعيتكم في قائمة الاحتياط. يمكنكم متابعة حالة الطلب عبر الرابط الآمن.';
    await this.issueAndSend(email, [{ id: draft.id, publicCode: draft.publicCode, displayCode: application.publicCode, status: draft.status, name: application.name, needsInfo: false }],
      'قرار اختيار الجمعية — مشروع الأجهزة الكهربائية', intro);
  }

  async sendNeedsInfo(applicationId: string): Promise<void> {
    const application = await prisma.associationApplication.findUnique({
      where: { id: applicationId },
      include: {
        sourceDraft: true,
        informationRequests: { where: { status: ApplicationInformationRequestStatus.OPEN }, orderBy: { requestedAt: 'desc' }, take: 1 },
      },
    });
    const draft = application?.sourceDraft;
    const email = normalizeEmail(application?.email ?? draft?.contactEmail ?? '');
    if (!application || !draft || !email || !application.informationRequests.length) throw new ApiError('APPLICATION_EMAIL_UNAVAILABLE', 'لا يوجد بريد رسمي صالح أو مسودة مرتبطة لإرسال رابط الاستكمال', 409);
    const note = application.informationRequests[0]!.note?.trim();
    await this.issueAndSend(email, [{ id: draft.id, publicCode: draft.publicCode, status: draft.status, name: application.name, needsInfo: true }],
      'مطلوب استكمال بيانات الطلب — مشروع الأجهزة الكهربائية', note ? `مطلوب استكمال بيانات الطلب: ${note}` : 'مطلوب استكمال بيانات محددة في طلبك.');
  }

  private async issueAndSend(
    email: string,
    drafts: Array<{ id: string; publicCode: string; displayCode?: string; status: ApplicationDraftStatus; name: string; needsInfo: boolean }>,
    subject: string,
    intro: string,
  ) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MINUTES * 60_000);
    const issued = drafts.map((draft) => ({ draft, raw: randomBytes(32).toString('base64url') }));
    await prisma.$transaction(async (tx) => {
      for (const item of issued) {
        await tx.applicationAccessToken.updateMany({ where: { draftId: item.draft.id, consumedAt: null }, data: { consumedAt: now } });
        await tx.applicationAccessToken.create({ data: {
          draftId: item.draft.id,
          purpose: item.draft.needsInfo
            ? ApplicationAccessTokenPurpose.NEEDS_INFO
            : item.draft.status === ApplicationDraftStatus.ACTIVE
              ? ApplicationAccessTokenPurpose.DRAFT_RESUME
              : ApplicationAccessTokenPurpose.SUBMITTED_STATUS,
          tokenHash: sha256Hex(item.raw),
          expiresAt,
        } });
      }
    });
    try {
      const base = publicWebUrl();
      await this.email.sendApplicationAccess({
        to: email,
        name: issued[0]?.draft.name ?? 'الجمعية',
        subject,
        intro,
        items: issued.map(({ draft, raw }) => ({
          label: draft.status === ApplicationDraftStatus.ACTIVE ? 'مسودة' : draft.needsInfo ? 'طلب يحتاج استكمالًا' : 'طلب',
          code: draft.displayCode ?? draft.publicCode,
          url: `${base}/apply/access?token=${encodeURIComponent(raw)}`,
        })),
      });
      await prisma.auditLog.createMany({ data: issued.map((item) => ({
        actorAccountId: null,
        actorRole: null,
        action: 'APPLICATION_ACCESS_EMAIL_SENT',
        entityType: 'association_application_drafts',
        entityId: item.draft.id,
        metadata: { purpose: item.draft.needsInfo ? 'NEEDS_INFO' : item.draft.status === ApplicationDraftStatus.ACTIVE ? 'DRAFT_RESUME' : 'SUBMITTED_STATUS' },
      })) });
    } catch (error) {
      await prisma.applicationAccessToken.updateMany({ where: { tokenHash: { in: issued.map((item) => sha256Hex(item.raw)) }, consumedAt: null }, data: { consumedAt: new Date() } });
      await prisma.auditLog.createMany({ data: issued.map((item) => ({
        actorAccountId: null,
        actorRole: null,
        action: 'APPLICATION_ACCESS_EMAIL_FAILED',
        entityType: 'association_application_drafts',
        entityId: item.draft.id,
      })) });
      throw error;
    }
  }
}

function normalizeEmail(value: string): string | null {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

function publicWebUrl(): string {
  const raw = process.env.PUBLIC_WEB_URL?.trim() || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  if (!raw) throw new Error('PUBLIC_WEB_URL is required for email links');
  const url = new URL(raw);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('PUBLIC_WEB_URL must use HTTPS in production');
  return url.origin;
}

function readName(payload: unknown, fallback?: string | null): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const organization = (payload as Record<string, unknown>).organization;
    if (organization && typeof organization === 'object' && !Array.isArray(organization)) {
      const name = (organization as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 150);
    }
  }
  return fallback?.trim() || 'الجمعية';
}

function invalidAccess() {
  return new ApiError('APPLICATION_ACCESS_INVALID', 'رابط الوصول غير صالح أو انتهت صلاحيته أو استُخدم بالفعل', 403);
}
