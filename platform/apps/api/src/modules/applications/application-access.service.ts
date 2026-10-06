import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ApplicationAccessTokenPurpose,
  ApplicationDraftStatus,
  ApplicationInformationRequestStatus,
  Prisma,
  prisma,
  OutboxEventType,
  OutboxEventStatus,
} from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { sha256Hex } from '../../common/crypto.util';
import { RateLimitService } from '../../common/rate-limit.service';
import { EmailService, enqueueEmail, decryptEmailDelivery, type EmailDeliveryPayload, type EmailDeliveryContext } from '../auth/email/email.service';
import { applicationRequirementDescription } from '@alzad/shared';
import type { AuthContext } from '../auth/auth.types';
import { assertAdminApplicationScope, assertAdminApplicationScopeCurrent } from '../auth/admin-route-permissions';

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

  async upgradeResumeToken(draftCodeRaw: string, resumeTokenRaw: string) {
    const draftCode = draftCodeRaw.trim();
    const resumeToken = resumeTokenRaw.trim();
    if (!draftCode || resumeToken.length < 32) throw invalidAccess();
    await this.rateLimit.consume('application-resume-session-upgrade', sha256Hex(resumeToken), { limit: 10, windowSeconds: 3600 });
    const now = new Date();
    const draft = await prisma.associationApplicationDraft.findFirst({
      where: { publicCode: draftCode, resumeTokenHash: sha256Hex(resumeToken), expiresAt: { gt: now } },
      select: { id: true, expiresAt: true },
    });
    if (!draft) throw invalidAccess();
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = draft.expiresAt;
    await prisma.applicationApplicantSession.create({
      data: { draftId: draft.id, tokenHash: sha256Hex(sessionToken), expiresAt },
    });
    return { ok: true as const, draftCode, sessionToken, expiresAt };
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

  async sendSubmitted(draftId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const draft = await (tx ?? prisma).associationApplicationDraft.findUnique({ where: { id: draftId }, include: { submittedApplication: true } });
    const email = normalizeEmail(draft?.submittedApplication?.email ?? draft?.contactEmail ?? '');
    if (!draft || !email) return false;
    return this.issueAndSend(email, [{ id: draft.id, publicCode: draft.publicCode, displayCode: draft.submittedApplication?.publicCode, status: draft.status, name: draft.submittedApplication?.name ?? 'الجمعية', needsInfo: false }],
      'متابعة طلب المشاركة — مشروع الأجهزة الكهربائية', 'تم استلام طلبك. استخدم الرابط الآمن لمتابعة حالته.', tx);
  }

  async sendSelectionDecision(applicationId: string, tx?: Prisma.TransactionClient, ctx?: AuthContext): Promise<boolean> {
    if (!tx) return prisma.$transaction(client => this.sendSelectionDecision(applicationId, client, ctx));
    const source = await tx.associationApplicationDraft.findFirst({ where: { submittedApplicationId: applicationId }, select: { id: true } });
    if (source) await tx.$queryRaw`SELECT id FROM association_application_drafts WHERE id=${source.id}::uuid FOR UPDATE`;
    const application = await tx.associationApplication.findUnique({
      where: { id: applicationId }, include: { sourceDraft: true },
    });
    const draft = application?.sourceDraft;
    const email = normalizeEmail(application?.email ?? '');
    if (!application || !draft || !email || application.selectionList !== 'MAIN' || application.status !== 'ACCEPTED') throw new ApiError('APPLICATION_EMAIL_UNAVAILABLE', 'يمكن إرسال الاعتماد للجمعيات الأساسية المعتمدة فقط', 409);
    if (ctx) assertAdminApplicationScope(ctx, application.regionOfficialCode); // The explicit sender locks the actor scope once for its whole batch.
    const delivery = await this.selectionDelivery(tx, application.id, application.selectionApprovedAt);
    if (['PENDING', 'ACCEPTED', 'UNKNOWN'].includes(delivery.status)) throw new ApiError('APPLICATION_SELECTION_EMAIL_EXISTS', 'سبق طلب إرسال الاعتماد أو تعذر إثبات نتيجة إرساله؛ لا تُنشأ رسالة مكررة', 409);
    const intro = 'تم اختيار جمعيتكم في القائمة الأساسية. يمكنكم متابعة متطلبات التهيئة عبر رابط الطلب الآمن.';
    return this.issueAndSend(email, [{ id: draft.id, publicCode: draft.publicCode, displayCode: application.publicCode, status: draft.status, name: application.name, needsInfo: false }],
      'قرار اختيار الجمعية — مشروع الأجهزة الكهربائية', intro, tx, { applicationId, selectionList: application.selectionList as 'MAIN' | 'RESERVE', selectionApprovedAt: application.selectionApprovedAt?.toISOString() ?? null });
  }

  async selectionDelivery(tx: Prisma.TransactionClient | typeof prisma, applicationId: string, selectionApprovedAt: Date | null, selectionList = 'MAIN'): Promise<{ status: 'NOT_REQUESTED' | 'PENDING' | 'ACCEPTED' | 'FAILED' | 'UNKNOWN'; requestedAt?: string }> {
    return (await this.selectionDeliveries(tx, [{ id: applicationId, selectionApprovedAt, selectionList }])).get(applicationId)!;
  }

  async selectionDeliveries(tx: Prisma.TransactionClient | typeof prisma, applications: Array<{ id: string; selectionApprovedAt: Date | null; selectionList?: string }>) {
    type Receipt = { status: 'NOT_REQUESTED' | 'PENDING' | 'ACCEPTED' | 'FAILED' | 'UNKNOWN'; requestedAt?: string };
    const result = new Map<string, Receipt>();
    if (!applications.length) return result;
    const ids = applications.map(application => application.id);
    const records = await tx.auditLog.findMany({ where: { action: 'APPLICATION_ACCESS_EMAIL_QUEUED', OR: ids.map(id => ({ metadata: { path: ['applicationId'], equals: id } })) }, select: { metadata: true, createdAt: true } });
    const eventIds = records.flatMap(record => typeof (record.metadata as { eventId?: unknown })?.eventId === 'string' ? [(record.metadata as { eventId: string }).eventId] : []);
    const events = await tx.outboxEvent.findMany({ where: { id: { in: eventIds } } });
    const origins = await tx.auditLog.findMany({ where: { action: 'APPLICATION_SELECTION_DECIDED', entityId: { in: ids }, metadata: { path: ['workflowVersion'], equals: 2 } }, select: { entityId: true, metadata: true } });
    for (const application of applications) {
      if (application.selectionList && application.selectionList !== 'MAIN') { result.set(application.id, { status: 'NOT_REQUESTED' }); continue; }
      let matched = false, failed = false;
      let receipt: Receipt | undefined;
      for (const record of records.filter(record => (record.metadata as { applicationId?: string; selectionList?: string })?.applicationId === application.id && (record.metadata as { selectionList?: string }).selectionList === 'MAIN')) {
      const id = (record.metadata as { eventId?: unknown })?.eventId;
      if (typeof id !== 'string') { receipt = { status: 'UNKNOWN' }; break; }
      const event = events.find(event => event.id === id);
      if (!event) { receipt = { status: 'UNKNOWN' }; break; }
      let delivery;
      try { delivery = decryptEmailDelivery(event.id, event.payload as unknown as EmailDeliveryPayload); } catch { receipt = { status: 'UNKNOWN' }; break; }
      if (delivery.context.type !== 'access' || delivery.context.expected?.selectionApprovedAt !== (application.selectionApprovedAt?.toISOString() ?? null)) continue;
      matched = true;
      const phase = (event.payload as unknown as EmailDeliveryPayload).phase;
      if (phase === 'SMTP_ACCEPTED' || event.status === OutboxEventStatus.PROCESSED) { receipt = { status: 'ACCEPTED', requestedAt: record.createdAt.toISOString() }; continue; }
      if (phase === 'SMTP_STARTED') { receipt = { status: 'UNKNOWN', requestedAt: record.createdAt.toISOString() }; break; }
      if (event.status === OutboxEventStatus.FAILED) failed = true;
      else if (receipt?.status !== 'ACCEPTED') receipt = { status: 'PENDING', requestedAt: record.createdAt.toISOString() };
      }
      const stamp = application.selectionApprovedAt?.toISOString() ?? null;
      const internal = origins.some(origin => origin.entityId === application.id && (origin.metadata as { selectionApprovedAt?: string })?.selectionApprovedAt === stamp);
      result.set(application.id, receipt ?? (matched && failed ? { status: 'FAILED' } : { status: internal ? 'NOT_REQUESTED' : 'UNKNOWN' }));
    }
    return result;
  }

  async cancelUnsentMainDecision(tx: Prisma.TransactionClient, applicationId: string, draftId: string, selectionApprovedAt: Date | null, ownerCorrection = false) {
    const blocked = () => new ApiError('APPLICATION_SELECTION_EMAIL_STARTED', 'لا يمكن النقل إلى الاحتياط بعد بدء إشعار الأساسية، أو عند تعذر إثبات أنه لم يُرسل', 409);
    if (!selectionApprovedAt && !ownerCorrection) throw blocked();
    // A resend must never make a historical MAIN decision eligible for reversal.
    // Only the original decision transaction can write this exact decision stamp.
    const origin = selectionApprovedAt ? await tx.auditLog.findFirst({ where: { entityType: 'association_applications', AND: [
      { metadata: { path: ['selectionApprovedAt'], equals: selectionApprovedAt.toISOString() } },
      { OR: [
        { action: 'APPLICATION_SELECTION_DECIDED', entityId: applicationId, metadata: { path: ['decision'], equals: 'MAIN' } },
        { action: 'APPLICATION_SELECTION_COMMITTED', metadata: { path: ['mainIds'], array_contains: [applicationId] } },
      ] },
    ] }, select: { id: true, metadata: true } }) : null;
    if (!origin && !ownerCorrection) throw blocked();
    const internalDecision = (origin?.metadata as { workflowVersion?: number } | undefined)?.workflowVersion === 2;
    const records = await tx.auditLog.findMany({ where: { action: 'APPLICATION_ACCESS_EMAIL_QUEUED', entityId: draftId, AND: [{ metadata: { path: ['applicationId'], equals: applicationId } }, { metadata: { path: ['selectionList'], equals: 'MAIN' } }] }, select: { metadata: true } });
    if (!records.length) {
      if (ownerCorrection || internalDecision) return;
      throw blocked(); // Historical SMTP outcomes have no reliable decision-specific receipt.
    }
    const ids = records.map(record => (record.metadata as { eventId?: unknown })?.eventId);
    if (ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw blocked();
    let currentDecisionTracked = false;
    for (const id of [...new Set(ids as string[])].sort()) {
      await tx.$queryRaw`SELECT id FROM outbox_events WHERE id=${id}::uuid FOR UPDATE`;
      const event = await tx.outboxEvent.findUnique({ where: { id } });
      const payload = event?.payload as unknown as EmailDeliveryPayload;
      if (!event || event.type !== OutboxEventType.EMAIL_DELIVERY) throw blocked();
      let delivery;
      try { delivery = decryptEmailDelivery(event.id, payload); } catch { throw blocked(); }
      const context = delivery.context;
      if (context.type !== 'access' || context.expected?.applicationId !== applicationId || context.expected.selectionList !== 'MAIN' || !Array.isArray(context.draftTokens) || !context.draftTokens.length || context.draftTokens.some(token => !token || typeof token.id !== 'string' || !token.id || token.draftId !== draftId)) throw blocked();
      if (!ownerCorrection && context.expected.selectionApprovedAt !== selectionApprovedAt?.toISOString()) continue;
      if (ownerCorrection && ['SMTP_STARTED', 'SMTP_ACCEPTED'].includes(payload.phase)) continue; // Never undo an in-flight or definite SMTP result.
      if (payload.phase !== 'READY' || event.status === OutboxEventStatus.PROCESSED || (event.status === OutboxEventStatus.FAILED && !event.lastError) || (event.lastError && !['MAIL_TEMPORARY_FAILURE', 'MAIL_STATE_UNAVAILABLE', 'MAIL_STATE_INVALID', 'MAIL_EXPIRED', 'MAIL_ATTACHMENT_INVALID', 'MAIL_CONFIGURATION_INVALID', 'MAIL_DELIVERY_REJECTED'].includes(event.lastError))) throw blocked();
      if (context.expected.selectionApprovedAt === selectionApprovedAt?.toISOString()) currentDecisionTracked = true;
      const cancelled = await tx.outboxEvent.updateMany({ where: { id: event.id, status: event.status, lockedAt: event.lockedAt, payload: { path: ['phase'], equals: 'READY' } }, data: { status: OutboxEventStatus.FAILED, failedAt: new Date(), lockedAt: null, lastError: 'MAIL_STATE_INVALID' } });
      if (cancelled.count !== 1) throw blocked();
      await tx.applicationAccessToken.updateMany({ where: { id: { in: context.draftTokens.map(token => token.id) }, draftId, consumedAt: null }, data: { consumedAt: new Date() } });
    }
    if (!currentDecisionTracked && !ownerCorrection && !internalDecision) throw blocked(); // Caller transaction rolls back all cancellations.
  }

  async sendNeedsInfo(applicationId: string, tx?: Prisma.TransactionClient, ctx?: AuthContext): Promise<boolean> {
    if (!tx) return prisma.$transaction(client => this.sendNeedsInfo(applicationId, client, ctx));
    const application = await (tx ?? prisma).associationApplication.findUnique({
      where: { id: applicationId },
      include: {
        sourceDraft: true,
        informationRequests: { where: { status: ApplicationInformationRequestStatus.OPEN }, include: { items: true }, orderBy: { requestedAt: 'desc' }, take: 1 },
      },
    });
    const draft = application?.sourceDraft;
    const email = normalizeEmail(application?.email ?? draft?.contactEmail ?? '');
    if (!application || !draft || !email || !application.informationRequests.length) throw new ApiError('APPLICATION_EMAIL_UNAVAILABLE', 'لا يوجد بريد رسمي صالح أو مسودة مرتبطة لإرسال رابط الاستكمال', 409);
    if (ctx) await assertAdminApplicationScopeCurrent(tx, ctx, application.regionOfficialCode);
    const request = application.informationRequests[0]!;
    const details = request.items.map((item, index) => `${index + 1}. ${applicationRequirementDescription(item.type, item.key, item.reason)}`).join('\n');
    const note = request.note?.trim();
    return this.issueAndSend(email, [{ id: draft.id, publicCode: draft.publicCode, status: draft.status, name: application.name, needsInfo: true }],
      'مطلوب استكمال بيانات الطلب — مشروع الأجهزة الكهربائية', `يرجى استكمال المتطلبات التالية عبر رابط طلبكم الآمن:\n${details}${note ? `\nملاحظة: ${note}` : ''}`, tx, { applicationId, informationRequestId: request.id });
  }

  private async issueAndSend(
    email: string,
    drafts: Array<{ id: string; publicCode: string; displayCode?: string; status: ApplicationDraftStatus; name: string; needsInfo: boolean }>,
    subject: string,
    intro: string,
    transaction?: Prisma.TransactionClient,
    expected?: Extract<EmailDeliveryContext, { type: 'access' }>['expected'],
  ): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MINUTES * 60_000);
    const queue = async (tx: Prisma.TransactionClient) => {
      const issued: Array<{ draft: typeof drafts[number]; raw: string }> = [];
      const draftTokens: Array<{ id: string; draftId: string; predecessorIds: string[] }> = [];
      // Same ordered draft locks as the worker; capture only existing predecessors.
      for (const draftId of [...new Set(drafts.map((draft) => draft.id))].sort()) {
        await tx.$queryRaw`SELECT id FROM association_application_drafts WHERE id=${draftId}::uuid FOR UPDATE`;
      }
      for (const draft of drafts) {
        const current = await tx.associationApplicationDraft.findUnique({ where: { id: draft.id }, select: { status: true, expiresAt: true } });
        if (!current || current.expiresAt <= now || ![ApplicationDraftStatus.ACTIVE, ApplicationDraftStatus.SUBMITTED].includes(current.status as 'ACTIVE' | 'SUBMITTED')) continue;
        issued.push({ draft, raw: randomBytes(32).toString('base64url') });
      }
      for (const item of issued) {
        const predecessors = await tx.applicationAccessToken.findMany({ where: { draftId: item.draft.id, consumedAt: null, expiresAt: { gt: now } }, select: { id: true } });
        const token = await tx.applicationAccessToken.create({ data: {
          draftId: item.draft.id,
          purpose: item.draft.needsInfo
            ? ApplicationAccessTokenPurpose.NEEDS_INFO
            : item.draft.status === ApplicationDraftStatus.ACTIVE
              ? ApplicationAccessTokenPurpose.DRAFT_RESUME
              : ApplicationAccessTokenPurpose.SUBMITTED_STATUS,
          tokenHash: sha256Hex(item.raw),
          expiresAt,
        } });
        draftTokens.push({ id: token.id, draftId: item.draft.id, predecessorIds: predecessors.map(({ id }) => id) });
      }
      if (!issued.length) return false;
      const base = publicWebUrl();
      const queued = await enqueueEmail(tx, 'APPLICATION_ACCESS', {
        to: email,
        name: issued[0]?.draft.name ?? 'الجمعية',
        subject,
        intro,
        items: issued.map(({ draft, raw }) => ({
          label: draft.status === ApplicationDraftStatus.ACTIVE ? 'مسودة' : draft.needsInfo ? 'طلب يحتاج استكمالًا' : 'طلب',
          code: draft.displayCode ?? draft.publicCode,
          url: `${base}/apply/access?token=${encodeURIComponent(raw)}`,
        })),
      }, { type: 'access', draftTokens, ...(expected ? { expected } : {}) });
      await tx.auditLog.createMany({ data: issued.map((item) => ({
        actorAccountId: null,
        actorRole: null,
        action: 'APPLICATION_ACCESS_EMAIL_QUEUED',
        entityType: 'association_application_drafts',
        entityId: item.draft.id,
        metadata: { eventId: queued.eventId, ...(expected?.selectionList ? { applicationId: expected.applicationId, selectionList: expected.selectionList } : {}), purpose: item.draft.needsInfo ? 'NEEDS_INFO' : item.draft.status === ApplicationDraftStatus.ACTIVE ? 'DRAFT_RESUME' : 'SUBMITTED_STATUS' },
      })) });
      return true;
    };
    if (transaction) return queue(transaction);
    return prisma.$transaction(queue);
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
